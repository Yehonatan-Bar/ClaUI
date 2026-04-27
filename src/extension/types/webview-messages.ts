/**
 * postMessage contract between extension host and webview.
 */

import type { ContentBlock } from './stream-json';

export type TypingTheme = 'terminal-hacker' | 'retro' | 'zen' | 'neo-zen';
export type ProviderId = 'claude' | 'codex' | 'remote';
export type HandoffStage =
  | 'idle'
  | 'collecting_context'
  | 'creating_target_tab'
  | 'starting_target_session'
  | 'arming_first_user_prompt'
  | 'completed'
  | 'failed';
export type CodexReasoningEffort = '' | 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export interface CodexModelOption {
  label: string;
  value: string;
  supportedReasoningEfforts?: CodexReasoningEffort[];
}

export interface ProviderCapabilities {
  supportsPlanApproval: boolean;
  supportsCompact: boolean;
  supportsFork: boolean;
  supportsImages: boolean;
  supportsGitPush: boolean;
  supportsTranslation: boolean;
  supportsPromptEnhancer: boolean;
  supportsCodexConsult: boolean;
  supportsPermissionModeSelector: boolean;
  supportsLiveTextStreaming: boolean;
  supportsConversationDiskReplay: boolean;
  supportsCostUsd: boolean;
}

export type McpScope = 'local' | 'project' | 'user' | 'managed' | 'unknown';
export type McpSource = 'runtime' | 'config' | 'both';
export type McpTransport = 'stdio' | 'sse' | 'http';
export type McpRuntimeStatus =
  | 'connected'
  | 'needs-auth'
  | 'needs-approval'
  | 'error'
  | 'disconnected'
  | 'unknown';
export type McpEffectiveStatus =
  | 'active'
  | 'configured'
  | 'pending_restart'
  | 'needs_auth'
  | 'needs_approval'
  | 'broken'
  | 'unknown';
export type McpMutationKind = 'added' | 'removed' | 'updated' | 'imported';
export type McpNextAction =
  | 'restart-session'
  | 'reconnect'
  | 'sign-in'
  | 'approve-project'
  | 'open-config'
  | 'none';

export interface McpServerConfig {
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  scope?: McpScope;
  /**
   * Raw secret values keyed by environment variable name.
   * The config payload should reference these via `${VAR_NAME}` placeholders.
   * This field must never be echoed back to the webview.
   */
  secretValues?: Record<string, string>;
  raw?: Record<string, unknown>;
}

export interface McpServerInfo {
  name: string;
  scope: McpScope;
  source: McpSource;
  transport?: McpTransport;
  runtimeStatus: McpRuntimeStatus;
  effectiveStatus: McpEffectiveStatus;
  command?: string;
  args?: string[];
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  tools: string[];
  resources?: string[];
  prompts?: string[];
  pendingMutation?: McpMutationKind;
  restartRequired?: boolean;
  lastError?: string;
  nextAction?: McpNextAction;
}

export interface McpMutationRecord {
  name: string;
  scope: McpScope;
  kind: McpMutationKind;
  timestamp: number;
  restartRequired: boolean;
}

export interface McpConfigPaths {
  workspaceConfigPath?: string;
  userConfigPath?: string;
  managedConfigPath?: string;
  localConfigPath?: string;
}

export type McpTemplateFieldTarget = 'env' | 'header';

