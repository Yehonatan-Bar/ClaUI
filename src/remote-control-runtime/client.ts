import { InstanceClient } from './instanceClient';
import { LOCAL_TOOL_NAMES, runLocalTool } from './localTools';
import { TOOL_CATALOG, type ToolDefinition } from '../remote-control-shared/toolCatalog';
import { RemoteControlError, type RemoteEvent } from '../remote-control-shared/protocol';

/**
 * ClaUi Remote Control - Node.js client library (bundle entry
 * dist/remote-control-runtime/client.js, loaded through the stable launcher
 * ~/.claui/remote-control/bin/claui-client.js).
 *
 *   const claui = require(path.join(os.homedir(), '.claui/remote-control/bin/claui-client.js')).connect();
 *   const tab = await claui.call('create_tab', { provider: 'claude', prompt: 'List the TODOs' });
 *   console.log(tab.status, tab.response);
 *   for await (const event of claui.events({ types: ['turnComplete'] })) { ... }
 *
 * Every tool of the ClaUi MCP server is available through call(). Failures
 * reject with RemoteControlError ({ code, message, details }).
 */

export interface ConnectOptions {
  /** instanceId, workspace folder path or workspace name (default: env CLAUI_INSTANCE, then cwd match, then most recently focused window). */
  instance?: string;
  /** Working directory used to pick the matching VS Code window (default: process.cwd()). */
  cwd?: string;
}

export interface CallOptions {
  /** Client-side HTTP timeout in seconds (default: the tool's timeoutSec / waitSec + 60, else 660). */
  timeoutSec?: number;
}

export class ClauiClient {
  private readonly client: InstanceClient;

  constructor(options: ConnectOptions = {}) {
    this.client = new InstanceClient({
      preferred: options.instance ?? process.env.CLAUI_INSTANCE,
      cwd: options.cwd ?? process.cwd(),
      clientName: 'node-client',
    });
  }

  /** Call any ClaUi tool, e.g. call('send_message', { text: 'hi', tabId: 2 }). */
  async call<T = any>(tool: string, args: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
    if (LOCAL_TOOL_NAMES.has(tool)) {
      return (await runLocalTool(this.client, tool, args)) as T;
    }
    const wait = typeof args.timeoutSec === 'number' ? args.timeoutSec : typeof args.waitSec === 'number' ? args.waitSec : 600;
    const timeoutSec = options.timeoutSec ?? wait + 60;
    return (await this.client.callTool(tool, args, timeoutSec * 1000)) as T;
  }

  /** The tool catalog (name, description, JSON schema, mutating flag). */
  tools(): ToolDefinition[] {
    return TOOL_CATALOG;
  }

  status(): Promise<Record<string, unknown>> {
    return this.call('get_status');
  }

  /** Every VS Code window running ClaUi. */
  windows(): Promise<Record<string, unknown>> {
    return this.call('list_instances');
  }

  /** Target another VS Code window (instanceId, folder path or name). */
  select(instance: string): Promise<Record<string, unknown>> {
    return this.call('select_instance', { instance });
  }

  /** Async iterator over ClaUi events (long-poll). Break out of the loop to stop. */
  async *events(filters: { tabId?: string | number; types?: string[]; direction?: 'out' | 'in' | 'system'; sinceSeq?: number } = {}): AsyncGenerator<RemoteEvent> {
    let cursor = filters.sinceSeq;
    const { sinceSeq: _ignored, ...rest } = filters;
    for (;;) {
      const result = await this.call<{ events: RemoteEvent[]; nextSeq: number }>('get_events', {
        ...rest,
        ...(cursor !== undefined ? { sinceSeq: cursor } : {}),
        waitSec: 60,
        limit: 200,
      });
      for (const event of result.events) {
        yield event;
      }
      cursor = result.nextSeq;
    }
  }
}

export function connect(options: ConnectOptions = {}): ClauiClient {
  return new ClauiClient(options);
}

export { RemoteControlError, TOOL_CATALOG };
