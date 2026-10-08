import { requestJson } from '../remote-control-shared/httpClient';
import {
  listInstances,
  matchInstanceByCwd,
  readInstance,
  readToken,
  selectInstance,
  writeStartRequest,
  DEFAULT_REGISTRY_PATHS,
  type RegistryPaths,
} from '../remote-control-shared/instanceRegistry';
import {
  ERROR_CODES,
  RemoteControlError,
  ROUTES,
  type InstanceInfo,
  type ToolCallResponse,
} from '../remote-control-shared/protocol';
import type { ToolDefinition } from '../remote-control-shared/toolCatalog';

/**
 * Talks to a ClaUi window over its localhost control server.
 *
 * Every VS Code window running ClaUi has a record (serving or not). Selection
 * order: explicit select_instance / CLAUI_INSTANCE, then the window whose
 * workspace contains the client's cwd, then the most recently focused window
 * (windows with mode 'off' are skipped unless explicitly chosen). A window in
 * mode 'auto' that is not serving yet is asked to start (request file) and the
 * client waits for it. A candidate only counts once an authenticated
 * /api/status answers with the same instanceId (stale records, PID reuse).
 */

export interface InstanceStatus {
  instanceId?: string;
  startupNonce?: string;
  protocolVersion?: number;
  extensionVersion?: string;
  workspaceName?: string;
  workspaceFolders?: string[];
  accessLevel?: string;
  tabCount?: number;
}

