import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SpaSecretScanner } from '../SecretScanner';
import { SecretWritePolicyEngine } from '../SecretWritePolicyEngine';
import { PathClassifier } from '../PathClassifier';
import { GitStateScanner } from '../GitStateScanner';
import { SpaAuditWriter } from '../AuditWriter';
import { ExceptionLoader } from '../ExceptionLoader';
import { BaselineStore } from '../BaselineStore';
import {
  SpaHookEvent,
  SuperParticleAcceleratorSettings,
  SecretWritePolicyDecision,
  SecretFinding,
  SuperParticleAcceleratorAuditEvent,
  ScanSource,
} from '../../shared/super-particle-accelerator/types';

const TIMEOUT_MS = 5000;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const BASH_WRITE_PATTERNS = [
  /\b(echo|printf)\s+.*>\s*/,
  /\bcat\s+.*>\s*/,
  /\btee\s+/,
  /\bsed\s+-i/,
  /\bperl\s+-pi/,
  /\bnode\s+-e\s+.*fs\.writeFileSync/,
  /\bpython\s+-c\s+.*open\(.*,\s*['"]w['"]\)/,
];

const GIT_DEPLOY_PATTERNS = [
  /\bgit\s+(add|commit|push)\b/,
  /\bgh\s+pr\s+create\b/,
  /\b(npm|pnpm|yarn)\s+run\s+deploy\b/,
  /\b(vercel|netlify|firebase|gcloud(\s+app)?)\s+deploy\b/,
];

function parseHookEvent(): SpaHookEvent {
  const markerIdx = process.argv.indexOf('--claui-spa-hook');
  if (markerIdx === -1 || markerIdx + 1 >= process.argv.length) {
    throw new Error('Missing hook event argument after --claui-spa-hook');
  }
  const event = process.argv[markerIdx + 1];
  if (!['PreToolUse', 'PostToolUse', 'Stop'].includes(event)) {
    throw new Error(`Unknown hook event: ${event}`);
  }
  return event as SpaHookEvent;
}

function installTimeout(hookEvent: SpaHookEvent): void {
  const timer = setTimeout(() => {
    if (hookEvent === 'PreToolUse') {
      const deny = {
        hookSpecificOutput: {
          hookEventName: hookEvent,
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Super Particle Accelerator timed out scanning this operation. Blocked as a precaution.',
        },
      };
      process.stdout.write(JSON.stringify(deny));
    }
    process.exit(0);
  }, TIMEOUT_MS);
  timer.unref();
}

function allow(): void {
  process.exit(0);
}

function deny(reason: string, hookEvent: SpaHookEvent = 'PreToolUse'): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: hookEvent,
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function loadSettingsFromEnv(): SuperParticleAcceleratorSettings {
  return {
    enabled: process.env.CLAUI_SPA === '1',
    mode: (process.env.CLAUI_SPA_MODE as 'block' | 'audit') || 'block',
    scanEditTools: process.env.CLAUI_SPA_SCAN_EDIT !== '0',
    scanBashCommands: process.env.CLAUI_SPA_SCAN_BASH !== '0',
    scanMcpTools: process.env.CLAUI_SPA_SCAN_MCP !== '0',
    scanWorkingTreeOnStop: process.env.CLAUI_SPA_SCAN_STOP !== '0',
    blockGitCommitPush: process.env.CLAUI_SPA_BLOCK_GIT !== '0',
    allowIgnoredEnvFiles: process.env.CLAUI_SPA_ALLOW_IGNORED_ENV !== '0',
    entropyThreshold: parseFloat(process.env.CLAUI_SPA_ENTROPY_THRESHOLD || '4.2'),
    frontendPathGlobs: safeJsonParse(process.env.CLAUI_SPA_FRONTEND_GLOBS, [
      'public/**', 'static/**', 'dist/**', 'build/**',
      'client/**', 'frontend/**', 'web/**',
      'src/**/*.html', 'src/**/*.tsx', 'src/**/*.jsx',
      'src/**/*.js', 'src/**/*.ts',
    ]),
    allowedSecretFileGlobs: safeJsonParse(process.env.CLAUI_SPA_ALLOWED_SECRET_GLOBS, [
      '.env.local', '.env.*.local', '*.local.env',
    ]),
  };
}

function safeJsonParse<T>(str: string | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function buildAuditEvent(
  decision: SecretWritePolicyDecision,
  toolName: string,
  source: ScanSource,
  provider: 'claude' | 'codex',
  sessionId?: string,
  turnId?: string,
  filePath?: string,
): SuperParticleAcceleratorAuditEvent {
  return {
    id: createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16),
    timestamp: new Date().toISOString(),
    provider,
    sessionId,
    turnId,
    workspacePathHash: createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12),
    toolName,
    source,
    action: decision.action,
    reason: decision.reason,
    filePath,
    findings: decision.findings.map(f => ({
      ruleId: f.ruleId,
      type: f.type,
      severity: f.severity,
      confidence: f.confidence,
      valueSha256: f.valueSha256,
      redactedPreview: f.redactedPreview,
      line: f.line,
    })),
  };
}

function isBashWriteCommand(command: string): boolean {
  return BASH_WRITE_PATTERNS.some(p => p.test(command));
}

function isGitDeployCommand(command: string): boolean {
  return GIT_DEPLOY_PATTERNS.some(p => p.test(command));
}

async function handleEditWrite(
  input: { tool_name: string; tool_input: Record<string, unknown> },
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  const filePath = (input.tool_input.file_path || input.tool_input.path) as string | undefined;
  const rawContent = (input.tool_input.content || input.tool_input.new_string || '') as string;

  if (!rawContent) return allow();
  const content = rawContent.length > MAX_SCAN_BYTES ? rawContent.slice(0, MAX_SCAN_BYTES) : rawContent;

  const findings = scanner.scan({
    text: content,
    source: 'edit',
    provider: 'claude',
    filePath,
    cwd: process.cwd(),
    sessionId: process.env.CLAUI_SESSION_ID,
  });

  let isFileGitIgnored: boolean | undefined;
  if (filePath && settings.allowIgnoredEnvFiles) {
    const gitScanner = new GitStateScanner(scanner, process.cwd(), 'claude');
    isFileGitIgnored = gitScanner.isGitIgnored(filePath);
  }

  const exceptions = exceptionLoader.loadActive();
  const decision = policy.evaluate({
    findings,
    filePath,
    source: 'edit',
    provider: 'claude',
    toolName: input.tool_name,
    cwd: process.cwd(),
    settings,
    exceptions,
    isFileGitIgnored,
  });

  if (decision.consumedExceptionIds.length > 0) {
    exceptionLoader.consumeMany(decision.consumedExceptionIds);
  }

  if (decision.action !== 'allow') {
    audit.write(buildAuditEvent(decision, input.tool_name, 'edit', 'claude',
      process.env.CLAUI_SESSION_ID, undefined, filePath));
  }

  if (decision.action === 'deny') {
    return deny(
      `Super Particle Accelerator blocked this action.\n\n${decision.reason}\n\n${decision.remediation ?? ''}`,
    );
  }

  return allow();
}

async function handleBash(
  input: { tool_name: string; tool_input: Record<string, unknown> },
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  const command = (input.tool_input.command || '') as string;
  if (!command) return allow();

  if (settings.blockGitCommitPush && isGitDeployCommand(command)) {
    const gitScanner = new GitStateScanner(scanner, process.cwd(), 'claude');
    const stagedFindings = gitScanner.scanStagedDiff();
    const unstagedFindings = gitScanner.scanUnstagedDiff();
    const untrackedFindings = gitScanner.scanUntrackedFiles();
    const allFindings = [...stagedFindings, ...unstagedFindings, ...untrackedFindings];

    if (allFindings.length > 0) {
      const exceptions = exceptionLoader.loadActive();
      const decision = policy.evaluate({
        findings: allFindings,
        source: 'staged-diff',
        provider: 'claude',
        toolName: 'Bash',
        command,
        cwd: process.cwd(),
        settings,
        exceptions,
      });

      if (decision.action === 'deny') {
        audit.write(buildAuditEvent(decision, 'Bash', 'staged-diff', 'claude',
          process.env.CLAUI_SESSION_ID));
        return deny(
          `Super Particle Accelerator blocked this git operation.\n\n${decision.reason}\n\n${decision.remediation ?? ''}`,
        );
      }
    }
  }

  // Scan command text for inline secrets (file-write commands)
  if (isBashWriteCommand(command)) {
    const findings = scanner.scan({
      text: command,
      source: 'bash-command',
      provider: 'claude',
      cwd: process.cwd(),
      sessionId: process.env.CLAUI_SESSION_ID,
    });

    if (findings.length > 0) {
      const exceptions = exceptionLoader.loadActive();
      const decision = policy.evaluate({
        findings,
        source: 'bash-command',
        provider: 'claude',
        toolName: 'Bash',
        command,
        cwd: process.cwd(),
        settings,
        exceptions,
      });

      if (decision.action === 'deny') {
        audit.write(buildAuditEvent(decision, 'Bash', 'bash-command', 'claude',
          process.env.CLAUI_SESSION_ID));
        return deny(
          `Super Particle Accelerator blocked this command.\n\n${decision.reason}\n\n${decision.remediation ?? ''}`,
        );
      }
    }
  }

  return allow();
}

async function handleMcp(
  input: { tool_name: string; tool_input: Record<string, unknown> },
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  const allStrings = extractStrings(input.tool_input);
  const rawText = allStrings.join('\n');

  if (!rawText) return allow();
  const text = rawText.length > MAX_SCAN_BYTES ? rawText.slice(0, MAX_SCAN_BYTES) : rawText;

  const findings = scanner.scan({
    text,
    source: 'mcp-args',
    provider: 'claude',
    cwd: process.cwd(),
    sessionId: process.env.CLAUI_SESSION_ID,
  });

  if (findings.length === 0) return allow();

  const exceptions = exceptionLoader.loadActive();
  const decision = policy.evaluate({
    findings,
    source: 'mcp-args',
    provider: 'claude',
    toolName: input.tool_name,
    cwd: process.cwd(),
    settings,
    exceptions,
  });

  if (decision.action !== 'allow') {
    audit.write(buildAuditEvent(decision, input.tool_name, 'mcp-args', 'claude',
      process.env.CLAUI_SESSION_ID));
  }

  if (decision.action === 'deny') {
    return deny(
      `Super Particle Accelerator blocked this MCP call.\n\n${decision.reason}\n\n${decision.remediation ?? ''}`,
    );
  }

  return allow();
}

function extractStrings(obj: unknown): string[] {
  const result: string[] = [];
  if (typeof obj === 'string') {
    result.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) result.push(...extractStrings(item));
  } else if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj)) result.push(...extractStrings(value));
  }
  return result;
}

