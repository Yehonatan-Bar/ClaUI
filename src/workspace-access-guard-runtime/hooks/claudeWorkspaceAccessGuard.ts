import * as fs from 'fs';
import * as path from 'path';
import {
  WorkspaceAccessGuardSettings,
  WorkspaceAccessOrgPolicy,
  WorkspaceAccessPolicyInput,
} from '../../shared/workspace-access-guard/types';
import { evaluate } from '../PathPolicyEngine';
import { extractCommandPaths } from '../CommandPathExtractor';
import { extractToolPaths } from '../ToolPathExtractor';
import { WagAuditWriter, hashWorkspacePath, createAuditEvent } from '../AuditWriter';
import { DEFAULT_ORG_POLICY } from '../defaultOrgPolicy';

const WAG_MARKER = '--claui-workspace-access-guard-hook';
const TIMEOUT_MS = 3000;

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

function main(): void {
  const args = process.argv.slice(2);
  const markerIdx = args.indexOf(WAG_MARKER);
  if (markerIdx === -1) { allow(); return; }
  const eventName = args[markerIdx + 1];
  if (!eventName) { allow(); return; }

  const settings = loadSettings();
  if (!settings || !settings.enabled) { allow(); return; }

  const timer = setTimeout(() => {
    if (eventName === 'PreToolUse') { deny('Workspace Access Guard timeout exceeded'); }
    else { allow(); }
    process.exit(0);
  }, TIMEOUT_MS);

  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => { inputData += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(timer);
    try {
      const parsed = JSON.parse(inputData) as HookInput;
      handleEvent(eventName, parsed, settings);
    } catch {
      if (eventName === 'PreToolUse' && settings.mode === 'block') {
        deny('Failed to parse hook input');
      } else {
        allow();
      }
    }
  });
}

function handleEvent(eventName: string, input: HookInput, settings: WorkspaceAccessGuardSettings): void {
  if (eventName !== 'PreToolUse') { allow(); return; }

  const toolName = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};
  const cwd = (toolInput.cwd as string) ?? process.env.CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH ?? process.cwd();
  const env = buildEnv();
  const orgPolicy = loadOrgPolicy(settings);
  const userAllowedRoots = loadUserAllowedRoots(settings);

  const workspacePath = process.env.CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH;
  if (settings.autoAllowWorkspaceFolders && workspacePath) {
    const normalizedWorkspace = workspacePath.replace(/\//g, '\\').replace(/\\+$/, '');
    if (!userAllowedRoots.some(r => r.toLowerCase() === normalizedWorkspace.toLowerCase())) {
      userAllowedRoots.push(normalizedWorkspace);
    }
  }

  let extractedPaths: string[] = [];
  let operation: WorkspaceAccessPolicyInput['operation'] = 'unknown';

  if (toolName === 'Bash') {
    if (!settings.scanBashCommands) { allow(); return; }
    const command = (toolInput.command as string) ?? '';
    const result = extractCommandPaths(command, cwd);
    extractedPaths = result.paths;
    operation = 'bash';
    if (result.accessKind === 'no-file-access') { allow(); return; }
    if (result.accessKind === 'build-or-test') {
      extractedPaths = result.cwdIsTarget ? [cwd] : result.paths;
    } else if (result.accessKind === 'unknown-file-access') {
      operation = 'unknown';
      extractedPaths = result.cwdIsTarget ? [cwd] : result.paths;
    }
  } else if (toolName.startsWith('mcp__')) {
    if (!settings.scanMcpTools) { allow(); return; }
    const result = extractToolPaths({ provider: 'claude', toolName, toolInput, cwd });
    extractedPaths = result.paths;
    operation = 'mcp';
  } else {
    if (!settings.scanFileTools) { allow(); return; }
    const result = extractToolPaths({ provider: 'claude', toolName, toolInput, cwd });
    extractedPaths = result.paths;
    operation = result.operation;
  }

  const policyInput: WorkspaceAccessPolicyInput = {
    provider: 'claude',
    toolName,
    operation,
    command: toolName === 'Bash' ? (toolInput.command as string) : undefined,
    cwd,
    extractedPaths,
    userAllowedRoots,
    orgPolicy,
    settings,
    env,
  };

  const decision = evaluate(policyInput);

  const storeDir = process.env.CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR;
  if (storeDir && decision.action !== 'allow') {
    try {
      const writer = new WagAuditWriter(storeDir);
      writer.write(createAuditEvent({
        provider: 'claude',
        sessionId: process.env.CLAUI_WORKSPACE_ACCESS_GUARD_SESSION_ID,
        turnId: process.env.CLAUI_WORKSPACE_ACCESS_GUARD_TURN_ID,
        workspacePathHash: hashWorkspacePath(cwd),
        toolName,
        operation,
        action: decision.action,
        reason: decision.reason,
        matchedPath: decision.matchedPath,
        normalizedMatchedPath: decision.normalizedPaths[0],
        matchedRuleId: decision.matchedRuleId,
        matchedRuleSource: decision.matchedRuleSource,
        extractedPathCount: extractedPaths.length,
        allowedRootCount: userAllowedRoots.length,
        deniedRuleCount: orgPolicy.deniedRoots.filter(r => r.enabled).length,
      }));
    } catch { /* best-effort audit */ }
  }

  if (decision.action === 'deny') {
    deny(decision.remediation ?? decision.reason);
  } else {
    allow();
  }
}

