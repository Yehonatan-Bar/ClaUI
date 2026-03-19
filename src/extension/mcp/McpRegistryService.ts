import type { SystemInitEvent } from '../types/stream-json';
import type {
  McpEffectiveStatus,
  McpMutationRecord,
  McpNextAction,
  McpRuntimeStatus,
  McpServerInfo,
  McpScope,
  McpTransport,
} from '../types/webview-messages';

export interface McpInventoryResult {
  servers: McpServerInfo[];
  pendingRestartCount: number;
}

const SCOPE_PRIORITY: Record<McpScope, number> = {
  local: 0,
  project: 1,
  user: 2,
  managed: 3,
  unknown: 4,
};

export class McpRegistryService {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  buildRuntimeServers(event: Pick<SystemInitEvent, 'mcp_servers' | 'tools'>): McpServerInfo[] {
    const allTools = Array.isArray(event.tools) ? event.tools : [];
    const runtimeServers: McpServerInfo[] = [];

    for (const server of Array.isArray(event.mcp_servers) ? event.mcp_servers : []) {
      const name = String(server?.name || server?.id || '').trim();
      if (!name) {
        continue;
      }

      const transport = this.normalizeTransport(
        typeof server.transport === 'string' ? server.transport : typeof server.type === 'string' ? server.type : ''
      );

      runtimeServers.push({
        name,
        scope: 'unknown',
        source: 'runtime',
        transport: transport ?? (typeof server.url === 'string' ? 'http' : typeof server.command === 'string' ? 'stdio' : undefined),
        runtimeStatus: this.normalizeRuntimeStatus(server.status),
        effectiveStatus: 'unknown',
        command: typeof server.command === 'string' ? server.command : undefined,
        args: Array.isArray(server.args) ? server.args.filter((value): value is string => typeof value === 'string') : undefined,
        url: typeof server.url === 'string' ? server.url : undefined,
        envKeys: this.objectKeys(server.env),
        headerKeys: this.objectKeys(server.headers),
        tools: this.extractRuntimeTools(name, allTools),
        resources: Array.isArray(server.resources) ? server.resources.filter((value): value is string => typeof value === 'string') : [],
        prompts: Array.isArray(server.prompts) ? server.prompts.filter((value): value is string => typeof value === 'string') : [],
      });
    }

    return runtimeServers;
  }

  mergeInventory(
    runtimeServers: McpServerInfo[],
    configServers: McpServerInfo[],
    pendingMutations: McpMutationRecord[] = [],
    options?: { hasRuntimeSession?: boolean }
  ): McpInventoryResult {
    const hasRuntimeSession = !!options?.hasRuntimeSession;
    const merged = new Map<string, McpServerInfo>();
    const configByName = new Map<string, McpServerInfo[]>();

    for (const configServer of configServers) {
      const key = this.makeKey(configServer.name, configServer.scope);
      merged.set(key, { ...configServer });
      const existing = configByName.get(configServer.name) ?? [];
      existing.push(configServer);
      configByName.set(configServer.name, existing);
    }

    for (const runtimeServer of runtimeServers) {
      const target = this.pickConfigForRuntime(configByName.get(runtimeServer.name));
      const key = target ? this.makeKey(target.name, target.scope) : this.makeKey(runtimeServer.name, 'unknown');
      const existing = merged.get(key);
      merged.set(key, this.mergeServer(existing, runtimeServer));
    }

    for (const mutation of pendingMutations) {
      const key = this.makeKey(mutation.name, mutation.scope);
      const exact = merged.get(key);
      if (exact) {
        merged.set(key, {
          ...exact,
          pendingMutation: mutation.kind,
          restartRequired: mutation.restartRequired,
        });
        continue;
      }

      const byNameEntry = Array.from(merged.entries()).find(([, server]) => server.name === mutation.name);
      if (byNameEntry) {
        const [existingKey, server] = byNameEntry;
        merged.set(existingKey, {
          ...server,
          scope: server.scope === 'unknown' ? mutation.scope : server.scope,
          pendingMutation: mutation.kind,
          restartRequired: mutation.restartRequired,
        });
        continue;
      }

      merged.set(key, {
        name: mutation.name,
        scope: mutation.scope,
        source: 'config',
        runtimeStatus: 'unknown',
        effectiveStatus: mutation.restartRequired ? 'pending_restart' : 'configured',
        tools: [],
        pendingMutation: mutation.kind,
        restartRequired: mutation.restartRequired,
      });
    }

    const finalized = Array.from(merged.values())
      .map((server) => this.finalizeServer(server, runtimeServers, hasRuntimeSession))
      .sort((left, right) => {
        if (left.scope !== right.scope) {
          return SCOPE_PRIORITY[left.scope] - SCOPE_PRIORITY[right.scope];
        }
        return left.name.localeCompare(right.name);
      });

    const pendingRestartCount = finalized.filter((server) => server.restartRequired).length;
    return { servers: finalized, pendingRestartCount };
  }

