import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  McpConfigDiffPreview,
  McpConfigPaths,
  McpScope,
  McpServerConfig,
  McpServerInfo,
  McpTransport,
} from '../types/webview-messages';
import { McpCliService } from './McpCliService';

export interface McpConfigSnapshot {
  servers: McpServerInfo[];
  configPaths: McpConfigPaths;
  lastError?: string;
}

export class McpConfigService {
  constructor(
    private readonly cliService: McpCliService,
    private readonly log: (msg: string) => void = () => {}
  ) {}

  getConfigPaths(workspacePath?: string): McpConfigPaths {
    return {
      workspaceConfigPath: workspacePath ? path.join(workspacePath, '.mcp.json') : undefined,
      userConfigPath: path.join(os.homedir(), '.claude.json'),
      managedConfigPath: this.getManagedConfigPath(),
      localConfigPath: workspacePath ? path.join(os.homedir(), '.claude.json') : undefined,
    };
  }

  async readSnapshot(workspacePath?: string): Promise<McpConfigSnapshot> {
    const configPaths = this.getConfigPaths(workspacePath);
    const collected = new Map<string, McpServerInfo>();
    const errors: string[] = [];

    const workspaceServers = this.readProjectConfig(configPaths.workspaceConfigPath, errors);
    const userConfig = this.readJsonFile(configPaths.userConfigPath, errors);
    const managedConfig = this.readJsonFile(configPaths.managedConfigPath, errors);

    this.mergeServers(collected, workspaceServers);
    this.mergeServers(collected, this.readUserScopeFromConfig(userConfig));
    this.mergeServers(collected, this.readLocalScopeFromConfig(userConfig, workspacePath));
    this.mergeServers(collected, this.readManagedScopeFromConfig(managedConfig));

    try {
      const cliDiscovered = await this.readViaCliFallback();
      this.mergeServers(collected, cliDiscovered);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`CLI fallback failed: ${message}`);
      errors.push(message);
    }

