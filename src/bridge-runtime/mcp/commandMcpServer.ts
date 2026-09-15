import * as fs from 'fs';
import * as path from 'path';
import { BRIDGE_COMMANDS, BridgeCommandSpec } from '../commands/commandCatalog';
import { buildTaskPacket } from '../commands/packetBuilder';
import { CLAUI_HOME } from '../config';
import { JsonRpcRequest, readMessages, sendError, sendResult } from './jsonRpcStdio';

/**
 * Standalone MCP stdio server exposing ClaUi's bridge engine commands
 * (/code-review, /security-review, /simplify) as callable tools — Layer B of
 * the bridge command-tools plan. Spawned by the Grok ACP backend
 * (grokAcp.ts's mcpServers()) as `node <this bundle>`, registered per-session
 * via ACP's session/new and session/load. A separate webpack entry
 * (dist/bridge-runtime/mcp/command-server.js) — see webpack.config.js.
 */

// Overridable so tests never write into the real ~/.claui/bridge.log.
const LOG_FILE = process.env.CLAUI_LOG_FILE || path.join(CLAUI_HOME, 'bridge.log');
function log(...parts: unknown[]): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] [mcp-command-server] ${parts.map((p) => String(p)).join(' ')}\n`,
    );
  } catch {
    /* logging must never break the server */
  }
}

/** MCP protocol revisions this server is known to work with (it has no
 *  version-specific behavior, but only echoes a version it actually knows
 *  about — an unrecognized client-proposed version falls back to the default
 *  rather than being echoed back unchecked). */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export interface ServerCtx {
  cwd: string;
  diffBase: string;
}

function toolDefs(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}[] {
  return BRIDGE_COMMANDS.map((spec) => ({
    name: spec.toolName,
    description: spec.description,
    inputSchema: {
      type: 'object',
      properties: {
        arg: {
          type: 'string',
          description: 'Optional free-text argument, same as typing it after the slash command.',
        },
      },
      required: [],
    },
    // Standard MCP tool annotations (see the MCP spec's tool-annotations
    // section): every command in v1 only reads the diff/files and returns
    // text — none of them write, execute, or touch anything outside the
    // workspace. Declaring this lets a compliant ACP client (Grok) classify
    // the resulting tool_call with a read-only `kind`, so it can be
    // auto-approved under supervised permission mode the same way ClaUi's
    // own read-only tools are — without ClaUi's own permission gate (see
    // isReadOnlyGrokKind in grokAcp.ts) ever having to trust anything
    // model-controlled. Revisit when Section 6 (--fix write-back) ships,
    // since `simplify --fix` would then be a mutating variant.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

function findByToolName(name: unknown): BridgeCommandSpec | undefined {
  return BRIDGE_COMMANDS.find((s) => s.toolName === name);
}

/** Handle one JSON-RPC request/notification. Exported for direct unit
 *  testing; the bottom of this file wires it to real stdio when run as the
 *  entry point. */
export function handleRequest(msg: JsonRpcRequest, ctx: ServerCtx): void {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    if (id === undefined) return;
    const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    if (typeof requested !== 'string' || !requested) {
      sendError(id, -32602, 'initialize requires a string protocolVersion');
      return;
    }
    // Only echo a version this server actually knows about; an unrecognized
    // client-proposed version falls back to our default rather than being
    // reflected back unchecked (this server has no version-specific
    // behavior, but "unchecked echo" would let a client dictate an arbitrary,
    // possibly-malformed value into our own response).
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
    sendResult(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'claui-commands', version: '1.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // A true notification carries no id; an id-bearing one is a malformed
    // request pretending to be a notification — answer it as invalid rather
    // than silently accepting it.
    if (id !== undefined) {
      sendError(id, -32600, 'notifications/initialized must not include an id');
    }
    return;
  }

  if (method === 'tools/list') {
    if (id === undefined) return;
    sendResult(id, { tools: toolDefs() });
    return;
  }

  if (method === 'tools/call') {
    if (id === undefined) return;
    const p = (params as { name?: string; arguments?: { arg?: unknown } } | undefined) || {};
    const spec = findByToolName(p.name);
    if (!spec) {
      sendError(id, -32602, `Unknown tool: ${String(p.name)}`);
      return;
    }
    try {
      const arg = typeof p.arguments?.arg === 'string' ? p.arguments.arg : '';
      const packet = buildTaskPacket(spec, arg, ctx.cwd, ctx.diffBase);
      sendResult(id, { content: [{ type: 'text', text: packet.text }] });
    } catch (e) {
      // Full detail (which could include a local path or other environment
      // specifics) stays in bridge.log — never echoed back into a response a
      // remote model could see.
      log('tools/call failed:', e instanceof Error ? (e.stack ?? e.message) : String(e));
      sendError(id, -32000, 'Failed to build the task packet — see bridge.log for details.');
    }
    return;
  }

  // Unknown method: error only for requests (never respond to a notification).
  if (id !== undefined) {
    sendError(id, -32601, `Method not supported by claui-commands: ${method}`);
  }
}

if (require.main === module) {
  const ctx: ServerCtx = {
    cwd: process.env.CLAUI_CWD || process.cwd(),
    diffBase: process.env.CLAUI_DIFF_BASE || 'main',
  };
  log('command MCP server starting', JSON.stringify(ctx));
  readMessages((msg) => {
    try {
      handleRequest(msg, ctx);
    } catch (e) {
      log('request handling error:', e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  });
  process.stdin.on('close', () => process.exit(0));
}