function loadSettings(): WorkspaceAccessGuardSettings | null {
  const storeDir = process.env.CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR;
  if (process.env.CLAUI_WORKSPACE_ACCESS_GUARD === '0') {
    return null;
  }

  const runtimeSettings = storeDir ? readRuntimeSettings(storeDir) : null;
  if (process.env.CLAUI_WORKSPACE_ACCESS_GUARD === '1') {
    return applyEnvOverrides({
      ...(runtimeSettings ?? defaultSettings(true)),
      enabled: true,
    });
  }

  if (runtimeSettings) return applyEnvOverrides(runtimeSettings);

  return null;
}

function readRuntimeSettings(storeDir: string): WorkspaceAccessGuardSettings | null {
  const settingsPath = path.join(storeDir, 'runtime-enabled.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return coerceSettings(JSON.parse(raw), false);
  } catch {
    return null;
  }
}

function defaultSettings(enabled: boolean): WorkspaceAccessGuardSettings {
  return {
    enabled,
    mode: 'block',
    userAllowedRoots: [],
    autoAllowWorkspaceFolders: true,
    orgPolicyPath: '',
    scanBashCommands: true,
    scanFileTools: true,
    scanMcpTools: true,
    blockOutsideAllowedRoots: true,
    blockDeniedRoots: true,
    warnOnBroadAllowedRoots: true,
    denyUnresolvedSymlinkTargets: true,
    denyUnknownFileAccessCommands: true,
    auditRetentionDays: 90,
  };
}

function coerceSettings(value: unknown, fallbackEnabled: boolean): WorkspaceAccessGuardSettings {
  const defaults = defaultSettings(fallbackEnabled);
  const partial = isRecord(value) ? value as Partial<WorkspaceAccessGuardSettings> : {};
  return {
    enabled: typeof partial.enabled === 'boolean' ? partial.enabled : defaults.enabled,
    mode: partial.mode === 'audit' ? 'audit' : partial.mode === 'block' ? 'block' : defaults.mode,
    userAllowedRoots: Array.isArray(partial.userAllowedRoots)
      ? partial.userAllowedRoots.filter((root): root is string => typeof root === 'string')
      : defaults.userAllowedRoots,
    autoAllowWorkspaceFolders: boolOrDefault(partial.autoAllowWorkspaceFolders, defaults.autoAllowWorkspaceFolders),
    orgPolicyPath: typeof partial.orgPolicyPath === 'string' ? partial.orgPolicyPath : defaults.orgPolicyPath,
    scanBashCommands: boolOrDefault(partial.scanBashCommands, defaults.scanBashCommands),
    scanFileTools: boolOrDefault(partial.scanFileTools, defaults.scanFileTools),
    scanMcpTools: boolOrDefault(partial.scanMcpTools, defaults.scanMcpTools),
    blockOutsideAllowedRoots: boolOrDefault(partial.blockOutsideAllowedRoots, defaults.blockOutsideAllowedRoots),
    blockDeniedRoots: boolOrDefault(partial.blockDeniedRoots, defaults.blockDeniedRoots),
    warnOnBroadAllowedRoots: boolOrDefault(partial.warnOnBroadAllowedRoots, defaults.warnOnBroadAllowedRoots),
    denyUnresolvedSymlinkTargets: boolOrDefault(partial.denyUnresolvedSymlinkTargets, defaults.denyUnresolvedSymlinkTargets),
    denyUnknownFileAccessCommands: boolOrDefault(partial.denyUnknownFileAccessCommands, defaults.denyUnknownFileAccessCommands),
    auditRetentionDays: typeof partial.auditRetentionDays === 'number' ? partial.auditRetentionDays : defaults.auditRetentionDays,
  };
}

