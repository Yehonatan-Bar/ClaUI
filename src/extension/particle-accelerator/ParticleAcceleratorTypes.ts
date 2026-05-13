export const CLAUI_PARTICLE_ACCELERATOR_VERSION = '1.0.0';
export const CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION = 1;

export interface ParticleAcceleratorTrace {
  schemaVersion: number;
  traceId: string;
  timestamp: string;
  provider: 'claude' | 'codex';
  tabRuntimeId: string;
  sessionId: string | null;
  turnId: string | null;
  workspacePath: string;
  command: {
    original: string;
    family: string;
    encoded: string;
  };
  execution: {
    exitCode: number | null;
    signal: string | null;
    interrupted: boolean;
    durationMs: number;
    shell: string;
  };
  output: {
    rawStdoutBytes: number;
    rawStderrBytes: number;
    filteredStdoutBytes: number;
    filteredStderrBytes: number;
    estimatedTokensSaved: number;
    compressionRatio: number;
  };
  filter: {
    name: string;
    version: string;
    profile: string;
    fallbackUsed: boolean;
  };
  redaction: {
    replacements: number;
    rulesTriggered: string[];
  };
  storage: {
    stdoutLogPath: string | null;
    stderrLogPath: string | null;
  };
}

export interface ParticleAcceleratorTraceSummary {
  traceId: string;
  timestamp: string;
  provider: 'claude' | 'codex';
  commandFamily: string;
  exitCode: number | null;
  durationMs: number;
  rawBytes: number;
  filteredBytes: number;
  estimatedTokensSaved: number;
  filterName: string;
  redactions: number;
}

export interface ParticleAcceleratorStatus {
  enabled: boolean;
  installed: boolean;
  version: string | null;
  claudeHookInstalled: boolean;
  codexHookInstalled: boolean;
  codexMode: 'off' | 'instruction-only' | 'hook-guard';
  nodeAvailable: boolean;
  error: string | null;
}

export interface ParticleAcceleratorAggregate {
  totalCommands: number;
  failedCommands: number;
  totalRawBytes: number;
  totalFilteredBytes: number;
  totalEstimatedTokensSaved: number;
  avgCompressionRatio: number;
  avgDurationMs: number;
  totalRedactions: number;
  topCommandFamilies: Array<{ family: string; count: number; tokensSaved: number }>;
  topFilters: Array<{ filter: string; count: number }>;
  providerBreakdown: Record<string, { count: number; tokensSaved: number }>;
}

export interface ParticleAcceleratorSessionStats {
  commandCount: number;
  failedCommandCount: number;
  totalRawBytes: number;
  totalFilteredBytes: number;
  estimatedTokensSaved: number;
  topCommandFamilies: Array<{ family: string; count: number }>;
}

export interface ParticleAcceleratorContextFile {
  schemaVersion: number;
  tabRuntimeId: string;
  provider: 'claude' | 'codex';
  workspacePath: string;
  sessionId: string | null;
  turnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommandEligibilityResult {
  eligible: boolean;
  reason: string;
  filterHint?: string;
  commandFamily?: string;
}

export interface RedactionResult {
  text: string;
  replacements: number;
  rulesTriggered: string[];
}

export interface FilterInput {
  command: string;
  commandFamily: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  profile: 'balanced' | 'strict' | 'verbose';
  redactionResult: RedactionResult;
}

export interface FilterOutput {
  filteredStdout: string;
  filteredStderr: string;
  header: string;
  filterName: string;
  filterVersion: string;
  rawStdoutBytes: number;
  rawStderrBytes: number;
  filteredStdoutBytes: number;
  filteredStderrBytes: number;
  estimatedTokensSaved: number;
}

export interface ParticleAcceleratorEnvInput {
  baseEnv: NodeJS.ProcessEnv;
  provider: 'claude' | 'codex';
  workspacePath: string;
  tabRuntimeId: string;
  sessionId: string | null;
  binDir: string;
  storeDir: string;
  contextFilePath: string;
  shell?: string;
  filterProfile?: 'balanced' | 'strict' | 'verbose';
  storeRawLogs?: boolean;
}

export interface ParticleAcceleratorDailyReport {
  schemaVersion: 1;
  date: string;
  generatedAt: string;
  commandCount: number;
  failedCommandCount: number;
  totalRawBytes: number;
  totalFilteredBytes: number;
  estimatedTokensSaved: number;
  topCommandFamilies: Array<{ family: string; count: number; tokensSaved: number }>;
  topFilters: Array<{ filter: string; count: number }>;
  avgCompressionRatio: number;
  avgDurationMs: number;
  totalRedactions: number;
  providerBreakdown: Record<string, { count: number; tokensSaved: number }>;
}

export interface ParticleAcceleratorRuntimePaths {
  binDir: string;
  runnerJs: string;
  hooksDir: string;
  storeDir: string;
}

export interface FilterConfig {
  budgetOverrides?: Record<string, { success?: number; failure?: number }>;
  extraImportantPatterns?: string[];
  disabledFilters?: string[];
}

export interface ParticleAcceleratorSettings {
  enabled: boolean;
  filterProfile: 'balanced' | 'strict' | 'verbose';
  storeRawRedactedLogs: boolean;
  rawLogRetentionDays: number;
  maxRawLogMb: number;
  traceRetentionDays: number;
  maxTraceCount: number;
  dailyReportRetentionDays: number;
  workspaceLocalStorage: boolean;
  installClaudeHook: boolean;
  installCodexHook: boolean;
  codexMode: 'off' | 'instruction-only' | 'hook-guard';
}
