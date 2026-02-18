/**
 * postMessage contract between extension host and webview.
 */

import type { ContentBlock } from './stream-json';

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

export interface SetPermissionModeRequest {
  type: 'setPermissionMode';
  mode: 'full-access' | 'supervised';
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
  | ShowHistoryRequest
  | OpenPlanDocsRequest
  | PlanApprovalResponseMessage
  | OpenFileRequest
  | OpenUrlRequest
  | GetPromptHistoryRequest
  | EditAndResendRequest
  | SetPermissionModeRequest;

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
  | ModelSettingMessage
  | PlanApprovalRequiredMessage
  | PromptHistoryResponseMessage
  | ActivitySummaryMessage
  | PermissionModeSettingMessage;
