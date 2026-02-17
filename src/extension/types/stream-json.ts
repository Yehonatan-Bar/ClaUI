/**
 * Types for Claude CLI stream-json protocol.
 * Used with: claude -p --output-format stream-json --input-format stream-json
 */

// --- Events received from Claude CLI stdout (one JSON object per line) ---

export interface SystemInitEvent {
  type: 'system';
  subtype: string; // 'init', 'hook_started', 'hook_response', etc.
  session_id: string;
  tools: string[];
  model: string;
  cwd: string;
  mcp_servers: Record<string, unknown>[];
}

export interface ContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use';
    id?: string;
    text?: string;
    name?: string;
    input?: string;
  };
}

export interface ContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

export interface ContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface MessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
  };
}

export interface MessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

export interface MessageStop {
  type: 'message_stop';
}

export type StreamEventPayload =
  | ContentBlockStart
  | ContentBlockDelta
  | ContentBlockStop
  | MessageStart
  | MessageDelta
  | MessageStop;

export interface StreamEvent {
  type: 'stream_event';
  event: StreamEventPayload;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  session_id: string;
}

export interface UserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: ContentBlock[];
  };
  session_id: string;
}

export interface ResultSuccess {
  type: 'result';
  subtype: 'success';
  cost_usd: number;
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: false;
  num_turns: number;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ResultError {
  type: 'result';
  subtype: 'error';
  error: string;
  is_error: true;
  session_id: string;
}

export type ResultEvent = ResultSuccess | ResultError;

export type CliOutputEvent =
  | SystemInitEvent
  | StreamEvent
  | AssistantMessage
  | UserMessage
  | ResultSuccess
  | ResultError;

// --- Messages sent TO Claude CLI stdin ---

export interface UserInputMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
}

export interface ControlRequest {
  type: 'control_request';
  request: {
    subtype: 'compact' | 'cancel';
    custom_instructions?: string;
  };
}

export type CliInputMessage = UserInputMessage | ControlRequest;
