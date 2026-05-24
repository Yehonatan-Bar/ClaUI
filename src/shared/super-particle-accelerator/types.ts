export type SecretFindingType =
  | 'google_api_key'
  | 'openai_api_key'
  | 'anthropic_api_key'
  | 'github_token'
  | 'aws_access_key'
  | 'jwt'
  | 'supabase_key'
  | 'azure_key'
  | 'private_key'
  | 'database_url'
  | 'generic_high_entropy_secret';

export type SecretFindingSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SecretFindingConfidence = 'low' | 'medium' | 'high';

export interface SecretFinding {
  ruleId: string;
  type: SecretFindingType;
  severity: SecretFindingSeverity;
  confidence: SecretFindingConfidence;
  filePath?: string;
  line?: number;
  column?: number;
  redactedPreview: string;
  valueSha256: string;
}

export type PathRisk =
  | 'public-client-code'
  | 'generated-public-artifact'
  | 'server-code'
  | 'local-secret-file'
  | 'unknown-repository-file';

export type ScanSource =
  | 'edit'
  | 'bash-command'
  | 'mcp-args'
  | 'file'
  | 'diff'
  | 'staged-diff';

export type SpaHookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'PermissionRequest';

export interface SecretScanInput {
  text: string;
  source: ScanSource;
  provider: 'claude' | 'codex';
  toolName?: string;
  filePath?: string;
  cwd: string;
  sessionId?: string;
  turnId?: string;
}

export interface DiffFileEntry {
  filePath: string;
  addedLines: Array<{ lineNumber: number; text: string }>;
}

export interface SecretWritePolicyInput {
  findings: SecretFinding[];
  filePath?: string;
  source: ScanSource;
  provider: 'claude' | 'codex';
  toolName?: string;
  command?: string;
  cwd: string;
  gitInfo?: GitInfo;
  settings: SuperParticleAcceleratorSettings;
  exceptions: SuperParticleAcceleratorException[];
  /** When true the target file is gitignored. Required for Gate 3 (allowIgnoredEnvFiles). */
  isFileGitIgnored?: boolean;
}

export interface SecretWritePolicyDecision {
  action: 'allow' | 'deny' | 'audit';
  reason: string;
  remediation?: string;
  findings: SecretFinding[];
  consumedExceptionIds: string[];
}

export interface GitInfo {
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
  hasStagedFindings: boolean;
  hasUnstagedFindings: boolean;
}

export interface SuperParticleAcceleratorSettings {
  enabled: boolean;
  mode: 'block' | 'audit';
  scanEditTools: boolean;
  scanBashCommands: boolean;
  scanMcpTools: boolean;
  scanWorkingTreeOnStop: boolean;
  blockGitCommitPush: boolean;
  allowIgnoredEnvFiles: boolean;
  entropyThreshold: number;
  frontendPathGlobs: string[];
  allowedSecretFileGlobs: string[];
  customSecretRulesPath?: string;
}

export type SuperParticleAcceleratorStatus =
  | 'disabled'
  | 'enabled-hooks-installed'
  | 'enabled-hooks-missing'
  | 'enabled-trust-required'
  | 'enabled-partial-coverage'
  | 'error';

export interface SuperParticleAcceleratorAuditEvent {
  id: string;
  timestamp: string;
  provider: 'claude' | 'codex';
  sessionId?: string;
  turnId?: string;
  workspacePathHash: string;
  toolName: string;
  source: ScanSource;
  action: 'allow' | 'deny' | 'audit';
  reason: string;
  filePath?: string;
  pathRisk?: PathRisk;
  findings: Array<{
    ruleId: string;
    type: SecretFindingType;
    severity: SecretFindingSeverity;
    confidence: SecretFindingConfidence;
    valueSha256: string;
    redactedPreview: string;
    line?: number;
  }>;
}

export interface SuperParticleAcceleratorException {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: 'user';
  ruleId: string;
  valueSha256: string;
  filePathGlob: string;
  maxUses: number;
  usedCount: number;
  reason: string;
}

export interface SpaBaseline {
  sessionId: string;
  createdAt: string;
  entries: Array<{ valueSha256: string; filePath: string }>;
}
