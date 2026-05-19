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
import { GitSemanticFilter } from './filters/GitSemanticFilter';
import { DeclarativeFilter } from './filters/DeclarativeFilter';
import { BUILTIN_DEFINITIONS } from './filters/builtinDefinitions';
import { loadUserFilters } from './filters/UserFilterLoader';
import {
  ParticleAcceleratorTrace, ParticleAcceleratorContextFile, FilterConfig,
  CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION,
} from '../extension/particle-accelerator/ParticleAcceleratorTypes';
import { CompositeSecretScanner } from '../shared/secret-protection/scanners/CompositeSecretScanner';
import { RedactionEngine } from '../shared/secret-protection/RedactionEngine';
import type { SecretProtectionSettings, FindingSeverity } from '../shared/secret-protection/types';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

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

  // Secret Protection DLP scanning (complements existing SecretRedactor)
  let dlpFindingCount = 0;
  const dlpBoundaries: string[] = [];
  let dlpSeverityMax: string | null = null;
  let dlpRedactionTokenCount = 0;

  const secretProtectionEnabled = process.env.CLAUI_SECRET_PROTECTION === '1';
  const secretProtectionMode = process.env.CLAUI_SECRET_PROTECTION_MODE ?? 'balanced';
  const scanTerminalOutput = process.env.CLAUI_SECRET_PROTECTION_SCAN_TERMINAL !== 'false';

  // Shared scanner instance: reused for both terminal and persistence boundaries
  let dlpScanner: CompositeSecretScanner | null = null;

  if (secretProtectionEnabled && secretProtectionMode !== 'off') {
    try {
      const spSettings: SecretProtectionSettings = {
        enabled: true,
        mode: secretProtectionMode as SecretProtectionSettings['mode'],
        blockProtectedPaths: true,
        scanPrompts: true,
        scanTerminalOutput,
        scanGitPublication: true,
        scanMcp: true,
        requireBrowserCaptureApproval: true,
        exceptionMaxMinutes: 30,
        auditRetentionDays: 90,
        enableEntropyScanner: process.env.CLAUI_SECRET_PROTECTION_ENTROPY === 'true',
      };
      dlpScanner = new CompositeSecretScanner(spSettings);
    } catch {
      // Scanner construction failure; proceed without DLP
    }
  }

  const STRUCTURED_TOKEN_RE = /<REDACTED\s+type="[^"]*"\s+id="[^"]*"\s*\/>/g;

  if (dlpScanner && scanTerminalOutput) {
    try {
      const terminalContext = {
        boundary: 'command.output' as const,
        destination: { kind: 'terminal_stdout_to_agent' as const, trustTier: 'trusted_local' as const },
      };

      // Scan stdout and stderr SEPARATELY so byte offsets match each string
      const stdoutScan = dlpScanner.scan(redactedStdout, terminalContext);
      const stderrScan = dlpScanner.scan(redactedStderr, terminalContext);

      dlpFindingCount = stdoutScan.findings.length + stderrScan.findings.length;
      if (dlpFindingCount > 0) {
        dlpBoundaries.push('command.output');
      }

      const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      let maxSevNum = 0;
      for (const f of [...stdoutScan.findings, ...stderrScan.findings]) {
        const num = severityOrder[f.severity] ?? 0;
        if (num > maxSevNum) {
          maxSevNum = num;
          dlpSeverityMax = f.severity;
        }
      }

      if (secretProtectionMode === 'strict' || secretProtectionMode === 'balanced') {
        const dlpEngine = new RedactionEngine();

        if (stdoutScan.findings.length > 0) {
          const r = dlpEngine.redact(redactedStdout, stdoutScan.findings);
          redactedStdout = r.redacted.replace(STRUCTURED_TOKEN_RE, '[REDACTED]');
          dlpRedactionTokenCount += r.replacementCount;
          totalRedactions += r.replacementCount;
        }

        if (stderrScan.findings.length > 0) {
          const engine2 = new RedactionEngine();
          const r = engine2.redact(redactedStderr, stderrScan.findings);
          redactedStderr = r.redacted.replace(STRUCTURED_TOKEN_RE, '[REDACTED]');
          dlpRedactionTokenCount += r.replacementCount;
          totalRedactions += r.replacementCount;
        }
      }
    } catch {
      // DLP scanning is best-effort in the CLI pipeline
    }
  }

  // Classify command for filter selection
  const classification = classifyCommand(command);
  const commandFamily = classification.commandFamily ?? 'unknown';

  // Set up filter registry
  const registry = new OutputFilterRegistry();

  // User custom declarative filters (highest priority)
  const userDefs = loadUserFilters(storeDir, cwd);
  if (userDefs.length > 0) {
    registry.register(new DeclarativeFilter(userDefs));
  }

  // Existing specialized filters
  registry.register(new JavaScriptPackageFilter());
  registry.register(new PytestFilter());
  registry.register(new JestVitestFilter());
  registry.register(new TypeScriptFilter());
  registry.register(new EslintFilter());

  // Git semantic filter
  registry.register(new GitSemanticFilter());

  // Built-in declarative filters (55+ command definitions)
  registry.register(new DeclarativeFilter(BUILTIN_DEFINITIONS));

  // Generic fallback (must be last)
  registry.register(new GenericFilter());

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

    // Write raw redacted logs (persistence boundary: may apply stricter
    // redaction than terminal output -- e.g. PII is allowed to terminal
    // but redacted for persistence)
    let stdoutLogPath: string | null = null;
    let stderrLogPath: string | null = null;

    if (storeRawLogs) {
      let persistStdout = redactedStdout;
      let persistStderr = redactedStderr;

      if (dlpScanner) {
        try {
          const persistContext = {
            boundary: 'persistence.write' as const,
            destination: { kind: 'local_disk' as const, trustTier: 'trusted_local' as const },
          };
          const pStdout = dlpScanner.scan(persistStdout, persistContext);
          if (pStdout.findings.length > 0) {
            const eng = new RedactionEngine();
            const pResult = eng.redact(persistStdout, pStdout.findings);
            persistStdout = pResult.redacted.replace(STRUCTURED_TOKEN_RE, '[REDACTED]');
            dlpFindingCount += pStdout.findings.length;
            dlpRedactionTokenCount += pResult.replacementCount;
            if (!dlpBoundaries.includes('persistence.write')) {
              dlpBoundaries.push('persistence.write');
            }
          }
          const pStderr = dlpScanner.scan(persistStderr, persistContext);
          if (pStderr.findings.length > 0) {
            const eng = new RedactionEngine();
            const pResult = eng.redact(persistStderr, pStderr.findings);
            persistStderr = pResult.redacted.replace(STRUCTURED_TOKEN_RE, '[REDACTED]');
            dlpFindingCount += pStderr.findings.length;
            dlpRedactionTokenCount += pResult.replacementCount;
          }
          // Update severity max from persistence findings
          const persistSeverityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          for (const f of [...pStdout.findings, ...pStderr.findings]) {
            const num = persistSeverityOrder[f.severity] ?? 0;
            const curMax = dlpSeverityMax ? (persistSeverityOrder[dlpSeverityMax] ?? 0) : 0;
            if (num > curMax) {
              dlpSeverityMax = f.severity;
            }
          }
        } catch {
          // Persistence scan failure; write with terminal-redacted content
        }
      }

      try {
        await traceWriter.writeRawLog(traceId, 'stdout', persistStdout);
        stdoutLogPath = `raw/${new Date().toISOString().slice(0, 10)}/${traceId}.stdout.log`;
      } catch {
        // Can't write raw log; continue
      }
      try {
        await traceWriter.writeRawLog(traceId, 'stderr', persistStderr);
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

    // DLP: scan command string before persisting in trace (may contain secrets as args)
    let safeCommand = command;
    if (dlpScanner) {
      try {
        const cmdContext = {
          boundary: 'persistence.write' as const,
          destination: { kind: 'local_disk' as const, trustTier: 'trusted_local' as const },
        };
        const cmdScan = dlpScanner.scan(command, cmdContext);
        if (cmdScan.findings.length > 0) {
          const cmdEngine = new RedactionEngine();
          safeCommand = cmdEngine.redact(command, cmdScan.findings).redacted
            .replace(STRUCTURED_TOKEN_RE, '[REDACTED]');
          dlpFindingCount += cmdScan.findings.length;
          dlpRedactionTokenCount += cmdScan.findings.length;
          if (!dlpBoundaries.includes('persistence.write')) {
            dlpBoundaries.push('persistence.write');
          }
          const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          for (const f of cmdScan.findings) {
            const num = severityOrder[f.severity] ?? 0;
            const curMax = dlpSeverityMax ? (severityOrder[dlpSeverityMax] ?? 0) : 0;
            if (num > curMax) {
              dlpSeverityMax = f.severity;
            }
          }
        }
      } catch {
        // Command scan failure; persist original command
      }
    }

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
        original: safeCommand,
        family: commandFamily,
        encoded: base64urlEncode(safeCommand),
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
        rawLines: countLines(result.stdout) + countLines(result.stderr),
        filteredLines: countLines(filterOutput.filteredStdout) + countLines(filterOutput.filteredStderr),
        rawWords: countWords(result.stdout) + countWords(result.stderr),
        filteredWords: countWords(filterOutput.filteredStdout) + countWords(filterOutput.filteredStderr),
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
      dlp: secretProtectionEnabled ? {
        findingCount: dlpFindingCount,
        boundaries: dlpBoundaries,
        severityMax: dlpSeverityMax,
        redactionTokenCount: dlpRedactionTokenCount,
      } : undefined,
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
