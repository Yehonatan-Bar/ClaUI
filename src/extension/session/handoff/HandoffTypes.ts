import type { ProviderId, SerializedChatMessage } from '../../types/webview-messages';

export type HandoffProvider = 'claude' | 'codex';

export type HandoffStage =
  | 'idle'
  | 'collecting_context'
  | 'creating_target_tab'
  | 'starting_target_session'
  | 'injecting_handoff_prompt'
  | 'awaiting_first_reply'
  | 'completed'
  | 'failed';

export interface HandoffDecision {
  decision: string;
  rationale?: string;
}

export interface HandoffRecentTurn {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts?: string;
}

export interface HandoffCapsule {
  schemaVersion: 1;
  source: {
    provider: HandoffProvider;
    tabId: string;
    sessionId?: string;
    createdAtIso: string;
  };
  target: {
    provider: HandoffProvider;
  };
  workspace: {
    cwd?: string;
    repoRoot?: string;
    branch?: string;
  };
  task: {
    objective: string;
    status: 'active' | 'blocked' | 'done';
    blockers: string[];
    nextSteps: string[];
  };
  decisions: HandoffDecision[];
  touchedFiles: string[];
  recentTurns: HandoffRecentTurn[];
  summaryText: string;
  limits: {
    estimatedChars: number;
    truncated: boolean;
  };
}

export interface HandoffSourceSnapshot {
  provider: HandoffProvider;
  tabId: string;
  sessionId?: string;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  model?: string;
  messages: SerializedChatMessage[];
  createdAtIso: string;
}

export interface HandoffProgressUpdate {
  stage: HandoffStage;
  sourceProvider: HandoffProvider;
  targetProvider: HandoffProvider;
  detail?: string;
  artifactPath?: string;
  manualPrompt?: string;
  error?: string;
}

export interface HandoffArtifactPaths {
  jsonPath: string;
  markdownPath: string;
}

export interface HandoffRunResult {
  targetTabId: string;
  targetSessionId?: string;
  artifact?: HandoffArtifactPaths;
  capsule: HandoffCapsule;
  prompt: string;
}

export interface HandoffSessionRequest {
  sourceTabId?: string;
  targetProvider: HandoffProvider;
  keepSourceOpen?: boolean;
  autoSend?: boolean;
}

export function isHandoffProvider(provider: ProviderId): provider is HandoffProvider {
  return provider === 'claude' || provider === 'codex';
}
