import * as readline from 'readline';
import {
  errorResponse,
  handleMcpMessage,
  JSON_RPC_ERRORS,
  SERVER_INSTRUCTIONS,
  type McpExecutor,
} from '../remote-control-shared/mcpProtocol';
import { TOOL_CATALOG, findTool, toMcpTool, type ToolDefinition } from '../remote-control-shared/toolCatalog';
import { InstanceClient } from './instanceClient';
import { LOCAL_TOOL_NAMES, runLocalTool } from './localTools';

/**
 * ClaUi Remote Control - stdio MCP server.
 *
 * Launched by MCP clients (Claude Code, Claude Desktop, Cursor, VS Code, ...)
 * as `node ~/.claui/remote-control/bin/claui-mcp.js`. Newline-delimited
 * JSON-RPC on stdin/stdout; diagnostics go to stderr only. Every 'instance'
 * tool is forwarded to the selected VS Code window's localhost server; the
 * 'local' tools (list_instances / select_instance / open_vscode_window) run
 * here. The tool list is the live catalog of the selected window when one is
 * reachable, else the bundled catalog (so the client sees the tools even
 * before VS Code is open).
 *
 * Environment: CLAUI_INSTANCE = preferred window (instanceId / workspace path / name).
 */

const SERVER_VERSION = '1.0.0';
const DEFAULT_CALL_TIMEOUT_SEC = 600;
const PROGRESS_INTERVAL_MS = 10_000;

function writeMessage(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[claui-mcp] ${message}\n`);
}

export function createExecutor(client: InstanceClient, notify: (msg: unknown) => void = writeMessage): McpExecutor & {
  refreshTools: () => Promise<void>;
} {
  let liveTools: ToolDefinition[] | null = null;
  const localTools = TOOL_CATALOG.filter((t) => t.scope === 'local');

  const currentTools = (): ToolDefinition[] => {
    const instanceTools = liveTools ?? TOOL_CATALOG.filter((t) => t.scope === 'instance');
    return [...instanceTools, ...localTools];
  };

  return {
    async refreshTools() {
      liveTools = await client.fetchTools();
    },
    listTools: () => currentTools().map(toMcpTool),
    hasTool: (name) => currentTools().some((t) => t.name === name) || !!findTool(name),
    async callTool(name, args, ctx) {
      if (LOCAL_TOOL_NAMES.has(name)) {
        return runLocalTool(client, name, args);
      }
      const def = currentTools().find((t) => t.name === name) ?? findTool(name);
      const timeoutSec =
        typeof args.timeoutSec === 'number' ? args.timeoutSec : typeof args.waitSec === 'number' ? args.waitSec : DEFAULT_CALL_TIMEOUT_SEC;
      // Server-side waits are bounded by the tool's own timeout; give the HTTP call some slack.
      const httpTimeoutMs = (Math.min(3600, timeoutSec) + 60) * 1000;

      let heartbeat: ReturnType<typeof setInterval> | null = null;
      if (def?.longRunning && ctx.progressToken !== undefined) {
        let ticks = 0;
        const startedAt = Date.now();
        heartbeat = setInterval(() => {
          ticks += 1;
          notify({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken: ctx.progressToken,
              progress: ticks,
              message: `${name}: still working (${Math.round((Date.now() - startedAt) / 1000)}s)`,
            },
          });
        }, PROGRESS_INTERVAL_MS);
      }
      try {
        return await client.callTool(name, args, httpTimeoutMs);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    },
  };
}

export function startStdioServer(): void {
  const client = new InstanceClient({ preferred: process.env.CLAUI_INSTANCE, cwd: process.cwd() });
  const executor = createExecutor(client);
  const identity = { name: 'claui', version: SERVER_VERSION, instructions: SERVER_INSTRUCTIONS };
  let pending = 0;
  let inputClosed = false;

  const maybeExit = (): void => {
    if (inputClosed && pending === 0) {
      // Exit only after stdout is flushed (pipe writes can be async on some platforms).
      process.stdout.write('', () => process.exit(0));
    }
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      writeMessage(errorResponse(null, JSON_RPC_ERRORS.parse, 'Parse error'));
      return;
    }
    // Requests are handled concurrently: a long send_message must not block ping / list calls.
    pending += 1;
    void (async () => {
      try {
        const method = (parsed as { method?: unknown })?.method;
        if (method === 'tools/list') {
          await executor.refreshTools();
        }
        const response = await handleMcpMessage(parsed, executor, identity);
        if (response) {
          writeMessage(response);
        }
      } catch (err) {
        logError(`request failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        const id = (parsed as { id?: unknown })?.id;
        if (typeof id === 'number' || typeof id === 'string') {
          writeMessage(errorResponse(id, JSON_RPC_ERRORS.internal, 'Internal error'));
        }
      } finally {
        pending -= 1;
        maybeExit();
      }
    })();
  });
  rl.on('close', () => {
    inputClosed = true;
    maybeExit();
  });
}
