export type WorkspaceAccessDecisionAction = 'allow' | 'deny' | 'audit';

export interface WorkspaceAccessDecision {
  action: WorkspaceAccessDecisionAction;
  reason: string;
  matchedPath?: string;
  matchedRuleId?: string;
  matchedRuleSource?: 'builtin-default' | 'organization-policy' | 'user-allowed-root';
  normalizedPaths: string[];
  remediation?: string;
}

export type CommandAccessKind =
  | 'no-file-access'
  | 'file-read'
  | 'recursive-file-read'
  | 'file-write'
  | 'file-delete'
  | 'file-move-copy'
  | 'git-operation'
  | 'build-or-test'
  | 'network-or-exfiltration'
  | 'unknown-file-access';

export interface CommandPathExtractionResult {
  accessKind: CommandAccessKind;
  paths: string[];
  cwdIsTarget: boolean;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface ToolPathExtractionInput {
  provider: 'claude' | 'codex';
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

export interface ToolPathExtractionResult {
  paths: string[];
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
}

export interface NormalizedPathResult {
  original: string;
  expanded: string;
  absolutePath: string;
  realPath?: string;
  comparisonPath: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'unknown';
  warnings: string[];
}

export type DeniedRootSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DeniedRootCategory =
  | 'windows-credentials'
  | 'browser-profile'
  | 'ssh-keys'
  | 'cloud-credentials'
  | 'kubernetes-credentials'
  | 'shell-history'
  | 'git-credentials'
  | 'ai-agent-history'
  | 'application-secrets'
  | 'custom';

export interface WorkspaceAccessDeniedRoot {
  id: string;
  description: string;
  path: string;
  enabled: boolean;
  severity: DeniedRootSeverity;
  category: DeniedRootCategory;
}

export interface WorkspaceAccessBroadRootRules {
  denyWholeUserProfile: boolean;
  denyWholeUsersFolder: boolean;
  denyDriveRoot: boolean;
  warnOnDocumentsDesktopDownloads: boolean;
}

export interface WorkspaceAccessCommandRules {
  denyRecursiveSearchOutsideAllowedRoots: boolean;
  denyFileReadOutsideAllowedRoots: boolean;
  denyFileWriteOutsideAllowedRoots: boolean;
  denyUnknownFileAccessCommands: boolean;
}

export interface WorkspaceAccessPolicyUi {
  supportContact?: string;
  helpUrl?: string;
}

export interface WorkspaceAccessOrgPolicy {
  schemaVersion: 1;
  policyName: string;
  policyId?: string;
  updatedAt?: string;
  updatedBy?: string;
  mode?: 'block' | 'audit';
  deniedRoots: WorkspaceAccessDeniedRoot[];
  broadRootRules?: WorkspaceAccessBroadRootRules;
  commandRules?: WorkspaceAccessCommandRules;
  ui?: WorkspaceAccessPolicyUi;
}

export interface WorkspaceAccessGuardSettings {
  enabled: boolean;
  mode: 'block' | 'audit';
  userAllowedRoots: string[];
  autoAllowWorkspaceFolders: boolean;
  orgPolicyPath: string;
  scanBashCommands: boolean;
  scanFileTools: boolean;
  scanMcpTools: boolean;
  blockOutsideAllowedRoots: boolean;
  blockDeniedRoots: boolean;
  warnOnBroadAllowedRoots: boolean;
  denyUnresolvedSymlinkTargets: boolean;
  denyUnknownFileAccessCommands: boolean;
  auditRetentionDays: number;
}

export type WorkspaceAccessGuardStatus =
  | 'disabled'
  | 'enabled-hooks-installed'
  | 'enabled-hooks-missing'
  | 'enabled-partial-coverage'
  | 'enabled-org-policy-invalid'
  | 'enabled-using-built-in-policy'
  | 'error';

export type WagHookEvent = 'PreToolUse' | 'PermissionRequest' | 'Stop';

export interface WorkspaceAccessPolicyInput {
  provider: 'claude' | 'codex';
  toolName: string;
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'bash' | 'unknown';
  command?: string;
  cwd: string;
  extractedPaths: string[];
  userAllowedRoots: string[];
  orgPolicy: WorkspaceAccessOrgPolicy;
  settings: WorkspaceAccessGuardSettings;
  env: Record<string, string | undefined>;
}

export interface WorkspaceAccessAuditEvent {
  id: string;
  timestamp: string;
  provider: 'claude' | 'codex';
  sessionId?: string;
  turnId?: string;
  workspacePathHash: string;
  toolName: string;
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'bash' | 'unknown';
  action: 'allow' | 'deny' | 'audit';
  reason: string;
  commandFamily?: string;
  matchedPath?: string;
  normalizedMatchedPath?: string;
  matchedRuleId?: string;
  matchedRuleSource?: 'builtin-default' | 'organization-policy' | 'user-allowed-root';
  extractedPathCount: number;
  allowedRootCount: number;
  deniedRuleCount: number;
}

export interface WorkspaceAccessGuardProviderHookStatus {
  provider: 'claude' | 'codex';
  bash: boolean;
  fileTools: boolean;
  mcp: boolean;
  stop?: boolean;
  orderBeforeSpa: boolean;
  orderBeforeParticleAccelerator: boolean;
}

export interface UserAllowedRootsData {
  schemaVersion: 1;
  updatedAt: string;
  roots: string[];
}

export interface WorkspaceAccessAllowedRootView {
  path: string;
  isBroad: boolean;
  broadWarning?: string;
}

export interface WorkspaceAccessOrgPolicyStatus {
  loaded: boolean;
  source: 'file' | 'built-in-defaults';
  filePath?: string;
  lastModified?: string;
  deniedRootCount: number;
  policyName?: string;
  error?: string;
}
