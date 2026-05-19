// --- Destination & Trust ---

export type TrustTier =
  | 'trusted_local'
  | 'trusted_org'
  | 'approved_remote'
  | 'unknown_remote'
  | 'public';

export type DestinationKind =
  | 'local_disk'
  | 'local_terminal'
  | 'remote_model'
  | 'mcp_server'
  | 'git_remote'
  | 'browser'
  | 'trace_log';

export interface DlpDestination {
  kind: DestinationKind;
  provider: string | null;
  remote: boolean;
  trustTier: TrustTier;
}

// --- Boundary ---

export type DlpBoundary =
  | 'prompt_submission'
  | 'context_expansion'
  | 'file_exposure'
  | 'command_execution'
  | 'terminal_output'
  | 'mcp_tool_call'
  | 'browser_screenshot'
  | 'git_publication'
  | 'persistence';

// --- Findings & Redaction ---

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingConfidence = 'definite' | 'high' | 'medium' | 'low';

export interface DlpFinding {
  ruleId: string;
  type: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  location: {
    offset: number;
    length: number;
    lineNumber?: number;
    context?: string;
  };
  redactionToken: RedactionToken;
}

export interface RedactionToken {
  text: string;
  stableId: string;
  hashPrefix: string;
  originalLength: number;
}

// --- Events ---

export interface DlpEvent {
  id: string;
  timestamp: string;
  sessionId: string | null;
  boundary: DlpBoundary;
  source: string;
  destination: DlpDestination;
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

export interface DlpDecision {
  action: DlpAction;
  findings: DlpFinding[];
  redactedContent: string | null;
  audit: AuditEvent | null;
  reason: string;
}

// --- Audit ---

export interface AuditEvent {
  id: string;
  timestamp: string;
  sessionId: string | null;
  boundary: DlpBoundary;
  action: DlpAction;
  ruleIds: string[];
  findingTypes: string[];
  severityMax: FindingSeverity | null;
  contentHash: string;
  redactionCount: number;
  destination: DlpDestination;
}

// --- Exceptions ---

export interface DlpException {
  id: string;
  createdAt: string;
  expiresAt: string;
  provider: string | null;
  destination: DlpDestination | null;
  ruleId: string | null;
  boundary: DlpBoundary | null;
  maxUses: number;
  usesRemaining: number;
}

// --- Command Risk ---

export type CommandRiskClass =
  | 'safe_read'
  | 'safe_write_local'
  | 'credential_discovery'
  | 'credential_use'
  | 'network_download'
  | 'network_upload'
  | 'git_publish'
  | 'git_history_rewrite'
  | 'agent_control_read'
  | 'agent_control_write'
  | 'shell_obfuscation'
  | 'process_injection'
  | 'file_exfiltration'
  | 'environment_mutation'
  | 'service_management'
  | 'unknown';

export interface CommandRisk {
  classes: CommandRiskClass[];
  severity: FindingSeverity;
  requiresApproval: boolean;
  hardBlock: boolean;
}

// --- Context Manifest ---

export interface ContextManifestEntry {
  filePath: string;
  sizeBytes: number;
  sensitive: boolean;
  findings: DlpFinding[];
}

export interface ContextManifest {
  attachedFiles: ContextManifestEntry[];
  screenshots: ContextManifestEntry[];
  mcpResources: ContextManifestEntry[];
  decision: DlpDecision | null;
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
  mode: SecretProtectionMode;
  protectedPaths: string[];
  internalDomains: string[];
  allowedProviders: string[];
  allowedMcpServers: string[];
  blockedCommands: string[];
  hardBlockRules: string[];
  exceptionMaxMinutes: number;
  allowlistedSecretHmacs: string[];
}