export interface LiveInstance extends InstanceInfo {
  reachable: boolean;
  status?: InstanceStatus;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class InstanceClient {
  private preferred: string | undefined;
  private current: InstanceInfo | null = null;

  constructor(
    private readonly opts: {
      preferred?: string;
      cwd?: string;
      paths?: RegistryPaths;
      /** Label recorded in start requests (diagnostics only). */
      clientName?: string;
      /** How long to wait for an 'auto' window to start serving. */
      startTimeoutMs?: number;
    } = {},
  ) {
    this.preferred = opts.preferred?.trim() || undefined;
  }

  private get paths(): RegistryPaths {
    return this.opts.paths ?? DEFAULT_REGISTRY_PATHS;
  }

  get selected(): InstanceInfo | null {
    return this.current;
  }

  get preference(): string | undefined {
    return this.preferred;
  }

  token(): string {
    const token = readToken(this.paths);
    if (!token) {
      throw new RemoteControlError(
        ERROR_CODES.noInstance,
        'No ClaUi Remote Control token found. Install the ClaUi VS Code extension and open VS Code once.',
      );
    }
    return token;
  }

  async probe(info: InstanceInfo, timeoutMs = 2000): Promise<InstanceStatus | null> {
    if (!info.serving || !info.port) {
      return null;
    }
    try {
      const res = await requestJson({
        host: info.host || '127.0.0.1',
        port: info.port,
        method: 'GET',
        path: ROUTES.status,
        token: this.token(),
        timeoutMs,
      });
      const body = res.body as { ok?: boolean; result?: InstanceStatus };
      if (res.status !== 200 || !body?.ok || body.result?.instanceId !== info.instanceId) {
        return null;
      }
      return body.result;
    } catch {
      return null;
    }
  }

  /** Every window running ClaUi; `reachable` is true for serving windows that answered. */
  async listLive(): Promise<LiveInstance[]> {
    const instances = listInstances(this.paths);
    return Promise.all(
      instances.map(async (info) => {
        const status = await this.probe(info);
        return { ...info, reachable: !!status, status: status ?? undefined };
      }),
    );
  }

  /** Change the preferred window (instanceId, workspace path or name). Throws when nothing matches. */
  async select(query: string): Promise<InstanceInfo> {
    const windows = listInstances(this.paths);
    const match = selectInstance(windows, { preferred: query });
    if (!match) {
      throw new RemoteControlError(ERROR_CODES.noInstance, `No running ClaUi window matches "${query}".`, {
        windows: windows.map((i) => ({ instanceId: i.instanceId, workspaceName: i.workspaceName, folders: i.workspaceFolders })),
      });
    }
    this.preferred = match.instanceId;
    this.current = null;
    return this.resolve();
  }

  /** Ask an 'auto' window to start serving and wait until its record says so. */
  private async requestStart(target: InstanceInfo): Promise<InstanceInfo> {
    writeStartRequest(target.instanceId, this.opts.clientName ?? 'claui-runtime', this.paths);
    const deadline = Date.now() + (this.opts.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      const latest = readInstance(target.instanceId, this.paths);
      if (!latest) {
        throw new RemoteControlError(ERROR_CODES.noInstance, `The ClaUi window "${target.workspaceName}" closed.`);
      }
      if (latest.serving && latest.port) {
        return latest;
      }
      await sleep(200);
    }
    throw new RemoteControlError(
      ERROR_CODES.noInstance,
      `The ClaUi window "${target.workspaceName}" did not start Remote Control in time. ` +
        'Check claudeMirror.remoteControl.mode (auto or on) and that ClaUi is up to date.',
    );
  }

  /**
   * Resolve (and cache) the window to talk to, starting its server on demand.
   * With start=false a window that is not serving yet is NOT started (throws).
   */
  async resolve(options: { start?: boolean } = {}): Promise<InstanceInfo> {
    if (this.current && (await this.probe(this.current, 1500))) {
      return this.current;
    }
    this.current = null;
    const windows = listInstances(this.paths);
    if (windows.length === 0) {
      throw new RemoteControlError(
        ERROR_CODES.noInstance,
        'VS Code with the ClaUi extension is not running. Open VS Code (or call the open_vscode_window tool) and try again.',
      );
    }
    let candidates: InstanceInfo[];
    // A window chosen explicitly or by working-directory match must never be
    // silently swapped for another project's window; only a pick by recency
    // falls back to the next most recently focused window.
    let mayFallBack = false;
    if (this.preferred) {
      const target = selectInstance(windows, { preferred: this.preferred });
      if (!target) {
        throw new RemoteControlError(
          ERROR_CODES.noInstance,
          `No running ClaUi window matches "${this.preferred}". Use list_instances / select_instance.`,
        );
      }
      candidates = [target];
    } else {
      const usable = windows.filter((w) => w.mode !== 'off');
      if (usable.length === 0) {
        throw new RemoteControlError(
          ERROR_CODES.noInstance,
          'Remote Control is turned off in every open ClaUi window (setting claudeMirror.remoteControl.mode).',
        );
      }
      const byCwd = this.opts.cwd ? matchInstanceByCwd(usable, this.opts.cwd) : undefined;
      candidates = byCwd ? [byCwd] : usable;
      mayFallBack = !byCwd;
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        let target = candidate;
        if (!target.serving) {
          if (target.mode === 'off') {
            throw new RemoteControlError(
              ERROR_CODES.noInstance,
              `Remote Control is turned off in the ClaUi window "${target.workspaceName}" (setting claudeMirror.remoteControl.mode).`,
            );
          }
          if (options.start === false) {
            throw new RemoteControlError(ERROR_CODES.noInstance, `The ClaUi window "${target.workspaceName}" is not serving yet.`);
          }
          target = await this.requestStart(target);
        }
        if (await this.probe(target)) {
          this.current = target;
          return target;
        }
        throw new RemoteControlError(
          ERROR_CODES.noInstance,
          `The ClaUi window "${target.workspaceName}" is not answering. Is VS Code still running?`,
        );
      } catch (err) {
        lastError = err;
        if (!mayFallBack) {
          break;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new RemoteControlError(ERROR_CODES.noInstance, 'No usable ClaUi window found.');
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const info = await this.resolve();
    let res;
    try {
      res = await requestJson({
        host: info.host || '127.0.0.1',
        port: info.port,
        method: 'POST',
        path: `${ROUTES.toolPrefix}${encodeURIComponent(name)}`,
        token: this.token(),
        body: args,
        timeoutMs,
      });
    } catch (err) {
      this.current = null;
      throw new RemoteControlError(
        ERROR_CODES.noInstance,
        `Lost connection to ClaUi (${info.workspaceName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const body = res.body as ToolCallResponse | string;
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      throw new RemoteControlError(ERROR_CODES.internal, `Unexpected response from ClaUi (HTTP ${res.status}).`);
    }
    if (!body.ok) {
      throw new RemoteControlError(body.error.code, body.error.message, body.error.details);
    }
    return body.result;
  }

  /**
   * Live tool catalog of the selected window when it is already serving (null
   * otherwise). Never starts a server: MCP clients list tools at every session
   * start, and merely listing must not open a port.
   */
  async fetchTools(timeoutMs = 1500): Promise<ToolDefinition[] | null> {
    try {
      const info = await this.resolve({ start: false });
      const res = await requestJson({
        host: info.host || '127.0.0.1',
        port: info.port,
        method: 'GET',
        path: ROUTES.tools,
        token: this.token(),
        timeoutMs,
      });
      const body = res.body as { ok?: boolean; result?: { tools?: ToolDefinition[] } };
      return res.status === 200 && body?.ok && Array.isArray(body.result?.tools) ? body.result!.tools! : null;
    } catch {
      return null;
    }
  }
}
