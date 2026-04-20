import { create } from 'zustand';
import type { ContentBlock } from '../../extension/types/stream-json';
import type {
  BugReportContext,
  CodexReasoningEffort,
  HandoffStage,
  McpConfigDiffPreview,
  McpConfigPaths,
  McpMutationRecord,
  McpNextAction,
  McpServerInfo,
  McpTemplateDefinition,
  ProviderCapabilities,
  ProviderId,
  TypingTheme,
} from '../../extension/types/webview-messages';
import type {
  AchievementAwardPayload,
  AchievementGoalPayload,
  AchievementProfilePayload,
  CodexModelOption,
  SessionRecapPayload,
  SessionSummary,
  SkillGenRunStatus,
  SkillGenRunHistoryEntry,
  TokenUsageRatioSample,
  TokenRatioBucketSummary,
  TurnRecord,
  TurnSemantics,
  CommunityFriendProfilePayload,
  UsageStat,
  CheckpointState,
} from '../../extension/types/webview-messages';
import type { AdventureBeat } from '../components/Vitals/adventure/types';
import { deriveTurnHistoryFromMessages } from '../utils/turnVitals';
import type { AchievementLang } from '../components/Achievements/achievementI18n';

// --- Message types for the UI ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  model?: string;
  timestamp: number;
  thinkingEffort?: string;
}

export interface StreamingBlock {
  blockIndex: number;
  type: 'text' | 'tool_use';
  text: string;
  toolName?: string;
  toolId?: string;
  partialJson?: string;
}

export interface CostInfo {
  costUsd: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Snapshot of the most recent assistant event for a given message */
interface AssistantSnapshot {
  messageId: string;
  content: ContentBlock[];
  model: string;
}

// --- Visual Progress Mode types ---

export type ToolCategory =
  | 'reading'
  | 'writing'
  | 'editing'
  | 'searching'
  | 'executing'
  | 'delegating'
  | 'planning'
  | 'skill'
  | 'deciding'
  | 'researching';

export interface VisualProgressCard {
  id: string;
  category: ToolCategory;
  toolName: string;
  description: string;
  aiDescription?: string;
  filePath?: string;
  command?: string;
  pattern?: string;
  timestamp: number;
  isStreaming: boolean;
}

// --- Store state ---

export interface TextSettings {
  fontSize: number;    // px
  fontFamily: string;  // CSS font-family string, empty = use VS Code default
}

export interface AchievementToast extends AchievementAwardPayload {
  toastId: string;
  createdAt: number;
}

export interface AppState {
  // Session
  sessionId: string | null;
  provider: ProviderId | null;
  model: string | null;
  selectedProvider: ProviderId;
  providerCapabilities: ProviderCapabilities;
  selectedModel: string;  // model chosen by user for next session
  selectedCodexReasoningEffort: CodexReasoningEffort;
  codexModelOptions: CodexModelOption[];
  isConnected: boolean;
  isBusy: boolean;
  lastActivityAt: number;
  handoffStage: HandoffStage;
  handoffTargetProvider: ProviderId | null;
  handoffError: string | null;
  handoffArtifactPath: string | null;
  handoffManualPrompt: string | null;

  // Messages
  messages: ChatMessage[];
  streamingMessageId: string | null;
  streamingBlocks: StreamingBlock[];

  // Last assistant snapshot (authoritative content from the server)
  lastAssistantSnapshot: AssistantSnapshot | null;

  // Cost
  cost: CostInfo;

  // Errors
  lastError: string | null;

  // Text display settings
  textSettings: TextSettings;
  typingTheme: TypingTheme;

  // File paths dropped/picked
  pendingFilePaths: string[] | null;

  // Prompt history (most recent last)
  promptHistory: string[];

  // Resume indicator
  isResuming: boolean;

  // Plan approval (CLI paused waiting for user approval of ExitPlanMode / AskUserQuestion)
  pendingApproval: { toolName: string; planText: string } | null;

  // Prompt history panel
  promptHistoryPanelOpen: boolean;
  projectPromptHistory: string[];
  globalPromptHistory: string[];

  // Real-time tool activity (lightweight, no API calls)
  currentToolActivity: string | null;

  // Thinking effort level detected for the current streaming message
  currentThinkingEffort: string | null;

  // Activity summary (from Haiku)
  activitySummary: { shortLabel: string; fullSummary: string } | null;
  activitySummaryDismissed: boolean; // temporarily dismissed for current turn
  activitySummaryEnabled: boolean; // VS Code setting mirror

  // Permission mode
  permissionMode: 'full-access' | 'supervised';

  // Git push
  gitPushSettings: { enabled: boolean; scriptPath: string; commitMessageTemplate: string } | null;
  gitPushResult: { success: boolean; output: string } | null;
  gitPushConfigPanelOpen: boolean;
  gitPushRunning: boolean;

  // Fork state (set when a forked tab receives forkInit from extension)
  forkInit: { promptText: string } | null;

  // BTW side-thought popup state
  btwPopup: { contextMessageId: string | null; mode: 'compose' | 'chat' } | null;

  // BTW background session state (separate from main session)
  btwSession: {
    messages: ChatMessage[];
    streamingMessageId: string | null;
    streamingBlocks: StreamingBlock[];
    isBusy: boolean;
  } | null;

  // Translation state
  translationLanguage: string;
  translations: Record<string, string>;
  translatingMessageIds: Set<string>;
  showingTranslation: Set<string>;
  /** Per-message forced LTR alignment override. Toggled from the bubble's "יישור לשמאל/לימין" button. */
  messageForcedLtr: Set<string>;
  /** Maps message IDs to translation error messages (cleared on next attempt) */
  translationErrors: Record<string, string>;
  /** Maps user message IDs to the original (pre-translation) text the user typed */
  userOriginalTexts: Record<string, string>;
  /** Holds the original text while waiting for the CLI to echo the translated message */
  pendingOriginalText: string | null;

  // Summary Mode
  summaryModeEnabled: boolean;
  sessionAnimationIndex: number;
  sessionToolCount: number;
  summaryByMessageId: Record<string, { shortLabel: string; fullSummary: string }>;

  // Visual Progress Mode
  vpmEnabled: boolean;
  visualProgressCards: VisualProgressCard[];

  // Detailed Diff View
  detailedDiffEnabled: boolean;
  /** Maps toolUseId -> { filePath, oldContent } for pre-write file captures */
  writeOldContentByToolId: Record<string, { filePath: string; oldContent: string }>;

  // Session Vitals
  vitalsEnabled: boolean;
  turnHistory: TurnRecord[];
  turnByMessageId: Record<string, TurnRecord>;
  weather: WeatherState;

  // Checkpoint revert/redo
  checkpointState: CheckpointState | null;
  checkpointResult: {
    success: boolean;
    action: 'revert' | 'redo';
    targetTurnIndex: number;
    error?: string;
    conflicts?: string[];
  } | null;

  // Context usage widget
  contextWidgetVisible: boolean;

  // Ultrathink mode: 'off' | 'single' (one-shot) | 'locked' (always on)
  // Persisted via workspaceState at project level.
  ultrathinkMode: 'off' | 'single' | 'locked';

  // Restore-sessions-on-startup toggle (mirrors claudeMirror.restoreSessionsOnStartup)
  restoreSessionsEnabled: boolean;

  // Usage widget
  usageWidgetEnabled: boolean;
  usageStats: UsageStat[];
  usageFetchedAt: number | null;
  usageError: string | undefined;
  usageLimit: {
    active: boolean;
    resetAtMs: number | null;
    resetDisplay: string;
    rawMessage: string | null;
  };
  usageQueuedPrompt: {
    queued: boolean;
    scheduledSendAtMs: number | null;
    summary: string | null;
  };

  // Scheduled message
  scheduledMessage: {
    scheduled: boolean;
    text: string | null;
    scheduledAtMs: number | null;
    summary: string | null;
  };
  scheduleMessageEnabled: boolean;
  scheduleMessageAtMs: number | null;

  // Achievements
  achievementsEnabled: boolean;
  achievementsSound: boolean;
  achievementLanguage: AchievementLang;
  achievementProfile: AchievementProfilePayload;
  achievementGoals: AchievementGoalPayload[];
  achievementToasts: AchievementToast[];
  achievementPanelOpen: boolean;
  sessionRecap: SessionRecapPayload | null;

  // Community (GitHub sync)
  communityPanelOpen: boolean;
  githubSyncStatus: {
    connected: boolean;
    username: string;
    gistId: string;
    gistUrl: string;
    lastSyncedAt: string;
    syncEnabled: boolean;
  } | null;
  communityFriends: CommunityFriendProfilePayload[];
  friendActionPending: boolean;

  // Adventure Widget
  adventureEnabled: boolean;
  adventureBeats: AdventureBeat[];

  // Dashboard
  dashboardOpen: boolean;
  /** Pending semantics by messageId (for late/early arrival merge) */
  pendingTurnSemanticsByMessageId: Record<string, TurnSemantics>;

  // Prompt Enhancer
  isEnhancing: boolean;
  autoEnhanceEnabled: boolean;
  enhancerModel: string;
  enhancerPopoverOpen: boolean;
  enhanceComparisonData: { originalText: string; enhancedText: string } | null;

  // Babel Fish (unified translation toggle)
  babelFishEnabled: boolean;

  // Prompt Translator
  isTranslatingPrompt: boolean;
  promptTranslateEnabled: boolean;
  autoTranslateEnabled: boolean;
  sendSettingsPopoverOpen: boolean;

  // Turn analysis settings (mirrored from VS Code config)
  turnAnalysisEnabled: boolean;
  analysisModel: string;

  // Session metadata (from system/init event) for Context Inspector
  sessionMetadata: {
    tools: string[];
    model: string;
    cwd: string;
    mcpServers: McpServerInfo[];
  } | null;

  mcpPanelOpen: boolean;
  mcpSelectedTab: 'session' | 'workspace' | 'add' | 'debug';
  mcpInventory: McpServerInfo[];
  mcpPendingMutations: McpMutationRecord[];
  mcpPendingRestartCount: number;
  mcpLoading: boolean;
  mcpLastError: string | null;
  mcpLastOperation: { op: string; name?: string; success: boolean; restartNeeded?: boolean; nextAction?: McpNextAction } | null;
  mcpConfigPaths: McpConfigPaths | null;
  mcpTemplates: McpTemplateDefinition[];
  mcpDiffPreview: McpConfigDiffPreview | null;

