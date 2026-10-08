import { requestJson } from '../remote-control-shared/httpClient';
import {
  listInstances,
  readToken,
  selectInstance,
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
 * Talks to a running ClaUi window over its localhost control server.
 * Selection order: explicit select_instance / CLAUI_INSTANCE, then the window
 * whose workspace contains the client's cwd, then the most recently focused.
 * A candidate only counts when an authenticated /api/status answers with the
 * same instanceId (guards against stale records and PID reuse).
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

export class InstanceClient {
  private preferred: string | undefined;
  private current: InstanceInfo | null = null;

  constructor(
    private readonly opts: { preferred?: string; cwd?: string; paths?: RegistryPaths } = {},
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
        'No ClaUi Remote Control token found. In VS Code run "ClaUi: Remote Control Setup" and turn it on.',
      );
    }
    return token;
  }

  async probe(info: InstanceInfo, timeoutMs = 2000): Promise<InstanceStatus | null> {
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
    const live = (await this.listLive()).filter((i) => i.reachable);
    const match = selectInstance(live, { preferred: query });
    if (!match) {
      throw new RemoteControlError(ERROR_CODES.noInstance, `No running ClaUi window matches "${query}".`, {
        instances: live.map((i) => ({ instanceId: i.instanceId, workspaceName: i.workspaceName, folders: i.workspaceFolders })),
      });
    }
    this.preferred = match.instanceId;
    this.current = match;
    return match;
  }

  /** Resolve (and cache) the instance to talk to, verifying it is alive. */
  async resolve(): Promise<InstanceInfo> {
    if (this.current && (await this.probe(this.current, 1500))) {
      return this.current;
    }
    this.current = null;
    const instances = listInstances(this.paths);
    if (instances.length === 0) {
      throw new RemoteControlError(
        ERROR_CODES.noInstance,
        'No running ClaUi window has Remote Control enabled. Open VS Code (or call open_vscode_window) and turn it on via "ClaUi: Remote Control Setup".',
      );
    }
    const ordered: InstanceInfo[] = [];
    const first = selectInstance(instances, { preferred: this.preferred, cwd: this.opts.cwd });
    if (first) ordered.push(first);
    for (const i of instances) if (!ordered.includes(i)) ordered.push(i);
    for (const candidate of ordered) {
      // An explicit preference must not silently fall back to another window.
      if (this.preferred && candidate !== first) {
        break;
      }
      if (await this.probe(candidate)) {
        this.current = candidate;
        return candidate;
      }
    }
    throw new RemoteControlError(
      ERROR_CODES.noInstance,
      this.preferred
        ? `The selected ClaUi window (${this.preferred}) is not reachable. Use list_instances / select_instance.`
        : 'Found ClaUi instance records, but none answered. Is VS Code still running?',
    );
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

  /** Live tool catalog of the selected window (null when unreachable). */
  async fetchTools(timeoutMs = 1500): Promise<ToolDefinition[] | null> {
    try {
      const info = await this.resolve();
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
