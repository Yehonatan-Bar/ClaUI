import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { McpScope, McpServerConfig, McpTransport, McpRuntimeStatus } from '../types/webview-messages';

export interface McpCliListEntry {
  name: string;
  summary?: string;
  runtimeStatus: McpRuntimeStatus;
}

export interface McpCliServerDetails {
  name: string;
  scope: McpScope;
  runtimeStatus: McpRuntimeStatus;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headerKeys?: string[];
  envKeys?: string[];
  rawOutput: string;
}

interface CliInvocation {
  command: string;
  prefixArgs: string[];
}

export class McpCliService {
  constructor(
    private readonly getCliPath: () => string,
    private readonly log: (msg: string) => void = () => {}
  ) {}

  async listServers(): Promise<McpCliListEntry[]> {
    const output = await this.execCli(['mcp', 'list']);
    return this.parseListOutput(output.stdout);
  }

  async getServer(name: string): Promise<McpCliServerDetails> {
    const output = await this.execCli(['mcp', 'get', name]);
    return this.parseGetOutput(name, output.stdout);
  }

  async addServer(name: string, config: McpServerConfig, scope: McpScope): Promise<void> {
    const payload = this.toCliJsonConfig(config);
    await this.execCli(['mcp', 'add-json', '-s', scope, name, JSON.stringify(payload)]);
  }

  async removeServer(name: string, scope?: McpScope): Promise<void> {
    const args = ['mcp', 'remove'];
    if (scope) {
      args.push('-s', scope);
    }
    args.push(name);
    await this.execCli(args);
  }

  async importFromDesktop(): Promise<void> {
    await this.execCli(['mcp', 'add-from-claude-desktop']);
  }

  async resetProjectChoices(): Promise<void> {
    await this.execCli(['mcp', 'reset-project-choices']);
  }

  private execCli(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string }> {
    const invocation = this.resolveCliInvocation();
    const fullArgs = [...invocation.prefixArgs, ...args];
    this.log(`execFile: ${invocation.command} ${fullArgs.join(' ')}`);

    return new Promise((resolve, reject) => {
      execFile(
        invocation.command,
        fullArgs,
        {
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          shell: false,
        },
        (error, stdout, stderr) => {
          const trimmedStdout = (stdout ?? '').trim();
          const trimmedStderr = (stderr ?? '').trim();
          if (error) {
            const details = [trimmedStderr, trimmedStdout, error.message].filter(Boolean).join('\n');
            reject(new Error(details || 'Claude MCP command failed.'));
            return;
          }
          resolve({ stdout: trimmedStdout, stderr: trimmedStderr });
        }
      );
    });
  }

  private resolveCliInvocation(): CliInvocation {
    const configured = (this.getCliPath() || 'claude').trim() || 'claude';
    if (process.platform !== 'win32') {
      return { command: configured, prefixArgs: [] };
    }

    const explicit = this.resolveWindowsScriptPath(configured);
    if (explicit) {
      return explicit;
    }

    return { command: configured, prefixArgs: [] };
  }

