import {
  DEFAULT_MCP_PROTOCOL_VERSION,
  RemoteControlError,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from './protocol';

/**
 * Transport-agnostic MCP (JSON-RPC 2.0) request handling, shared by the
 * extension-host Streamable-HTTP endpoint and the stdio runtime. Hand-rolled
 * (no MCP SDK) like src/bridge-runtime/mcp/, so neither bundle needs runtime
 * npm dependencies. Only the `tools` capability is implemented; resources and
 * prompts answer with empty lists for clients that probe them regardless.
 */

export type JsonRpcId = number | string;

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolCallContext {
  /** MCP progress token supplied by the client in `_meta.progressToken`, if any. */
  progressToken?: string | number;
}

export interface McpExecutor {
  /** MCP tool entries for `tools/list`. */
  listTools(): Record<string, unknown>[];
  /** Returns true when `name` is a known tool. */
  hasTool(name: string): boolean;
  /** Executes a tool; throws RemoteControlError for expected failures. */
  callTool(name: string, args: Record<string, unknown>, ctx: McpToolCallContext): Promise<unknown>;
}

export interface McpServerIdentity {
  name: string;
  version: string;
  /** Model-facing usage hints returned in InitializeResult.instructions. */
  instructions?: string;
}

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export const SERVER_INSTRUCTIONS =
  'ClaUi Remote Control: drive the ClaUi VS Code extension (multi-tab Claude Code / Codex chat UI). ' +
  'Start with get_status or list_tabs. Tools accept tabId (id like "tab-3", tab number, or exact name; omitted = active tab). ' +
  'send_message behaves exactly like typing in the chat and by default waits for the reply; a status of ' +
  'awaiting_approval means the tab is blocked on a plan/question/permission (see list_pending_approvals, ' +
  'respond_to_approval, answer_question). get_events streams everything that happens in the UI. ' +
  'For features without a dedicated tool use list_ui_actions + dispatch_ui_action, or list_commands + execute_command.';

function isValidId(id: unknown): id is JsonRpcId | undefined {
  return id === undefined || (typeof id === 'number' && Number.isFinite(id)) || typeof id === 'string';
}

export function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** Renders a tool's return value as MCP text content. Strings pass through; everything else is pretty JSON. */
export function formatToolResult(value: unknown): Record<string, unknown> {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  return { content: [{ type: 'text', text }], isError: false };
}

export function formatToolError(err: unknown): Record<string, unknown> {
  if (err instanceof RemoteControlError) {
    const details = err.details === undefined ? '' : `\n${JSON.stringify(err.details, null, 2)}`;
    return { content: [{ type: 'text', text: `Error (${err.code}): ${err.message}${details}` }], isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error (internal_error): ${message}` }], isError: true };
}

/**
 * Handle one parsed JSON-RPC message. Returns the response to send, or null
 * when nothing must be sent (notifications, or responses from the client).
 */
export async function handleMcpMessage(
  raw: unknown,
  executor: McpExecutor,
  identity: McpServerIdentity,
): Promise<JsonRpcResponse | null> {
  const msg = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const candidateId = msg && isValidId(msg.id) ? (msg.id as JsonRpcId | undefined) : undefined;
  if (!msg || msg.jsonrpc !== '2.0' || !isValidId(msg.id)) {
    return errorResponse(candidateId ?? null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  }
  // A response object from the client (we never send requests, so just drop it).
  if (typeof msg.method !== 'string') {
    if ('result' in msg || 'error' in msg) {
      return null;
    }
    return errorResponse(candidateId ?? null, JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  }

  const id = msg.id as JsonRpcId | undefined;
  const method = msg.method;
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
  const isNotification = id === undefined;

  if (method.startsWith('notifications/')) {
    // initialized / cancelled / roots/list_changed ... nothing to do.
    return null;
  }
  if (isNotification) {
    // Unknown notification: per JSON-RPC, never respond.
    return null;
  }

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      if (typeof requested !== 'string' || !requested) {
        return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'initialize requires a string protocolVersion');
      }
      const protocolVersion = SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_MCP_PROTOCOL_VERSION;
      return resultResponse(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: identity.name, version: identity.version },
        ...(identity.instructions ? { instructions: identity.instructions } : {}),
      });
    }
    case 'ping':
      return resultResponse(id, {});
    case 'logging/setLevel':
      return resultResponse(id, {});
    case 'resources/list':
      return resultResponse(id, { resources: [] });
    case 'resources/templates/list':
      return resultResponse(id, { resourceTemplates: [] });
    case 'prompts/list':
      return resultResponse(id, { prompts: [] });
    case 'tools/list':
      return resultResponse(id, { tools: executor.listTools() });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !executor.hasTool(name)) {
        return errorResponse(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool: ${String(name)}`);
      }
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && (rawArgs === null || typeof rawArgs !== 'object' || Array.isArray(rawArgs))) {
        return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'Tool arguments must be an object');
      }
      const meta = params._meta as { progressToken?: unknown } | undefined;
      const progressToken =
        typeof meta?.progressToken === 'string' || typeof meta?.progressToken === 'number'
          ? meta.progressToken
          : undefined;
      try {
        const value = await executor.callTool(name, (rawArgs ?? {}) as Record<string, unknown>, { progressToken });
        return resultResponse(id, formatToolResult(value));
      } catch (err) {
        // Tool failures are reported inside the result (isError) so the model can read and react to them.
        return resultResponse(id, formatToolError(err));
      }
    }
    default:
      return errorResponse(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${method}`);
  }
}