  // Project-level analytics (cross-session, from workspaceState)
  projectSessions: SessionSummary[];
  projectDashboardMode: 'session' | 'project' | 'user';

  // Session activity timer (Claude active processing time only)
  sessionActivityStarted: boolean;
  sessionActivityElapsedMs: number;
  sessionActivityRunningSinceMs: number | null;

  // API Key
  hasApiKey: boolean;
  maskedApiKey: string;
  setApiKeySetting: (hasKey: boolean, maskedKey: string) => void;
  claudeAuthLoggedIn: boolean;
  claudeAuthEmail: string;
  claudeAuthSubscriptionType: string;
  setClaudeAuthStatus: (loggedIn: boolean, email: string, subscriptionType: string) => void;

  // Agent Teams
  teamActive: boolean;
  teamName: string | null;
  teamConfig: {
    name: string;
    description?: string;
    members: Array<{
      agentId: string;
      name: string;
      agentType: string;
      color?: string;
    }>;
  } | null;
  teamTasks: Array<{
    id: number;
    subject: string;
    description?: string;
    activeForm?: string;
    owner?: string;
    status: string;
    blockedBy?: number[];
    blocks?: number[];
  }>;
  teamAgentStatuses: Record<string, string>;
  teamRecentMessages: Array<{
    from: string;
    to?: string;
    text: string;
    timestamp: string | number;
    read?: boolean;
    type?: string;
    summary?: string;
  }>;
  teamPanelOpen: boolean;
  teamPanelActiveTab: string;
  setTeamState: (state: {
    teamName: string;
    config: AppState['teamConfig'];
    tasks: AppState['teamTasks'];
    agentStatuses: Record<string, string>;
    recentMessages: AppState['teamRecentMessages'];
  }) => void;
  setTeamActive: (active: boolean, teamName?: string) => void;
  setTeamPanelOpen: (open: boolean) => void;
  clearTeamState: () => void;

  // Codex Consultation
  codexConsultPanelOpen: boolean;
  setCodexConsultPanelOpen: (open: boolean) => void;

  // Active Skill indicator (accumulated across session, pills persist)
  sessionSkills: string[];
  addSessionSkill: (name: string) => void;

  // Skill Generation
  skillGenEnabled: boolean;
  skillGenThreshold: number;
  skillGenPendingDocs: number;
  skillGenRunStatus: SkillGenRunStatus;
  skillGenProgress: number;
  skillGenProgressLabel: string;
  skillGenLastRun: SkillGenRunHistoryEntry | null;
  skillGenHistory: SkillGenRunHistoryEntry[];
  skillGenPanelOpen: boolean;
  skillGenShowInfo: boolean;
  skillGenOnboardingSeen: boolean;

  // Bug Report
  bugReportPanelOpen: boolean;
  bugReportMode: 'quick' | 'ai';
  bugReportPhase: 'idle' | 'collecting' | 'ready' | 'sending' | 'sent' | 'error';
  bugReportDiagSummary: {
    os: string; vsCodeVersion: string; extensionVersion: string;
    nodeVersion: string; claudeCliVersion: string | null; codexCliVersion: string | null;
    logFileCount: number; logTotalSize: number;
  } | null;
  bugReportChatMessages: Array<{ role: 'user' | 'assistant' | 'script'; content: string; scripts?: Array<{ command: string; language: string }> }>;
  bugReportChatLoading: boolean;
  bugReportPreviewFiles: Array<{ name: string; sizeBytes: number; preview?: string }>;
  bugReportError: string | null;
  bugReportContext: BugReportContext | null;
  setBugReportPanelOpen: (open: boolean) => void;
  setBugReportMode: (mode: 'quick' | 'ai') => void;
  setBugReportContext: (context: BugReportContext | null) => void;
  bugReportReset: () => void;

  // Token-Usage Ratio
  tokenRatioSamples: TokenUsageRatioSample[];
  tokenRatioSummaries: TokenRatioBucketSummary[];
  tokenRatioGlobalTurnCount: number;
  tokenRatioCumulativeTokens: { input: number; output: number; cacheCreation: number; cacheRead: number } | null;
  tokenRatioCumulativeWeightedTokens: number | null;
  setTokenRatioData: (samples: TokenUsageRatioSample[], summaries: TokenRatioBucketSummary[], globalTurnCount: number, cumulativeTokens: { input: number; output: number; cacheCreation: number; cacheRead: number }, cumulativeWeightedTokens: number) => void;

  // Chat Search
  chatSearchOpen: boolean;
  chatSearchQuery: string;
  chatSearchScope: 'session' | 'project';
  chatSearchMatchIds: string[];
  chatSearchCurrentIndex: number;
  chatSearchProjectResults: import('../../extension/types/webview-messages').ChatSearchProjectResult[];
  chatSearchProjectLoading: boolean;
  chatSearchProjectRequestId: number;

  // Image Lightbox
  lightboxImageSrc: string | null;
  setLightboxImageSrc: (src: string | null) => void;

  // Actions
  setSession: (sessionId: string, model: string) => void;
  endSession: (reason: string) => void;
  addUserMessage: (content: string | ContentBlock[]) => void;
  addAssistantMessage: (messageId: string, content: ContentBlock[], model: string, thinkingEffort?: string) => void;

  // Streaming lifecycle
  handleMessageStart: (messageId: string, model: string) => void;
  appendStreamingText: (
    messageId: string,
    blockIndex: number,
    text: string
  ) => void;
  startToolUse: (
    messageId: string,
    blockIndex: number,
    toolName: string,
    toolId: string
  ) => void;
  appendToolInput: (
    messageId: string,
    blockIndex: number,
    partialJson: string
  ) => void;
  updateAssistantSnapshot: (
    messageId: string,
    content: ContentBlock[],
    model: string
  ) => void;
  finalizeStreamingMessage: () => void;
  clearStreaming: () => void;