async function handlePreToolUse(
  input: { tool_name: string; tool_input: Record<string, unknown> },
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  const toolName = input.tool_name;

  if (/^(Edit|Write|MultiEdit)$/.test(toolName) && settings.scanEditTools) {
    return handleEditWrite(input, scanner, policy, audit, exceptionLoader, settings);
  }

  if (toolName === 'Bash' && settings.scanBashCommands) {
    return handleBash(input, scanner, policy, audit, exceptionLoader, settings);
  }

  if (toolName.startsWith('mcp__') && settings.scanMcpTools) {
    return handleMcp(input, scanner, policy, audit, exceptionLoader, settings);
  }

  return allow();
}

async function handlePostToolUse(
  input: { tool_name: string; tool_output?: string },
  scanner: SpaSecretScanner,
  audit: SpaAuditWriter,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  if (input.tool_name === 'Bash' && input.tool_output && settings.scanBashCommands) {
    const rawOutput = input.tool_output;
    const output = rawOutput.length > MAX_SCAN_BYTES ? rawOutput.slice(0, MAX_SCAN_BYTES) : rawOutput;

    const findings = scanner.scan({
      text: output,
      source: 'bash-command',
      provider: 'claude',
      cwd: process.cwd(),
    });

    if (findings.length > 0) {
      const event: SuperParticleAcceleratorAuditEvent = {
        id: createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16),
        timestamp: new Date().toISOString(),
        provider: 'claude',
        sessionId: process.env.CLAUI_SESSION_ID,
        workspacePathHash: createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12),
        toolName: 'Bash',
        source: 'bash-command',
        action: 'audit',
        reason: 'Secret detected in Bash output',
        findings: findings.map(f => ({
          ruleId: f.ruleId,
          type: f.type,
          severity: f.severity,
          confidence: f.confidence,
          valueSha256: f.valueSha256,
          redactedPreview: f.redactedPreview,
          line: f.line,
        })),
      };
      audit.write(event);
    }
  }

  return allow();
}

