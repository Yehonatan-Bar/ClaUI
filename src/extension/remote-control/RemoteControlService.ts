import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { TabManager } from '../session/TabManager';
import type { SessionStore } from '../session/SessionStore';
import type { TabGroupStore } from '../session/TabGroupStore';
import { McpCliService } from '../mcp/McpCliService';
import { remoteControlTap } from './RemoteControlTap';
import { EventLog } from './core/EventLog';
import { TabStateTracker } from './core/TabStateTracker';
import { RemoteControlHttpServer, type RemoteControlBackend } from './core/RemoteControlHttpServer';
import { RemoteControlToolHandlers } from './RemoteControlToolHandlers';
import {
  BIN_DIR,
  CLI_BIN,
  MCP_SERVER_BIN,
  MCP_SERVER_NAME,
  REMOTE_CONTROL_HOME,
  ROUTES,
  type AccessLevel,
  type InstanceInfo,
} from '../../remote-control-shared/protocol';
import {
  ensureToken,
  newInstanceId,
  readToken,
  regenerateToken,
  removeInstance,
  writeInstance,
} from '../../remote-control-shared/instanceRegistry';
import { SERVER_INSTRUCTIONS } from '../../remote-control-shared/mcpProtocol';
import { TOOL_CATALOG } from '../../remote-control-shared/toolCatalog';

/** Bumped when the HTTP/tool contract changes incompatibly (the stdio runtime checks it). */
export const REMOTE_CONTROL_PROTOCOL_VERSION = 1;

const HEARTBEAT_MS = 30_000;
const RUNTIME_FILES = ['mcp-server.js', 'cli.js'];

interface RemoteControlSettings {
  enabled: boolean;
  port: number;
  accessLevel: AccessLevel;
  allowSensitiveActions: boolean;
}

interface RawWaiter {
  tabId: string;
  types: Set<string>;
  resolve: (msg: Record<string, unknown> | null) => void;
}

interface NodeCommand {
  command: string;
  env?: Record<string, string>;
}

/**
 * ClaUi Remote Control (MCP): lets external scripts and MCP clients drive the
 * extension. Owns the per-tab state tracker (always on, fed by the tab tap),
 * and — while `claudeMirror.remoteControl.enabled` is true — the localhost
 * control server, the instance discovery record and the stable runtime copy.
 * Detail doc: Kingdom_of_Claudes_Beloved_MDs/REMOTE_CONTROL_MCP.md
 */
