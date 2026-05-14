/**
 * Client-server protocol types for multi-participant sessions.
 * These mirror the server/src/types.ts shapes over WebSocket JSON.
 */

export type MPAgentProvider = 'claude' | 'codex';
export type MPParticipantKind = 'human' | 'agent';
export type MPParticipantStatus = 'online' | 'offline';
export type MPAgentMode = 'execute' | 'plan-only';
export type MPRemoteSteerPolicy = 'owner-only' | 'ask' | 'always';
export type MPAgentBusyPolicy = 'direct' | 'codex-auto-steer' | 'queued' | 'rejected';
export type MPParticipantActivityState = 'idle' | 'typing' | 'thinking' | 'streaming';
export type MPApprovalDecisionType = 'approve-count' | 'approve-always' | 'approve-force' | 'deny';
export type MPFileChangeKind = 'create' | 'modify' | 'delete';
export type MPFileChangeReportSource = 'tool-use' | 'snapshot';

export interface MPSession {
  sessionId: string;
  sessionNumber: number;
  name: string;
  createdAt: string;
  createdByParticipantId: string;
  status: 'active' | 'ended';
  nextSeq: number;
  agentMode: MPAgentMode;
  allowRemoteSteer: MPRemoteSteerPolicy;
  /** True if the session is password-protected (actual password is never sent). */
  hasPassword?: boolean;
}

export interface MPParticipant {
  participantId: string;
  sessionId: string;
  kind: MPParticipantKind;
  displayName: string;
  canonicalName: string;
  routeKey: string;
  ownerHumanId: string | null;
  provider: MPAgentProvider | null;
  model: string | null;
  status: MPParticipantStatus;
  joinedAt: string;
}

export interface MPMessage {
  messageId: string;
  sessionId: string;
  seq: number;
  authorParticipantId: string;
  recipientParticipantId: string | null;
  rawBody: string;
  parsedBody: string;
  routePrefix: string | null;
  createdAt: string;
  displayNameSnapshot: string;
  deliveryId: string | null;
  agentTurnStatus: MPDeliveryStatus | null;
  triggerMessageId: string | null;
  triggerDeliveryId: string | null;
}

export type MPDeliveryStatus =
  | 'pending'
  | 'acknowledged'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'not_delivered';

export interface MPAgentLoopControlState {
  sessionId: string;
  mode: 'ask' | 'budget' | 'always' | 'force';
  remainingBudget: number | null;
  consecutiveA2aCount: number;
  lastGuardCheckAt: number;
  approvedByParticipantId: string | null;
  updatedAt: string;
}