function applyEnvOverrides(settings: WorkspaceAccessGuardSettings): WorkspaceAccessGuardSettings {
  return {
    ...settings,
    mode: parseModeEnv(process.env.CLAUI_WORKSPACE_ACCESS_GUARD_MODE, settings.mode),
    orgPolicyPath: process.env.CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH ?? settings.orgPolicyPath,
    autoAllowWorkspaceFolders: parseBoolEnv('CLAUI_WAG_AUTO_ALLOW_WORKSPACE', settings.autoAllowWorkspaceFolders),
    scanBashCommands: parseBoolEnv('CLAUI_WAG_SCAN_BASH', settings.scanBashCommands),
    scanFileTools: parseBoolEnv('CLAUI_WAG_SCAN_FILE_TOOLS', settings.scanFileTools),
    scanMcpTools: parseBoolEnv('CLAUI_WAG_SCAN_MCP', settings.scanMcpTools),
    blockOutsideAllowedRoots: parseBoolEnv('CLAUI_WAG_BLOCK_OUTSIDE_ALLOWED_ROOTS', settings.blockOutsideAllowedRoots),
    blockDeniedRoots: parseBoolEnv('CLAUI_WAG_BLOCK_DENIED_ROOTS', settings.blockDeniedRoots),
    warnOnBroadAllowedRoots: parseBoolEnv('CLAUI_WAG_WARN_BROAD_ALLOWED_ROOTS', settings.warnOnBroadAllowedRoots),
    denyUnresolvedSymlinkTargets: parseBoolEnv('CLAUI_WAG_DENY_UNRESOLVED_SYMLINKS', settings.denyUnresolvedSymlinkTargets),
    denyUnknownFileAccessCommands: parseBoolEnv('CLAUI_WAG_DENY_UNKNOWN', settings.denyUnknownFileAccessCommands),
    auditRetentionDays: parseNumberEnv('CLAUI_WAG_AUDIT_RETENTION_DAYS', settings.auditRetentionDays),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseModeEnv(value: string | undefined, fallback: 'block' | 'audit'): 'block' | 'audit' {
  if (value === 'block' || value === 'audit') return value;
  return fallback;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value !== '0' && value.toLowerCase() !== 'false';
}

function parseNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadOrgPolicy(settings: WorkspaceAccessGuardSettings): WorkspaceAccessOrgPolicy {
  const policyPath = settings.orgPolicyPath || process.env.CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH;
  if (policyPath) {
    try {
      const raw = fs.readFileSync(policyPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.deniedRoots)) {
        return parsed as WorkspaceAccessOrgPolicy;
      }
    } catch { /* fall through to defaults */ }
  }
  return DEFAULT_ORG_POLICY;
}

function loadUserAllowedRoots(settings: WorkspaceAccessGuardSettings): string[] {
  const roots: string[] = [...(settings.userAllowedRoots ?? [])];
  const rootsPath = process.env.CLAUI_WORKSPACE_ACCESS_GUARD_USER_ROOTS_PATH;
  if (rootsPath) {
    try {
      const raw = fs.readFileSync(rootsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.roots)) {
        for (const r of parsed.roots) {
          if (typeof r === 'string' && !roots.includes(r)) roots.push(r);
        }
      }
    } catch { /* ignore */ }
  }
  return roots;
}

function buildEnv(): Record<string, string | undefined> {
  return {
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    HOME: process.env.HOME,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
}

function allow(): void {
  process.exit(0);
}

function deny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
