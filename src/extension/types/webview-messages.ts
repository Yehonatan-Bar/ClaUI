/**
 * postMessage contract between extension host and webview.
 */

import type { ContentBlock } from './stream-json';

export type TypingTheme = 'terminal-hacker' | 'retro' | 'zen';

// --- Webview -> Extension ---

export interface SendTextMessage {
  type: 'sendMessage';
  text: string;
}

export interface SendMessageWithImages {
  type: 'sendMessageWithImages';
  text: string;
  images: WebviewImageData[];
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
  action: 'approve' | 'reject' | 'feedback' | 'questionAnswer';
  feedback?: string;
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

export interface GetPromptHistoryRequest {
  type: 'getPromptHistory';
  scope: 'project' | 'global';
}

export interface EditAndResendRequest {
  type: 'editAndResend';
  text: string;
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
}

export interface FileSearchRequest {
  type: 'fileSearch';
  query: string;
  requestId: number;
}

export interface SetAchievementsEnabledRequest {
  type: 'setAchievementsEnabled';
  enabled: boolean;
}

export interface SetVitalsEnabledRequest {
  type: 'setVitalsEnabled';
  enabled: boolean;
}

export interface GetAchievementsSnapshotRequest {
  type: 'getAchievementsSnapshot';
}


export type WebviewToExtensionMessage =
  | SendTextMessage
  | SendMessageWithImages
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
  | SetTypingThemeRequest
  | ShowHistoryRequest
  | OpenPlanDocsRequest
  | PlanApprovalResponseMessage
  | OpenFileRequest
  | OpenUrlRequest
  | GetPromptHistoryRequest
  | EditAndResendRequest
  | ForkFromMessageRequest
  | SetPermissionModeRequest
  | GitPushRequest
  | GitPushConfigRequest
  | GetGitPushSettingsRequest
  | TranslateMessageRequest
  | FileSearchRequest
  | SetAchievementsEnabledRequest
  | GetAchievementsSnapshotRequest
  | SetVitalsEnabledRequest;

export interface WebviewImageData {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

// --- Extension -> Webview ---

export interface SessionStartedMessage {
  type: 'sessionStarted';
  sessionId: string;
  model: string;
  isResume?: boolean;
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
}

export interface UserMessageDisplay {
  type: 'userMessage';
  content: ContentBlock[];
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

export interface MessageStartMessage {
  type: 'messageStart';
  messageId: string;
  model: string;
}

export interface MessageStopMessage {
  type: 'messageStop';
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

export interface PlanApprovalRequiredMessage {
  type: 'planApprovalRequired';
  toolName: string;
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

export interface TranslationResultMessage {
  type: 'translationResult';
  messageId: string;
  /** The translated text, or null if translation failed */
  translatedText: string | null;
  success: boolean;
  error?: string;
}

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type AchievementCategory = 'debugging' | 'testing' | 'refactor' | 'collaboration' | 'session';

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
  | 'command';      // Cyan - Bash tool usage

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
}

export interface TurnCompleteMessage {
  type: 'turnComplete';
  turn: TurnRecord;
}

export interface VitalsSettingMessage {
  type: 'vitalsSetting';
  enabled: boolean;
}

export interface ConversationHistoryMessage {
  type: 'conversationHistory';
  /** Full conversation history loaded from Claude's session storage */
  messages: SerializedChatMessage[];
}

/** Serializable chat message for passing between webview instances (e.g. fork) */
export interface SerializedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  model?: string;
  timestamp: number;
}

export type ExtensionToWebviewMessage =
  | SessionStartedMessage
  | SessionEndedMessage
  | StreamingTextMessage
  | AssistantCompleteMessage
  | UserMessageDisplay
  | ToolUseStartMessage
  | ToolUseInputMessage
  | ToolResultMessage
  | CostUpdateMessage
  | ErrorMessage
  | ProcessBusyMessage
  | MessageStartMessage
  | MessageStopMessage
  | FilePathsPickedMessage
  | TextSettingsMessage
  | TypingThemeSettingMessage
  | ModelSettingMessage
  | PlanApprovalRequiredMessage
  | PromptHistoryResponseMessage
  | ActivitySummaryMessage
  | PermissionModeSettingMessage
  | GitPushResultMessage
  | GitPushSettingsMessage
  | ForkInitMessage
  | ConversationHistoryMessage
  | TranslationResultMessage
  | FileSearchResultMessage
  | AchievementsSettingsMessage
  | AchievementsSnapshotMessage
  | AchievementAwardedMessage
  | AchievementProgressMessage
  | SessionRecapMessage
  | TurnCompleteMessage
  | VitalsSettingMessage;
