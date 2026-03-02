/**
 * Happy Coder protocol type definitions.
 * Covers envelopes, events, auth, and connection state for the
 * Socket.IO relay between ClaUi and a remote AI coding session.
 */

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

export type HappyConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ---------------------------------------------------------------------------
// Happy events (discriminated union on `type`)
// ---------------------------------------------------------------------------

export interface HappyTextEvent {
  type: 'text';
  text: string;
}

export interface HappyServiceEvent {
  type: 'service';
  service: string;
  action: string;
  detail?: string;
}

export interface HappyToolCallStartEvent {
  type: 'tool-call-start';
  toolId: string;
  toolName: string;
  input?: string;
}

export interface HappyToolCallEndEvent {
  type: 'tool-call-end';
  toolId: string;
  toolName: string;
  output?: string;
  isError?: boolean;
}

export interface HappyFileEvent {
  type: 'file';
  action: 'read' | 'write' | 'delete';
  path: string;
  content?: string;
}

export interface HappyTurnStartEvent {
  type: 'turn-start';
  model?: string;
}

export interface HappyTurnEndEvent {
  type: 'turn-end';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
    cost_usd?: number;
  };
}

export interface HappyStartEvent {
  type: 'start';
  sessionId: string;
  model?: string;
}

export interface HappyStopEvent {
  type: 'stop';
  reason?: string;
}

export type HappyEvent =
  | HappyTextEvent
  | HappyServiceEvent
  | HappyToolCallStartEvent
  | HappyToolCallEndEvent
  | HappyFileEvent
  | HappyTurnStartEvent
  | HappyTurnEndEvent
  | HappyStartEvent
  | HappyStopEvent;

// ---------------------------------------------------------------------------
// Envelope -- wrapper around events on the wire
// ---------------------------------------------------------------------------

export interface HappyEnvelope {
  id: string;
  time: number;
  role: 'assistant' | 'user' | 'system';
  turn: number;
  subagent?: string;
  ev: HappyEvent;
}

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

export interface HappyAuthRequest {
  publicKey: string;
}

export interface HappyAuthChallenge {
  challenge: string;
  /** Nonce to prevent replay attacks */
  nonce?: string;
}

export interface HappyAuthVerify {
  publicKey: string;
  signature: string;
  nonce?: string;
}

export interface HappyAuthToken {
  token: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Session config
// ---------------------------------------------------------------------------

export interface HappySessionConfig {
  name?: string;
  model?: string;
  cwd?: string;
  /** Encrypted metadata blob (base64) */
  encryptedMeta?: string;
}

export interface HappySessionInfo {
  sessionId: string;
  name?: string;
  model?: string;
  createdAt: number;
  status: 'active' | 'ended';
}
