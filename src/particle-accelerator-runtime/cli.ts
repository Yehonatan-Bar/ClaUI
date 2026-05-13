import * as fs from 'fs';
import { enforceNoNetwork } from './NoNetworkGuard';
import { createSecretRedactor } from './SecretRedactor';
import { executeShellCommand } from './executeShellCommand';
import { classifyCommand } from './CommandEligibility';
import { CommandTraceWriter } from './CommandTraceWriter';
import { OutputFilterRegistry, estimateTokens } from './filters/OutputFilterRegistry';
import { GenericFilter } from './filters/GenericFilter';
import { JavaScriptPackageFilter } from './filters/JavaScriptPackageFilter';
import { PytestFilter } from './filters/PytestFilter';
import { JestVitestFilter } from './filters/JestVitestFilter';
import { TypeScriptFilter } from './filters/TypeScriptFilter';
import { EslintFilter } from './filters/EslintFilter';
import {
  ParticleAcceleratorTrace, ParticleAcceleratorContextFile, FilterConfig,
  CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION,
} from '../extension/particle-accelerator/ParticleAcceleratorTypes';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

async function main(): Promise<void> {
  try {
    enforceNoNetwork();
  } catch {
    // Non-fatal if guard setup fails
  }

  const args = process.argv.slice(2);
  let command: string;

  // Parse CLI args
  const encodedIdx = args.indexOf('--claui-encoded-shell-command');
  if (encodedIdx !== -1 && args[encodedIdx + 1]) {
    command = base64urlDecode(args[encodedIdx + 1]);
  } else if (args[0] === '--') {
    command = args.slice(1).join(' ');
  } else {
    process.stderr.write('[claui-particle-accelerator] Usage: claui-run --claui-encoded-shell-command <base64url> | claui-run -- <command...>\n');
    process.exit(1);
  }

  if (!command) {
    process.stderr.write('[claui-particle-accelerator] Runner failed before executing command: empty command\n');
    process.exit(127);
  }

  // Read env vars
  const contextFilePath = process.env.CLAUI_PARTICLE_ACCELERATOR_CONTEXT_FILE ?? '';
  const storeDir = process.env.CLAUI_PARTICLE_ACCELERATOR_STORE_DIR ?? '';
  const shellOverride = process.env.CLAUI_PARTICLE_ACCELERATOR_SHELL;
  const filterProfile = (process.env.CLAUI_PARTICLE_ACCELERATOR_FILTER_PROFILE ?? 'balanced') as 'balanced' | 'strict' | 'verbose';
  const storeRawLogs = process.env.CLAUI_PARTICLE_ACCELERATOR_STORE_RAW_LOGS !== 'false';

  // Read context file
  let context: ParticleAcceleratorContextFile | null = null;
  if (contextFilePath) {
    try {
      const raw = fs.readFileSync(contextFilePath, 'utf8');
      context = JSON.parse(raw);
    } catch {
      // Context file missing or corrupt; continue without it
    }
  }

  const cwd = process.cwd();
  const shell = shellOverride ?? detectShell();

  // Create secret redactor from current env snapshot
  const envSnapshot: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) envSnapshot[k] = v;
  }
  const redactor = createSecretRedactor(envSnapshot);

  // Execute command
  const result = await executeShellCommand(command, {
    cwd,
    shell,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });

  // Redact stdout and stderr
  let redactedStdout = result.stdout;
  let redactedStderr = result.stderr;
  let totalRedactions = 0;
  const allRulesTriggered = new Set<string>();

  try {
    const stdoutResult = redactor.redact(result.stdout);
    redactedStdout = stdoutResult.text;
    totalRedactions += stdoutResult.replacements;
    stdoutResult.rulesTriggered.forEach(r => allRulesTriggered.add(r));

    const stderrResult = redactor.redact(result.stderr);
    redactedStderr = stderrResult.text;
    totalRedactions += stderrResult.replacements;
    stderrResult.rulesTriggered.forEach(r => allRulesTriggered.add(r));
  } catch {
    redactedStdout = '[claui-particle-accelerator] Output suppressed: redaction error.';
    redactedStderr = '';
    allRulesTriggered.add('ERROR');
  }

  // Classify command for filter selection
  const classification = classifyCommand(command);
  const commandFamily = classification.commandFamily ?? 'unknown';

  // Set up filter registry
  const registry = new OutputFilterRegistry();
  registry.register(new JavaScriptPackageFilter());
  registry.register(new PytestFilter());
  registry.register(new JestVitestFilter());
  registry.register(new TypeScriptFilter());
  registry.register(new EslintFilter());
  registry.register(new GenericFilter()); // Must be last (fallback)

  // Load filter config if available
  if (storeDir) {
    try {
      const configPath = `${storeDir}/config/filters.json`;
      const configRaw = fs.readFileSync(configPath, 'utf8');
      const filterConfig: FilterConfig = JSON.parse(configRaw);
      registry.setConfig(filterConfig);
    } catch {
      // No config or invalid; use defaults
    }
  }

  // Apply filter
  let filterOutput;
  let fallbackUsed = false;
  try {
    filterOutput = registry.applyFilter({
      command,
      commandFamily,
      stdout: redactedStdout,
      stderr: redactedStderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      profile: filterProfile,
      redactionResult: {
        text: redactedStdout,
        replacements: totalRedactions,
        rulesTriggered: Array.from(allRulesTriggered),
      },
    });
  } catch {
    // Filter failed: use bounded redacted output
    fallbackUsed = true;
    const cap = 16000;
    filterOutput = {
      filteredStdout: redactedStdout.slice(0, cap),
      filteredStderr: redactedStderr.slice(0, cap / 4),
      header: `[claui-particle-accelerator] ${command} exited ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s. Filter error: fallback used.`,
      filterName: 'GenericFilter',
      filterVersion: '1.0.0',
      rawStdoutBytes: Buffer.byteLength(redactedStdout, 'utf8'),
      rawStderrBytes: Buffer.byteLength(redactedStderr, 'utf8'),
      filteredStdoutBytes: Math.min(Buffer.byteLength(redactedStdout, 'utf8'), cap),
      filteredStderrBytes: Math.min(Buffer.byteLength(redactedStderr, 'utf8'), cap / 4),
      estimatedTokensSaved: 0,
    };
  }

  // Write trace and raw logs
  const traceId = CommandTraceWriter.generateTraceId();

  if (storeDir) {
    const traceWriter = new CommandTraceWriter(storeDir);

    // Write raw redacted logs
    let stdoutLogPath: string | null = null;
    let stderrLogPath: string | null = null;

    if (storeRawLogs) {
      try {
        await traceWriter.writeRawLog(traceId, 'stdout', redactedStdout);
        stdoutLogPath = `raw/${new Date().toISOString().slice(0, 10)}/${traceId}.stdout.log`;
      } catch {
        // Can't write raw log; continue
      }
      try {
        await traceWriter.writeRawLog(traceId, 'stderr', redactedStderr);
        stderrLogPath = `raw/${new Date().toISOString().slice(0, 10)}/${traceId}.stderr.log`;
      } catch {
        // Can't write raw log; continue
      }
    }

    // Build trace
    const rawStdoutBytes = Buffer.byteLength(result.stdout, 'utf8');
    const rawStderrBytes = Buffer.byteLength(result.stderr, 'utf8');
    const totalRaw = rawStdoutBytes + rawStderrBytes;
    const totalFiltered = filterOutput.filteredStdoutBytes + filterOutput.filteredStderrBytes;

    const trace: ParticleAcceleratorTrace = {
      schemaVersion: CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION,
      traceId,
      timestamp: new Date().toISOString(),
      provider: context?.provider ?? 'claude',
      tabRuntimeId: context?.tabRuntimeId ?? 'unknown',
      sessionId: context?.sessionId ?? null,
      turnId: context?.turnId ?? null,
      workspacePath: context?.workspacePath ?? cwd,
      command: {
        original: command,
        family: commandFamily,
        encoded: base64urlEncode(command),
      },
      execution: {
        exitCode: result.exitCode,
        signal: result.signal,
        interrupted: result.interrupted,
        durationMs: result.durationMs,
        shell,
      },
      output: {
        rawStdoutBytes,
        rawStderrBytes,
        filteredStdoutBytes: filterOutput.filteredStdoutBytes,
        filteredStderrBytes: filterOutput.filteredStderrBytes,
        estimatedTokensSaved: estimateTokens(totalRaw - totalFiltered),
        compressionRatio: totalRaw > 0 ? totalRaw / (totalFiltered || 1) : 1,
      },
      filter: {
        name: filterOutput.filterName,
        version: filterOutput.filterVersion,
        profile: filterProfile,
        fallbackUsed,
      },
      redaction: {
        replacements: totalRedactions,
        rulesTriggered: Array.from(allRulesTriggered),
      },
      storage: {
        stdoutLogPath,
        stderrLogPath,
      },
    };

    try {
      await traceWriter.writeTrace(trace);
    } catch {
      process.stderr.write('[claui-particle-accelerator] Warning: failed to write trace file\n');
    }
  }

  // Output filtered results
  const finalStdout = filterOutput.header + '\n' + filterOutput.filteredStdout;
  const finalStderr = filterOutput.filteredStderr;

  if (finalStdout) process.stdout.write(finalStdout);
  if (finalStderr) process.stderr.write(finalStderr);

  process.exit(result.exitCode ?? 1);
}

function base64urlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function base64urlEncode(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function detectShell(): string {
  if (process.platform !== 'win32') return '/bin/sh';

  // Prefer the SHELL env var set by Git Bash / MSYS2
  const envShell = process.env.SHELL;
  if (envShell) {
    // MSYS paths like /usr/bin/bash need converting to Windows paths
    const msysRoot = process.env.MSYSTEM_PREFIX;
    if (msysRoot && envShell.startsWith('/')) {
      const winPath = msysRoot + envShell.replace(/\//g, '\\');
      try { fs.accessSync(winPath); return winPath; } catch { /* fall through */ }
    }
    // Try the raw value (might already be a Windows path)
    try { fs.accessSync(envShell); return envShell; } catch { /* fall through */ }
  }

  // Look for Git Bash in common locations
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of candidates) {
    try { fs.accessSync(p); return p; } catch { /* continue */ }
  }

  return 'cmd.exe';
}

main().catch((err) => {
  process.stderr.write(`[claui-particle-accelerator] Runner failed before executing command: ${err?.message ?? err}\n`);
  process.exit(127);
});