export interface McpTemplateField {
  id: string;
  label: string;
  target: McpTemplateFieldTarget;
  key: string;
  envVar?: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface McpTemplateDefinition {
  id: string;
  title: string;
  description: string;
  transport: McpTransport;
  defaultName: string;
  defaultScope: McpScope;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  fields: McpTemplateField[];
  notes?: string[];
}

export interface McpConfigDiffPreview {
  name: string;
  scope: McpScope;
  exists: boolean;
  before: string;
  after: string;
  diff: string;
}

// --- Webview -> Extension ---

export interface SendTextMessage {
  type: 'sendMessage';
  text: string;
  /** Codex only: user approved interrupting a running turn to steer the next prompt. */
  steer?: boolean;
}

export interface SendMessageWithImages {
  type: 'sendMessageWithImages';
  text: string;
  images: WebviewImageData[];
  /** Codex only: user approved interrupting a running turn to steer the next prompt. */
  steer?: boolean;
}

export interface QueuePromptUntilUsageResetRequest {
  type: 'queuePromptUntilUsageReset';
  text: string;
  images?: WebviewImageData[];
}

export interface ScheduleMessageRequest {
  type: 'scheduleMessage';
  text: string;
  images?: WebviewImageData[];
  scheduledAtMs: number;
}

export interface CancelScheduledMessageRequest {
  type: 'cancelScheduledMessage';
}

export interface CancelRequest {
  type: 'cancelRequest';
}

export interface CompactRequest {
  type: 'compact';
  instructions?: string;
}

export interface StartSessionRequest {
  type: 'startSession';
  workspacePath?: string;
}

export interface StopSessionRequest {
  type: 'stopSession';
}

export interface ResumeSessionRequest {
  type: 'resumeSession';
  sessionId: string;
}

export interface ForkSessionRequest {
  type: 'forkSession';
  sessionId: string;
}

export interface WebviewReady {
  type: 'ready';
}

export interface PickFilesRequest {
  type: 'pickFiles';
}

export interface ClearSessionRequest {
  type: 'clearSession';
  workspacePath?: string;
}

export interface SetModelRequest {
  type: 'setModel';
  model: string;
}

export interface SetProviderRequest {
  type: 'setProvider';
  provider: ProviderId;
}

export interface OpenProviderTabRequest {
  type: 'openProviderTab';
  provider: ProviderId;
}

export interface SwitchProviderWithContextRequest {
  type: 'switchProviderWithContext';
  targetProvider: 'claude' | 'codex';
  keepSourceOpen?: boolean;
}

export interface McpRefreshRequest {
  type: 'mcpRefresh';
}

export interface McpOpenConfigRequest {
  type: 'mcpOpenConfig';
  scope?: McpScope;
}

export interface McpOpenLogsRequest {
  type: 'mcpOpenLogs';
}

export interface McpAddServerRequest {
  type: 'mcpAddServer';
  name: string;
  config: McpServerConfig;
  scope: McpScope;
}

export interface McpPreviewAddServerRequest {
  type: 'mcpPreviewAddServer';
  name: string;
  config: McpServerConfig;
  scope: McpScope;
}

export interface McpRemoveServerRequest {
  type: 'mcpRemoveServer';
  name: string;
  scope: McpScope;
}

export interface McpResetProjectChoicesRequest {
  type: 'mcpResetProjectChoices';
}

export interface McpImportDesktopRequest {
  type: 'mcpImportDesktop';
}

export interface McpRestartSessionRequest {
  type: 'mcpRestartSession';
}

export interface SetCodexReasoningEffortRequest {
  type: 'setCodexReasoningEffort';
  effort: CodexReasoningEffort;
}

export interface SetTypingThemeRequest {
  type: 'setTypingTheme';
  theme: TypingTheme;
}

export interface ShowHistoryRequest {
  type: 'showHistory';
}

export interface OpenPlanDocsRequest {
  type: 'openPlanDocs';
}

export interface PlanApprovalResponseMessage {
  type: 'planApprovalResponse';
  action: 'approve' | 'approveClearBypass' | 'approveManual' | 'reject' | 'feedback' | 'questionAnswer';
  feedback?: string;
  /** The tool that triggered the approval (ExitPlanMode / AskUserQuestion).
   *  Sent by the webview so the handler can identify the tool even if the
   *  `result` event already cleared `pendingApprovalTool`. */
  toolName?: string;
  /** Selected option label(s) when answering AskUserQuestion */
  selectedOptions?: string[];
}

export interface OpenFileRequest {
  type: 'openFile';
  filePath: string;
}

export interface OpenUrlRequest {
  type: 'openUrl';
  url: string;
}

export interface OpenFeedbackRequest {
  type: 'openFeedback';
}

export type FeedbackActionValue = 'bug' | 'feature' | 'email' | 'fullBugReport';

export interface FeedbackActionRequest {
  type: 'feedbackAction';
  action: FeedbackActionValue;
}

export interface GetPromptHistoryRequest {
  type: 'getPromptHistory';
  scope: 'project' | 'global';
}

export interface EditAndResendRequest {
  type: 'editAndResend';
  text: string;
}

export interface RequestSessionRecapSnapshot {
  type: 'requestSessionRecapSnapshot';
}

export interface ForkFromMessageRequest {
  type: 'forkFromMessage';
  sessionId: string;
  /** Index of the user message to fork from (0-based in the messages array) */
  forkMessageIndex: number;
  /** The text content of the user message being forked */
  promptText: string;
  /** Conversation history up to (but not including) the fork message */
  messages: SerializedChatMessage[];
}

export interface SetPermissionModeRequest {
  type: 'setPermissionMode';
  mode: 'full-access' | 'supervised';
}

export interface GitPushRequest {
  type: 'gitPush';
}

export interface GitPushConfigRequest {
  type: 'gitPushConfig';
  instruction: string;
}

export interface GetGitPushSettingsRequest {
  type: 'getGitPushSettings';
}

export interface TranslateMessageRequest {
  type: 'translateMessage';
  messageId: string;
  /** Text content to translate (code blocks already stripped by the webview) */
  textContent: string;
  /** Target language selected in the webview (fallback to config when omitted) */
  language?: string;
}

export interface FileSearchRequest {
  type: 'fileSearch';
  query: string;
  requestId: number;
}

// --- Chat Search ---

export interface ChatSearchProjectRequest {
  type: 'chatSearchProject';
  query: string;
  requestId: number;
}

export interface ChatSearchResumeSessionRequest {
  type: 'chatSearchResumeSession';
  sessionId: string;
}

export interface ChatSearchProjectResult {
  sessionId: string;
  sessionLabel: string;
  mtime: number;
  matchSnippet: string;
  matchRole: 'user' | 'assistant';
}

export interface SetAchievementsEnabledRequest {
  type: 'setAchievementsEnabled';
  enabled: boolean;
}

export interface SetVitalsEnabledRequest {
  type: 'setVitalsEnabled';
  enabled: boolean;
}

export interface SetDetailedDiffViewEnabledRequest {
  type: 'setDetailedDiffViewEnabled';
  enabled: boolean;
}

export interface SetAdventureWidgetEnabledRequest {
  type: 'setAdventureWidgetEnabled';
  enabled: boolean;
}

export interface SetWeatherWidgetEnabledRequest {
  type: 'setWeatherWidgetEnabled';
  enabled: boolean;
}

export interface SetActivitySummaryEnabledRequest {
  type: 'setActivitySummaryEnabled';
  enabled: boolean;
}

export interface SetTranslationLanguageRequest {
  type: 'setTranslationLanguage';
  language: string;
}

export interface AdventureDebugLogMessage {
  type: 'adventureDebugLog';
  source: 'engine' | 'maze';
  event: string;
  payload?: Record<string, unknown>;
  ts: number;
}

export interface UiDebugLogMessage {
  type: 'uiDebugLog';
  source: string;
  event: string;
  payload?: Record<string, unknown>;
  ts: number;
}

export interface GetAchievementsSnapshotRequest {
  type: 'getAchievementsSnapshot';
}

export interface OpenSettingsRequest {
  type: 'openSettings';
  query: string;
}

export interface OpenTerminalRequest {
  type: 'openTerminal';
  command?: string;
}

export interface CopyToClipboardRequest {
  type: 'copyToClipboard';
  text: string;
}

export interface OpenHtmlPreviewRequest {
  type: 'openHtmlPreview';
  html: string;
}

export interface OpenCodexLoginRequest {
  type: 'openCodexLogin';
}

export interface ClaudeAuthLoginRequest {
  type: 'claudeAuthLogin';
}

export interface ClaudeAuthLogoutRequest {
  type: 'claudeAuthLogout';
}

export interface ClaudeAuthStatusRequest {
  type: 'claudeAuthStatus';
}

export interface PickCodexCliPathRequest {
  type: 'pickCodexCliPath';
}

export interface AutoDetectCodexCliPathRequest {
  type: 'autoDetectCodexCliPath';
}

export interface AutoSetupCodexCliRequest {
  type: 'autoSetupCodexCli';
}

export interface SetTurnAnalysisEnabledRequest {
  type: 'setTurnAnalysisEnabled';
  enabled: boolean;
}

export interface SetAnalysisModelRequest {
  type: 'setAnalysisModel';
  model: string;
}

export interface GetProjectAnalyticsRequest {
  type: 'getProjectAnalytics';
}

export interface EnhancePromptRequest {
  type: 'enhancePrompt';
  text: string;
  model?: string;
}

export interface SetAutoEnhanceRequest {
  type: 'setAutoEnhance';
  enabled: boolean;
}

export interface SetEnhancerModelRequest {
  type: 'setEnhancerModel';
  model: string;
}

// --- Babel Fish (Webview -> Extension) ---

export interface SetBabelFishEnabledRequest {
  type: 'setBabelFishEnabled';
  enabled: boolean;
}

// --- Prompt Translation (Webview -> Extension) ---

export interface TranslatePromptRequest {
  type: 'translatePrompt';
  text: string;
}

export interface SetPromptTranslationEnabledRequest {
  type: 'setPromptTranslationEnabled';
  enabled: boolean;
}

export interface SetAutoTranslateRequest {
  type: 'setAutoTranslate';
  enabled: boolean;
}

// --- Skill Generation (Webview -> Extension) ---

export interface SetSkillGenEnabledRequest {
  type: 'setSkillGenEnabled';
  enabled: boolean;
}

export interface SetSkillGenThresholdRequest {
  type: 'setSkillGenThreshold';
  threshold: number;
}

export interface SkillGenTriggerRequest {
  type: 'skillGenTrigger';
}

export interface SkillGenCancelRequest {
  type: 'skillGenCancel';
}

export interface GetSkillGenStatusRequest {
  type: 'getSkillGenStatus';
}

export interface SkillGenUiLogMessage {
  type: 'skillGenUiLog';
  level: 'INFO' | 'DEBUG';
  event: string;
  data?: Record<string, unknown>;
}

export interface SkillUsageReportMessage {
  type: 'skillUsageReport';
  skillName: string;
}

export interface OpenSkillGenGuideRequest {
  type: 'openSkillGenGuide';
}

export interface SkillGenOnboardingDecisionRequest {
  type: 'skillGenOnboardingDecision';
  accepted: boolean;
}

export interface SetGitHubSyncEnabledRequest {
  type: 'setGitHubSyncEnabled';
  enabled: boolean;
}

// --- GitHub Sync (Webview -> Extension) ---

export interface GitHubSyncRequest {
  type: 'githubSync';
  action: 'connect' | 'publish' | 'disconnect';
}

export interface AddFriendRequest {
  type: 'addFriend';
  username: string;
}

export interface RemoveFriendRequest {
  type: 'removeFriend';
  username: string;
}

export interface RefreshFriendsRequest {
  type: 'refreshFriends';
}

export interface GetCommunityDataRequest {
  type: 'getCommunityData';
}

export interface CopyShareCardRequest {
  type: 'copyShareCard';
  format: 'markdown' | 'shields-badge';
}

export interface CodexConsultRequest {
  type: 'codexConsult';
  question: string;
}

export interface SetApiKeyRequest {
  type: 'setApiKey';
  apiKey: string;  // empty string = clear the key
}

export interface RequestUsageMessage {
  type: 'requestUsage';
}

// --- Memory dashboard (Webview -> Extension) ---

export interface RequestMemoryStreamRequest {
  type: 'requestMemoryStream';
  /** True to start streaming; false to stop. */
  enabled: boolean;
  /** Sampling interval in ms. Clamped on the extension side. Default 2500. */
  intervalMs?: number;
}

export interface SetUsageWidgetEnabledRequest {
  type: 'setUsageWidgetEnabled';
  enabled: boolean;
}

export interface SetRestoreSessionsEnabledRequest {
  type: 'setRestoreSessionsEnabled';
  enabled: boolean;
}

// --- Agent Teams (Webview -> Extension) ---

export interface TeamPanelOpenRequest {
  type: 'teamPanelOpen';
}

export interface TeamSendMessageRequest {
  type: 'teamSendMessage';
  agentName: string;
  content: string;
}

export interface TeamCreateTaskRequest {
  type: 'teamCreateTask';
  subject: string;
  description?: string;
}

export interface TeamUpdateTaskRequest {
  type: 'teamUpdateTask';
  taskId: number;
  updates: {
    status?: 'pending' | 'in_progress' | 'completed' | 'blocked';
    owner?: string;
  };
}

export interface TeamShutdownAgentRequest {
  type: 'teamShutdownAgent';
  agentName: string;
}

// --- Bug Report (Webview -> Extension) ---

export interface BugReportInitRequest {
  type: 'bugReportInit';
  context?: BugReportContext;
}

export interface BugReportChatRequest {
  type: 'bugReportChat';
  message: string;
}

export interface BugReportApproveScriptRequest {
  type: 'bugReportApproveScript';
  command: string;
  index: number;
}

export interface BugReportSubmitRequest {
  type: 'bugReportSubmit';
  mode: 'quick' | 'ai';
  description?: string;
}

export interface BugReportGetPreviewRequest {
  type: 'bugReportGetPreview';
}

export interface BugReportCloseRequest {
  type: 'bugReportClose';
}

export interface BugReportContext {
  source?: 'mcp';
  title?: string;
  quickDescription?: string;
  aiPrompt?: string;
  metadataText?: string;
}

export type WebviewToExtensionMessage =
  | SendTextMessage
  | SendMessageWithImages
  | QueuePromptUntilUsageResetRequest
  | ScheduleMessageRequest
  | CancelScheduledMessageRequest
  | CancelRequest
  | CompactRequest
  | StartSessionRequest
  | StopSessionRequest
  | ResumeSessionRequest
  | ForkSessionRequest
  | WebviewReady
  | PickFilesRequest
  | ClearSessionRequest
  | SetModelRequest
  | SetProviderRequest
  | OpenProviderTabRequest
  | SwitchProviderWithContextRequest
  | McpRefreshRequest
  | McpOpenConfigRequest
  | McpOpenLogsRequest
  | McpAddServerRequest
  | McpPreviewAddServerRequest
  | McpRemoveServerRequest
  | McpResetProjectChoicesRequest
  | McpImportDesktopRequest
  | McpRestartSessionRequest
  | SetCodexReasoningEffortRequest
  | SetTypingThemeRequest
  | ShowHistoryRequest
  | OpenPlanDocsRequest
  | PlanApprovalResponseMessage
  | OpenFileRequest
  | OpenUrlRequest
  | OpenFeedbackRequest
  | FeedbackActionRequest
  | GetPromptHistoryRequest
  | EditAndResendRequest
  | RequestSessionRecapSnapshot
  | ForkFromMessageRequest
  | SetPermissionModeRequest
  | GitPushRequest
  | GitPushConfigRequest
  | GetGitPushSettingsRequest
  | TranslateMessageRequest
  | FileSearchRequest
  | SetAchievementsEnabledRequest
  | GetAchievementsSnapshotRequest
  | SetVitalsEnabledRequest
  | SetDetailedDiffViewEnabledRequest
  | SetAdventureWidgetEnabledRequest
  | SetWeatherWidgetEnabledRequest
  | SetActivitySummaryEnabledRequest
  | SetTranslationLanguageRequest
  | AdventureDebugLogMessage
  | UiDebugLogMessage
  | OpenSettingsRequest
  | OpenTerminalRequest
  | CopyToClipboardRequest
  | OpenHtmlPreviewRequest
  | OpenCodexLoginRequest
  | ClaudeAuthLoginRequest
  | ClaudeAuthLogoutRequest
  | ClaudeAuthStatusRequest
  | PickCodexCliPathRequest
  | AutoDetectCodexCliPathRequest
  | AutoSetupCodexCliRequest
  | SetTurnAnalysisEnabledRequest
  | SetAnalysisModelRequest
  | GetProjectAnalyticsRequest
  | EnhancePromptRequest
  | SetAutoEnhanceRequest
  | SetEnhancerModelRequest
  | SetBabelFishEnabledRequest
  | TranslatePromptRequest
  | SetPromptTranslationEnabledRequest
  | SetAutoTranslateRequest
  | SetSkillGenEnabledRequest
  | SetSkillGenThresholdRequest
  | SkillGenTriggerRequest
  | SkillGenCancelRequest
  | GetSkillGenStatusRequest
  | SkillGenUiLogMessage
  | SkillUsageReportMessage
  | OpenSkillGenGuideRequest
  | SkillGenOnboardingDecisionRequest
  | SetGitHubSyncEnabledRequest
  | GitHubSyncRequest
  | AddFriendRequest
  | RemoveFriendRequest
  | RefreshFriendsRequest
  | GetCommunityDataRequest
  | CopyShareCardRequest
  | CodexConsultRequest
  | SetApiKeyRequest
  | RequestUsageMessage
  | RequestMemoryStreamRequest
  | SetUsageWidgetEnabledRequest
  | SetRestoreSessionsEnabledRequest
  | GetTokenRatioDataRequest
  | ClearTokenRatioDataRequest
  | ForceResampleTokenRatioRequest
  | BugReportInitRequest
  | BugReportChatRequest
  | BugReportApproveScriptRequest
  | BugReportSubmitRequest
  | BugReportGetPreviewRequest
  | BugReportCloseRequest
  | TeamPanelOpenRequest
  | TeamSendMessageRequest
  | TeamCreateTaskRequest
  | TeamUpdateTaskRequest
  | TeamShutdownAgentRequest
  | SetSummaryModeEnabledRequest
  | SetVpmEnabledRequest
  | SetUltrathinkModeRequest
  | StartBtwSessionRequest
  | SendBtwMessageRequest
  | CloseBtwSessionRequest
  | ChatSearchProjectRequest
  | ChatSearchResumeSessionRequest
  | CheckpointRevertRequest
  | CheckpointRedoRequest;

export interface WebviewImageData {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

// --- Extension -> Webview ---

export interface McpInventoryMessage {
  type: 'mcpInventory';
  servers: McpServerInfo[];
  pendingRestartCount: number;
  configPaths?: McpConfigPaths;
  lastError?: string;
}

export interface McpCatalogMessage {
  type: 'mcpCatalog';
  templates: McpTemplateDefinition[];
}

export interface McpDiffPreviewMessage {
  type: 'mcpDiffPreview';
  preview: McpConfigDiffPreview;
}

export interface McpOperationResultMessage {
  type: 'mcpOperationResult';
  success: boolean;
  operation: string;
  name?: string;
  error?: string;
  restartNeeded?: boolean;
  nextAction?: McpNextAction;
}

export interface ToggleMcpPanelMessage {
  type: 'toggleMcpPanel';
  open?: boolean;
  tab?: 'session' | 'workspace' | 'add' | 'debug';
}

export interface SessionStartedMessage {
  type: 'sessionStarted';
  sessionId: string;
  model: string;
  isResume?: boolean;
  provider?: ProviderId;
}

export interface SessionEndedMessage {
  type: 'sessionEnded';
  reason: 'stopped' | 'crashed' | 'completed';
}

export interface StreamingTextMessage {
  type: 'streamingText';
  text: string;
  messageId: string;
  blockIndex: number;
}

export interface AssistantCompleteMessage {
  type: 'assistantMessage';
  messageId: string;
  content: ContentBlock[];
  model: string;
  thinkingEffort?: string;
}

export interface UserMessageDisplay {
  type: 'userMessage';
  content: ContentBlock[];
  // Origin of this user message. 'input' = typed by the user via the input box.
  // 'auto-prompt' = injected by ClaUi (e.g. team idle, queued/scheduled prompt).
  // Defaults to 'input' if absent. Only 'input' messages are eligible for
  // Fork / Revert / prompt-navigation buttons.
  source?: 'input' | 'auto-prompt';
}

/**
 * Synthetic content emitted by the CLI as a `type: "user"` envelope with
 * isMeta=true (e.g. skill body loaded into context, sub-agent dispatch
 * context, system reminders). Rendered as part of Claude's output flow,
 * never as a "YOU" message.
 */
export interface SyntheticToolContentMessage {
  type: 'syntheticToolContent';
  content: ContentBlock[];
  sourceToolUseID?: string;
}

export interface ToolUseStartMessage {
  type: 'toolUseStart';
  messageId: string;
  blockIndex: number;
  toolName: string;
  toolId: string;
}

export interface ToolUseInputMessage {
  type: 'toolUseInput';
  messageId: string;
  blockIndex: number;
  partialJson: string;
}

export interface ToolResultMessage {
  type: 'toolResult';
  toolId: string;
  content: string | ContentBlock[];
  isError: boolean;
}

export interface CostUpdateMessage {
  type: 'costUpdate';
  costUsd: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ProcessBusyMessage {
  type: 'processBusy';
  busy: boolean;
}

export interface UsageLimitDetectedMessage {
  type: 'usageLimitDetected';
  active: boolean;
  resetAtMs?: number;
  resetDisplay: string;
  rawMessage: string;
}

export interface UsageQueuedPromptStateMessage {
  type: 'usageQueuedPromptState';
  queued: boolean;
  scheduledSendAtMs?: number;
  summary?: string;
}

export interface ScheduledMessageStateMessage {
  type: 'scheduledMessageState';
  scheduled: boolean;
  text?: string;
  scheduledAtMs?: number;
  summary?: string;
}

export interface MessageStartMessage {
  type: 'messageStart';
  messageId: string;
  model: string;
  inputTokens?: number;  // Total context tokens (input + cache_creation + cache_read) for real-time widget update
  thinkingEffort?: string;
}

export interface MessageStopMessage {
  type: 'messageStop';
}

export interface ThinkingEffortUpdateMessage {
  type: 'thinkingEffortUpdate';
  effort: string;
}

export interface FilePathsPickedMessage {
  type: 'filePathsPicked';
  paths: string[];
}

export interface TextSettingsMessage {
  type: 'textSettings';
  fontSize: number;
  fontFamily: string;
}

export interface TypingThemeSettingMessage {
  type: 'typingThemeSetting';
  theme: TypingTheme;
}

export interface ModelSettingMessage {
  type: 'modelSetting';
  model: string;
}

export interface ProviderSettingMessage {
  type: 'providerSetting';
  provider: ProviderId;
}

export interface ProviderCapabilitiesMessage {
  type: 'providerCapabilities';
  capabilities: ProviderCapabilities;
}

export interface HandoffProgressMessage {
  type: 'handoffProgress';
  stage: HandoffStage;
  sourceProvider: 'claude' | 'codex';
  targetProvider: 'claude' | 'codex';
  detail?: string;
  artifactPath?: string;
  manualPrompt?: string;
  error?: string;
}

export interface CodexReasoningEffortSettingMessage {
  type: 'codexReasoningEffortSetting';
  effort: CodexReasoningEffort;
}

export interface CodexModelOptionsMessage {
  type: 'codexModelOptions';
  options: CodexModelOption[];
}

export interface PlanApprovalRequiredMessage {
  type: 'planApprovalRequired';
  toolName: string;
}

export interface PlanApprovalDismissedMessage {
  type: 'planApprovalDismissed';
}

export interface PromptHistoryResponseMessage {
  type: 'promptHistoryResponse';
  scope: 'project' | 'global';
  prompts: string[];
}

export interface ActivitySummaryMessage {
  type: 'activitySummary';
  shortLabel: string;
  fullSummary: string;
}

export interface ToolActivityMessage {
  type: 'toolActivity';
  toolName: string;        // Raw tool name: "Read", "Bash", etc.
  detail: string;          // Human-readable: "Reading src/app.ts", "Running: npm test"
}

export interface PermissionModeSettingMessage {
  type: 'permissionModeSetting';
  mode: 'full-access' | 'supervised';
}

export interface GitPushResultMessage {
  type: 'gitPushResult';
  success: boolean;
  output: string;
}

export interface GitPushSettingsMessage {
  type: 'gitPushSettings';
  enabled: boolean;
  scriptPath: string;
  commitMessageTemplate: string;
}

export interface ForkInitMessage {
  type: 'forkInit';
  /** The prompt text to place in the input area */
  promptText: string;
  /** Conversation history to display (already truncated at fork point) */
  messages: SerializedChatMessage[];
}

export interface FileSearchResultMessage {
  type: 'fileSearchResults';
  results: Array<{ relativePath: string; fileName: string }>;
  requestId: number;
}

export interface ChatSearchProjectResultMessage {
  type: 'chatSearchProjectResults';
  requestId: number;
  results: ChatSearchProjectResult[];
  totalMatches: number;
}

export interface TranslationResultMessage {
  type: 'translationResult';
  messageId: string;
  /** The translated text, or null if translation failed */
  translatedText: string | null;
  success: boolean;
  error?: string;
}

export interface TranslationLanguageSettingMessage {
  type: 'translationLanguageSetting';
  language: string;
}

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type AchievementCategory = 'debugging' | 'testing' | 'refactor' | 'collaboration' | 'session' | 'architecture' | 'productivity';

export interface AchievementProfilePayload {
  totalXp: number;
  level: number;
  totalAchievements: number;
  unlockedIds: string[];
}

export interface AchievementAwardPayload {
  id: string;
  title: string;
  description: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  xp: number;
  hidden?: boolean;
}

export interface AchievementGoalPayload {
  id: string;
  title: string;
  current: number;
  target: number;
  completed: boolean;
}

export interface SessionRecapPayload {
  durationMs: number;
  bugsFixed: number;
  passingTests: number;
  highestStreak: number;
  newAchievements: string[];
  xpEarned: number;
  level: number;
  filesTouched?: number;
  languagesUsed?: string[];
  aiInsight?: string;
  sessionQuality?: string;
  codingPattern?: string;
  aiXpBonus?: number;
}

export interface AchievementsSettingsMessage {
  type: 'achievementsSettings';
  enabled: boolean;
  sound: boolean;
}

export interface AchievementsSnapshotMessage {
  type: 'achievementsSnapshot';
  profile: AchievementProfilePayload;
  goals: AchievementGoalPayload[];
}

export interface AchievementAwardedMessage {
  type: 'achievementAwarded';
  achievement: AchievementAwardPayload;
  profile: AchievementProfilePayload;
}

export interface AchievementProgressMessage {
  type: 'achievementProgress';
  goals: AchievementGoalPayload[];
}

export interface SessionRecapMessage {
  type: 'sessionRecap';
  recap: SessionRecapPayload;
}

// --- Session Vitals ---

/** Category classification for a turn, used for timeline coloring */
export type TurnCategory =
  | 'success'       // Green - successful completion, no errors
  | 'error'         // Red - tool_result.is_error or ResultError
  | 'discussion'    // Blue - text-only, no tool usage
  | 'code-write'    // Purple - Write, Edit, NotebookEdit tools
  | 'research'      // Orange - Read, Grep, Glob, WebSearch, WebFetch
  | 'command'       // Cyan - Bash tool usage
  | 'skill';        // Magenta - Skill tool invocation

/** Semantic analysis signals for a turn, populated asynchronously by TurnAnalyzer */
export interface TurnSemantics {
  /** User's inferred emotional state this turn */
  userMood: 'frustrated' | 'satisfied' | 'confused' | 'excited' | 'neutral' | 'urgent';
  /** Whether the stated task appears to be resolved */
  taskOutcome: 'success' | 'partial' | 'failed' | 'in-progress' | 'unknown';
  /** Classification of the task the user is working on */
  taskType: TaskType;
  /** Is this a repeated mention of the same bug? */
  bugRepeat: 'none' | 'first' | 'second' | 'third-plus';
  /** Model's confidence in these signals (0-1) */
  confidence: number;
}

export type TaskType =
  | 'bug-fix'
  | 'feature-small'
  | 'feature-large'
  | 'exploration'
  | 'refactor'
  | 'new-app'
  | 'planning'
  | 'code-review'
  | 'debugging'
  | 'testing'
  | 'documentation'
  | 'devops'
  | 'question'
  | 'configuration'
  | 'unknown';

export interface TurnRecord {
  turnIndex: number;
  toolNames: string[];
  toolCount: number;
  durationMs: number;
  costUsd: number;
  totalCostUsd: number;
  isError: boolean;
  category: TurnCategory;
  timestamp: number;
  messageId: string;
  /** Adventure metadata inferred from tool inputs (optional, UI-only) */
  adventureArtifacts?: string[];
  adventureIndicators?: string[];
  adventureCommandTags?: string[];
  /** Per-turn token breakdown */
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** Bash command strings run this turn */
  bashCommands?: string[];
  /** Async semantic analysis (arrives after turnComplete) */
  semantics?: TurnSemantics;
}

export interface TurnCompleteMessage {
  type: 'turnComplete';
  turn: TurnRecord;
}

export interface VitalsSettingMessage {
  type: 'vitalsSetting';
  enabled: boolean;
}

export interface DetailedDiffViewSettingMessage {
  type: 'detailedDiffViewSetting';
  enabled: boolean;
}

/** Carries the pre-write file content for a Write tool call so the webview can show a diff */
export interface FileOldContentMessage {
  type: 'fileOldContent';
  toolUseId: string;
  filePath: string;
  oldContent: string;
}

export interface AdventureWidgetSettingMessage {
  type: 'adventureWidgetSetting';
  enabled: boolean;
}

export interface WeatherWidgetSettingMessage {
  type: 'weatherWidgetSetting';
  enabled: boolean;
}

export interface ActivitySummarySettingMessage {
  type: 'activitySummarySetting';
  enabled: boolean;
}

// --- Summary Mode ---

/** Webview -> Extension: toggle Visual Progress Mode */
export interface SetVpmEnabledRequest {
  type: 'setVpmEnabled';
  enabled: boolean;
}

/** Webview -> Extension: toggle summary mode */
export interface SetSummaryModeEnabledRequest {
  type: 'setSummaryModeEnabled';
  enabled: boolean;
}

/** Webview -> Extension: persist ultrathink mode at project level */
export interface SetUltrathinkModeRequest {
  type: 'setUltrathinkMode';
  mode: 'off' | 'single' | 'locked';
}

/** Extension -> Webview: send Visual Progress Mode setting */
export interface VpmSettingMessage {
  type: 'vpmSetting';
  enabled: boolean;
}

/** Extension -> Webview: new VPM card */
export interface VisualProgressCardMessage {
  type: 'visualProgressCard';
  card: {
    id: string;
    category: string;
    toolName: string;
    description: string;
    filePath?: string;
    command?: string;
    pattern?: string;
    timestamp: number;
    isStreaming: boolean;
  };
}

/** Extension -> Webview: update VPM card with AI description */
export interface VisualProgressCardUpdateMessage {
  type: 'visualProgressCardUpdate';
  cardId: string;
  aiDescription: string;
}

/** Extension -> Webview: send summary mode setting */
export interface SummaryModeSettingMessage {
  type: 'summaryModeSetting';
  enabled: boolean;
}

/** Extension -> Webview: send ultrathink mode state (project-level) */
export interface UltrathinkModeSettingMessage {
  type: 'ultrathinkModeSetting';
  mode: 'off' | 'single' | 'locked';
}

/** Extension -> Webview: tell the webview to focus the input textarea */
export interface FocusInputMessage {
  type: 'focusInput';
}

/** Extension -> Webview: per-message summary text */
export interface MessageSummaryMessage {
  type: 'messageSummary';
  messageId: string;
  shortLabel: string;
  fullSummary: string;
}

export interface TurnSemanticsMessage {
  type: 'turnSemantics';
  messageId: string;
  semantics: TurnSemantics;
}

export interface TurnAnalysisSettingsMessage {
  type: 'turnAnalysisSettings';
  enabled: boolean;
  analysisModel: string;
}

export interface SessionMetadataMessage {
  type: 'sessionMetadata';
  tools: string[];
  model: string;
  cwd: string;
  mcpServers: McpServerInfo[];
}

export interface AdventureBeatMessage {
  type: 'adventureBeat';
  beat: {
    turnIndex: number;
    timestamp: number;
    beat: string;
    intensity: 1 | 2 | 3;
    outcome: 'success' | 'fail' | 'mixed' | 'neutral';
    toolNames: string[];
    labelShort: string;
    tooltipDetail?: string;
    roomType: string;
    isHaikuEnhanced: boolean;
    achievementRarity?: string;
    artifacts?: string[];
    indicators?: string[];
    commandTags?: string[];
  };
}

export interface ConversationHistoryMessage {
  type: 'conversationHistory';
  /** Full conversation history loaded from Claude's session storage */
  messages: SerializedChatMessage[];
}

// --- Project-Level Analytics ---

/** Pre-aggregated summary of a completed session, persisted in workspaceState */
export interface SessionSummary {
  sessionId: string;
  provider: ProviderId;
  sessionName: string;
  model: string;
  startedAt: string;   // ISO date
  endedAt: string;     // ISO date
  durationMs: number;
  totalCostUsd: number;
  totalTurns: number;
  totalErrors: number;
  totalToolUses: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalBashCommands: number;
  toolFrequency: Record<string, number>;
  categoryDistribution: Record<string, number>;
  taskTypeDistribution: Record<string, number>;
  avgCostPerTurn: number;
  avgDurationMs: number;
  errorRate: number;
}

export interface ProjectAnalyticsDataMessage {
  type: 'projectAnalyticsData';
  sessions: SessionSummary[];
}

export interface EnhancePromptResultMessage {
  type: 'enhancePromptResult';
  enhancedText: string | null;
  success: boolean;
  error?: string;
}

export interface PromptEnhancerSettingsMessage {
  type: 'promptEnhancerSettings';
  autoEnhance: boolean;
  enhancerModel: string;
}

// --- Babel Fish (Extension -> Webview) ---

export interface BabelFishSettingsMessage {
  type: 'babelFishSettings';
  enabled: boolean;
  language: string;
}

export interface AutoTranslateStartedMessage {
  type: 'autoTranslateStarted';
  messageId: string;
}

// --- Prompt Translation (Extension -> Webview) ---

export interface TranslatePromptResultMessage {
  type: 'translatePromptResult';
  translatedText: string | null;
  success: boolean;
  error?: string;
}

export interface PromptTranslatorSettingsMessage {
  type: 'promptTranslatorSettings';
  translateEnabled: boolean;
  autoTranslate: boolean;
}

// --- Skill Generation (Extension -> Webview) ---

export type SkillGenRunStatus = 'idle' | 'scanning' | 'preflight' | 'running' | 'installing' | 'succeeded' | 'failed' | 'cancelled';

export interface SkillGenDocumentInfo {
  relativePath: string;
  fingerprint: string;
  status: 'pending' | 'processed';
}

export interface SkillGenRunHistoryEntry {
  date: string;           // ISO date
  docsProcessed: number;
  newSkills: number;
  upgradedSkills: number;
  skippedSkills: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  durationMs: number;
}

export interface SkillGenSettingsMessage {
  type: 'skillGenSettings';
  enabled: boolean;
  threshold: number;
  docsDirectory: string;
  autoRun: boolean;
  onboardingSeen: boolean;
}

export interface SkillGenStatusMessage {
  type: 'skillGenStatus';
  pendingDocs: number;
  threshold: number;
  runStatus: SkillGenRunStatus;
  progress: number;        // 0-100 percent
  progressLabel: string;   // e.g. "Extracting patterns (3/5)..."
  lastRun: SkillGenRunHistoryEntry | null;
  history: SkillGenRunHistoryEntry[];
}

export interface SkillGenProgressMessage {
  type: 'skillGenProgress';
  runStatus: SkillGenRunStatus;
  progress: number;
  progressLabel: string;
}

export interface SkillGenCompleteMessage {
  type: 'skillGenComplete';
  success: boolean;
  newSkills: number;
  upgradedSkills: number;
  skippedSkills: number;
  durationMs: number;
  error?: string;
}

// --- GitHub Sync (Extension -> Webview) ---

export interface CommunityFriendProfilePayload {
  username: string;
  displayName: string;
  avatarUrl: string;
  totalXp: number;
  level: number;
  unlockedIds: string[];
  stats: {
    sessionsCompleted: number;
    totalSessionMinutes: number;
    bugFixes: number;
    testPasses: number;
    consecutiveDays: number;
    totalEdits: number;
  };
  lastUpdated: string;
}

export interface GitHubSyncStatusMessage {
  type: 'githubSyncStatus';
  connected: boolean;
  username: string;
  gistId: string;
  gistUrl: string;
  lastSyncedAt: string;
  syncEnabled: boolean;
}

export interface CommunityDataMessage {
  type: 'communityData';
  friends: CommunityFriendProfilePayload[];
}

export interface FriendActionResultMessage {
  type: 'friendActionResult';
  action: 'add' | 'remove' | 'refresh';
  username: string;
  success: boolean;
  error?: string;
  profile?: CommunityFriendProfilePayload;
}

export interface ShareCardCopiedMessage {
  type: 'shareCardCopied';
  success: boolean;
  format: 'markdown' | 'shields-badge';
}

export interface ApiKeySettingMessage {
  type: 'apiKeySetting';
  hasKey: boolean;
  maskedKey: string;  // e.g. "****abcd" or "" if no key
}

export interface ClaudeAuthStatusMessage {
  type: 'claudeAuthStatus';
  loggedIn: boolean;
  email: string;
  subscriptionType: string;
}

/** One usage stat entry from the claude /usage command output */
export interface UsageStat {
  label: string;       // compact display label, e.g. "All Models", "Opus"
  period: string;      // human-readable period, e.g. "7 Days", "5 Hours"
  modelLabel: string;  // model name, e.g. "All Models", "Opus", "Sonnet"
  bucketKey: string;   // original API key, e.g. "seven_day_sonnet"
  percentage: number;  // 0–100
  resetsAt: string;    // e.g. "1pm (Asia/Jerusalem)"
}

export interface UsageDataMessage {
  type: 'usageData';
  stats: UsageStat[];
  fetchedAt: number;
  error?: string;
}

// --- Memory dashboard (Extension -> Webview) ---

export type MemoryProcessCategory =
  | 'main'
  | 'renderer'
  | 'extensionHost'
  | 'gpu'
  | 'utility'
  | 'crashpad'
  | 'pty'
  | 'other';

export interface MemoryVsCodeProcess {
  pid: number;
  parentPid: number;
  name: string;
  rssBytes: number;
  category: MemoryProcessCategory;
}

export interface MemoryCliProcess {
  tabId: string;
  tabName: string;
  provider: 'claude' | 'codex';
  rootPid: number;
  treeRssBytes: number;
  processCount: number;
}

export interface MemorySnapshotMessage {
  type: 'memorySnapshot';
  timestamp: number;
  systemTotalBytes: number;
  systemFreeBytes: number;
  extensionHost: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  vscodeProcesses: MemoryVsCodeProcess[];
  cliProcesses: MemoryCliProcess[];
}

export interface MemoryStreamErrorMessage {
  type: 'memoryStreamError';
  error: string;
}

export interface UsageWidgetSettingMessage {
  type: 'usageWidgetSetting';
  enabled: boolean;
}

export interface RestoreSessionsSettingMessage {
  type: 'restoreSessionsSetting';
  enabled: boolean;
}

// --- Token-Usage Ratio Tracker ---

export interface TokenUsageRatioSample {
  id: string;
  timestamp: number;
  bucket: string;
  bucketLabel: string;
  usagePercent: number;
  cumulativeTotalTokens: number;
  cumulativeWeightedTokens: number;
  deltaTokens: number;
  weightedDeltaTokens: number;
  deltaUsagePercent: number;
  tokensPerPercent: number | null;
}

export interface TokenRatioBucketSummary {
  bucket: string;
  bucketLabel: string;
  sampleCount: number;
  avgTokensPerPercent: number | null;
  latestTokensPerPercent: number | null;
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient-data';
}

export interface TokenRatioDataMessage {
  type: 'tokenRatioData';
  samples: TokenUsageRatioSample[];
  summaries: TokenRatioBucketSummary[];
  globalTurnCount: number;
  cumulativeTokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  cumulativeWeightedTokens: number;
}

export interface GetTokenRatioDataRequest {
  type: 'getTokenRatioData';
}

export interface ClearTokenRatioDataRequest {
  type: 'clearTokenRatioData';
}

export interface ForceResampleTokenRatioRequest {
  type: 'forceResampleTokenRatio';
}

// --- Agent Teams (Extension -> Webview) ---

export interface TeamStateUpdateMessage {
  type: 'teamStateUpdate';
  teamName: string;
  config: {
    name: string;
    description?: string;
    members: Array<{
      agentId: string;
      name: string;
      agentType: string;
      color?: string;
    }>;
  };
  tasks: Array<{
    id: number;
    subject: string;
    description?: string;
    activeForm?: string;
    owner?: string;
    status: string;
    blockedBy?: number[];
    blocks?: number[];
  }>;
  agentStatuses: Record<string, string>;
  recentMessages: Array<{
    from: string;
    to?: string;
    text: string;
    timestamp: string | number;
    read?: boolean;
    type?: string;
    summary?: string;
  }>;
  lastUpdatedAt: number;
}

export interface TeamDetectedMessage {
  type: 'teamDetected';
  teamName: string;
}

export interface TeamDismissedMessage {
  type: 'teamDismissed';
  teamName: string;
}

// --- Bug Report (Extension -> Webview) ---

export interface BugReportOpenMessage {
  type: 'bugReportOpen';
}

export interface BugReportStatusMessage {
  type: 'bugReportStatus';
  phase: 'collecting' | 'ready' | 'sending' | 'sent' | 'error';
  summary?: {
    os: string;
    vsCodeVersion: string;
    extensionVersion: string;
    nodeVersion: string;
    claudeCliVersion: string | null;
    codexCliVersion: string | null;
    logFileCount: number;
    logTotalSize: number;
  };
  error?: string;
}

export interface BugReportChatResponseMessage {
  type: 'bugReportChatResponse';
  text: string;
  scripts: Array<{ command: string; language: string }>;
}

export interface BugReportScriptResultMessage {
  type: 'bugReportScriptResult';
  index: number;
  output: string;
  exitCode: number;
}

export interface BugReportPreviewMessage {
  type: 'bugReportPreview';
  files: Array<{ name: string; sizeBytes: number; preview?: string }>;
}

export interface BugReportSubmitResultMessage {
  type: 'bugReportSubmitResult';
  ok: boolean;
  error?: string;
}

// --- BTW Background Session (Webview -> Extension) ---

export interface StartBtwSessionRequest {
  type: 'startBtwSession';
  promptText: string;
}

export interface SendBtwMessageRequest {
  type: 'sendBtwMessage';
  text: string;
}

export interface CloseBtwSessionRequest {
  type: 'closeBtwSession';
}

// --- BTW Background Session (Extension -> Webview) ---

export interface BtwSessionStartedMessage {
  type: 'btwSessionStarted';
}

export interface BtwUserMessageMessage {
  type: 'btwUserMessage';
  content: ContentBlock[];
}

export interface BtwMessageStartMessage {
  type: 'btwMessageStart';
  messageId: string;
}

export interface BtwStreamingTextMessage {
  type: 'btwStreamingText';
  blockIndex: number;
  text: string;
}

export interface BtwAssistantMessageMessage {
  type: 'btwAssistantMessage';
  messageId: string;
  content: ContentBlock[];
  model?: string;
}

export interface BtwMessageStopMessage {
  type: 'btwMessageStop';
}

export interface BtwResultMessage {
  type: 'btwResult';
}

export interface BtwSessionEndedMessage {
  type: 'btwSessionEnded';
  error?: string;
}

// --- Checkpoint Types ---

export interface CheckpointFileEntry {
  filePath: string;
  before: string | null;
  after: string | null;
  toolName: string;
}

export interface CheckpointSummary {
  turnIndex: number;
  messageId: string;
  timestamp: number;
  fileCount: number;
  filePaths: string[];
}

export interface CheckpointState {
  checkpoints: CheckpointSummary[];
  revertedToIndex: number | null;
}

export interface CheckpointStateMessage {
  type: 'checkpointState';
  state: CheckpointState;
}

export interface CheckpointResultMessage {
  type: 'checkpointResult';
  success: boolean;
  action: 'revert' | 'redo';
  targetTurnIndex: number;
  error?: string;
  conflicts?: string[];
}

export interface CheckpointRevertRequest {
  type: 'checkpointRevert';
  turnIndex: number;
}

export interface CheckpointRedoRequest {
  type: 'checkpointRedo';
  turnIndex: number;
}

/** Serializable chat message for passing between webview instances (e.g. fork) */
export interface SerializedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  model?: string;
  timestamp: number;
  thinkingEffort?: string;
  source?: 'input' | 'auto-prompt';
}

export type ExtensionToWebviewMessage =
  | McpInventoryMessage
  | McpCatalogMessage
  | McpDiffPreviewMessage
  | McpOperationResultMessage
  | ToggleMcpPanelMessage
  | SessionStartedMessage
  | SessionEndedMessage
  | StreamingTextMessage
  | AssistantCompleteMessage
  | UserMessageDisplay
  | SyntheticToolContentMessage
  | ToolUseStartMessage
  | ToolUseInputMessage
  | ToolResultMessage
  | CostUpdateMessage
  | ErrorMessage
  | ProcessBusyMessage
  | UsageLimitDetectedMessage
  | UsageQueuedPromptStateMessage
  | ScheduledMessageStateMessage
  | MessageStartMessage
  | MessageStopMessage
  | ThinkingEffortUpdateMessage
  | FilePathsPickedMessage
  | TextSettingsMessage
  | TypingThemeSettingMessage
  | ModelSettingMessage
  | ProviderSettingMessage
  | ProviderCapabilitiesMessage
  | HandoffProgressMessage
  | CodexReasoningEffortSettingMessage
  | CodexModelOptionsMessage
  | PlanApprovalRequiredMessage
  | PlanApprovalDismissedMessage
  | PromptHistoryResponseMessage
  | ActivitySummaryMessage
  | ToolActivityMessage
  | PermissionModeSettingMessage
  | GitPushResultMessage
  | GitPushSettingsMessage
  | ForkInitMessage
  | ConversationHistoryMessage
  | TranslationResultMessage
  | TranslationLanguageSettingMessage
  | FileSearchResultMessage
  | AchievementsSettingsMessage
  | AchievementsSnapshotMessage
  | AchievementAwardedMessage
  | AchievementProgressMessage
  | SessionRecapMessage
  | TurnCompleteMessage
  | VitalsSettingMessage
  | DetailedDiffViewSettingMessage
  | FileOldContentMessage
  | AdventureWidgetSettingMessage
  | WeatherWidgetSettingMessage
  | ActivitySummarySettingMessage
  | AdventureBeatMessage
  | TurnSemanticsMessage
  | TurnAnalysisSettingsMessage
  | SessionMetadataMessage
  | ProjectAnalyticsDataMessage
  | EnhancePromptResultMessage
  | PromptEnhancerSettingsMessage
  | BabelFishSettingsMessage
  | AutoTranslateStartedMessage
  | TranslatePromptResultMessage
  | PromptTranslatorSettingsMessage
  | SkillGenSettingsMessage
  | SkillGenStatusMessage
  | SkillGenProgressMessage
  | SkillGenCompleteMessage
  | GitHubSyncStatusMessage
  | CommunityDataMessage
  | FriendActionResultMessage
  | ShareCardCopiedMessage
  | ApiKeySettingMessage
  | ClaudeAuthStatusMessage
  | UsageDataMessage
  | MemorySnapshotMessage
  | MemoryStreamErrorMessage
  | UsageWidgetSettingMessage
  | RestoreSessionsSettingMessage
  | TokenRatioDataMessage
  | BugReportOpenMessage
  | BugReportStatusMessage
  | BugReportChatResponseMessage
  | BugReportScriptResultMessage
  | BugReportPreviewMessage
  | BugReportSubmitResultMessage
  | TeamStateUpdateMessage
  | TeamDetectedMessage
  | TeamDismissedMessage
  | SummaryModeSettingMessage
  | MessageSummaryMessage
  | VpmSettingMessage
  | VisualProgressCardMessage
  | VisualProgressCardUpdateMessage
  | UltrathinkModeSettingMessage
  | FocusInputMessage
  | BtwSessionStartedMessage
  | BtwUserMessageMessage
  | BtwMessageStartMessage
  | BtwStreamingTextMessage
  | BtwAssistantMessageMessage
  | BtwMessageStopMessage
  | BtwResultMessage
  | BtwSessionEndedMessage
  | ChatSearchProjectResultMessage
  | CheckpointStateMessage
  | CheckpointResultMessage;