export class RemoteControlService implements vscode.Disposable {
  private readonly tracker = new TabStateTracker();
  private readonly eventLog = new EventLog(3000);
  private readonly handlers: RemoteControlToolHandlers;
  private readonly rawWaiters = new Set<RawWaiter>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly startedAt = new Date().toISOString();
  /** Updated when this window gains OS focus; clients prefer the most recently focused window. */
  private lastFocusedAt = vscode.window.state.focused ? new Date().toISOString() : this.startedAt;
  /** Random per-activation value echoed by /api/status so clients can detect PID reuse. */
  private readonly startupNonce = crypto.randomBytes(8).toString('hex');
  private server: RemoteControlHttpServer | null = null;
  private instanceId: string | null = null;
  private token = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastTabSnapshot = new Map<string, { name: string; busy: boolean; sessionId: string | null; sleepState: string }>();
  private applyQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tabManager: TabManager,
    private readonly sessionStore: SessionStore,
    private readonly tabGroupStore: TabGroupStore,
    private readonly log: (msg: string) => void,
  ) {
    this.handlers = new RemoteControlToolHandlers({
      context,
      tabManager,
      sessionStore,
      tabGroupStore,
      tracker: this.tracker,
      eventLog: this.eventLog,
      log,
      getAccessLevel: () => this.readSettings().accessLevel,
      allowSensitiveActions: () => this.readSettings().allowSensitiveActions,
      waitForOutbound: (tabId, types, timeoutMs, signal) => this.waitForOutbound(tabId, types, timeoutMs, signal),
      instanceSummary: () => this.instanceSummary(),
    });

    // The tracker is always fed, so transcripts are complete even when remote
    // control is switched on mid-session. Events are recorded only while serving.
    remoteControlTap.setListener((tabId, direction, message) => this.onTap(tabId, direction, message));

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    this.statusBarItem.command = 'claudeMirror.remoteControl.setup';

    this.disposables.push(
      this.statusBarItem,
      tabManager.onTreeStateChanged(() => this.emitTabLifecycleEvents()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claudeMirror.remoteControl')) {
          this.scheduleApply();
        }
      }),
      vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
          this.lastFocusedAt = new Date().toISOString();
          this.writeInstanceRecord();
        }
      }),
      ...this.registerCommands(),
    );
    this.scheduleApply();
  }

  // -------------------------------------------------------------------------
  // Settings & lifecycle
  // -------------------------------------------------------------------------

  private readSettings(): RemoteControlSettings {
    const cfg = vscode.workspace.getConfiguration('claudeMirror.remoteControl');
    const port = cfg.get<number>('port', 0);
    return {
      enabled: cfg.get<boolean>('enabled', false),
      port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
      accessLevel: cfg.get<string>('accessLevel', 'full') === 'readOnly' ? 'readOnly' : 'full',
      allowSensitiveActions: cfg.get<boolean>('allowSensitiveActions', false),
    };
  }

  private scheduleApply(): void {
    this.applyQueue = this.applyQueue.then(() => this.applySettings()).catch((err) => {
      this.log(`[RemoteControl] apply failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async applySettings(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const settings = this.readSettings();
    const portChanged = this.server !== null && settings.port !== 0 && settings.port !== this.server.port;
    if (!settings.enabled || portChanged) {
      await this.stopServer();
    }
    if (settings.enabled && !this.server) {
      await this.startServer(settings);
    }
    if (this.server) {
      this.writeInstanceRecord();
    }
    this.updateStatusBar();
  }

  private async startServer(settings: RemoteControlSettings): Promise<void> {
    this.token = ensureToken();
    this.instanceId = this.instanceId ?? newInstanceId();
    const backend: RemoteControlBackend = {
      identity: {
        name: 'claui',
        version: this.extensionVersion(),
        instructions: SERVER_INSTRUCTIONS,
      },
      instanceId: this.instanceId,
      listTools: () => TOOL_CATALOG.filter((t) => t.scope === 'instance'),
      callTool: async (name, args, ctx) => {
        try {
          return await this.handlers.call(name, args, { signal: ctx.signal, requestId: ctx.requestId });
        } catch (err) {
          const code = (err as { code?: unknown }).code;
          this.log(`[RemoteControl] #${ctx.requestId} tool=${name} failed (${typeof code === 'string' ? code : 'internal_error'})`);
          throw err;
        }
      },
      getStatus: () => this.statusPayload(),
      eventLog: this.eventLog,
      log: this.log,
    };
    // Read the shared token file on every request so a regenerate in ANY window revokes old clients everywhere.
    const server = new RemoteControlHttpServer(backend, { port: settings.port, getToken: () => readToken() ?? this.token });
    try {
      await server.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[RemoteControl] Failed to start server: ${message}`);
      void vscode.window.showErrorMessage(`ClaUi Remote Control could not start: ${message}`);
      return;
    }
    this.server = server;
    this.installRuntime();
    this.lastTabSnapshot = this.snapshotTabs();
    this.heartbeatTimer = setInterval(() => this.writeInstanceRecord(false), HEARTBEAT_MS);
    this.log(
      `[RemoteControl] Serving on http://127.0.0.1:${server.port} (instance ${this.instanceId}, access=${settings.accessLevel}` +
        `${settings.allowSensitiveActions ? ', sensitive actions allowed' : ''})`,
    );
    this.eventLog.record({ tabId: null, direction: 'system', type: 'remoteControlStarted', data: { port: server.port } });
  }

  private async stopServer(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.instanceId) {
      removeInstance(this.instanceId);
    }
    const server = this.server;
    this.server = null;
    for (const waiter of this.rawWaiters) {
      waiter.resolve(null);
    }
    this.rawWaiters.clear();
    if (server) {
      await server.stop();
      this.log('[RemoteControl] Server stopped');
    }
  }

  dispose(): void {
    this.disposed = true;
    remoteControlTap.setListener(null);
    void this.stopServer();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  private extensionVersion(): string {
    return String((this.context.extension.packageJSON as { version?: unknown })?.version ?? '0.0.0');
  }

  private statusPayload(): Record<string, unknown> {
    const settings = this.readSettings();
    return {
      app: 'claui',
      instanceId: this.instanceId,
      startupNonce: this.startupNonce,
      protocolVersion: REMOTE_CONTROL_PROTOCOL_VERSION,
      extensionVersion: this.extensionVersion(),
      pid: process.pid,
      port: this.server?.port ?? null,
      accessLevel: settings.accessLevel,
      allowSensitiveActions: settings.allowSensitiveActions,
      workspaceName: vscode.workspace.name ?? null,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      tabCount: this.tabManager.listTabs().length,
      startedAt: this.startedAt,
    };
  }

  private instanceSummary(): Record<string, unknown> {
    const settings = this.readSettings();
    return {
      app: 'ClaUi',
      instanceId: this.instanceId,
      extensionVersion: this.extensionVersion(),
      pid: process.pid,
      accessLevel: settings.accessLevel,
      allowSensitiveActions: settings.allowSensitiveActions,
      endpoint: this.server ? `http://127.0.0.1:${this.server.port}` : null,
    };
  }

  private writeInstanceRecord(log = true): void {
    if (!this.server || !this.instanceId) {
      return;
    }
    const now = new Date().toISOString();
    const info: InstanceInfo = {
      instanceId: this.instanceId,
      pid: process.pid,
      port: this.server.port,
      host: '127.0.0.1',
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      workspaceName: vscode.workspace.name ?? '(no folder)',
      extensionVersion: this.extensionVersion(),
      accessLevel: this.readSettings().accessLevel,
      startedAt: this.startedAt,
      heartbeatAt: now,
      lastFocusedAt: this.lastFocusedAt,
    };
    try {
      writeInstance(info);
    } catch (err) {
      if (log) {
        this.log(`[RemoteControl] Could not write instance record: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private updateStatusBar(): void {
    if (!this.server) {
      this.statusBarItem.hide();
      return;
    }
    const settings = this.readSettings();
    this.statusBarItem.text = settings.accessLevel === 'readOnly' ? '$(plug) MCP (read-only)' : '$(plug) MCP';
    this.statusBarItem.tooltip =
      `ClaUi Remote Control is ON\nhttp://127.0.0.1:${this.server.port}  (instance ${this.instanceId})\n` +
      `Access: ${settings.accessLevel}${settings.allowSensitiveActions ? ' + sensitive actions' : ''}\nClick for setup options`;
    this.statusBarItem.show();
  }

  // -------------------------------------------------------------------------
  // Tap -> tracker / events
  // -------------------------------------------------------------------------

  private onTap(tabId: string, direction: 'in' | 'out', message: unknown): void {
    if (direction === 'out') {
      this.tracker.ingestOutbound(tabId, message);
    } else {
      this.tracker.ingestInbound(tabId, message);
    }
    if (!this.server) {
      return;
    }
    const msg = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>;
    const type = typeof msg.type === 'string' ? msg.type : 'unknown';
    const { type: _omit, ...data } = msg;
    this.eventLog.record({ tabId, direction, type, data });
    if (direction === 'out' && this.rawWaiters.size > 0) {
      for (const waiter of [...this.rawWaiters]) {
        if (waiter.tabId === tabId && waiter.types.has(type)) {
          waiter.resolve(msg);
        }
      }
    }
  }

  private waitForOutbound(
    tabId: string,
    types: string[],
    timeoutMs: number,
    signal: AbortSignal,
  ): { promise: Promise<Record<string, unknown> | null>; cancel: () => void } {
    let finish: (msg: Record<string, unknown> | null) => void = () => undefined;
    const promise = new Promise<Record<string, unknown> | null>((resolve) => {
      const waiter: RawWaiter = {
        tabId,
        types: new Set(types),
        resolve: (msg) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          this.rawWaiters.delete(waiter);
          resolve(msg);
        },
      };
      const timer = setTimeout(() => waiter.resolve(null), timeoutMs);
      const onAbort = (): void => waiter.resolve(null);
      signal.addEventListener('abort', onAbort);
      this.rawWaiters.add(waiter);
      finish = waiter.resolve;
      if (signal.aborted) {
        onAbort();
      }
    });
    return { promise, cancel: () => finish(null) };
  }

  private snapshotTabs(): Map<string, { name: string; busy: boolean; sessionId: string | null; sleepState: string }> {
    return new Map(
      this.tabManager.listTabs().map((t) => [t.id, { name: t.displayName, busy: t.isBusy, sessionId: t.sessionId, sleepState: t.sleepState }]),
    );
  }

  /** Diff the tab list on every tree change into tabOpened/Closed/Renamed/BusyChanged/... system events. */
  private emitTabLifecycleEvents(): void {
    const current = this.snapshotTabs();
    const previous = this.lastTabSnapshot;
    this.lastTabSnapshot = current;
    const record = (tabId: string, type: string, data: unknown): void => {
      if (this.server) {
        this.eventLog.record({ tabId, direction: 'system', type, data });
      }
    };
    for (const [id, now] of current) {
      const before = previous.get(id);
      if (!before) {
        const summary = this.tabManager.listTabs().find((t) => t.id === id);
        record(id, 'tabOpened', { name: now.name, provider: summary?.provider, number: summary?.tabNumber });
        continue;
      }
      if (before.name !== now.name) record(id, 'tabRenamed', { name: now.name, previous: before.name });
      if (before.busy !== now.busy) record(id, 'tabBusyChanged', { busy: now.busy });
      if (before.sessionId !== now.sessionId && now.sessionId) record(id, 'tabSessionAssigned', { sessionId: now.sessionId });
      if (before.sleepState !== now.sleepState) record(id, 'tabSleepChanged', { sleepState: now.sleepState });
    }
    for (const [id, before] of previous) {
      if (!current.has(id)) {
        record(id, 'tabClosed', { name: before.name, sessionId: before.sessionId });
        this.tracker.remove(id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stable runtime install (versioned dirs + launchers that survive updates)
  // -------------------------------------------------------------------------

  private installRuntime(): void {
    const sourceDir = path.join(this.context.extensionPath, 'dist', 'remote-control-runtime');
    const version = this.extensionVersion();
    const targetDir = path.join(BIN_DIR, version);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of RUNTIME_FILES) {
        const src = path.join(sourceDir, file);
        if (!fs.existsSync(src)) {
          this.log(`[RemoteControl] Runtime bundle missing: ${src}`);
          return;
        }
        const content = fs.readFileSync(src);
        const dest = path.join(targetDir, file);
        const same =
          fs.existsSync(dest) &&
          crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') ===
            crypto.createHash('sha256').update(content).digest('hex');
        if (!same) {
          const tmp = `${dest}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, content);
          fs.renameSync(tmp, dest);
        }
      }
      const currentFile = path.join(BIN_DIR, 'current.json');
      const tmpCurrent = `${currentFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmpCurrent, JSON.stringify({ version, dir: targetDir, installedAt: new Date().toISOString() }, null, 2));
      fs.renameSync(tmpCurrent, currentFile);
      this.writeLauncher(MCP_SERVER_BIN, 'mcp-server.js', 'ClaUi Remote Control MCP server (stdio)');
      this.writeLauncher(CLI_BIN, 'cli.js', 'ClaUi Remote Control command-line client');
      this.pruneOldRuntimes(version);
    } catch (err) {
      this.log(`[RemoteControl] Runtime install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private writeLauncher(launcherPath: string, entry: string, title: string): void {
    const content =
      `#!/usr/bin/env node\n` +
      `// ${title}.\n` +
      `// Generated by the ClaUi VS Code extension: a stable entry point that loads the\n` +
      `// newest installed runtime, so MCP client configs survive extension updates.\n` +
      `'use strict';\n` +
      `const fs = require('fs');\n` +
      `const path = require('path');\n` +
      `let current;\n` +
      `try {\n` +
      `  current = JSON.parse(fs.readFileSync(path.join(__dirname, 'current.json'), 'utf8'));\n` +
      `} catch (err) {\n` +
      `  process.stderr.write('ClaUi runtime not installed. Enable Remote Control in VS Code (ClaUi: Remote Control Setup).\\n');\n` +
      `  process.exit(1);\n` +
      `}\n` +
      `require(path.join(current.dir, ${JSON.stringify(entry)}));\n`;
    const existing = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, 'utf8') : '';
    if (existing !== content) {
      const tmp = `${launcherPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, launcherPath);
    }
  }

  /** Keep the current and the newest previous version directory; delete older ones. */
  private pruneOldRuntimes(currentVersion: string): void {
    try {
      const dirs = fs
        .readdirSync(BIN_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== currentVersion && /^\d+\.\d+\.\d+/.test(d.name))
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const old of dirs.slice(1)) {
        fs.rmSync(path.join(BIN_DIR, old), { recursive: true, force: true });
      }
    } catch {
      /* best effort */
    }
  }

  // -------------------------------------------------------------------------
  // Client configuration helpers
  // -------------------------------------------------------------------------

  /** Absolute node path when available; otherwise VS Code's own Electron binary in node mode. */
  private resolveNodeCommand(): NodeCommand {
    try {
      const probe = process.platform === 'win32' ? 'where' : 'which';
      const res = spawnSync(probe, ['node'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
      const first = (res.stdout || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l));
      if (res.status === 0 && first) {
        return { command: first };
      }
    } catch {
      /* fall through */
    }
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }

  private stdioServerConfig(): { command: string; args: string[]; env?: Record<string, string> } {
    const node = this.resolveNodeCommand();
    return { command: node.command, args: [MCP_SERVER_BIN], ...(node.env ? { env: node.env } : {}) };
  }

  private quote(value: string): string {
    return /[\s"'&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  }

  private claudeCodeCommand(): string {
    const cfg = this.stdioServerConfig();
    const envArgs = Object.entries(cfg.env ?? {}).map(([k, v]) => `-e ${k}=${v}`).join(' ');
    return `claude mcp add --scope user ${envArgs ? `${envArgs} ` : ''}${MCP_SERVER_NAME} -- ${this.quote(cfg.command)} ${this.quote(MCP_SERVER_BIN)}`;
  }

  private desktopConfigJson(): string {
    return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: this.stdioServerConfig() } }, null, 2);
  }

  private vscodeMcpJson(): string {
    return JSON.stringify({ servers: { [MCP_SERVER_NAME]: { type: 'stdio', ...this.stdioServerConfig() } } }, null, 2);
  }

  private async ensureEnabledFor(action: string): Promise<boolean> {
    if (this.server) {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(
      `ClaUi Remote Control is off. Turn it on to ${action}?`,
      'Enable',
      'Cancel',
    );
    if (choice !== 'Enable') {
      return false;
    }
    await vscode.workspace.getConfiguration('claudeMirror.remoteControl').update('enabled', true, vscode.ConfigurationTarget.Global);
    await this.waitForServer();
    return !!this.server;
  }

  private async waitForServer(): Promise<void> {
    for (let i = 0; i < 40 && !this.server; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.applyQueue;
  }

  private async registerWithClaudeCode(): Promise<void> {
    if (!(await this.ensureEnabledFor('register it with Claude Code'))) {
      return;
    }
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude') || 'claude';
    const service = new McpCliService(() => cliPath, (m) => this.log(`[RemoteControl][mcp-cli] ${m}`));
    const cfg = this.stdioServerConfig();
    try {
      try {
        await service.removeServer(MCP_SERVER_NAME, 'user');
      } catch {
        /* not registered yet */
      }
      await service.addServer(
        MCP_SERVER_NAME,
        { transport: 'stdio', command: cfg.command, args: cfg.args, env: cfg.env, raw: { type: 'stdio', ...cfg } },
        'user',
      );
      void vscode.window.showInformationMessage(
        `Registered "${MCP_SERVER_NAME}" with Claude Code (user scope). New Claude Code sessions - including ones inside ClaUi - can now control ClaUi.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const pick = await vscode.window.showErrorMessage(`Could not register with Claude Code: ${message}`, 'Copy command instead');
      if (pick) {
        await vscode.env.clipboard.writeText(this.claudeCodeCommand());
      }
    }
  }

  private async openQuickGuide(): Promise<void> {
    const port = this.server?.port;
    const lines = [
      '# ClaUi Remote Control (MCP) - quick guide',
      '',
      `Status: ${this.server ? `ON at http://127.0.0.1:${port} (instance ${this.instanceId})` : 'OFF'}`,
      '',
      '## MCP clients (stdio, recommended)',
      '',
      'Claude Code:',
      '',
      '```',
      this.claudeCodeCommand(),
      '```',
      '',
      'Claude Desktop / Cursor / Windsurf (mcpServers JSON):',
      '',
      '```json',
      this.desktopConfigJson(),
      '```',
      '',
      'VS Code (.vscode/mcp.json):',
      '',
      '```json',
      this.vscodeMcpJson(),
      '```',
      '',
      '## Scripts',
      '',
      `CLI: \`node "${CLI_BIN}" help\``,
      '',
      '```',
      `node "${CLI_BIN}" tabs`,
      `node "${CLI_BIN}" send "Summarize the open diff" --tab 1`,
      `node "${CLI_BIN}" call create_tab --json "{\\"provider\\":\\"claude\\",\\"prompt\\":\\"hello\\"}"`,
      `node "${CLI_BIN}" events --follow`,
      '```',
      '',
      `HTTP (token in ${path.join(REMOTE_CONTROL_HOME, 'token')}):`,
      '',
      '```',
      `curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:${port ?? '<port>'}${ROUTES.tools}`,
      `curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\\"text\\":\\"hi\\"}" http://127.0.0.1:${port ?? '<port>'}${ROUTES.toolPrefix}send_message`,
      '```',
      '',
      `Discovery: one JSON file per VS Code window in ${path.join(REMOTE_CONTROL_HOME, 'instances')}.`,
      '',
      '## Safety',
      '',
      '- Listens on 127.0.0.1 only; every request needs the token; browser requests are refused.',
      '- Anyone holding the token can run prompts (and therefore code, in full-access mode) as you.',
      '- `claudeMirror.remoteControl.accessLevel = readOnly` blocks every state-changing tool.',
      '- Credential, git, security-policy, file/URL and external-send actions stay blocked unless',
      '  `claudeMirror.remoteControl.allowSensitiveActions` is enabled.',
      '- "Regenerate token" in the setup menu revokes every existing client.',
    ];
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async showSetup(): Promise<void> {
    const settings = this.readSettings();
    type Item = vscode.QuickPickItem & { run: () => Thenable<void> | void };
    const copy = async (text: string, what: string): Promise<void> => {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(`Copied ${what} to the clipboard.`);
    };
    const cfg = vscode.workspace.getConfiguration('claudeMirror.remoteControl');
    const items: Item[] = [
      settings.enabled
        ? { label: '$(debug-disconnect) Turn Remote Control off', run: () => cfg.update('enabled', false, vscode.ConfigurationTarget.Global) }
        : { label: '$(plug) Turn Remote Control on', description: 'Starts the localhost MCP / HTTP control server', run: () => cfg.update('enabled', true, vscode.ConfigurationTarget.Global) },
      { label: '$(add) Register with Claude Code', description: 'claude mcp add (user scope)', run: () => this.registerWithClaudeCode() },
      { label: '$(copy) Copy Claude Code command', run: () => copy(this.claudeCodeCommand(), 'the Claude Code command') },
      { label: '$(json) Copy MCP config (Claude Desktop / Cursor / Windsurf)', run: () => copy(this.desktopConfigJson(), 'the MCP config') },
      { label: '$(json) Copy VS Code mcp.json config', run: () => copy(this.vscodeMcpJson(), 'the VS Code mcp.json config') },
      {
        label: '$(globe) Copy HTTP endpoint and token (scripts)',
        description: this.server ? `http://127.0.0.1:${this.server.port}` : 'turn on first',
        run: async () => {
          if (!(await this.ensureEnabledFor('get its endpoint'))) return;
          await copy(`Endpoint: http://127.0.0.1:${this.server?.port}\nAuthorization: Bearer ${readToken() ?? this.token}`, 'the endpoint and token');
        },
      },
      {
        label: settings.accessLevel === 'readOnly' ? '$(unlock) Switch to full access' : '$(lock) Switch to read-only',
        description: `current: ${settings.accessLevel}`,
        run: () => cfg.update('accessLevel', settings.accessLevel === 'readOnly' ? 'full' : 'readOnly', vscode.ConfigurationTarget.Global),
      },
      {
        label: settings.allowSensitiveActions ? '$(shield) Block sensitive actions' : '$(warning) Allow sensitive actions',
        description: 'credentials, git, security policy, files/URLs, external sends',
        run: () => cfg.update('allowSensitiveActions', !settings.allowSensitiveActions, vscode.ConfigurationTarget.Global),
      },
      {
        label: '$(key) Regenerate token',
        description: 'disconnects every existing client',
        run: async () => {
          const ok = await vscode.window.showWarningMessage('Regenerate the Remote Control token? Every connected client must reconnect.', { modal: true }, 'Regenerate');
          if (ok === 'Regenerate') {
            this.token = regenerateToken();
            void vscode.window.showInformationMessage('Remote Control token regenerated.');
          }
        },
      },
      { label: '$(book) Open quick guide', run: () => this.openQuickGuide() },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: this.server
        ? `ClaUi Remote Control: ON - http://127.0.0.1:${this.server.port} (${settings.accessLevel})`
        : 'ClaUi Remote Control: OFF',
      ignoreFocusOut: true,
    });
    if (picked) {
      await picked.run();
    }
  }

  private registerCommands(): vscode.Disposable[] {
    const cfg = () => vscode.workspace.getConfiguration('claudeMirror.remoteControl');
    return [
      vscode.commands.registerCommand('claudeMirror.remoteControl.setup', () => this.showSetup()),
      vscode.commands.registerCommand('claudeMirror.remoteControl.enable', async () => {
        await cfg().update('enabled', true, vscode.ConfigurationTarget.Global);
        await this.waitForServer();
        const pick = await vscode.window.showInformationMessage(
          this.server ? `ClaUi Remote Control is on (http://127.0.0.1:${this.server.port}).` : 'ClaUi Remote Control is turning on.',
          'Register with Claude Code',
          'Quick guide',
        );
        if (pick === 'Register with Claude Code') await this.registerWithClaudeCode();
        if (pick === 'Quick guide') await this.openQuickGuide();
      }),
      vscode.commands.registerCommand('claudeMirror.remoteControl.disable', () =>
        cfg().update('enabled', false, vscode.ConfigurationTarget.Global),
      ),
      vscode.commands.registerCommand('claudeMirror.remoteControl.registerWithClaudeCode', () => this.registerWithClaudeCode()),
      vscode.commands.registerCommand('claudeMirror.remoteControl.copyMcpConfig', async () => {
        await vscode.env.clipboard.writeText(this.desktopConfigJson());
        void vscode.window.showInformationMessage('Copied the ClaUi MCP config to the clipboard.');
      }),
      vscode.commands.registerCommand('claudeMirror.remoteControl.regenerateToken', async () => {
        this.token = regenerateToken();
        void vscode.window.showInformationMessage('Remote Control token regenerated. Existing clients must reconnect.');
      }),
      vscode.commands.registerCommand('claudeMirror.remoteControl.quickGuide', () => this.openQuickGuide()),
    ];
  }
}
