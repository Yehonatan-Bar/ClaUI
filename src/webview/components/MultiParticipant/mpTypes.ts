/**
 * Multi-Participant session types used by webview components and the store.
 *
 * Re-exports the canonical protocol types so components import from a single
 * local barrel without coupling directly to the extension's internal paths.
 */

export type {
  MPMessage,
  MPParticipant,
  MPSession,
  MPDeliveryStatus,
  MPParticipantActivityState,
  MPApprovalEvent,
  MPTypingState,
  MPFileConflictWarning,
  MPParticipantKind,
  MPParticipantStatus,
  MPAgentProvider,
  MPApprovalDecisionType,
  MPApprovalDecisionPayload,
} from '../../../extension/multiparticipant/MultiParticipantProtocol';
