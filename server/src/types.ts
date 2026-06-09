export type AgentProvider = 'claude' | 'codex';
export type ParticipantKind = 'human' | 'agent';
export type ParticipantStatus = 'online' | 'offline';
export type AgentMode = 'execute' | 'plan-only';
export type RemoteSteerPolicy = 'owner-only' | 'ask' | 'always';
export type AgentBusyPolicy = 'direct' | 'codex-auto-steer' | 'queued' | 'rejected';
export type ParticipantActivityState = 'idle' | 'typing' | 'thinking' | 'streaming';
export type ApprovalDecisionType = 'approve-count' | 'approve-always' | 'approve-force' | 'deny';
export type FileChangeKind = 'create' | 'modify' | 'delete';
export type FileChangeReportSource = 'tool-use' | 'snapshot';

export interface Session {
  sessionId: string;
  sessionNumber: number;
  name: string;
  createdAt: string;
  createdByParticipantId: string;
  status: 'active' | 'ended';
  nextSeq: number;
  agentMode: AgentMode;
  allowRemoteSteer: RemoteSteerPolicy;
  /** Set by the first user who joins; subsequent joins must match. Never sent to clients. */
  sessionPassword: string | null;
}

export interface Participant {
  participantId: string;
  sessionId: string;
  kind: ParticipantKind;
  displayName: string;
  canonicalName: string;
  routeKey: string;
  ownerHumanId: string | null;
  provider: AgentProvider | null;
  model: string | null;
  status: ParticipantStatus;
  joinedAt: string;
}

export interface Message {
  messageId: string;
  sessionId: string;
  seq: number;
  authorParticipantId: string;
  recipientParticipantId: string | null;
  rawBody: string;
  parsedBody: string;
  routePrefix: string | null;
  /** Agent's final answer with any addressing prefix stripped (split from narration). */
  answerBody?: string | null;
  /** Agent's interleaved narration ("thoughts"), shown distinctly from the answer. */
  thinkingBody?: string | null;
  createdAt: string;
  displayNameSnapshot: string;
  deliveryId: string | null;
  agentTurnStatus: DeliveryStatus | null;
  triggerMessageId: string | null;
  triggerDeliveryId: string | null;
}

export type DeliveryStatus =
  | 'pending'
  | 'acknowledged'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'not_delivered';

