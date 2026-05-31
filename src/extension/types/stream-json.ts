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
  mcp_servers: McpServerInit[];
  thinking_effort?: string;
}

export interface McpServerInit {
  name: string;
  id?: string;
  status?: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  [key: string]: unknown;
}

export interface ContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use' | 'thinking';
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
    type: 'text_delta' | 'input_json_delta' | 'thinking_delta';
    text?: string;
    partial_json?: string;
    thinking?: string;
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
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
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
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking';
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
  // CLI marks synthetic user-role messages (skill body load, sub-agent dispatch
  // context, system reminders) with isMeta=true. These are NOT real user prompts
  // and must not be rendered as "YOU" in the UI.
  isMeta?: boolean;
  // For meta messages, identifies the originating assistant tool_use call.
  sourceToolUseID?: string;
  // Set when this user-envelope originated INSIDE a Task/Agent subagent (its
  // first user message is the prompt the parent passed via tool_use.input.prompt,
  // already rendered inside AgentSpawnBlock). Must not be rendered as "YOU".
  parent_tool_use_id?: string;
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

/**
 * Handshake that activates the SDK control protocol for this session. Sent once
 * after spawn. Pairing it with the `--permission-prompt-tool stdio` flag makes
 * the CLI route tools whose checkPermissions returns "ask" (AskUserQuestion,
 * ExitPlanMode) back to us as can_use_tool requests instead of silently failing.
 */
export interface InitializeControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'initialize';
    hooks?: Record<string, unknown>;
  };
}

/** Decision returned to the CLI for a can_use_tool request. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** Our reply to a CLI can_use_tool control_request. */
export interface ControlResponseMessage {
  type: 'control_response';
  response: {
    subtype: 'success';
    request_id: string;
    response: PermissionResult;
  };
}

export type CliInputMessage =
  | UserInputMessage
  | ControlRequest
  | InitializeControlRequest
  | ControlResponseMessage;

// --- Control protocol messages received FROM the CLI ---

/**
 * CLI asks whether a tool may run, because that tool's checkPermissions returned
 * "ask". Under our flags only AskUserQuestion/ExitPlanMode reach us this way; we
 * defer those to the UI and reply with a control_response. Every other tool is
 * auto-bypassed by the CLI and never produces this request.
 */
export interface CanUseToolRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    display_name?: string;
    input: Record<string, unknown>;
    tool_use_id?: string;
    description?: string;
    permission_suggestions?: unknown;
    blocked_path?: string;
  };
}

/** CLI's reply to one of our control_requests (initialize/compact/cancel). */
export interface IncomingControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success' | 'error';
    request_id: string;
    response?: Record<string, unknown>;
    error?: string;
  };
}