  private mergeServer(existing: McpServerInfo | undefined, runtimeServer: McpServerInfo): McpServerInfo {
    if (!existing) {
      return {
        ...runtimeServer,
        source: 'runtime',
      };
    }

    return {
      ...existing,
      source: 'both',
      transport: existing.transport ?? runtimeServer.transport,
      runtimeStatus: runtimeServer.runtimeStatus,
      command: existing.command ?? runtimeServer.command,
      args: existing.args?.length ? existing.args : runtimeServer.args,
      url: existing.url ?? runtimeServer.url,
      envKeys: existing.envKeys?.length ? existing.envKeys : runtimeServer.envKeys,
      headerKeys: existing.headerKeys?.length ? existing.headerKeys : runtimeServer.headerKeys,
      tools: runtimeServer.tools.length > 0 ? runtimeServer.tools : existing.tools,
      resources: runtimeServer.resources?.length ? runtimeServer.resources : existing.resources,
      prompts: runtimeServer.prompts?.length ? runtimeServer.prompts : existing.prompts,
    };
  }

  private finalizeServer(
    server: McpServerInfo,
    runtimeServers: McpServerInfo[],
    hasRuntimeSession: boolean
  ): McpServerInfo {
    const hasRuntime = runtimeServers.some((entry) => entry.name === server.name);
    const hasConfig = server.source === 'config' || server.source === 'both';
    const hasRuntimeOnly = server.source === 'runtime';

    let restartRequired = !!server.restartRequired;
    if (!restartRequired && hasRuntimeSession) {
      restartRequired =
        (hasConfig && !hasRuntime) ||
        (hasRuntimeOnly && !hasConfig);
    }

    const runtimeStatus = server.runtimeStatus;
    const effectiveStatus = this.computeEffectiveStatus({
      runtimeStatus,
      hasConfig,
      hasRuntime,
      restartRequired,
    });

    return {
      ...server,
      effectiveStatus,
      restartRequired,
      nextAction: this.computeNextAction(server, effectiveStatus, hasRuntimeSession),
      tools: Array.from(new Set(server.tools)).sort(),
    };
  }

  private computeEffectiveStatus(input: {
    runtimeStatus: McpRuntimeStatus;
    hasConfig: boolean;
    hasRuntime: boolean;
    restartRequired: boolean;
  }): McpEffectiveStatus {
    if (input.runtimeStatus === 'needs-auth') return 'needs_auth';
    if (input.runtimeStatus === 'needs-approval') return 'needs_approval';
    if (input.runtimeStatus === 'error') return 'broken';
    if (input.runtimeStatus === 'connected') return input.restartRequired ? 'pending_restart' : 'active';
    if (input.restartRequired) return 'pending_restart';
    if (input.hasConfig) return 'configured';
    if (input.hasRuntime) return 'active';
    return 'unknown';
  }

  private computeNextAction(
    server: McpServerInfo,
    status: McpEffectiveStatus,
    hasRuntimeSession: boolean
  ): McpNextAction {
    if (server.runtimeStatus === 'disconnected' && hasRuntimeSession) {
      return 'reconnect';
    }
    switch (status) {
      case 'pending_restart':
        return 'restart-session';
      case 'needs_auth':
        return 'sign-in';
      case 'needs_approval':
        return 'approve-project';
      case 'broken':
        return 'open-config';
      default:
        return 'none';
    }
  }

  pruneSatisfiedMutations(inventory: McpServerInfo[], pendingMutations: McpMutationRecord[]): McpMutationRecord[] {
    return pendingMutations.filter((mutation) =>
      inventory.some(
        (server) =>
          server.name === mutation.name &&
          server.pendingMutation === mutation.kind &&
          (server.scope === mutation.scope || server.scope === 'unknown')
      )
    );
  }

  private pickConfigForRuntime(configServers: McpServerInfo[] | undefined): McpServerInfo | undefined {
    if (!configServers || configServers.length === 0) {
      return undefined;
    }

    return [...configServers].sort((left, right) => SCOPE_PRIORITY[left.scope] - SCOPE_PRIORITY[right.scope])[0];
  }

  private extractRuntimeTools(serverName: string, allTools: string[]): string[] {
    const prefix = `mcp__${serverName}__`;
    return allTools
      .filter((toolName) => toolName.startsWith(prefix))
      .map((toolName) => toolName.slice(prefix.length))
      .filter(Boolean);
  }

  private makeKey(name: string, scope: McpScope): string {
    return `${name}::${scope}`;
  }

  private normalizeRuntimeStatus(value: unknown): McpRuntimeStatus {
    const normalized = typeof value === 'string' ? value.toLowerCase() : '';
    if (normalized.includes('connected')) return 'connected';
    if (normalized.includes('needs auth') || normalized.includes('login')) return 'needs-auth';
    if (normalized.includes('approval') || normalized.includes('trust')) return 'needs-approval';
    if (normalized.includes('error') || normalized.includes('failed')) return 'error';
    if (normalized.includes('disconnected')) return 'disconnected';
    return 'unknown';
  }

  private normalizeTransport(value: string): McpTransport | undefined {
    const normalized = value.toLowerCase();
    if (normalized.includes('stdio')) return 'stdio';
    if (normalized.includes('sse')) return 'sse';
    if (normalized.includes('http')) return 'http';
    return undefined;
  }

  private objectKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    return Object.keys(value as Record<string, unknown>);
  }
}