    return {
      servers: Array.from(collected.values()).sort((a, b) => a.name.localeCompare(b.name)),
      configPaths,
      lastError: errors[0],
    };
  }

  getConfigPathForScope(scope: McpScope, workspacePath?: string): string | undefined {
    const paths = this.getConfigPaths(workspacePath);
    switch (scope) {
      case 'project':
        return paths.workspaceConfigPath;
      case 'user':
        return paths.userConfigPath;
      case 'managed':
        return paths.managedConfigPath;
      case 'local':
        return paths.localConfigPath;
      default:
        return undefined;
    }
  }

  buildAddServerPreview(
    name: string,
    config: McpServerConfig,
    scope: McpScope,
    workspacePath?: string
  ): McpConfigDiffPreview {
    const targetPath = this.getConfigPathForScope(scope, workspacePath);
    if (!targetPath) {
      throw new Error(`No writable MCP config path is known for scope "${scope}".`);
    }

    const before = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    const parsed = this.parseJsonObject(before);
    if (before.trim() && !parsed) {
      throw new Error(`Cannot preview MCP changes because ${targetPath} is not valid JSON.`);
    }
    const nextRoot = { ...(parsed ?? {}) };
    const existingServers = this.asRecord(nextRoot.mcpServers) ?? {};
    const nextServers = {
      ...existingServers,
      [name]: this.toConfigRecord(config),
    };

    nextRoot.mcpServers = nextServers;
    const after = `${JSON.stringify(nextRoot, null, 2)}\n`;

    return {
      name,
      scope,
      exists: fs.existsSync(targetPath),
      before: before || '{}\n',
      after,
      diff: this.buildUnifiedDiff(before || '{}\n', after),
    };
  }

  private readProjectConfig(filePath: string | undefined, errors: string[]): McpServerInfo[] {
    const parsed = this.readJsonFile(filePath, errors);
    return this.readServersRecord(parsed?.mcpServers, 'project');
  }

  private readUserScopeFromConfig(parsed: Record<string, unknown> | null): McpServerInfo[] {
    return this.readServersRecord(parsed?.mcpServers, 'user');
  }

  private readLocalScopeFromConfig(parsed: Record<string, unknown> | null, workspacePath?: string): McpServerInfo[] {
    if (!parsed || !workspacePath) {
      return [];
    }

    const normalizedWorkspace = this.normalizeWorkspacePath(workspacePath);
    const projects = this.asRecord(parsed.projects);
    const projectEntry = this.asRecord(projects?.[normalizedWorkspace]);
    return this.readServersRecord(projectEntry?.mcpServers, 'local');
  }

  private readManagedScopeFromConfig(parsed: Record<string, unknown> | null): McpServerInfo[] {
    if (!parsed) {
      return [];
    }
    const topLevel = this.readServersRecord(parsed.mcpServers, 'managed');
    if (topLevel.length > 0) {
      return topLevel;
    }
    const mcp = this.asRecord(parsed.mcp);
    return this.readServersRecord(mcp?.servers, 'managed');
  }

  private async readViaCliFallback(): Promise<McpServerInfo[]> {
    const servers: McpServerInfo[] = [];
    const list = await this.cliService.listServers();
    for (const entry of list) {
      try {
        const details = await this.cliService.getServer(entry.name);
        servers.push({
          name: details.name,
          scope: details.scope,
          source: 'config',
          transport: details.transport,
          runtimeStatus: 'unknown',
          effectiveStatus: 'configured',
          command: details.command,
          args: details.args,
          url: details.url,
          envKeys: details.envKeys,
          headerKeys: details.headerKeys,
          tools: [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Skipping CLI fallback server "${entry.name}": ${message}`);
      }
    }
    return servers;
  }

  private readServersRecord(value: unknown, scope: McpScope): McpServerInfo[] {
    const record = this.asRecord(value);
    if (!record) {
      return [];
    }

    return Object.entries(record)
      .map(([name, config]) => this.buildServerInfo(name, scope, config))
      .filter((server): server is McpServerInfo => !!server);
  }

  private buildServerInfo(name: string, scope: McpScope, config: unknown): McpServerInfo | null {
    if (!name) {
      return null;
    }

    const configRecord = this.asRecord(config);
    if (!configRecord) {
      return {
        name,
        scope,
        source: 'config',
        runtimeStatus: 'unknown',
        effectiveStatus: 'configured',
        tools: [],
      };
    }

    const transport = this.normalizeTransport(
      this.asString(configRecord.transport) || this.asString(configRecord.type)
    );
    const envRecord = this.asRecord(configRecord.env);
    const headersRecord = this.asRecord(configRecord.headers);
    const url =
      this.asString(configRecord.url) ||
      this.asString(configRecord.endpoint) ||
      this.asString(configRecord.serverUrl);

    return {
      name,
      scope,
      source: 'config',
      transport: transport ?? (url ? 'http' : this.asString(configRecord.command) ? 'stdio' : undefined),
      runtimeStatus: 'unknown',
      effectiveStatus: 'configured',
      command: this.asString(configRecord.command) || undefined,
      args: this.asStringArray(configRecord.args),
      url: url || undefined,
      envKeys: envRecord ? Object.keys(envRecord) : [],
      headerKeys: headersRecord ? Object.keys(headersRecord) : this.extractHeaderKeys(configRecord.headers),
      tools: [],
    };
  }

  private mergeServers(target: Map<string, McpServerInfo>, incoming: McpServerInfo[]): void {
    for (const server of incoming) {
      const key = `${server.name}::${server.scope}`;
      const existing = target.get(key);
      if (!existing) {
        target.set(key, server);
        continue;
      }

      target.set(key, {
        ...existing,
        ...server,
        tools: existing.tools.length > 0 ? existing.tools : server.tools,
        envKeys: existing.envKeys?.length ? existing.envKeys : server.envKeys,
        headerKeys: existing.headerKeys?.length ? existing.headerKeys : server.headerKeys,
      });
    }
  }

  private readJsonFile(filePath: string | undefined, errors: string[]): Record<string, unknown> | null {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return this.asRecord(parsed);
    } catch (error) {
      const message = `${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(message);
      return null;
    }
  }

  private getManagedConfigPath(): string | undefined {
    if (process.platform === 'win32') {
      return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
    }
    if (process.platform === 'darwin') {
      return '/Library/Application Support/ClaudeCode/managed-settings.json';
    }
    return '/etc/claude-code/managed-settings.json';
  }

  private normalizeWorkspacePath(workspacePath: string): string {
    return workspacePath.replace(/\\/g, '/');
  }

  private normalizeTransport(value: string): McpTransport | undefined {
    const normalized = value.toLowerCase();
    if (normalized.includes('stdio')) return 'stdio';
    if (normalized.includes('sse')) return 'sse';
    if (normalized.includes('http')) return 'http';
    return undefined;
  }

  private extractHeaderKeys(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => (typeof entry === 'string' ? entry.split(':', 1)[0].trim() : ''))
      .filter(Boolean);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private parseJsonObject(raw: string): Record<string, unknown> | null {
    if (!raw.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.asRecord(parsed);
    } catch {
      return null;
    }
  }

  private toConfigRecord(config: McpServerConfig): Record<string, unknown> {
    if (config.raw && Object.keys(config.raw).length > 0) {
      return config.raw;
    }

    const transport = config.transport ?? (config.command ? 'stdio' : 'http');
    const record: Record<string, unknown> = { type: transport };
    if (config.command) record.command = config.command;
    if (config.args?.length) record.args = config.args;
    if (config.url) record.url = config.url;
    if (config.env && Object.keys(config.env).length > 0) record.env = config.env;
    if (config.headers && Object.keys(config.headers).length > 0) record.headers = config.headers;
    return record;
  }

  private buildUnifiedDiff(before: string, after: string): string {
    const beforeLines = before.replace(/\r/g, '').split('\n');
    const afterLines = after.replace(/\r/g, '').split('\n');
    const max = Math.max(beforeLines.length, afterLines.length);
    const lines: string[] = ['--- before', '+++ after'];

    for (let index = 0; index < max; index += 1) {
      const left = beforeLines[index];
      const right = afterLines[index];
      if (left === right) {
        if (left !== undefined) {
          lines.push(`  ${left}`);
        }
        continue;
      }
      if (left !== undefined) {
        lines.push(`- ${left}`);
      }
      if (right !== undefined) {
        lines.push(`+ ${right}`);
      }
    }

    return lines.join('\n');
  }
}
