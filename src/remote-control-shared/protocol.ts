import * as os from 'os';
import * as path from 'path';

/**
 * Shared contract for ClaUi Remote Control (MCP).
 *
 * Imported by BOTH the extension host (which runs the localhost control
 * server) and the standalone remote-control runtime (stdio MCP server + CLI
 * that external tools launch). Must never import `vscode`.
 */

/** Root of all per-user ClaUi runtime state (shared with the bridge runtime). */
export const CLAUI_HOME = process.env.CLAUI_HOME || path.join(os.homedir(), '.claui');

/** Root of the remote-control state directory. Overridable for tests. */
export const REMOTE_CONTROL_HOME =
  process.env.CLAUI_REMOTE_CONTROL_HOME || path.join(CLAUI_HOME, 'remote-control');

/** One JSON file per live VS Code window (extension host) that serves remote control. */
export const INSTANCES_DIR = path.join(REMOTE_CONTROL_HOME, 'instances');

/** Per-user shared secret. Every request must present it. */
export const TOKEN_FILE = path.join(REMOTE_CONTROL_HOME, 'token');

/** Stable copy of the runtime bundles, so MCP client configs survive extension updates. */
export const BIN_DIR = path.join(REMOTE_CONTROL_HOME, 'bin');
export const MCP_SERVER_BIN = path.join(BIN_DIR, 'claui-mcp.js');
export const CLI_BIN = path.join(BIN_DIR, 'claui.js');

/** Name used when registering the stdio server with MCP clients. */
export const MCP_SERVER_NAME = 'claui';

/** Header names accepted for the token (Authorization: Bearer is preferred). */
export const TOKEN_HEADER = 'x-claui-token';

/** MCP protocol revisions understood by both transports. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';

/** HTTP routes served by the extension-host control server. */
export const ROUTES = {
  mcp: '/mcp',
  status: '/api/status',
  tools: '/api/tools',
  /** POST /api/tools/<toolName> with the JSON arguments object as body. */
  toolPrefix: '/api/tools/',
  events: '/api/events',
  eventStream: '/api/events/stream',
  health: '/health',
} as const;

/** Discovery record written by each extension host while remote control is on. */
export interface InstanceInfo {
  instanceId: string;
  pid: number;
  port: number;
  host: string;
  /** Absolute paths of the workspace folders open in that window. */
  workspaceFolders: string[];
  workspaceName: string;
  extensionVersion: string;
  accessLevel: AccessLevel;
  startedAt: string;
  /** Rewritten periodically (liveness / record recreation). */
  heartbeatAt: string;
  /** Last time this window gained OS focus; readers prefer the most recently focused window. */
  lastFocusedAt?: string;
}

export type AccessLevel = 'full' | 'readOnly';

/** JSON body returned by POST /api/tools/<name>. */
export type ToolCallResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/** One recorded event. `direction` tells where it came from. */
export interface RemoteEvent {
  seq: number;
  /** ISO timestamp */
  time: string;
  tabId: string | null;
  /**
   * 'out'    = extension -> chat UI message (what the user sees change),
   * 'in'     = chat UI -> extension action (user click/typing or a remote dispatch),
   * 'system' = synthesized by remote control (tab opened/closed/renamed/busy, etc.).
   */
  direction: 'out' | 'in' | 'system';
  type: string;
  data: unknown;
}

/** Error codes surfaced to callers (stable, machine-readable). */
export const ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  invalidArgs: 'invalid_arguments',
  readOnly: 'read_only_mode',
  noInstance: 'no_instance',
  timeout: 'timeout',
  unsupported: 'unsupported',
  internal: 'internal_error',
} as const;

/** Error type thrown by tool handlers; serialized as `{ code, message }`. */
export class RemoteControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RemoteControlError';
  }
}