async function handleStop(
  input: Record<string, unknown>,
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  baselineStore: BaselineStore,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  if (!settings.scanWorkingTreeOnStop) return allow();

  const cwd = process.cwd();
  const sessionId = process.env.CLAUI_SESSION_ID ?? 'unknown';
  const gitScanner = new GitStateScanner(scanner, cwd, 'claude');

  const stagedFindings = gitScanner.scanStagedDiff();
  const unstagedFindings = gitScanner.scanUnstagedDiff();
  const untrackedFindings = gitScanner.scanUntrackedFiles();
  const allFindings = [...stagedFindings, ...unstagedFindings, ...untrackedFindings];

  const newFindings = baselineStore.filterNew(sessionId, allFindings);

  if (newFindings.length === 0) {
    if (!baselineStore.load(sessionId)) {
      baselineStore.save(sessionId, allFindings);
    }
    return allow();
  }

  const exceptions = exceptionLoader.loadActive();
  const decision = policy.evaluate({
    findings: newFindings,
    source: 'diff',
    provider: 'claude',
    cwd,
    settings,
    exceptions,
  });

  if (decision.consumedExceptionIds.length > 0) {
    exceptionLoader.consumeMany(decision.consumedExceptionIds);
  }

  baselineStore.save(sessionId, allFindings);

  audit.write(buildAuditEvent(decision, 'Stop', 'diff', 'claude', sessionId));

  if (decision.action === 'deny') {
    return deny(
      `Super Particle Accelerator detected new secrets in the working tree.\n\n${decision.reason}\n\n${decision.remediation ?? ''}`,
      'Stop',
    );
  }

  return allow();
}