  setBusy: (busy: boolean) => void;
  setHandoffProgress: (progress: {
    stage: HandoffStage;
    targetProvider: 'claude' | 'codex';
    artifactPath?: string;
    manualPrompt?: string;
    error?: string;
    detail?: string;
  }) => void;
  clearHandoffProgress: () => void;
  markActivity: () => void;
  updateCost: (cost: CostInfo) => void;
  setError: (message: string | null) => void;
  setPendingFilePaths: (paths: string[] | null) => void;
  addToPromptHistory: (prompt: string) => void;
  setTextSettings: (settings: Partial<TextSettings>) => void;
  setTypingTheme: (theme: TypingTheme) => void;
  setProvider: (provider: ProviderId | null) => void;
  setSelectedProvider: (provider: ProviderId) => void;
  setProviderCapabilities: (capabilities: ProviderCapabilities) => void;
  setResuming: (resuming: boolean) => void;
  setSelectedModel: (model: string) => void;
  setSelectedCodexReasoningEffort: (effort: CodexReasoningEffort) => void;
  setCodexModelOptions: (options: CodexModelOption[]) => void;
  setPendingApproval: (approval: { toolName: string; planText: string } | null) => void;
  truncateFromMessage: (messageId: string) => void;
  setToolActivity: (detail: string | null) => void;
  setThinkingEffort: (effort: string | null) => void;
  setActivitySummary: (summary: { shortLabel: string; fullSummary: string } | null) => void;
  setActivitySummaryDismissed: (dismissed: boolean) => void;
  setActivitySummaryEnabled: (enabled: boolean) => void;
  setPromptHistoryPanelOpen: (open: boolean) => void;
  setPermissionMode: (mode: 'full-access' | 'supervised') => void;
  setProjectPromptHistory: (history: string[]) => void;
  setGlobalPromptHistory: (history: string[]) => void;
  setGitPushSettings: (settings: { enabled: boolean; scriptPath: string; commitMessageTemplate: string }) => void;
  setGitPushResult: (result: { success: boolean; output: string } | null) => void;
  setGitPushConfigPanelOpen: (open: boolean) => void;
  setGitPushRunning: (running: boolean) => void;
  setForkInit: (init: { promptText: string } | null) => void;
  setBtwPopup: (popup: { contextMessageId: string | null; mode: 'compose' | 'chat' } | null) => void;
  // BTW background session actions
  initBtwSession: () => void;
  addBtwUserMessage: (content: ContentBlock[]) => void;
  handleBtwMessageStart: (messageId: string) => void;
  handleBtwStreamingText: (blockIndex: number, text: string) => void;
  addBtwAssistantMessage: (messageId: string, content: ContentBlock[], model?: string) => void;
  handleBtwMessageStop: () => void;
  handleBtwResult: () => void;
  clearBtwSession: () => void;
  setTranslationLanguage: (language: string) => void;
  setTranslation: (messageId: string, translatedText: string) => void;
  setTranslating: (messageId: string, translating: boolean) => void;
  setTranslationError: (messageId: string, error: string) => void;
  toggleTranslationView: (messageId: string) => void;
  toggleMessageForcedLtr: (messageId: string) => void;
  setPendingOriginalText: (text: string | null) => void;
  setUserOriginalText: (messageId: string, text: string) => void;
  setSummaryModeEnabled: (enabled: boolean) => void;
  setMessageSummary: (messageId: string, summary: { shortLabel: string; fullSummary: string }) => void;
  incrementSessionToolCount: () => void;
  setVpmEnabled: (enabled: boolean) => void;
  addVisualProgressCard: (card: VisualProgressCard) => void;
  updateCardDescription: (cardId: string, description: string) => void;
  clearVisualProgressCards: () => void;
  setDetailedDiffEnabled: (enabled: boolean) => void;
  addWriteOldContent: (toolUseId: string, filePath: string, oldContent: string) => void;
  setUltrathinkMode: (mode: 'off' | 'single' | 'locked') => void;
  setVitalsEnabled: (enabled: boolean) => void;
  setCheckpointState: (state: CheckpointState) => void;
  setCheckpointResult: (result: AppState['checkpointResult']) => void;
  clearCheckpointResult: () => void;
  setContextWidgetVisible: (visible: boolean) => void;
  setUsageWidgetEnabled: (enabled: boolean) => void;
  setRestoreSessionsEnabled: (enabled: boolean) => void;
  setUsageData: (stats: UsageStat[], fetchedAt: number, error?: string) => void;
  setUsageLimitState: (state: { active: boolean; resetAtMs: number | null; resetDisplay: string; rawMessage: string | null }) => void;
  setUsageQueuedPromptState: (state: { queued: boolean; scheduledSendAtMs: number | null; summary: string | null }) => void;
  setScheduledMessageState: (state: { scheduled: boolean; text: string | null; scheduledAtMs: number | null; summary: string | null }) => void;
  setScheduleMessageEnabled: (enabled: boolean) => void;
  setScheduleMessageAtMs: (atMs: number | null) => void;
  rebuildTurnHistoryFromMessages: (messages?: ChatMessage[]) => void;
  addTurnRecord: (turn: TurnRecord) => void;
  setAchievementLanguage: (lang: AchievementLang) => void;
  setAchievementsSettings: (settings: { enabled: boolean; sound: boolean }) => void;
  setAchievementsSnapshot: (snapshot: { profile: AchievementProfilePayload; goals: AchievementGoalPayload[] }) => void;
  addAchievementToast: (toast: AchievementAwardPayload, profile: AchievementProfilePayload) => void;
  dismissAchievementToast: (toastId: string) => void;
  setAchievementPanelOpen: (open: boolean) => void;
  setSessionRecap: (recap: SessionRecapPayload | null) => void;
  setAchievementGoals: (goals: AchievementGoalPayload[]) => void;
  setCommunityPanelOpen: (open: boolean) => void;
  setGithubSyncStatus: (status: { connected: boolean; username: string; gistId: string; gistUrl: string; lastSyncedAt: string; syncEnabled: boolean }) => void;
  setCommunityFriends: (friends: CommunityFriendProfilePayload[]) => void;
  setFriendActionPending: (pending: boolean) => void;
  setAdventureEnabled: (enabled: boolean) => void;
  addAdventureBeat: (beat: AdventureBeat) => void;
  markSessionPromptSent: () => void;
  toggleDashboard: () => void;
  setDashboardOpen: (open: boolean) => void;
  applyTurnSemantics: (messageId: string, semantics: TurnSemantics) => void;
  setIsEnhancing: (enhancing: boolean) => void;
  setAutoEnhanceEnabled: (enabled: boolean) => void;
  setEnhancerModel: (model: string) => void;
  setEnhancerPopoverOpen: (open: boolean) => void;
  setEnhanceComparisonData: (data: { originalText: string; enhancedText: string } | null) => void;
  setPromptEnhancerSettings: (settings: { autoEnhance: boolean; enhancerModel: string }) => void;
  setBabelFishEnabled: (enabled: boolean) => void;
  setIsTranslatingPrompt: (translating: boolean) => void;
  setPromptTranslateEnabled: (enabled: boolean) => void;
  setAutoTranslateEnabled: (enabled: boolean) => void;
  setSendSettingsPopoverOpen: (open: boolean) => void;
  setPromptTranslatorSettings: (settings: { translateEnabled: boolean; autoTranslate: boolean }) => void;
  setTurnAnalysisSettings: (settings: { enabled: boolean; analysisModel: string }) => void;
  setSessionMetadata: (meta: { tools: string[]; model: string; cwd: string; mcpServers: McpServerInfo[] }) => void;
  setMcpPanelOpen: (open: boolean) => void;
  setMcpSelectedTab: (tab: 'session' | 'workspace' | 'add' | 'debug') => void;
  setMcpInventory: (servers: McpServerInfo[], configPaths?: McpConfigPaths | null) => void;
  setMcpPendingRestartCount: (count: number) => void;
  setMcpLoading: (loading: boolean) => void;
  setMcpLastError: (error: string | null) => void;
  setMcpLastOperation: (operation: { op: string; name?: string; success: boolean; restartNeeded?: boolean; nextAction?: McpNextAction } | null) => void;
  setMcpTemplates: (templates: McpTemplateDefinition[]) => void;
  setMcpDiffPreview: (preview: McpConfigDiffPreview | null) => void;
  setProjectSessions: (sessions: SessionSummary[]) => void;
  setProjectDashboardMode: (mode: 'session' | 'project' | 'user') => void;
  setSkillGenSettings: (settings: { enabled: boolean; threshold: number; onboardingSeen: boolean }) => void;
  setSkillGenStatus: (status: { pendingDocs: number; threshold: number; runStatus: SkillGenRunStatus; progress: number; progressLabel: string; lastRun: SkillGenRunHistoryEntry | null; history: SkillGenRunHistoryEntry[] }) => void;
  setSkillGenProgress: (update: { runStatus: SkillGenRunStatus; progress: number; progressLabel: string }) => void;
  setSkillGenPanelOpen: (open: boolean) => void;
  setSkillGenShowInfo: (show: boolean) => void;

  // Chat Search actions
  setChatSearchOpen: (open: boolean) => void;
  setChatSearchQuery: (query: string) => void;
  setChatSearchScope: (scope: 'session' | 'project') => void;
  setChatSearchCurrentIndex: (index: number) => void;
  setChatSearchProjectResults: (results: import('../../extension/types/webview-messages').ChatSearchProjectResult[], requestId: number) => void;
  setChatSearchProjectLoading: (loading: boolean) => void;
  clearChatSearch: () => void;

