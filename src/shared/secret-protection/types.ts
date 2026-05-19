// --- Destination & Trust ---

export type TrustTier =
  | 'trusted_local'
  | 'trusted_org'
  | 'approved_remote'
  | 'unknown_remote'
  | 'public';

export type DestinationKind =
  | 'local_agent'
  | 'remote_model_provider'
  | 'terminal_stdout_to_agent'
  | 'local_disk'
  | 'git_remote'
  | 'mcp_server'
  | 'browser_context'
  | 'telemetry_backend'
  | 'diagnostic_export';

export interface DlpDestination {
  kind: DestinationKind;
  provider?: 'anthropic' | 'openai' | 'github' | 'other';
  remote?: boolean;
  host?: string;
  trustTier: TrustTier;
}

// --- Boundary ---

export type DlpBoundary =
  | 'prompt.submit'
  | 'context.attach'
  | 'file.read_for_context'
  | 'command.preflight'
  | 'command.output'
  | 'git.diff'
  | 'git.publish'
  | 'mcp.request'
  | 'mcp.response'
  | 'browser.capture'
  | 'persistence.write'
  | 'telemetry.export'
  | 'diagnostic.export';

// --- Source ---

export interface DlpSource {
  kind: 'text' | 'file' | 'terminal' | 'git' | 'mcp' | 'browser' | 'config' | 'trace';
  path?: string;
  command?: string;
  lineRange?: { start: number; end: number };
  uri?: string;
  toolName?: string;
}

// --- Findings & Redaction ---

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingConfidence = 'high' | 'medium' | 'low';

export type FindingType =
  | 'hard_secret'
  | 'api_key'
  | 'private_key'
  | 'cloud_credential'
  | 'database_credential'
  | 'jwt'
  | 'webhook'
  | 'pii'
  | 'internal_topology'
  | 'protected_path'
  | 'agent_control_file'
  | 'git_control_file'
  | 'prompt_injection_marker'
  | 'network_exfil_primitive'
  | 'large_sensitive_output';

export interface DlpFinding {
  id: string;
  ruleId: string;
  type: FindingType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  location: {
    byteStart?: number;
    byteEnd?: number;
    line?: number;
    path?: string;
  };
  redaction: RedactionToken;
}

export interface RedactionToken {
  text: string;
  type: string;
  stableId: string;
  hashPrefix: string;
  originalLength: number;
  sourceHint?: string;
}

// --- Events ---

export interface DlpEvent {
  id: string;
  timestamp: string;
  sessionId?: string;
  turnId?: string;
  provider: 'claude' | 'codex';
  workspacePath: string;
  boundary: DlpBoundary;
  source: DlpSource;
  destination: DlpDestination;
  contentPreview?: string;
  contentBytes: number;
  contentHash: string;
}

// --- Decisions ---

export type DlpAction =
  | 'allow'
  | 'redact'
  | 'warn'
  | 'require_approval'
  | 'block'
  | 'summarize_locally';

export interface ApprovalRequest {
  findingId: string;
  boundary: DlpBoundary;
  destination: DlpDestination;
  description: string;
  options: ApprovalOption[];
}

export type ApprovalOption =
  | 'redact_and_continue'
  | 'remove_from_context'
  | 'approve_once'
  | 'block';

export interface DlpDecision {
  action: DlpAction;
  reason: string;
  findings: DlpFinding[];
  redactedContent?: string;
  safeSummary?: string;
  approvalRequest?: ApprovalRequest;
  audit: AuditEvent;
}

// --- Audit ---

export interface AuditEvent {
  id: string;
  timestamp: string;
  sessionId?: string;
  turnId?: string;
  boundary: DlpBoundary;
  action: DlpAction;
  ruleIds: string[];
  findingTypes: string[];
  severityMax: FindingSeverity | null;
  destinationKind: DestinationKind;
  destinationHostHash?: string;
  contentHash: string;
  redactedBytes: number;
  redactionCount: number;
  pathCategory?: string;
  approvedBy?: string;
  approvalExpiresAt?: string;
}

// --- Exceptions ---

export interface DlpException {
  id: string;
  createdAt: string;
  expiresAt: string;
  userId: string;
  workspaceHash: string;
  provider: 'claude' | 'codex';
  destination: DlpDestination;
  ruleId: string;
  pathPattern?: string;
  commandPatternHash?: string;
  maxUses: number;
  usedCount: number;
}

// --- Command Risk ---

export type CommandRiskClass =
  | 'safe_read'
  | 'build_or_test'
  | 'package_install'
  | 'credential_discovery'
  | 'env_dump'
  | 'secret_file_read'
  | 'network_download'
  | 'network_upload'
  | 'git_publish'
  | 'git_control_write'
  | 'agent_control_write'
  | 'shell_obfuscation'
  | 'destructive'
  | 'long_running'
  | 'interactive'
  | 'browser_capture';

export interface CommandRisk {
  classes: CommandRiskClass[];
  severity: FindingSeverity;
  requiresApproval: boolean;
  hardBlock: boolean;
  explanation: string;
}

// --- Context Manifest ---

export interface ContextManifest {
  sessionId: string;
  turnId: string;
  provider: 'claude' | 'codex';
  model?: string;
  destination: DlpDestination;
  userPromptBytes: number;
  attachedFiles: Array<{
    path: string;
    lineRange?: { start: number; end: number };
    byteCount: number;
    sensitivity: 'normal' | 'sensitive' | 'protected';
    findings: DlpFinding[];
  }>;
  screenshots: Array<{
    source: string;
    domain?: string;
    authenticated?: boolean;
  }>;
  mcpResources: Array<{
    server: string;
    resource: string;
    trustTier: string;
  }>;
  decision: DlpDecision;
}

// --- Settings ---

export type SecretProtectionMode = 'off' | 'observe' | 'balanced' | 'strict';

export interface SecretProtectionSettings {
  enabled: boolean;
  mode: SecretProtectionMode;
  blockProtectedPaths: boolean;
  scanPrompts: boolean;
  scanTerminalOutput: boolean;
  scanGitPublication: boolean;
  scanMcp: boolean;
  requireBrowserCaptureApproval: boolean;
  exceptionMaxMinutes: number;
  auditRetentionDays: number;
  enableEntropyScanner: boolean;
}

// --- Policy Config ---

export interface PolicyConfig {
  schemaVersion: number;
  mode: SecretProtectionMode;
  protectedPaths: string[];
  internalDomains: string[];
  allowedModelProviders: string[];
  allowedMcpServers: string[];
  allowedGitRemotes: string[];
  blockedCommands: string[];
  approvalRequiredCommandClasses: CommandRiskClass[];
  hardBlockRules: string[];
  exceptionMaxMinutes: number;
  allowlistedSecretHmacs: string[];
}