function tryLoadRuntimeSettings(storeDir: string): SuperParticleAcceleratorSettings | null {
  try {
    const raw = fs.readFileSync(path.join(storeDir, 'runtime-enabled.json'), 'utf-8');
    const data = JSON.parse(raw);
    if (!data.enabled) return null;
    return {
      enabled: true,
      mode: data.mode || 'block',
      scanEditTools: data.scanEditTools !== false,
      scanBashCommands: data.scanBashCommands !== false,
      scanMcpTools: data.scanMcpTools !== false,
      scanWorkingTreeOnStop: data.scanWorkingTreeOnStop !== false,
      blockGitCommitPush: data.blockGitCommitPush !== false,
      allowIgnoredEnvFiles: data.allowIgnoredEnvFiles !== false,
      entropyThreshold: data.entropyThreshold ?? 4.2,
      frontendPathGlobs: data.frontendPathGlobs ?? [],
      allowedSecretFileGlobs: data.allowedSecretFileGlobs ?? [],
    };
  } catch {
    return null;
  }
}

async function main() {
  const hookEvent = parseHookEvent();
  installTimeout(hookEvent);

  const storeDir = process.env.CLAUI_SPA_STORE_DIR;
  if (!storeDir) return allow();

  let settings: SuperParticleAcceleratorSettings;
  if (process.env.CLAUI_SPA === '1') {
    settings = loadSettingsFromEnv();
  } else {
    const fileSettings = tryLoadRuntimeSettings(storeDir);
    if (!fileSettings) return allow();
    settings = fileSettings;
  }

  const scanner = new SpaSecretScanner(settings.entropyThreshold);
  const pathClassifier = new PathClassifier(settings.frontendPathGlobs, settings.allowedSecretFileGlobs);
  const policy = new SecretWritePolicyEngine(pathClassifier);
  const audit = new SpaAuditWriter(storeDir);
  const exceptionLoader = new ExceptionLoader(storeDir);
  const baselineStore = new BaselineStore(storeDir);

  const raw = await readStdin();
  const input = JSON.parse(raw);

  switch (hookEvent) {
    case 'PreToolUse':
      return handlePreToolUse(input, scanner, policy, audit, exceptionLoader, settings);
    case 'PostToolUse':
      return handlePostToolUse(input, scanner, audit, settings);
    case 'Stop':
      return handleStop(input, scanner, policy, audit, exceptionLoader, baselineStore, settings);
    default:
      return allow();
  }
}

main().catch(() => {
  const event = (() => { try { return parseHookEvent(); } catch { return 'PreToolUse' as SpaHookEvent; } })();
  if (event === 'PreToolUse') {
    deny('Super Particle Accelerator encountered an error. Write blocked as a precaution.');
  }
  process.exit(0);
});