  reset: () => void;
}

const defaultTextSettings: TextSettings = {
  fontSize: 14,
  fontFamily: '',
};

const initialCost: CostInfo = {
  costUsd: 0,
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsPlanApproval: true,
  supportsCompact: true,
  supportsFork: true,
  supportsImages: true,
  supportsGitPush: true,
  supportsTranslation: true,
  supportsPromptEnhancer: true,
  supportsCodexConsult: true,
  supportsPermissionModeSelector: true,
  supportsLiveTextStreaming: true,
  supportsConversationDiskReplay: true,
  supportsCostUsd: true,
};

// --- Session Vitals ---

export type WeatherMood = 'clear' | 'partly-sunny' | 'cloudy' | 'rainy' | 'thunderstorm' | 'rainbow' | 'night' | 'snowflake';
export type PulseRate = 'slow' | 'normal' | 'fast';

export interface WeatherState {
  mood: WeatherMood;
  pulseRate: PulseRate;
}

const initialWeather: WeatherState = { mood: 'night', pulseRate: 'slow' };

/**
 * Multi-dimensional weather: composite score from 4 signals.
 * Each dimension scores 0-1 (higher = worse).
 *   - Error pressure  (30%): errors in recent turns
 *   - Cost velocity   (25%): recent per-turn cost vs session average
 *   - Momentum        (25%): recent turn duration vs session average
 *   - Productivity    (20%): productive categories vs discussion/error
 */
function calculateWeather(turns: TurnRecord[]): WeatherState {
  if (turns.length === 0) return { mood: 'night', pulseRate: 'slow' };

  const recent = turns.slice(-5);
  const recentLen = recent.length;
  const lastTurn = turns[turns.length - 1];
  const secondLast = turns.length > 1 ? turns[turns.length - 2] : null;

  // Rainbow: recovery after error
  if (secondLast?.isError && !lastTurn.isError) {
    return { mood: 'rainbow', pulseRate: 'normal' };
  }

  // 1. Error pressure (0-1)
  const errorScore = recent.filter(t => t.isError).length / recentLen;

  // 2. Cost velocity (0-1): how much recent cost exceeds session average
  const avgCost = turns.reduce((s, t) => s + t.costUsd, 0) / turns.length;
  const recentAvgCost = recent.reduce((s, t) => s + t.costUsd, 0) / recentLen;
  const costRatio = avgCost > 0.0001 ? recentAvgCost / avgCost : 0;
  // 0 when at-or-below average, 1 when 3x average
  const costScore = Math.min(1, Math.max(0, (costRatio - 1) / 2));

  // 3. Momentum (0-1): rising turn duration = worse
  const avgDur = turns.reduce((s, t) => s + t.durationMs, 0) / turns.length;
  const recentAvgDur = recent.reduce((s, t) => s + t.durationMs, 0) / recentLen;
  const durRatio = avgDur > 100 ? recentAvgDur / avgDur : 0;
  const momentumScore = Math.min(1, Math.max(0, (durRatio - 1) / 2));

  // 4. Productivity flow (0-1): low ratio of productive turns = worse
  const productiveCategories = new Set(['code-write', 'research', 'command', 'success', 'skill']);
  const productiveCount = recent.filter(t => productiveCategories.has(t.category)).length;
  const flowScore = 1 - (productiveCount / recentLen);

  // Weighted composite
  const composite = errorScore * 0.30 + costScore * 0.25 + momentumScore * 0.25 + flowScore * 0.20;

  // Map to mood
  let mood: WeatherMood;
  if (composite < 0.15) mood = 'clear';
  else if (composite < 0.30) mood = 'partly-sunny';
  else if (composite < 0.45) mood = 'cloudy';
  else if (composite < 0.60) mood = 'rainy';
  else mood = 'thunderstorm';

  const pulseRate: PulseRate = composite < 0.15 ? 'slow' : composite < 0.45 ? 'normal' : 'fast';

  return { mood, pulseRate };
}

const initialAchievementProfile: AchievementProfilePayload = {
  totalXp: 0,
  level: 1,
  totalAchievements: 0,
  unlockedIds: [],
};

/**
 * Convert current streaming blocks into ContentBlock[] for a finalized message.
 * Falls back to building from streaming state if no server snapshot is available.
 */
function buildContentFromBlocks(blocks: StreamingBlock[]): ContentBlock[] {
  return blocks.map((b): ContentBlock => {
    if (b.type === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      if (b.partialJson) {
        try {
          parsedInput = JSON.parse(b.partialJson);
        } catch {
          // Partial JSON that couldn't be parsed - store as raw string
          parsedInput = { _raw: b.partialJson };
        }
      }
      return {
        type: 'tool_use',
        id: b.toolId || '',
        name: b.toolName || '',
        input: parsedInput,
      };
    }
    return { type: 'text', text: b.text };
  });
}

function buildTurnByMessageId(turns: TurnRecord[]): Record<string, TurnRecord> {
  const byId: Record<string, TurnRecord> = {};
  for (const turn of turns) {
    byId[turn.messageId] = turn;
  }
  return byId;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  sessionId: null,
  provider: 'claude',
  model: null,
  selectedProvider: 'claude',
  providerCapabilities: { ...DEFAULT_PROVIDER_CAPABILITIES },
  selectedModel: '',
  selectedCodexReasoningEffort: '',
  codexModelOptions: [],
  isConnected: false,
  isBusy: false,
  lastActivityAt: 0,
  handoffStage: 'idle',
  handoffTargetProvider: null,
  handoffError: null,
  handoffArtifactPath: null,
  handoffManualPrompt: null,
  messages: [],
  streamingMessageId: null,
  streamingBlocks: [],
  lastAssistantSnapshot: null,
  cost: { ...initialCost },
  lastError: null,
  textSettings: { ...defaultTextSettings },
  typingTheme: 'zen' as const,
  pendingFilePaths: null,
  promptHistory: [],
  isResuming: false,
  pendingApproval: null,
  promptHistoryPanelOpen: false,
  projectPromptHistory: [],
  globalPromptHistory: [],
  currentToolActivity: null,
  currentThinkingEffort: null,
  activitySummary: null,
  activitySummaryDismissed: false,
  activitySummaryEnabled: true,
  permissionMode: 'full-access' as const,
  gitPushSettings: null,
  gitPushResult: null,
  gitPushConfigPanelOpen: false,
  gitPushRunning: false,
  forkInit: null,
  btwPopup: null,
  btwSession: null,
  translationLanguage: 'Hebrew',
  translations: {},
  translatingMessageIds: new Set(),
  showingTranslation: new Set(),
  messageForcedLtr: new Set(),
  translationErrors: {},
  userOriginalTexts: {},
  pendingOriginalText: null,
  summaryModeEnabled: false,
  sessionAnimationIndex: Math.floor(Math.random() * 5),
  sessionToolCount: 0,
  summaryByMessageId: {},
  vpmEnabled: false,
  visualProgressCards: [],
  detailedDiffEnabled: false,
  writeOldContentByToolId: {},
  ultrathinkMode: 'off' as 'off' | 'single' | 'locked',
  vitalsEnabled: false,
  turnHistory: [],
  turnByMessageId: {},
  weather: { ...initialWeather },
  checkpointState: null,
  checkpointResult: null,
  contextWidgetVisible: true,
  usageWidgetEnabled: false,
  restoreSessionsEnabled: true,
  usageStats: [],
  usageFetchedAt: null,
  usageError: undefined,
  usageLimit: { active: false, resetAtMs: null, resetDisplay: '', rawMessage: null },
  usageQueuedPrompt: { queued: false, scheduledSendAtMs: null, summary: null },
  scheduledMessage: { scheduled: false, text: null, scheduledAtMs: null, summary: null },
  scheduleMessageEnabled: false,
  scheduleMessageAtMs: null,
  achievementsEnabled: true,
  achievementsSound: false,
  achievementLanguage: (() => {
    try {
      const stored = localStorage.getItem('claui-achievement-lang');
      if (stored === 'he' || stored === 'en') return stored;
    } catch { /* webview localStorage may not be available */ }
    return 'en' as AchievementLang;
  })(),
  achievementProfile: { ...initialAchievementProfile },
  achievementGoals: [],
  achievementToasts: [],
  achievementPanelOpen: false,
  sessionRecap: null,
  communityPanelOpen: false,
  githubSyncStatus: null,
  communityFriends: [],
  friendActionPending: false,
  adventureEnabled: false,
  adventureBeats: [],
  dashboardOpen: false,
  pendingTurnSemanticsByMessageId: {},
  isEnhancing: false,
  autoEnhanceEnabled: false,
  enhancerModel: 'claude-sonnet-4-6',
  enhancerPopoverOpen: false,
  enhanceComparisonData: null,
  babelFishEnabled: false,
  isTranslatingPrompt: false,
  promptTranslateEnabled: false,
  autoTranslateEnabled: false,
  sendSettingsPopoverOpen: false,
  turnAnalysisEnabled: true,
  analysisModel: 'claude-haiku-4-5-20251001',
  sessionMetadata: null,
  mcpPanelOpen: false,
  mcpSelectedTab: 'session',
  mcpInventory: [],
  mcpPendingMutations: [],
  mcpPendingRestartCount: 0,
  mcpLoading: false,
  mcpLastError: null,
  mcpLastOperation: null,
  mcpConfigPaths: null,
  mcpTemplates: [],
  mcpDiffPreview: null,
  projectSessions: [],
  projectDashboardMode: 'session',
  sessionActivityStarted: false,
  sessionActivityElapsedMs: 0,
  sessionActivityRunningSinceMs: null,

  // API Key
  hasApiKey: false,
  maskedApiKey: '',
  setApiKeySetting: (hasKey, maskedKey) => set({ hasApiKey: hasKey, maskedApiKey: maskedKey }),
  claudeAuthLoggedIn: false,
  claudeAuthEmail: '',
  claudeAuthSubscriptionType: '',
  setClaudeAuthStatus: (loggedIn, email, subscriptionType) =>
    set({
      claudeAuthLoggedIn: loggedIn,
      claudeAuthEmail: email,
      claudeAuthSubscriptionType: subscriptionType,
    }),

  // Agent Teams
  teamActive: false,
  teamName: null,
  teamConfig: null,
  teamTasks: [],
  teamAgentStatuses: {},
  teamRecentMessages: [],
  teamPanelOpen: false,
  teamPanelActiveTab: 'topology',
  setTeamState: (teamState) => set({
    teamActive: true,
    teamName: teamState.teamName,
    teamConfig: teamState.config,
    teamTasks: teamState.tasks,
    teamAgentStatuses: teamState.agentStatuses,
    teamRecentMessages: teamState.recentMessages,
  }),
  setTeamActive: (active, teamName) => set({
    teamActive: active,
    ...(teamName ? { teamName } : {}),
  }),
  setTeamPanelOpen: (open) => set({ teamPanelOpen: open }),
  clearTeamState: () => set({
    teamActive: false,
    teamName: null,
    teamConfig: null,
    teamTasks: [],
    teamAgentStatuses: {},
    teamRecentMessages: [],
    teamPanelOpen: false,
    teamPanelActiveTab: 'topology',
  }),

  // Codex Consultation
  codexConsultPanelOpen: false,
  setCodexConsultPanelOpen: (open) => set({ codexConsultPanelOpen: open }),

  // Active Skill indicator (accumulated across session)
  sessionSkills: [],
  addSessionSkill: (name) => set((state) => {
    if (state.sessionSkills.includes(name)) return state;
    return { sessionSkills: [...state.sessionSkills, name] };
  }),

  // Skill Generation
  skillGenEnabled: true,
  skillGenThreshold: 30,
  skillGenPendingDocs: 0,
  skillGenRunStatus: 'idle' as SkillGenRunStatus,
  skillGenProgress: 0,
  skillGenProgressLabel: '',
  skillGenLastRun: null,
  skillGenHistory: [],
  skillGenPanelOpen: false,
  skillGenShowInfo: false,
  skillGenOnboardingSeen: false,

  // Bug Report
  bugReportPanelOpen: false,
  bugReportMode: 'quick' as 'quick' | 'ai',
  bugReportPhase: 'idle' as 'idle' | 'collecting' | 'ready' | 'sending' | 'sent' | 'error',
  bugReportDiagSummary: null,
  bugReportChatMessages: [],
  bugReportChatLoading: false,
  bugReportPreviewFiles: [],
  bugReportError: null,
  bugReportContext: null,
  setBugReportPanelOpen: (open) => set({ bugReportPanelOpen: open }),
  setBugReportMode: (mode) => set({ bugReportMode: mode }),
  setBugReportContext: (context) => set({ bugReportContext: context }),
  bugReportReset: () => set({
    bugReportPanelOpen: false,
    bugReportMode: 'quick' as 'quick' | 'ai',
    bugReportPhase: 'idle' as 'idle' | 'collecting' | 'ready' | 'sending' | 'sent' | 'error',
    bugReportDiagSummary: null,
    bugReportChatMessages: [],
    bugReportChatLoading: false,
    bugReportPreviewFiles: [],
    bugReportError: null,
    bugReportContext: null,
  }),

  // Token-Usage Ratio
  tokenRatioSamples: [],
  tokenRatioSummaries: [],
  tokenRatioGlobalTurnCount: 0,
  tokenRatioCumulativeTokens: null,
  tokenRatioCumulativeWeightedTokens: null,
  setTokenRatioData: (samples, summaries, globalTurnCount, cumulativeTokens, cumulativeWeightedTokens) =>
    set({ tokenRatioSamples: samples, tokenRatioSummaries: summaries, tokenRatioGlobalTurnCount: globalTurnCount, tokenRatioCumulativeTokens: cumulativeTokens, tokenRatioCumulativeWeightedTokens: cumulativeWeightedTokens }),

  // Chat Search
  chatSearchOpen: false,
  chatSearchQuery: '',
  chatSearchScope: 'session' as 'session' | 'project',
  chatSearchMatchIds: [],
  chatSearchCurrentIndex: -1,
  chatSearchProjectResults: [],
  chatSearchProjectLoading: false,
  chatSearchProjectRequestId: 0,

  // Image Lightbox
  lightboxImageSrc: null,
  setLightboxImageSrc: (src) => set({ lightboxImageSrc: src }),

  // Actions
  setSession: (sessionId, model) =>
    set((state) => {
      const isPendingToRealTransition =
        state.sessionId === 'pending' &&
        sessionId !== 'pending' &&
        !!sessionId;
      const isBrandNewSession =
        !state.isConnected ||
        (!isPendingToRealTransition &&
          state.sessionId !== null &&
          state.sessionId !== sessionId);
      return {
        sessionId,
        model,
        isConnected: true,
        lastError: null,
        sessionRecap: null,
        // Session connected: show clear sky (not night/idle) even before first turn completes
        ...(isBrandNewSession
          ? {
            sessionActivityStarted: false,
            sessionActivityElapsedMs: 0,
            sessionActivityRunningSinceMs: null,
            weather: { mood: 'clear' as WeatherMood, pulseRate: 'slow' as PulseRate },
            visualProgressCards: [],
          }
          : {}),
      };
    }),

  endSession: (_reason) =>
    set((state) => {
      const now = Date.now();
      const finalElapsed = state.sessionActivityRunningSinceMs
        ? state.sessionActivityElapsedMs + (now - state.sessionActivityRunningSinceMs)
        : state.sessionActivityElapsedMs;
      return {
        isConnected: false,
        isBusy: false,
        streamingMessageId: null,
        streamingBlocks: [],
        lastAssistantSnapshot: null,
        pendingApproval: null,
        currentToolActivity: null,
        currentThinkingEffort: null,
        activitySummary: null,
        activitySummaryDismissed: false,
        sessionSkills: [],
        sessionActivityElapsedMs: finalElapsed,
        sessionActivityRunningSinceMs: null,
        weather: { mood: 'night' as WeatherMood, pulseRate: 'slow' as PulseRate },
        lastActivityAt: 0,
        handoffStage: 'idle' as HandoffStage,
        handoffTargetProvider: null,
        handoffError: null,
        handoffArtifactPath: null,
        handoffManualPrompt: null,
        usageLimit: { active: false, resetAtMs: null, resetDisplay: '', rawMessage: null },
        usageQueuedPrompt: { queued: false, scheduledSendAtMs: null, summary: null },
        scheduledMessage: { scheduled: false, text: null, scheduledAtMs: null, summary: null },
        scheduleMessageEnabled: false,
        scheduleMessageAtMs: null,
        // Clear team state when the session ends - teammates die with the session
        teamActive: false,
        teamName: null,
        teamConfig: null,
        teamTasks: [],
        teamAgentStatuses: {},
        teamRecentMessages: [],
        teamPanelOpen: false,
      };
    }),

  addUserMessage: (content) => {
    // Normalize content: CLI may send a plain string instead of ContentBlock[]
    const normalizedContent: ContentBlock[] = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content)
        ? content
        : [{ type: 'text', text: String(content) }];

    // Filter out tool_result blocks - these are API-internal messages
    // (tool results sent back to Claude as user-role), not actual user input.
    // They should not appear as "You" messages in the chat UI.
    const userVisibleContent = normalizedContent.filter(
      (block) => block.type !== 'tool_result'
    );

    // Skip entirely if no user-visible content remains
    if (userVisibleContent.length === 0) {
      return;
    }

    // Deduplicate: search recent messages (not just the last one) for a user
    // message with matching text.  The optimistic display adds the user message
    // immediately, but the CLI echo can arrive *after* assistant events
    // (messageStart, textDelta, messageStop) have already been appended,
    // so checking only the very last message is insufficient.
    // The 15-second window is generous enough to cover slow CLI echoes while
    // still allowing legitimate repeated messages sent minutes apart.
    const DEDUP_WINDOW_MS = 15_000;
    const state = get();
    const now = Date.now();
    const newText = userVisibleContent
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('');

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (now - msg.timestamp >= DEDUP_WINDOW_MS) break;
      if (msg.role !== 'user') continue;
      const existingText = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      if (newText === existingText) {
        return; // duplicate — suppress
      }
    }