  private resolveWindowsScriptPath(configured: string): CliInvocation | null {
    const ext = path.extname(configured).toLowerCase();

    // Explicit .cmd/.ps1 path provided by user
    if (ext === '.cmd') {
      return { command: 'cmd.exe', prefixArgs: ['/c', configured] };
    }
    if (ext === '.ps1') {
      return {
        command: 'powershell',
        prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', configured],
      };
    }

    // Absolute or relative path (contains directory separator) - check sibling .cmd then .ps1
    if (configured.includes(path.sep) || configured.includes('/')) {
      if (!ext) {
        const siblingCmd = `${configured}.cmd`;
        if (fs.existsSync(siblingCmd)) {
          return { command: 'cmd.exe', prefixArgs: ['/c', siblingCmd] };
        }
        const siblingPs1 = `${configured}.ps1`;
        if (fs.existsSync(siblingPs1)) {
          return {
            command: 'powershell',
            prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', siblingPs1],
          };
        }
      }
      return null;
    }

    // Bare command name - scan PATH for .cmd first, then .ps1
    const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const cmdCandidate = path.join(dir, `${configured}.cmd`);
      if (fs.existsSync(cmdCandidate)) {
        return { command: 'cmd.exe', prefixArgs: ['/c', cmdCandidate] };
      }
    }
    for (const dir of pathDirs) {
      const ps1Candidate = path.join(dir, `${configured}.ps1`);
      if (fs.existsSync(ps1Candidate)) {
        return {
          command: 'powershell',
          prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Candidate],
        };
      }
    }

    return null;
  }

  private parseListOutput(output: string): McpCliListEntry[] {
    const entries: McpCliListEntry[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^checking mcp server health/i.test(line)) {
        continue;
      }

      const match = line.match(/^([^:]+):\s*(.*?)\s+-\s+(.+)$/);
      if (!match) {
        continue;
      }

      entries.push({
        name: match[1].trim(),
        summary: match[2].trim() || undefined,
        runtimeStatus: this.normalizeRuntimeStatus(match[3]),
      });
    }

    return entries;
  }

  private parseGetOutput(name: string, output: string): McpCliServerDetails {
    const details: McpCliServerDetails = {
      name,
      scope: 'unknown',
      runtimeStatus: 'unknown',
      rawOutput: output,
    };

    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      const kv = line.match(/^([A-Za-z ]+):\s*(.+)$/);
      if (!kv) {
        continue;
      }

      const key = kv[1].trim().toLowerCase();
      const value = kv[2].trim();

      switch (key) {
        case 'scope':
          details.scope = this.normalizeScope(value);
          break;
        case 'status':
          details.runtimeStatus = this.normalizeRuntimeStatus(value);
          break;
        case 'type':
          details.transport = this.normalizeTransport(value);
          break;
        case 'command':
          details.command = value;
          break;
        case 'args':
          details.args = value ? this.splitArgs(value) : [];
          break;
        case 'url':
          details.url = value;
          break;
        case 'env':
        case 'environment':
          details.envKeys = value.split(',').map((item) => item.trim()).filter(Boolean);
          break;
        case 'headers':
          details.headerKeys = value.split(',').map((item) => item.split(':', 1)[0].trim()).filter(Boolean);
          break;
      }
    }

    if (!details.transport) {
      details.transport = details.url ? 'http' : details.command ? 'stdio' : undefined;
    }

    return details;
  }

  private normalizeScope(value: string): McpScope {
    const normalized = value.toLowerCase();
    if (normalized.includes('local')) return 'local';
    if (normalized.includes('project')) return 'project';
    if (normalized.includes('user')) return 'user';
    if (normalized.includes('managed')) return 'managed';
    return 'unknown';
  }

  private normalizeTransport(value: string): McpTransport | undefined {
    const normalized = value.toLowerCase();
    if (normalized.includes('stdio')) return 'stdio';
    if (normalized.includes('sse')) return 'sse';
    if (normalized.includes('http')) return 'http';
    return undefined;
  }

  private normalizeRuntimeStatus(value: string): McpRuntimeStatus {
    const normalized = value.toLowerCase();
    if (normalized.includes('connected')) return 'connected';
    if (normalized.includes('needs auth') || normalized.includes('login')) return 'needs-auth';
    if (normalized.includes('approval') || normalized.includes('trust')) return 'needs-approval';
    if (normalized.includes('error') || normalized.includes('failed')) return 'error';
    if (normalized.includes('disconnected')) return 'disconnected';
    return 'unknown';
  }

  private splitArgs(value: string): string[] {
    const matches = value.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
    return matches.map((part) => part.replace(/^['"]|['"]$/g, ''));
  }

  private toCliJsonConfig(config: McpServerConfig): Record<string, unknown> {
    if (config.raw && Object.keys(config.raw).length > 0) {
      return config.raw;
    }

    const transport = config.transport ?? (config.command ? 'stdio' : 'http');
    if (transport === 'stdio' && !config.command) {
      throw new Error('stdio MCP servers require a command.');
    }
    if (transport !== 'stdio' && !config.url) {
      throw new Error(`${transport} MCP servers require a URL.`);
    }

    const payload: Record<string, unknown> = { type: transport };
    if (config.command) payload.command = config.command;
    if (config.args?.length) payload.args = config.args;
    if (config.url) payload.url = config.url;
    if (config.env && Object.keys(config.env).length > 0) payload.env = config.env;
    if (config.headers && Object.keys(config.headers).length > 0) payload.headers = config.headers;
    return payload;
  }
}