export interface AgentDelivery {
  deliveryId: string;
  sessionId: string;
  agentParticipantId: string;
  triggerMessageId: string;
  triggerSeq: number;
  contextStartSeq: number;
  contextEndSeq: number;
  status: DeliveryStatus;
  busyPolicy: AgentBusyPolicy | null;
  responseMessageId: string | null;
  errorText: string | null;
  notDeliveredReason: string | null;
  interruptedByDeliveryId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentSeenState {
  agentParticipantId: string;
  sessionId: string;
  lastAckedDeliveredSeq: number;
  lastDeliveryId: string | null;
  updatedAt: string;
}

export interface AgentLoopControlState {
  sessionId: string;
  mode: 'ask' | 'budget' | 'always' | 'force';
  remainingBudget: number | null;
  consecutiveA2aCount: number;
  lastGuardCheckAt: number;
  approvedByParticipantId: string | null;
  updatedAt: string;
}

export interface ApprovalEvent {
  eventId: string;
  sessionId: string;
  type: 'agent-to-agent';
  sourceAgentId: string;
  targetAgentId: string;
  pendingMessageId: string;
  decision: ApprovalDecisionType | null;
  budgetCount: number | null;
  decidedByParticipantId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TypingState {
  participantId: string;
  state: ParticipantActivityState;
  updatedAt: string;
}

export interface RenameEvent {
  eventId: string;
  sessionId: string;
  participantId: string;
  oldDisplayName: string;
  newDisplayName: string;
  oldRouteKey: string;
  newRouteKey: string;
  createdAt: string;
}

export interface ApprovalDecisionPayload {
  type: ApprovalDecisionType;
  budgetCount?: number | null;
}

export interface FileChange {
  path: string;
  changeKind: FileChangeKind;
  toolName?: 'Edit' | 'MultiEdit' | 'Write' | 'NotebookEdit' | string;
  absolutePath?: string;
}

export interface FileChangeReport {
  deliveryId: string;
  agentParticipantId?: string;
  workspaceId: string;
  workspaceRoot?: string;
  repoRoot?: string;
  gitBranch?: string;
  source: FileChangeReportSource;
  changes: FileChange[];
  reportedAt: string;
}

export interface FileConflictDelivery {
  deliveryId: string;
  agentParticipantId: string;
  agentDisplayName: string;
  filePaths: string[];
}

export interface FileConflictWarning {
  conflictId: string;
  sessionId: string;
  workspaceId: string;
  filePaths: string[];
  deliveries: FileConflictDelivery[];
  createdAt: string;
  message?: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  participantIds: string[];
}

// -- Client -> Server messages --

export type ClientToServerMessage =
  | { type: 'createSession'; sessionNumber: number; sessionName: string; humanName: string; agentName: string; agentProvider: AgentProvider; agentModel?: string; password?: string }
  | { type: 'joinSession'; sessionNumber: number; humanName: string; agentName: string; agentProvider: AgentProvider; agentModel?: string; password?: string }
  | { type: 'rejoinSession'; sessionNumber: number; humanParticipantId: string; agentParticipantId: string; lastSeenSeq: number }
  | { type: 'humanMessage'; rawBody: string }
  | { type: 'agentEvent'; deliveryId: string; event: AgentEventPayload }
  | { type: 'agentStatus'; status: ParticipantStatus }
  | { type: 'approvalDecision'; eventId: string; decision: ApprovalDecisionPayload }
  | { type: 'typingIndicator'; state: Extract<ParticipantActivityState, 'idle' | 'typing'>; updatedAt?: string }
  | { type: 'fileChangeReport'; report: FileChangeReport }
  | { type: 'renameParticipant'; participantId: string; newDisplayName: string }
  | { type: 'addReaction'; messageId: string; emoji: string }
  | { type: 'removeReaction'; messageId: string; emoji: string }
  | { type: 'leaveSession' }
  | { type: 'resetSession' }
  | { type: 'pong' };

export type AgentEventPayload =
  | { kind: 'accepted' }
  | { kind: 'rejected'; error: string }
  | { kind: 'started' }
  | { kind: 'firstToken' }
  | { kind: 'textDelta'; text: string }
  | { kind: 'completed'; fullText: string; answerText?: string; thinkingText?: string }
  | { kind: 'failed'; error: string }
  | { kind: 'interrupted'; interruptedByDeliveryId: string };

// -- Server -> Client messages --

export type ServerToClientMessage =
  | { type: 'sessionState'; session: Session; participants: Participant[]; transcript: Message[]; loopControlState?: AgentLoopControlState; approvals?: ApprovalEvent[]; typingStates?: TypingState[]; fileConflicts?: FileConflictWarning[]; reactions?: Record<string, ReactionSummary[]> }
  | { type: 'newMessage'; message: Message }
  | { type: 'deliverPrompt'; deliveryId: string; agentParticipantId: string; prompt: string; busyPolicy: AgentBusyPolicy | null }
  | { type: 'cancelAgent'; deliveryId: string; agentParticipantId: string; reason?: string }
  | { type: 'participantJoined'; participant: Participant }
  | { type: 'participantLeft'; participantId: string }
  | { type: 'participantStatusChange'; participantId: string; status: ParticipantStatus }
  | { type: 'participantActivity'; activity: TypingState }
  | { type: 'participantRenamed'; event: RenameEvent; participant: Participant }
  | { type: 'renameRejected'; participantId: string; requestedDisplayName: string; reason: string }
  | { type: 'deliveryStatusUpdate'; deliveryId: string; agentParticipantId: string; agentDisplayName: string; status: DeliveryStatus; errorText?: string; interruptedByDeliveryId?: string }
  | { type: 'agentStreamingText'; deliveryId: string; agentParticipantId: string; text: string }
  | { type: 'agentToAgentApproval'; approval: ApprovalEvent; pendingMessage: Message; sourceAgent: Participant; targetAgent: Participant }
  | { type: 'a2aPendingApproval'; approval: ApprovalEvent; pendingMessageId: string; sourceAgentId: string; targetAgentId: string }
  | { type: 'approvalResolved'; approval: ApprovalEvent; decision: ApprovalDecisionPayload; decidedByParticipantId: string | null; deliveryId?: string | null; deniedReason?: string }
  | { type: 'guardStop'; approval: ApprovalEvent; reason: string; lastMessages: Message[] }
  | { type: 'fileConflictWarning'; warning: FileConflictWarning }
  | { type: 'sessionReset'; session: Session; participants: Participant[] }
  | { type: 'reactionUpdate'; messageId: string; reactions: ReactionSummary[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'joinRejected'; reason: string }
  | { type: 'rejoinAccepted'; session: Session; participants: Participant[]; deltaTranscript: Message[]; lastSeenSeq: number; reactions?: Record<string, ReactionSummary[]> }
  | { type: 'rejoinRejected'; reason: string }
  | { type: 'ping' };