    const messageId = `user-${Date.now()}`;
    const pending = get().pendingOriginalText;

    set((s) => {
      const updates: Partial<AppState> = {
        messages: [
          ...s.messages,
          {
            id: messageId,
            role: 'user' as const,
            content: userVisibleContent,
            timestamp: Date.now(),
          },
        ],
      };
      // If there's a pending original text from Babel Fish translation, associate it
      if (pending) {
        updates.userOriginalTexts = { ...s.userOriginalTexts, [messageId]: pending };
        updates.pendingOriginalText = null;
      }
      return updates;
    });
  },

  /**
   * Add a complete assistant message directly to the messages array.
   * Used for replayed messages during session resume (no streaming pipeline).
   */
  addAssistantMessage: (messageId, content, model, thinkingEffort?) => {
    // Normalize content defensively
    const normalizedContent: ContentBlock[] = Array.isArray(content)
      ? content
      : [{ type: 'text', text: String(content) }];

    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: normalizedContent,
      model,
      timestamp: Date.now(),
      thinkingEffort: thinkingEffort || get().currentThinkingEffort || undefined,
    };

    set((state) => {
      // Upsert: replace if same ID exists, otherwise append
      const existingIndex = state.messages.findIndex((m) => m.id === messageId);
      if (existingIndex >= 0) {
        // Guard: with --include-partial-messages, the CLI sends incremental
        // assistantMessage events (each containing only the most recently
        // completed block). Once a message is finalized by the streaming
        // pipeline (finalizeStreamingMessage), it has the complete, authoritative
        // content. Any subsequent assistantMessage event is a partial snapshot
        // that must not overwrite the finalized message.
        //
        // Rule: if the existing finalized message has any tool_use blocks,
        // treat it as authoritative and skip ALL replacement attempts.
        // The streaming pipeline (finalizeStreamingMessage) is the only
        // correct source for messages containing tool_use blocks.
        const existing = state.messages[existingIndex];
        const existingContent = Array.isArray(existing.content) ? existing.content : [];
        const existingHasToolUse = existingContent.some((b: ContentBlock) => b.type === 'tool_use');
        if (existingHasToolUse) {
          return {};
        }
        const updatedMessages = [...state.messages];
        updatedMessages[existingIndex] = newMessage;
        return { messages: updatedMessages };
      }
      return { messages: [...state.messages, newMessage] };
    });
  },

  /**
   * Called when a new assistant message starts streaming (messageStart event).
   * If there was a previous streaming message, finalize it first.
   */
  handleMessageStart: (messageId, _model) => {
    const state = get();

    // If we were streaming a different message, finalize it first
    if (state.streamingMessageId && state.streamingMessageId !== messageId && state.streamingBlocks.length > 0) {
      // Finalize previous message
      get().finalizeStreamingMessage();
    }

    // Start fresh for the new message
    set({
      streamingMessageId: messageId,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      currentThinkingEffort: null,
    });
  },

  appendStreamingText: (messageId, blockIndex, text) =>
    set((state) => {
      const existingBlock = state.streamingBlocks.find(
        (b) => b.blockIndex === blockIndex
      );

      let updatedBlocks: StreamingBlock[];
      if (existingBlock) {
        updatedBlocks = state.streamingBlocks.map((b) =>
          b.blockIndex === blockIndex
            ? { ...b, text: b.text + text }
            : b
        );
      } else {
        updatedBlocks = [
          ...state.streamingBlocks,
          { blockIndex, type: 'text', text },
        ];
      }

      return {
        streamingMessageId: messageId,
        streamingBlocks: updatedBlocks,
      };
    }),

  startToolUse: (messageId, blockIndex, toolName, toolId) =>
    set((state) => ({
      streamingMessageId: messageId,
      streamingBlocks: [
        ...state.streamingBlocks,
        {
          blockIndex,
          type: 'tool_use',
          text: '',
          toolName,
          toolId,
          partialJson: '',
        },
      ],
    })),

  appendToolInput: (_messageId, blockIndex, partialJson) =>
    set((state) => ({
      streamingBlocks: state.streamingBlocks.map((b) =>
        b.blockIndex === blockIndex
          ? { ...b, partialJson: (b.partialJson || '') + partialJson }
          : b
      ),
    })),

  /**
   * Store the latest assistant snapshot from the server.
   * This is NOT added to the messages array - it's used as the authoritative
   * content when the message is finalized (on messageStop or result).
   */
  updateAssistantSnapshot: (messageId, content, model) =>
    set({ lastAssistantSnapshot: { messageId, content, model } }),

  /**
   * Convert current streaming state into a finalized ChatMessage.
   * Prefer accumulated streaming blocks because they are the complete picture.
   * If Claude ends a message without any streamed blocks, fall back to the
   * last assistant snapshot so text-only replies are not dropped from history.
   */
  finalizeStreamingMessage: () => {
    const state = get();
    const snapshot = state.lastAssistantSnapshot;
    const hasStreamingBlocks = state.streamingBlocks.length > 0;
    const canUseSnapshotOnly =
      !hasStreamingBlocks &&
      snapshot?.messageId === state.streamingMessageId &&
      Array.isArray(snapshot.content) &&
      snapshot.content.length > 0;

    console.error('[FINALIZE] called', {
      streamingMessageId: state.streamingMessageId,
      streamingBlocksLength: state.streamingBlocks.length,
      streamingBlockTypes: state.streamingBlocks.map(b => `${b.type}[${b.blockIndex}]`),
      currentMessagesCount: state.messages.length,
      snapshotMessageId: snapshot?.messageId,
      canUseSnapshotOnly,
    });

    if (!state.streamingMessageId || (!hasStreamingBlocks && !canUseSnapshotOnly)) {
      console.error('[FINALIZE] SKIPPED - nothing to finalize');
      return;
    }

    const content = hasStreamingBlocks
      ? buildContentFromBlocks(state.streamingBlocks)
      : snapshot!.content;
    const model = snapshot?.messageId === state.streamingMessageId
      ? snapshot.model
      : undefined;

    console.error('[FINALIZE] built content', {
      contentLength: content.length,
      contentTypes: content.map(b => b.type),
      textPreview: content.filter(b => b.type === 'text').map(b => (b.text || '').slice(0, 50)),
    });

    const newMessage: ChatMessage = {
      id: state.streamingMessageId,
      role: 'assistant',
      content,
      model,
      timestamp: Date.now(),
      thinkingEffort: state.currentThinkingEffort || undefined,
    };

    // Upsert into messages (in case the same message ID was already finalized)
    const existingIndex = state.messages.findIndex(
      (m) => m.id === state.streamingMessageId
    );

    let updatedMessages: ChatMessage[];
    if (existingIndex >= 0) {
      updatedMessages = [...state.messages];
      updatedMessages[existingIndex] = newMessage;
    } else {
      updatedMessages = [...state.messages, newMessage];
    }

    console.error('[FINALIZE] setting messages', {
      newMessagesCount: updatedMessages.length,
      allIds: updatedMessages.map(m => `${m.role}:${m.id.slice(0,10)}`),
    });

    set({
      messages: updatedMessages,
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      currentThinkingEffort: null,
    });
  },

  /**
   * Called when the turn is complete (result event).
   * Finalizes any remaining streaming message and clears streaming state.
   */
  clearStreaming: () => {
    // Finalize first if there's an in-progress message
    get().finalizeStreamingMessage();
    set({
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      isResuming: false,
      currentToolActivity: null,
      // sessionSkills intentionally NOT reset here - pills persist across turns
    });
  },

  setBusy: (busy) =>
    set((state) => {
      const now = Date.now();
      if (!state.sessionActivityStarted) {
        return busy
          ? { isBusy: true, lastActivityAt: now }
          : { isBusy: false };
      }

      if (busy && state.sessionActivityRunningSinceMs === null) {
        return {
          isBusy: true,
          sessionActivityRunningSinceMs: now,
          lastActivityAt: now,
        };
      }

      if (busy) {
        return { isBusy: true, lastActivityAt: now };
      }

      if (!busy && state.sessionActivityRunningSinceMs !== null) {
        return {
          isBusy: false,
          currentToolActivity: null,
          sessionActivityElapsedMs: state.sessionActivityElapsedMs + (now - state.sessionActivityRunningSinceMs),
          sessionActivityRunningSinceMs: null,
        };
      }

      return { isBusy: busy, ...(!busy ? { currentToolActivity: null } : {}) };
    }),

  setHandoffProgress: (progress) =>
    set(() => ({
      handoffStage: progress.stage,
      handoffTargetProvider: progress.targetProvider,
      handoffError: progress.error ?? null,
      handoffArtifactPath: progress.artifactPath ?? null,
      handoffManualPrompt: progress.manualPrompt ?? null,
    })),

  clearHandoffProgress: () =>
    set({
      handoffStage: 'idle',
      handoffTargetProvider: null,
      handoffError: null,
      handoffArtifactPath: null,
      handoffManualPrompt: null,
    }),

  markActivity: () => set({ lastActivityAt: Date.now() }),

  updateCost: (cost) => set({ cost }),

  setError: (message) => set({ lastError: message }),

  setPendingFilePaths: (paths) => set({ pendingFilePaths: paths }),

  addToPromptHistory: (prompt) =>
    set((state) => {
      // Avoid consecutive duplicates
      if (state.promptHistory.length > 0 && state.promptHistory[state.promptHistory.length - 1] === prompt) {
        return state;
      }
      // Keep last 50 prompts
      const updated = [...state.promptHistory, prompt];
      if (updated.length > 50) updated.shift();
      return { promptHistory: updated };
    }),

  setTextSettings: (settings) =>
    set((state) => ({
      textSettings: { ...state.textSettings, ...settings },
    })),

  setTypingTheme: (theme) => set({ typingTheme: theme }),

  setProvider: (provider) => set((state) => ({
    provider,
    ...(provider !== 'claude'
      ? {
        usageLimit: { active: false, resetAtMs: null, resetDisplay: '', rawMessage: null },
        usageQueuedPrompt: { queued: false, scheduledSendAtMs: null, summary: null },
        scheduledMessage: { scheduled: false, text: null, scheduledAtMs: null, summary: null },
        scheduleMessageEnabled: false,
        scheduleMessageAtMs: null,
      }
      : {}),
  })),

  setSelectedProvider: (provider) => set({ selectedProvider: provider }),

  setProviderCapabilities: (providerCapabilities) => set({ providerCapabilities }),

  setResuming: (resuming) => set({ isResuming: resuming }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  setSelectedCodexReasoningEffort: (effort) => set({ selectedCodexReasoningEffort: effort }),

  setCodexModelOptions: (options) => set({ codexModelOptions: options }),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  truncateFromMessage: (messageId) =>
    set((state) => {
      const index = state.messages.findIndex((m) => m.id === messageId);
      if (index < 0) return state;
      // Keep messages before the target, discard target and everything after
      const retainedMessages = state.messages.slice(0, index);
      const retainedAssistantIds = new Set(
        retainedMessages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.id)
      );
      const retainedTurns = state.turnHistory
        .filter((turn) => retainedAssistantIds.has(turn.messageId))
        .map((turn, turnIndex) => ({ ...turn, turnIndex }));
      return {
        messages: retainedMessages,
        turnHistory: retainedTurns,
        turnByMessageId: buildTurnByMessageId(retainedTurns),
        weather: calculateWeather(retainedTurns),
        checkpointState: null,
        checkpointResult: null,
      };
    }),

  setToolActivity: (detail) => set({ currentToolActivity: detail }),

  setThinkingEffort: (effort) => set({ currentThinkingEffort: effort }),

  setActivitySummary: (summary) => set({ activitySummary: summary }),
  setActivitySummaryDismissed: (dismissed) => set({ activitySummaryDismissed: dismissed }),
  setActivitySummaryEnabled: (enabled) => set({
    activitySummaryEnabled: enabled,
    // Clear any existing summary when disabling so it doesn't linger in the UI
    ...(enabled ? {} : { activitySummary: null, activitySummaryDismissed: false }),
  }),

  setPermissionMode: (mode) => set({ permissionMode: mode }),

  setPromptHistoryPanelOpen: (open) => set({ promptHistoryPanelOpen: open }),

  setProjectPromptHistory: (history) => set({ projectPromptHistory: history }),

  setGlobalPromptHistory: (history) => set({ globalPromptHistory: history }),

  setGitPushSettings: (settings) => set({ gitPushSettings: settings }),
  setGitPushResult: (result) => set({ gitPushResult: result }),
  setGitPushConfigPanelOpen: (open) => set({ gitPushConfigPanelOpen: open }),
  setGitPushRunning: (running) => set({ gitPushRunning: running }),
  setForkInit: (init) => set({ forkInit: init }),
  setBtwPopup: (popup) => set({ btwPopup: popup }),

  // BTW background session actions
  // Idempotent: skip if already initialized (preserves optimistic user messages)
  initBtwSession: () => set((state) => {
    if (state.btwSession) { return {}; }
    return {
      btwSession: {
        messages: [],
        streamingMessageId: null,
        streamingBlocks: [],
        isBusy: true,
      },
    };
  }),

  addBtwUserMessage: (content) => set((state) => {
    if (!state.btwSession) { return {}; }
    const normalizedContent: ContentBlock[] = typeof content === 'string'
      ? [{ type: 'text', text: content as string }]
      : content;
    const newMsg: ChatMessage = {
      id: `btw-user-${Date.now()}`,
      role: 'user',
      content: normalizedContent,
      timestamp: Date.now(),
    };
    return {
      btwSession: {
        ...state.btwSession,
        messages: [...state.btwSession.messages, newMsg],
        isBusy: true,
      },
    };
  }),

  handleBtwMessageStart: (messageId) => set((state) => {
    if (!state.btwSession) { return {}; }
    return {
      btwSession: {
        ...state.btwSession,
        streamingMessageId: messageId,
        streamingBlocks: [],
        isBusy: true,
      },
    };
  }),

  handleBtwStreamingText: (blockIndex, text) => set((state) => {
    if (!state.btwSession) { return {}; }
    const blocks = [...state.btwSession.streamingBlocks];
    const existing = blocks.find((b) => b.blockIndex === blockIndex);
    if (existing) {
      existing.text += text;
    } else {
      blocks.push({ blockIndex, type: 'text', text, toolName: undefined, partialJson: undefined });
    }
    return {
      btwSession: { ...state.btwSession, streamingBlocks: blocks },
    };
  }),

  addBtwAssistantMessage: (messageId, content, model) => set((state) => {
    if (!state.btwSession) { return {}; }
    const newMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content,
      model,
      timestamp: Date.now(),
    };
    return {
      btwSession: {
        ...state.btwSession,
        messages: [...state.btwSession.messages, newMsg],
        streamingMessageId: null,
        streamingBlocks: [],
      },
    };
  }),

  handleBtwMessageStop: () => set((state) => {
    if (!state.btwSession) { return {}; }
    return {
      btwSession: { ...state.btwSession },
    };
  }),

  handleBtwResult: () => set((state) => {
    if (!state.btwSession) { return {}; }
    return {
      btwSession: { ...state.btwSession, isBusy: false },
    };
  }),

  clearBtwSession: () => set({ btwSession: null, btwPopup: null }),

  setTranslationLanguage: (language) =>
    set((state) => {
      if (state.translationLanguage === language) {
        return { translationLanguage: language };
      }
      return {
        translationLanguage: language,
        translations: {},
        translatingMessageIds: new Set(),
        showingTranslation: new Set(),
        translationErrors: {},
        userOriginalTexts: {},
        pendingOriginalText: null,
      };
    }),

  setTranslation: (messageId, translatedText) =>
    set((state) => ({
      translations: { ...state.translations, [messageId]: translatedText },
      showingTranslation: new Set([...state.showingTranslation, messageId]),
    })),

  setTranslating: (messageId, translating) =>
    set((state) => {
      const newSet = new Set(state.translatingMessageIds);
      if (translating) {
        newSet.add(messageId);
      } else {
        newSet.delete(messageId);
      }
      // Clear error when starting a new translation attempt
      if (translating) {
        const { [messageId]: _, ...rest } = state.translationErrors;
        return { translatingMessageIds: newSet, translationErrors: rest };
      }
      return { translatingMessageIds: newSet };
    }),

  setTranslationError: (messageId, error) =>
    set((state) => ({
      translationErrors: { ...state.translationErrors, [messageId]: error },
    })),

  toggleTranslationView: (messageId) =>
    set((state) => {
      const newSet = new Set(state.showingTranslation);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return { showingTranslation: newSet };
    }),

  toggleMessageForcedLtr: (messageId) =>
    set((state) => {
      const newSet = new Set(state.messageForcedLtr);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return { messageForcedLtr: newSet };
    }),

  setPendingOriginalText: (text) => set({ pendingOriginalText: text }),

  setUserOriginalText: (messageId, text) =>
    set((state) => ({
      userOriginalTexts: { ...state.userOriginalTexts, [messageId]: text },
    })),

  setSummaryModeEnabled: (enabled) => set({ summaryModeEnabled: enabled }),
  setVpmEnabled: (enabled) => set({ vpmEnabled: enabled }),
  addVisualProgressCard: (card) =>
    set((state) => {
      // If card with same ID exists, update it (enrichment from blockStop)
      const existing = state.visualProgressCards.findIndex((c) => c.id === card.id);
      if (existing >= 0) {
        const updated = [...state.visualProgressCards];
        updated[existing] = { ...updated[existing], ...card };
        return { visualProgressCards: updated };
      }
      return { visualProgressCards: [...state.visualProgressCards, card] };
    }),
  updateCardDescription: (cardId, description) =>
    set((state) => ({
      visualProgressCards: state.visualProgressCards.map((c) =>
        c.id === cardId ? { ...c, aiDescription: description } : c
      ),
    })),
  clearVisualProgressCards: () => set({ visualProgressCards: [] }),
  setMessageSummary: (messageId, summary) =>
    set((state) => ({
      summaryByMessageId: { ...state.summaryByMessageId, [messageId]: summary },
    })),
  incrementSessionToolCount: () =>
    set((state) => ({ sessionToolCount: state.sessionToolCount + 1 })),

  setDetailedDiffEnabled: (enabled) => set({ detailedDiffEnabled: enabled }),

  addWriteOldContent: (toolUseId, filePath, oldContent) =>
    set((state) => ({
      writeOldContentByToolId: {
        ...state.writeOldContentByToolId,
        [toolUseId]: { filePath, oldContent },
      },
    })),

  setUltrathinkMode: (mode) => set({ ultrathinkMode: mode }),

  setVitalsEnabled: (enabled) =>
    set((state) => {
      if (!enabled || state.turnHistory.length > 0) {
        return { vitalsEnabled: enabled };
      }
      const rebuilt = deriveTurnHistoryFromMessages(state.messages);
      return {
        vitalsEnabled: enabled,
        turnHistory: rebuilt,
        turnByMessageId: buildTurnByMessageId(rebuilt),
        weather: calculateWeather(rebuilt),
      };
    }),

  setCheckpointState: (checkpointState) => set({ checkpointState }),
  setCheckpointResult: (checkpointResult) => set({ checkpointResult }),
  clearCheckpointResult: () => set({ checkpointResult: null }),
  setContextWidgetVisible: (visible) => set({ contextWidgetVisible: visible }),
  setUsageWidgetEnabled: (enabled) => set({ usageWidgetEnabled: enabled }),
  setRestoreSessionsEnabled: (enabled) => set({ restoreSessionsEnabled: enabled }),

  setUsageData: (stats, fetchedAt, error) =>
    set({ usageStats: stats, usageFetchedAt: fetchedAt, usageError: error }),

  setUsageLimitState: (usageLimit) =>
    set({ usageLimit }),

  setUsageQueuedPromptState: (usageQueuedPrompt) =>
    set({ usageQueuedPrompt }),

  setScheduledMessageState: (scheduledMessage) =>
    set({ scheduledMessage }),

  setScheduleMessageEnabled: (scheduleMessageEnabled) =>
    set({ scheduleMessageEnabled }),

  setScheduleMessageAtMs: (scheduleMessageAtMs) =>
    set({ scheduleMessageAtMs }),

  rebuildTurnHistoryFromMessages: (messages) =>
    set((state) => {
      const rebuilt = deriveTurnHistoryFromMessages(messages ?? state.messages);
      return {
        turnHistory: rebuilt,
        turnByMessageId: buildTurnByMessageId(rebuilt),
        weather: calculateWeather(rebuilt),
      };
    }),

  addTurnRecord: (turn) =>
    set((state) => {
      // Merge pending semantics if they arrived before the turn
      const pendingSem = state.pendingTurnSemanticsByMessageId[turn.messageId];
      const mergedTurn = pendingSem && !turn.semantics ? { ...turn, semantics: pendingSem } : turn;
      const existingIndex = state.turnHistory.findIndex((t) => t.messageId === mergedTurn.messageId);
      let updated = [...state.turnHistory];
      if (existingIndex >= 0) {
        updated[existingIndex] = { ...mergedTurn, turnIndex: existingIndex };
      } else {
        updated.push({ ...mergedTurn, turnIndex: updated.length });
      }
      if (updated.length > 200) {
        updated = updated.slice(-200);
      }
      const normalized = updated.map((t, idx) =>
        t.turnIndex === idx ? t : { ...t, turnIndex: idx }
      );
      return {
        turnHistory: normalized,
        turnByMessageId: buildTurnByMessageId(normalized),
        weather: calculateWeather(normalized),
      };
    }),

  setAchievementLanguage: (lang) => {
    try { localStorage.setItem('claui-achievement-lang', lang); } catch { /* ignore */ }
    set({ achievementLanguage: lang });
  },

  setAchievementsSettings: ({ enabled, sound }) =>
    set((state) => ({
      achievementsEnabled: enabled,
      achievementsSound: sound,
      achievementPanelOpen: enabled ? state.achievementPanelOpen : false,
      achievementToasts: enabled ? state.achievementToasts : [],
    })),

  setAchievementsSnapshot: ({ profile, goals }) =>
    set({
      achievementProfile: profile,
      achievementGoals: goals,
    }),

  addAchievementToast: (toast, profile) =>
    set((state) => ({
      achievementProfile: profile,
      achievementToasts: [
        ...state.achievementToasts,
        {
          ...toast,
          toastId: `${toast.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        },
      ],
    })),

  dismissAchievementToast: (toastId) =>
    set((state) => ({
      achievementToasts: state.achievementToasts.filter((toast) => toast.toastId !== toastId),
    })),

  setAchievementPanelOpen: (open) => set({ achievementPanelOpen: open }),
  setSessionRecap: (recap) => set({ sessionRecap: recap }),
  setAchievementGoals: (goals) => set({ achievementGoals: goals }),
  setCommunityPanelOpen: (open) => set({ communityPanelOpen: open }),
  setGithubSyncStatus: (status) => set({ githubSyncStatus: status }),
  setCommunityFriends: (friends) => set({ communityFriends: friends, friendActionPending: false }),
  setFriendActionPending: (pending) => set({ friendActionPending: pending }),
  setAdventureEnabled: (enabled) => set({ adventureEnabled: enabled }),

  addAdventureBeat: (beat) =>
    set((state) => {
      const updated = [...state.adventureBeats, beat];
      const trimmed = updated.length > 100 ? updated.slice(-100) : updated;
      return { adventureBeats: trimmed };
    }),

  markSessionPromptSent: () =>
    set((state) => {
      if (state.sessionActivityStarted) {
        return {};
      }
      return {
        sessionActivityStarted: true,
        sessionActivityElapsedMs: 0,
        sessionActivityRunningSinceMs: null,
      };
    }),

  toggleDashboard: () => set((s) => ({ dashboardOpen: !s.dashboardOpen })),
  setDashboardOpen: (open) => set({ dashboardOpen: open }),

  applyTurnSemantics: (messageId, semantics) =>
    set((s) => ({
      turnHistory: s.turnHistory.map((t) =>
        t.messageId === messageId ? { ...t, semantics } : t
      ),
      turnByMessageId: {
        ...s.turnByMessageId,
        ...(s.turnByMessageId[messageId]
          ? { [messageId]: { ...s.turnByMessageId[messageId], semantics } }
          : {}),
      },
      pendingTurnSemanticsByMessageId: {
        ...s.pendingTurnSemanticsByMessageId,
        [messageId]: semantics,
      },
    })),

  setIsEnhancing: (enhancing) => set({ isEnhancing: enhancing }),
  setAutoEnhanceEnabled: (enabled) => set({ autoEnhanceEnabled: enabled }),
  setEnhancerModel: (model) => set({ enhancerModel: model }),
  setEnhancerPopoverOpen: (open) => set({ enhancerPopoverOpen: open }),
  setEnhanceComparisonData: (data) => set({ enhanceComparisonData: data }),
  setPromptEnhancerSettings: ({ autoEnhance, enhancerModel }) =>
    set({ autoEnhanceEnabled: autoEnhance, enhancerModel }),

  setBabelFishEnabled: (enabled) => set({
    babelFishEnabled: enabled,
    promptTranslateEnabled: enabled,
    autoTranslateEnabled: enabled,
  }),
  setIsTranslatingPrompt: (translating) => set({ isTranslatingPrompt: translating }),
  setPromptTranslateEnabled: (enabled) => set({ promptTranslateEnabled: enabled }),
  setAutoTranslateEnabled: (enabled) => set({ autoTranslateEnabled: enabled }),
  setSendSettingsPopoverOpen: (open) => set({ sendSettingsPopoverOpen: open }),
  setPromptTranslatorSettings: ({ translateEnabled, autoTranslate }) =>
    set({ promptTranslateEnabled: translateEnabled, autoTranslateEnabled: autoTranslate }),

  setTurnAnalysisSettings: ({ enabled, analysisModel }) =>
    set({ turnAnalysisEnabled: enabled, analysisModel }),

  setSessionMetadata: (meta) =>
    set({ sessionMetadata: meta }),

  setMcpPanelOpen: (open) => set({ mcpPanelOpen: open }),
  setMcpSelectedTab: (tab) => set({ mcpSelectedTab: tab }),
  setMcpInventory: (servers, configPaths) =>
    set((state) => ({
      mcpInventory: servers,
      mcpConfigPaths: configPaths ?? state.mcpConfigPaths,
      mcpPendingMutations: servers
        .filter((server) => server.pendingMutation)
        .map((server) => ({
          name: server.name,
          scope: server.scope,
          kind: server.pendingMutation!,
          timestamp: Date.now(),
          restartRequired: !!server.restartRequired,
        })),
    })),
  setMcpPendingRestartCount: (count) => set({ mcpPendingRestartCount: count }),
  setMcpLoading: (loading) => set({ mcpLoading: loading }),
  setMcpLastError: (error) => set({ mcpLastError: error }),
  setMcpLastOperation: (operation) => set({ mcpLastOperation: operation }),
  setMcpTemplates: (templates) => set({ mcpTemplates: templates }),
  setMcpDiffPreview: (preview) => set({ mcpDiffPreview: preview }),

  setProjectSessions: (sessions) =>
    set({ projectSessions: sessions }),

  setProjectDashboardMode: (mode) =>
    set({ projectDashboardMode: mode }),

  // Skill Generation actions
  setSkillGenSettings: (settings) =>
    set({ skillGenEnabled: settings.enabled, skillGenThreshold: settings.threshold, skillGenOnboardingSeen: settings.onboardingSeen }),

  setSkillGenStatus: (status) =>
    set({
      skillGenPendingDocs: status.pendingDocs,
      skillGenThreshold: status.threshold,
      skillGenRunStatus: status.runStatus,
      skillGenProgress: status.progress,
      skillGenProgressLabel: status.progressLabel,
      skillGenLastRun: status.lastRun,
      skillGenHistory: status.history,
    }),

  setSkillGenProgress: (update) =>
    set({
      skillGenRunStatus: update.runStatus,
      skillGenProgress: update.progress,
      skillGenProgressLabel: update.progressLabel,
    }),

  setSkillGenPanelOpen: (open) =>
    set({ skillGenPanelOpen: open }),

  setSkillGenShowInfo: (show) =>
    set({ skillGenShowInfo: show }),

  // Chat Search actions
  setChatSearchOpen: (open) =>
    set((state) => {
      if (!open) {
        // Closing search: clear all search state
        return {
          chatSearchOpen: false,
          chatSearchQuery: '',
          chatSearchMatchIds: [],
          chatSearchCurrentIndex: -1,
          chatSearchProjectResults: [],
          chatSearchProjectLoading: false,
        };
      }
      return { chatSearchOpen: true };
    }),

  setChatSearchQuery: (query) =>
    set((state) => {
      if (state.chatSearchScope === 'session') {
        // Client-side search: filter messages immediately
        const queryLower = query.toLowerCase();
        const matchIds: string[] = [];
        if (queryLower.length > 0) {
          for (const msg of state.messages) {
            const blocks = Array.isArray(msg.content) ? msg.content : [];
            const hasMatch = blocks.some((b) => {
              if (b.type === 'text' && b.text) {
                return b.text.toLowerCase().includes(queryLower);
              }
              return false;
            });
            if (hasMatch) matchIds.push(msg.id);
          }
        }
        return {
          chatSearchQuery: query,
          chatSearchMatchIds: matchIds,
          chatSearchCurrentIndex: matchIds.length > 0 ? 0 : -1,
          chatSearchProjectResults: [],
        };
      }
      // Project scope: just update query (caller handles debounce + extension call)
      return {
        chatSearchQuery: query,
        chatSearchMatchIds: [],
        chatSearchCurrentIndex: -1,
      };
    }),

  setChatSearchScope: (scope) =>
    set((state) => {
      if (scope === 'session') {
        // Switching to session: run client-side search with current query
        const queryLower = state.chatSearchQuery.toLowerCase();
        const matchIds: string[] = [];
        if (queryLower.length > 0) {
          for (const msg of state.messages) {
            const blocks = Array.isArray(msg.content) ? msg.content : [];
            const hasMatch = blocks.some((b) => {
              if (b.type === 'text' && b.text) {
                return b.text.toLowerCase().includes(queryLower);
              }
              return false;
            });
            if (hasMatch) matchIds.push(msg.id);
          }
        }
        return {
          chatSearchScope: scope,
          chatSearchMatchIds: matchIds,
          chatSearchCurrentIndex: matchIds.length > 0 ? 0 : -1,
          chatSearchProjectResults: [],
          chatSearchProjectLoading: false,
        };
      }
      // Switching to project: clear session matches
      return {
        chatSearchScope: scope,
        chatSearchMatchIds: [],
        chatSearchCurrentIndex: -1,
      };
    }),

  setChatSearchCurrentIndex: (index) => set({ chatSearchCurrentIndex: index }),

  setChatSearchProjectResults: (results, requestId) =>
    set((state) => {
      // Only apply results if requestId matches (discard stale responses)
      if (requestId !== state.chatSearchProjectRequestId) return {};
      return {
        chatSearchProjectResults: results,
        chatSearchProjectLoading: false,
      };
    }),

  setChatSearchProjectLoading: (loading) => set({ chatSearchProjectLoading: loading }),

  clearChatSearch: () =>
    set({
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchScope: 'session' as 'session' | 'project',
      chatSearchMatchIds: [],
      chatSearchCurrentIndex: -1,
      chatSearchProjectResults: [],
      chatSearchProjectLoading: false,
      chatSearchProjectRequestId: 0,
    }),

  reset: () =>
    set((state) => ({
      sessionId: null,
      provider: state.provider,
      model: null,
      isConnected: false,
      isBusy: false,
      lastActivityAt: 0,
      handoffStage: 'idle' as HandoffStage,
      handoffTargetProvider: null,
      handoffError: null,
      handoffArtifactPath: null,
      handoffManualPrompt: null,
      usageLimit: { active: false, resetAtMs: null, resetDisplay: '', rawMessage: null },
      usageQueuedPrompt: { queued: false, scheduledSendAtMs: null, summary: null },
      scheduledMessage: { scheduled: false, text: null, scheduledAtMs: null, summary: null },
      scheduleMessageEnabled: false,
      scheduleMessageAtMs: null,
      checkpointState: null,
      checkpointResult: null,
      messages: [],
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      cost: { ...initialCost },
      lastError: null,
      textSettings: { ...defaultTextSettings },
      typingTheme: 'zen' as const,
      pendingFilePaths: null,
      selectedProvider: state.selectedProvider,
      providerCapabilities: state.providerCapabilities,
      isResuming: false,
      pendingApproval: null,
      promptHistoryPanelOpen: false,
      projectPromptHistory: [],
      globalPromptHistory: [],
      currentToolActivity: null,
      activitySummary: null,
      activitySummaryDismissed: false,
      sessionSkills: [],
      permissionMode: 'full-access' as const,
      gitPushSettings: null,
      gitPushResult: null,
      gitPushConfigPanelOpen: false,
      gitPushRunning: false,
      forkInit: null,
      btwPopup: null,
      btwSession: null,
      translations: {},
      translatingMessageIds: new Set(),
      showingTranslation: new Set(),
      messageForcedLtr: new Set(),
      translationErrors: {},
      userOriginalTexts: {},
      pendingOriginalText: null,
      summaryModeEnabled: state.summaryModeEnabled,
      sessionAnimationIndex: Math.floor(Math.random() * 5),
      sessionToolCount: 0,
      summaryByMessageId: {},
      detailedDiffEnabled: state.detailedDiffEnabled,
      writeOldContentByToolId: {},
      ultrathinkMode: state.ultrathinkMode,
      vitalsEnabled: state.vitalsEnabled,
      adventureEnabled: state.adventureEnabled,
      adventureBeats: [],
      dashboardOpen: false,
      pendingTurnSemanticsByMessageId: {},
      turnHistory: [],
      turnByMessageId: {},
      weather: { ...initialWeather },
      achievementsEnabled: state.achievementsEnabled,
      achievementsSound: state.achievementsSound,
      achievementLanguage: state.achievementLanguage,
      achievementProfile: state.achievementProfile,
      achievementGoals: [],
      achievementToasts: [],
      achievementPanelOpen: false,
      sessionRecap: null,
      communityPanelOpen: false,
      // Note: githubSyncStatus and communityFriends persist across resets
      friendActionPending: false,
      codexConsultPanelOpen: false,
      // Agent Teams: clear on session reset
      teamActive: false,
      teamName: null,
      teamConfig: null,
      teamTasks: [],
      teamAgentStatuses: {},
      teamRecentMessages: [],
      teamPanelOpen: false,
      teamPanelActiveTab: 'topology',
      bugReportPanelOpen: false,
      bugReportPhase: 'idle' as 'idle' | 'collecting' | 'ready' | 'sending' | 'sent' | 'error',
      bugReportChatMessages: [],
      bugReportChatLoading: false,
      bugReportPreviewFiles: [],
      bugReportError: null,
      bugReportContext: null,
      isEnhancing: false,
      enhancerPopoverOpen: false,
      enhanceComparisonData: null,
      autoEnhanceEnabled: state.autoEnhanceEnabled,
      enhancerModel: state.enhancerModel,
      babelFishEnabled: state.babelFishEnabled,
      isTranslatingPrompt: false,
      sendSettingsPopoverOpen: false,
      promptTranslateEnabled: state.promptTranslateEnabled,
      autoTranslateEnabled: state.autoTranslateEnabled,
      sessionMetadata: null,
      mcpPanelOpen: false,
      mcpSelectedTab: 'session' as const,
      mcpInventory: [],
      mcpPendingMutations: [],
      mcpPendingRestartCount: 0,
      mcpLoading: false,
      mcpLastError: null,
      mcpLastOperation: null,
      mcpConfigPaths: null,
      mcpTemplates: [],
      mcpDiffPreview: null,
      projectSessions: [],
      sessionActivityStarted: false,
      sessionActivityElapsedMs: 0,
      sessionActivityRunningSinceMs: null,
      // API Key: reset to defaults (key still lives in SecretStorage;
      // the extension will re-push the setting on the next 'ready' event)
      hasApiKey: false,
      maskedApiKey: '',
      claudeAuthLoggedIn: false,
      claudeAuthEmail: '',
      claudeAuthSubscriptionType: '',
      // Chat Search: reset on session clear
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchScope: 'session' as 'session' | 'project',
      chatSearchMatchIds: [],
      chatSearchCurrentIndex: -1,
      chatSearchProjectResults: [],
      chatSearchProjectLoading: false,
      chatSearchProjectRequestId: 0,
    })),
}));
