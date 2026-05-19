import * as fs from 'fs';
import * as path from 'path';
import { CommandRiskClass, PolicyConfig, SecretProtectionMode } from './types';

const POLICY_FILE_NAME = 'secret-protection.policy.json';
const POLICY_DIR = '.claui';
const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_POLICY: PolicyConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  mode: 'balanced',
  protectedPaths: [
    '.env', '.env.*',
    '*.pem', '*.key', '*.p12', '*.pfx',
    '.ssh/**', '.aws/**', '.azure/**', '.kube/config',
    'terraform.tfstate', 'terraform.tfstate.backup',
    '**/secrets*.json', '**/credentials*',
    '.git/**', '.claude/**', '.codex/**', '.cursor/**',
    '.vscode/settings.json',
  ],
  internalDomains: ['*.corp', '*.internal', '*.cluster.local'],
  allowedModelProviders: ['anthropic', 'openai'],
  allowedMcpServers: [],
  allowedGitRemotes: [],
  blockedCommands: [
    'cat .env*', 'printenv', 'env', 'set',
    'aws configure export-credentials',
  ],
  approvalRequiredCommandClasses: [
    'network_upload', 'credential_discovery', 'agent_control_write',
    'browser_capture',
  ],
  hardBlockRules: [
    'private_key', 'cloud_secret_pair',
    'agent_control_file_write', 'git_control_file_write',
    'secret_to_git_publication',
  ],
  exceptionMaxMinutes: 30,
  allowlistedSecretHmacs: [],
};

const VALID_MODES: SecretProtectionMode[] = ['off', 'observe', 'balanced', 'strict'];

const VALID_RISK_CLASSES: CommandRiskClass[] = [
  'safe_read', 'build_or_test', 'package_install',
  'credential_discovery', 'env_dump', 'secret_file_read',
  'network_download', 'network_upload', 'git_publish',
  'git_control_write', 'agent_control_write', 'shell_obfuscation',
  'destructive', 'long_running', 'interactive', 'browser_capture',
];

export interface PolicyValidationResult {
  config: PolicyConfig;
  warnings: string[];
}

function filterStringArray(
  raw: unknown,
  fieldName: string,
  fallback: string[],
  warnings: string[]
): string[] {
  if (raw === undefined) {
    return fallback;
  }
  if (!Array.isArray(raw)) {
    warnings.push(`"${fieldName}" should be a string array, got ${typeof raw}; using defaults`);
    return fallback;
  }
  const nonStringCount = raw.filter(v => typeof v !== 'string').length;
  if (nonStringCount > 0) {
    warnings.push(`"${fieldName}" contains ${nonStringCount} non-string value(s), skipping them`);
  }
  return raw.filter((v): v is string => typeof v === 'string');
}

export function validatePolicy(raw: unknown): PolicyValidationResult {
  const warnings: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    warnings.push('Policy is not a valid object, using defaults');
    return { config: { ...DEFAULT_POLICY }, warnings };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    warnings.push(
      `Policy schemaVersion ${obj.schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}; some fields may be ignored`
    );
  }

  const mode = VALID_MODES.includes(obj.mode as SecretProtectionMode)
    ? (obj.mode as SecretProtectionMode)
    : (warnings.push(`Invalid mode "${obj.mode}", falling back to "${DEFAULT_POLICY.mode}"`), DEFAULT_POLICY.mode);

  const approvalRaw = filterStringArray(obj.approvalRequiredCommandClasses, 'approvalRequiredCommandClasses', [], warnings);
  const approvalRequiredCommandClasses: CommandRiskClass[] = approvalRaw.length > 0
    ? approvalRaw.filter((c): c is CommandRiskClass => {
        const valid = VALID_RISK_CLASSES.includes(c as CommandRiskClass);
        if (!valid) { warnings.push(`Unknown command risk class "${c}" in approvalRequiredCommandClasses, skipping`); }
        return valid;
      })
    : DEFAULT_POLICY.approvalRequiredCommandClasses;

  const exceptionMaxMinutes =
    typeof obj.exceptionMaxMinutes === 'number' && obj.exceptionMaxMinutes > 0
      ? Math.min(obj.exceptionMaxMinutes, 1440)
      : (obj.exceptionMaxMinutes !== undefined && warnings.push(
          `Invalid exceptionMaxMinutes "${obj.exceptionMaxMinutes}", falling back to ${DEFAULT_POLICY.exceptionMaxMinutes}`
        ), DEFAULT_POLICY.exceptionMaxMinutes);

  const config: PolicyConfig = {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : CURRENT_SCHEMA_VERSION,
    mode,
    protectedPaths: filterStringArray(obj.protectedPaths, 'protectedPaths', DEFAULT_POLICY.protectedPaths, warnings),
    internalDomains: filterStringArray(obj.internalDomains, 'internalDomains', DEFAULT_POLICY.internalDomains, warnings),
    allowedModelProviders: filterStringArray(obj.allowedModelProviders, 'allowedModelProviders', DEFAULT_POLICY.allowedModelProviders, warnings),
    allowedMcpServers: filterStringArray(obj.allowedMcpServers, 'allowedMcpServers', DEFAULT_POLICY.allowedMcpServers, warnings),
    allowedGitRemotes: filterStringArray(obj.allowedGitRemotes, 'allowedGitRemotes', DEFAULT_POLICY.allowedGitRemotes, warnings),
    blockedCommands: filterStringArray(obj.blockedCommands, 'blockedCommands', DEFAULT_POLICY.blockedCommands, warnings),
    approvalRequiredCommandClasses,
    hardBlockRules: filterStringArray(obj.hardBlockRules, 'hardBlockRules', DEFAULT_POLICY.hardBlockRules, warnings),
    exceptionMaxMinutes,
    allowlistedSecretHmacs: filterStringArray(obj.allowlistedSecretHmacs, 'allowlistedSecretHmacs', DEFAULT_POLICY.allowlistedSecretHmacs, warnings),
  };

  return { config, warnings };
}

export interface PolicyLoadResult {
  config: PolicyConfig;
  source: 'file' | 'defaults';
  warnings: string[];
}

export function loadPolicy(workspacePath: string): PolicyLoadResult {
  const policyPath = path.join(workspacePath, POLICY_DIR, POLICY_FILE_NAME);

  try {
    const content = fs.readFileSync(policyPath, 'utf-8');
    const raw = JSON.parse(content);
    const { config, warnings } = validatePolicy(raw);
    return { config, source: 'file', warnings };
  } catch (err: unknown) {
    const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) {
      return { config: { ...DEFAULT_POLICY }, source: 'defaults', warnings: [] };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      config: { ...DEFAULT_POLICY },
      source: 'defaults',
      warnings: [`Failed to load policy from ${policyPath}: ${message}; using defaults`],
    };
  }
}

export { DEFAULT_POLICY, CURRENT_SCHEMA_VERSION };
