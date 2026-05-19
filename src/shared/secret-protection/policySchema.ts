import * as fs from 'fs';
import * as path from 'path';
import { PolicyConfig, SecretProtectionMode } from './types';

const POLICY_FILE_NAME = 'secret-protection.policy.json';
const POLICY_DIR = '.claui';

const DEFAULT_POLICY: PolicyConfig = {
  mode: 'balanced',
  protectedPaths: [
    '.env', '.env.*',
    '*.pem', '*.key', '*.p12', '*.pfx',
    '.ssh/**', '.aws/**', '.azure/**',
    'terraform.tfstate', 'terraform.tfstate.backup',
    '.git/**', '.claude/**', '.codex/**', '.cursor/**', '.vscode/**',
  ],
  internalDomains: [],
  allowedProviders: ['anthropic', 'openai'],
  allowedMcpServers: [],
  blockedCommands: [],
  hardBlockRules: [
    'private-key-block',
    'aws-secret-key',
    'cloud-credential',
  ],
  exceptionMaxMinutes: 30,
  allowlistedSecretHmacs: [],
};

const VALID_MODES: SecretProtectionMode[] = ['off', 'observe', 'balanced', 'strict'];

export function validatePolicy(raw: unknown): PolicyConfig {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { ...DEFAULT_POLICY };
  }

  const obj = raw as Record<string, unknown>;

  const mode = VALID_MODES.includes(obj.mode as SecretProtectionMode)
    ? (obj.mode as SecretProtectionMode)
    : DEFAULT_POLICY.mode;

  const protectedPaths = Array.isArray(obj.protectedPaths)
    ? obj.protectedPaths.filter((p): p is string => typeof p === 'string')
    : DEFAULT_POLICY.protectedPaths;

  const internalDomains = Array.isArray(obj.internalDomains)
    ? obj.internalDomains.filter((d): d is string => typeof d === 'string')
    : DEFAULT_POLICY.internalDomains;

  const allowedProviders = Array.isArray(obj.allowedProviders)
    ? obj.allowedProviders.filter((p): p is string => typeof p === 'string')
    : DEFAULT_POLICY.allowedProviders;

  const allowedMcpServers = Array.isArray(obj.allowedMcpServers)
    ? obj.allowedMcpServers.filter((s): s is string => typeof s === 'string')
    : DEFAULT_POLICY.allowedMcpServers;

  const blockedCommands = Array.isArray(obj.blockedCommands)
    ? obj.blockedCommands.filter((c): c is string => typeof c === 'string')
    : DEFAULT_POLICY.blockedCommands;

  const hardBlockRules = Array.isArray(obj.hardBlockRules)
    ? obj.hardBlockRules.filter((r): r is string => typeof r === 'string')
    : DEFAULT_POLICY.hardBlockRules;

  const exceptionMaxMinutes =
    typeof obj.exceptionMaxMinutes === 'number' && obj.exceptionMaxMinutes > 0
      ? Math.min(obj.exceptionMaxMinutes, 1440)
      : DEFAULT_POLICY.exceptionMaxMinutes;

  const allowlistedSecretHmacs = Array.isArray(obj.allowlistedSecretHmacs)
    ? obj.allowlistedSecretHmacs.filter((h): h is string => typeof h === 'string')
    : DEFAULT_POLICY.allowlistedSecretHmacs;

  return {
    mode,
    protectedPaths,
    internalDomains,
    allowedProviders,
    allowedMcpServers,
    blockedCommands,
    hardBlockRules,
    exceptionMaxMinutes,
    allowlistedSecretHmacs,
  };
}

export function loadPolicy(workspacePath: string): PolicyConfig {
  const policyPath = path.join(workspacePath, POLICY_DIR, POLICY_FILE_NAME);

  try {
    const content = fs.readFileSync(policyPath, 'utf-8');
    const raw = JSON.parse(content);
    return validatePolicy(raw);
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export { DEFAULT_POLICY };