export interface MPApprovalEvent {
  eventId: string;
  sessionId: string;
  type: 'agent-to-agent';
  sourceAgentId: string;
  targetAgentId: string;
  pendingMessageId: string;
  decision: MPApprovalDecisionType | null;
  budgetCount: number | null;
  decidedByParticipantId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface MPTypingState {
  participantId: string;
  state: MPParticipantActivityState;
  updatedAt: string;
}

export interface MPRenameEvent {
  eventId: string;
  sessionId: string;
  participantId: string;
  oldDisplayName: string;
  newDisplayName: string;
  oldRouteKey: string;
  newRouteKey: string;
  createdAt: string;
}

export interface MPApprovalDecisionPayload {
  type: MPApprovalDecisionType;
  budgetCount?: number | null;
}

export interface MPFileChange {
  path: string;
  changeKind: MPFileChangeKind;
  toolName?: 'Edit' | 'MultiEdit' | 'Write' | 'NotebookEdit' | string;
  absolutePath?: string;
}

export interface MPFileChangeReport {
  deliveryId: string;
  agentParticipantId?: string;
  workspaceId: string;
  workspaceRoot?: string;
  repoRoot?: string;
  gitBranch?: string;
  source: MPFileChangeReportSource;
  changes: MPFileChange[];
  reportedAt: string;
}

export interface MPFileConflictDelivery {
  deliveryId: string;
  agentParticipantId: string;
  agentDisplayName: string;
  filePaths: string[];
}

export interface MPFileConflictWarning {
  conflictId: string;
  sessionId: string;
  workspaceId: string;
  filePaths: string[];
  deliveries: MPFileConflictDelivery[];
  createdAt: string;
  message?: string;
}

export interface MPReactionSummary {
  emoji: string;
  count: number;
  participantIds: string[];
}

// -- Client -> Server --

export type ClientToServerMessage =
  | { type: 'createSession'; sessionNumber: number; sessionName: string; humanName: string; agentName: string; agentProvider: MPAgentProvider; agentModel?: string; password?: string }
  | { type: 'joinSession'; sessionNumber: number; humanName: string; agentName: string; agentProvider: MPAgentProvider; agentModel?: string; password?: string }
  | { type: 'rejoinSession'; sessionNumber: number; humanParticipantId: string; agentParticipantId: string; lastSeenSeq: number }
  | { type: 'humanMessage'; rawBody: string }
  | { type: 'agentEvent'; deliveryId: string; event: AgentEventPayload }
  | { type: 'agentStatus'; status: MPParticipantStatus }
  | { type: 'approvalDecision'; eventId: string; decision: MPApprovalDecisionPayload }
  | { type: 'typingIndicator'; state: Extract<MPParticipantActivityState, 'idle' | 'typing'>; updatedAt?: string }
  | { type: 'fileChangeReport'; report: MPFileChangeReport }
  | { type: 'renameParticipant'; participantId: string; newDisplayName: string }
  | { type: 'leaveSession' }
  | { type: 'resetSession' }
  | { type: 'addReaction'; messageId: string; emoji: string }
  | { type: 'removeReaction'; messageId: string; emoji: string }
  | { type: 'pong' };

export type AgentEventPayload =
  | { kind: 'accepted' }
  | { kind: 'rejected'; error: string }
  | { kind: 'started' }
  | { kind: 'firstToken' }
  | { kind: 'textDelta'; text: string }
  | { kind: 'completed'; fullText: string }
  | { kind: 'failed'; error: string }
  | { kind: 'interrupted'; interruptedByDeliveryId: string };

// -- Server -> Client --

export type ServerToClientMessage =
  | { type: 'sessionState'; session: MPSession; participants: MPParticipant[]; transcript: MPMessage[]; loopControlState?: MPAgentLoopControlState; approvals?: MPApprovalEvent[]; typingStates?: MPTypingState[]; fileConflicts?: MPFileConflictWarning[]; reactions?: Record<string, MPReactionSummary[]> }
  | { type: 'newMessage'; message: MPMessage }
  | { type: 'deliverPrompt'; deliveryId: string; agentParticipantId: string; prompt: string; busyPolicy: MPAgentBusyPolicy | null }
  | { type: 'cancelAgent'; deliveryId: string; agentParticipantId: string; reason?: string }
  | { type: 'participantJoined'; participant: MPParticipant }
  | { type: 'participantLeft'; participantId: string }
  | { type: 'participantStatusChange'; participantId: string; status: MPParticipantStatus }
  | { type: 'participantActivity'; activity: MPTypingState }
  | { type: 'participantRenamed'; event: MPRenameEvent; participant: MPParticipant }
  | { type: 'renameRejected'; participantId: string; requestedDisplayName: string; reason: string }
  | { type: 'deliveryStatusUpdate'; deliveryId: string; agentParticipantId: string; agentDisplayName: string; status: MPDeliveryStatus; errorText?: string; interruptedByDeliveryId?: string }
  | { type: 'agentStreamingText'; deliveryId: string; agentParticipantId: string; text: string }
  | { type: 'agentToAgentApproval'; approval: MPApprovalEvent; pendingMessage: MPMessage; sourceAgent: MPParticipant; targetAgent: MPParticipant }
  | { type: 'a2aPendingApproval'; approval: MPApprovalEvent; pendingMessageId: string; sourceAgentId: string; targetAgentId: string }
  | { type: 'approvalResolved'; approval: MPApprovalEvent; decision: MPApprovalDecisionPayload; decidedByParticipantId: string | null; deliveryId?: string | null; deniedReason?: string }
  | { type: 'guardStop'; approval: MPApprovalEvent; reason: string; lastMessages: MPMessage[] }
  | { type: 'fileConflictWarning'; warning: MPFileConflictWarning }
  | { type: 'sessionReset'; session: MPSession; participants: MPParticipant[] }
  | { type: 'reactionUpdate'; messageId: string; reactions: MPReactionSummary[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'joinRejected'; reason: string }
  | { type: 'rejoinAccepted'; session: MPSession; participants: MPParticipant[]; deltaTranscript: MPMessage[]; lastSeenSeq: number; reactions?: Record<string, MPReactionSummary[]> }
  | { type: 'rejoinRejected'; reason: string }
  | { type: 'ping' };
