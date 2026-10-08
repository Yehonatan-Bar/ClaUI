import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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
  CONNECT_DOC,
  MCP_SERVER_NAME,
  REQUESTS_DIR,
  type AccessLevel,
  type InstanceInfo,
  type RemoteControlMode,
} from '../../remote-control-shared/protocol';
import {
  ensureToken,
  newInstanceId,
  readToken,
  regenerateToken,
  removeInstance,
  takeStartRequests,
  writeInstance,
} from '../../remote-control-shared/instanceRegistry';
import {
  buildConnectionInfo,
  clientConfigs,
  installRuntime,
  resolveNodeCommand,
  stdioServerEntry,
  writeConnectionFiles,
  type NodeCommand,
} from '../../remote-control-shared/runtimeInstaller';
import { SERVER_INSTRUCTIONS } from '../../remote-control-shared/mcpProtocol';
import { TOOL_CATALOG } from '../../remote-control-shared/toolCatalog';

/** Bumped when the HTTP/tool contract changes incompatibly (the stdio runtime checks it). */
export const REMOTE_CONTROL_PROTOCOL_VERSION = 1;

/** Provider id declared in package.json `contributes.mcpServerDefinitionProviders`. */
const VSCODE_MCP_PROVIDER_ID = 'claui.remoteControl';
const HEARTBEAT_MS = 30_000;
const REQUEST_POLL_MS = 3_000;

interface RemoteControlSettings {
  mode: RemoteControlMode;
  port: number;
  accessLevel: AccessLevel;
  allowSensitiveActions: boolean;
}

interface RawWaiter {
  tabId: string;
  types: Set<string>;
  resolve: (msg: Record<string, unknown> | null) => void;
}

/**
 * ClaUi Remote Control (MCP): lets agents, MCP clients and scripts drive the
 * extension with zero setup after installing it.
 *
 * On every activation (any mode except where noted):
 *  - installs the runtime (stdio MCP server, CLI, Node/Python clients) and the
 *    connection manifest into ~/.claui/remote-control (stable paths);
 *  - writes this window's instance record (serving or not);
 *  - registers the MCP server with VS Code itself (agents inside VS Code see it);
 *  - feeds the per-tab state tracker from the tab tap.
 * The localhost server itself runs per `claudeMirror.remoteControl.mode`:
 * 'auto' (default) = starts on the first client request, 'on' = always,
 * 'off' = never. Detail doc: Kingdom_of_Claudes_Beloved_MDs/REMOTE_CONTROL_MCP.md
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
  /** Stable for the life of this extension host (clients address the window by it). */
  private readonly instanceId = newInstanceId();
  private server: RemoteControlHttpServer | null = null;
  private token = '';
  private lifecycle: Promise<void> = Promise.resolve();
  private lastTabSnapshot = new Map<string, { name: string; busy: boolean; sessionId: string | null; sleepState: string }>();
  private nodeCommandCache: NodeCommand | null = null;
  private readonly mcpDefinitionsChanged = new vscode.EventEmitter<void>();
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

    // The tracker is always fed, so transcripts are complete whenever a client
    // connects. Events are recorded only while serving.
    remoteControlTap.setListener((tabId, direction, message) => this.onTap(tabId, direction, message));

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    this.statusBarItem.command = 'claudeMirror.remoteControl.setup';

    try {
      this.token = ensureToken();
    } catch (err) {
      this.log(`[RemoteControl] Could not create the token file: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.disposables.push(
      this.statusBarItem,
      this.mcpDefinitionsChanged,
      tabManager.onTreeStateChanged(() => this.emitTabLifecycleEvents()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claudeMirror.remoteControl')) {
          this.enqueue(() => this.applySettings());
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.writeInstanceRecord()),
      vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
          this.lastFocusedAt = new Date().toISOString();
          this.writeInstanceRecord();
        }
      }),
      ...this.registerCommands(),
    );

    this.registerVsCodeMcpProvider();
    this.watchStartRequests();
    const heartbeat = setInterval(() => this.writeInstanceRecord(false), HEARTBEAT_MS);
    this.disposables.push({ dispose: () => clearInterval(heartbeat) });
    // Runtime install probes for `node` (a short synchronous child process); keep it off the activation path.
    const installTimer = setTimeout(() => this.prepareRuntime(), 1500);
    this.disposables.push({ dispose: () => clearTimeout(installTimer) });
    this.enqueue(() => this.applySettings());
  }

  // -------------------------------------------------------------------------
  // Settings & lifecycle
  // -------------------------------------------------------------------------

  private readSettings(): RemoteControlSettings {
    const cfg = vscode.workspace.getConfiguration('claudeMirror.remoteControl');
    const port = cfg.get<number>('port', 0);
    return {
      mode: this.effectiveMode(cfg),
      port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
      accessLevel: cfg.get<string>('accessLevel', 'full') === 'readOnly' ? 'readOnly' : 'full',
      allowSensitiveActions: cfg.get<boolean>('allowSensitiveActions', false),
    };
  }

  /**
   * `mode` when set; otherwise the 0.1.244 boolean `enabled` (true = 'on',
   * explicit false = 'off'); otherwise 'auto'.
   */
  private effectiveMode(cfg: vscode.WorkspaceConfiguration): RemoteControlMode {
    const inspected = cfg.inspect<string>('mode');
    const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    if (explicit === 'auto' || explicit === 'on' || explicit === 'off') {
      return explicit;
    }
    const legacy = cfg.get<unknown>('enabled');
    if (legacy === true) {
      return 'on';
    }
    if (legacy === false) {
      return 'off';
    }
    return 'auto';
  }

  /** Serialize start/stop work so concurrent triggers never race. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.lifecycle = this.lifecycle.then(work).catch((err) => {
      this.log(`[RemoteControl] ${err instanceof Error ? err.message : String(err)}`);
    });
    return this.lifecycle;
  }

  private async applySettings(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const settings = this.readSettings();
    if (settings.mode === 'off') {
      await this.stopServer('mode is off');
    } else if (this.server && settings.port !== 0 && settings.port !== this.server.port) {
      await this.stopServer('port setting changed');
      await this.startServer('port setting changed');
    } else if (settings.mode === 'on' && !this.server) {
      await this.startServer('mode is on');
    }
    this.writeInstanceRecord();
    this.updateStatusBar();
    this.mcpDefinitionsChanged.fire();
  }

  /** Start serving now unless the mode is 'off'. Resolves to whether the server runs. */
  async ensureServing(reason: string): Promise<boolean> {
    await this.enqueue(async () => {
      if (!this.server && !this.disposed && this.readSettings().mode !== 'off') {
        await this.startServer(reason);
        this.writeInstanceRecord();
        this.updateStatusBar();
      }
    });
    return !!this.server;
  }

  private async startServer(reason: string): Promise<void> {
    const settings = this.readSettings();
    this.token = readToken() ?? ensureToken();
    const backend: RemoteControlBackend = {
      identity: { name: 'claui', version: this.extensionVersion(), instructions: SERVER_INSTRUCTIONS },
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
    this.lastTabSnapshot = this.snapshotTabs();
    this.log(
      `[RemoteControl] Serving on http://127.0.0.1:${server.port} (instance ${this.instanceId}, ${reason}, ` +
        `access=${settings.accessLevel}${settings.allowSensitiveActions ? ', sensitive actions allowed' : ''})`,
    );
    this.eventLog.record({ tabId: null, direction: 'system', type: 'remoteControlStarted', data: { port: server.port, reason } });
  }

  private async stopServer(reason: string): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const waiter of this.rawWaiters) {
      waiter.resolve(null);
    }
    this.rawWaiters.clear();
    if (server) {
      await server.stop();
      this.log(`[RemoteControl] Server stopped (${reason})`);
    }
  }

  dispose(): void {
    this.disposed = true;
    remoteControlTap.setListener(null);
    removeInstance(this.instanceId);
    void this.stopServer('window closing');
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
      mode: settings.mode,
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
      mode: settings.mode,
      accessLevel: settings.accessLevel,
      allowSensitiveActions: settings.allowSensitiveActions,
      endpoint: this.server ? `http://127.0.0.1:${this.server.port}` : null,
    };
  }

  /** This window's discovery record, written in every mode (serving or not). */
  private writeInstanceRecord(log = true): void {
    if (this.disposed) {
      return;
    }
    const settings = this.readSettings();
    const info: InstanceInfo = {
      instanceId: this.instanceId,
      pid: process.pid,
      port: this.server?.port ?? 0,
      host: '127.0.0.1',
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      workspaceName: vscode.workspace.name ?? '(no folder)',
      extensionVersion: this.extensionVersion(),
      accessLevel: settings.accessLevel,
      mode: settings.mode,
      serving: !!this.server,
      startedAt: this.startedAt,
      heartbeatAt: new Date().toISOString(),
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
      `ClaUi Remote Control is serving local clients\nhttp://127.0.0.1:${this.server.port}  (instance ${this.instanceId})\n` +
      `Mode: ${settings.mode}  Access: ${settings.accessLevel}${settings.allowSensitiveActions ? ' + sensitive actions' : ''}\n` +
      'Click for setup options';
    this.statusBarItem.show();
  }

  // -------------------------------------------------------------------------
  // On-demand start (mode 'auto'): clients drop a request file for this window
  // -------------------------------------------------------------------------

  private watchStartRequests(): void {
    try {
      fs.mkdirSync(REQUESTS_DIR, { recursive: true, mode: 0o700 });
    } catch {
      /* the poll below still works once the directory exists */
    }
    try {
      const watcher = fs.watch(REQUESTS_DIR, () => this.checkStartRequests());
      watcher.on('error', () => undefined);
      this.disposables.push({ dispose: () => watcher.close() });
    } catch {
      /* fs.watch unsupported here: rely on polling */
    }
    const poll = setInterval(() => this.checkStartRequests(), REQUEST_POLL_MS);
    this.disposables.push({ dispose: () => clearInterval(poll) });
    this.checkStartRequests();
  }

  private checkStartRequests(): void {
    if (this.disposed) {
      return;
    }
    let requests: Array<{ client: string }> = [];
    try {
      requests = takeStartRequests(this.instanceId);
    } catch {
      return;
    }
    if (requests.length === 0 || this.server) {
      return;
    }
    if (this.readSettings().mode === 'off') {
      this.log(`[RemoteControl] Ignored a start request from ${requests[0].client}: mode is off`);
      return;
    }
    void this.ensureServing(`started on demand by ${requests[0].client}`);
  }

  // -------------------------------------------------------------------------
  // Zero-setup availability: runtime install + VS Code MCP registration
  // -------------------------------------------------------------------------

  private nodeCommand(): NodeCommand {
    if (!this.nodeCommandCache) {
      // Absolute node on PATH, else VS Code's own Electron binary running as Node.
      this.nodeCommandCache = resolveNodeCommand({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
    }
    return this.nodeCommandCache;
  }

  /** Install launchers + clients into ~/.claui/remote-control/bin and refresh connection.json / CONNECT.md. */
  private prepareRuntime(): void {
    if (this.disposed) {
      return;
    }
    const version = this.extensionVersion();
    try {
      const result = installRuntime(path.join(this.context.extensionPath, 'dist', 'remote-control-runtime'), version);
      // An older ClaUi window (e.g. VS Code Insiders on an older build) never rewrites the manifest of a newer runtime.
      if (result.becameCurrent) {
        writeConnectionFiles(buildConnectionInfo(this.nodeCommand(), version));
      }
      this.log(`[RemoteControl] Runtime ${version} ready (${result.becameCurrent ? 'current' : 'a newer version is current'}); guide: ${CONNECT_DOC}`);
    } catch (err) {
      this.log(`[RemoteControl] Runtime install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Register the stdio server with VS Code's MCP registry (VS Code 1.101+), so
   * agents running inside VS Code get the ClaUi tools with no configuration.
   * The server is pinned to this window (CLAUI_INSTANCE) and started on demand.
   */
  private registerVsCodeMcpProvider(): void {
    const api = vscode as unknown as {
      lm?: { registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable };
      McpStdioServerDefinition?: new (
        label: string,
        command: string,
        args?: string[],
        env?: Record<string, string | number | null>,
        version?: string,
      ) => unknown;
    };
    const register = api.lm?.registerMcpServerDefinitionProvider;
    const Definition = api.McpStdioServerDefinition;
    if (typeof register !== 'function' || typeof Definition !== 'function') {
      this.log('[RemoteControl] VS Code MCP server registration not available in this VS Code version');
      return;
    }
    const script = path.join(this.context.extensionPath, 'dist', 'remote-control-runtime', 'mcp-server.js');
    try {
      this.disposables.push(
        register.call(api.lm, VSCODE_MCP_PROVIDER_ID, {
          onDidChangeMcpServerDefinitions: this.mcpDefinitionsChanged.event,
          provideMcpServerDefinitions: () =>
            this.readSettings().mode === 'off'
              ? []
              : [
                  new Definition(
                    'ClaUi',
                    process.execPath,
                    [script],
                    { ELECTRON_RUN_AS_NODE: '1', CLAUI_INSTANCE: this.instanceId },
                    this.extensionVersion(),
                  ),
                ],
        }),
      );
      this.log('[RemoteControl] Registered the ClaUi MCP server with VS Code');
    } catch (err) {
      this.log(`[RemoteControl] VS Code MCP registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
  // Setup UI (palette commands + status bar menu)
  // -------------------------------------------------------------------------

  private async registerWithClaudeCode(): Promise<void> {
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude') || 'claude';
    const service = new McpCliService(() => cliPath, (m) => this.log(`[RemoteControl][mcp-cli] ${m}`));
    const entry = stdioServerEntry(this.nodeCommand());
    try {
      try {
        await service.removeServer(MCP_SERVER_NAME, 'user');
      } catch {
        /* not registered yet */
      }
      await service.addServer(
        MCP_SERVER_NAME,
        { transport: 'stdio', command: entry.command, args: entry.args, env: entry.env, raw: { type: 'stdio', ...entry } },
        'user',
      );
      void vscode.window.showInformationMessage(
        `Registered "${MCP_SERVER_NAME}" with Claude Code (user scope). New Claude Code sessions - including ones inside ClaUi - can now control ClaUi.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const pick = await vscode.window.showErrorMessage(`Could not register with Claude Code: ${message}`, 'Copy command instead');
      if (pick) {
        await vscode.env.clipboard.writeText(clientConfigs(this.nodeCommand())['claude-code'].config);
      }
    }
  }

  private async openQuickGuide(): Promise<void> {
    if (!fs.existsSync(CONNECT_DOC)) {
      this.prepareRuntime();
    }
    await vscode.window.showTextDocument(vscode.Uri.file(CONNECT_DOC), { preview: false });
  }

  private async showSetup(): Promise<void> {
    const settings = this.readSettings();
    type Item = vscode.QuickPickItem & { run: () => Thenable<void> | void };
    const cfg = vscode.workspace.getConfiguration('claudeMirror.remoteControl');
    const configs = clientConfigs(this.nodeCommand());
    const copy = async (text: string, what: string): Promise<void> => {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(`Copied ${what} to the clipboard.`);
    };
    const modeLabel: Record<RemoteControlMode, string> = {
      auto: 'Auto - starts when a local tool connects (default)',
      on: 'Always on',
      off: 'Off',
    };
    const items: Item[] = [
      {
        label: `$(settings) Mode: ${modeLabel[settings.mode]}`,
        description: 'change',
        run: async () => {
          const pick = await vscode.window.showQuickPick(
            (['auto', 'on', 'off'] as RemoteControlMode[]).map((m) => ({ label: modeLabel[m], mode: m, picked: m === settings.mode })),
            { placeHolder: 'When should this window serve remote clients?' },
          );
          if (pick) await cfg.update('mode', pick.mode, vscode.ConfigurationTarget.Global);
        },
      },
      ...(!this.server && settings.mode !== 'off'
        ? [{ label: '$(play) Start serving now', description: 'otherwise it starts on the first client request', run: () => this.ensureServing('started from the setup menu').then(() => undefined) }]
        : []),
      { label: '$(add) Register with Claude Code', description: 'claude mcp add (user scope)', run: () => this.registerWithClaudeCode() },
      { label: '$(copy) Copy Claude Code command', run: () => copy(configs['claude-code'].config, 'the Claude Code command') },
      { label: '$(json) Copy MCP config (Claude Desktop / Cursor / Windsurf / agents)', run: () => copy(configs.generic.config, 'the MCP config') },
      { label: '$(json) Copy Codex CLI config (config.toml)', run: () => copy(configs.codex.config, 'the Codex config') },
      {
        label: '$(globe) Copy HTTP endpoint and token (scripts)',
        description: this.server ? `http://127.0.0.1:${this.server.port}` : 'starts the server',
        run: async () => {
          if (!(await this.ensureServing('started from the setup menu'))) {
            void vscode.window.showWarningMessage('Remote Control is off (claudeMirror.remoteControl.mode).');
            return;
          }
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
      { label: '$(book) Open connection guide', description: CONNECT_DOC, run: () => this.openQuickGuide() },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: this.server
        ? `ClaUi Remote Control: serving on http://127.0.0.1:${this.server.port} (${settings.mode}, ${settings.accessLevel})`
        : `ClaUi Remote Control: ${settings.mode === 'off' ? 'off' : 'ready - starts when a local tool connects'}`,
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
        await cfg().update('mode', 'on', vscode.ConfigurationTarget.Global);
        await this.ensureServing('enabled by command');
        const pick = await vscode.window.showInformationMessage(
          this.server ? `ClaUi Remote Control is on (http://127.0.0.1:${this.server.port}).` : 'ClaUi Remote Control is turning on.',
          'Register with Claude Code',
          'Connection guide',
        );
        if (pick === 'Register with Claude Code') await this.registerWithClaudeCode();
        if (pick === 'Connection guide') await this.openQuickGuide();
      }),
      vscode.commands.registerCommand('claudeMirror.remoteControl.disable', () =>
        cfg().update('mode', 'off', vscode.ConfigurationTarget.Global),
      ),
      vscode.commands.registerCommand('claudeMirror.remoteControl.registerWithClaudeCode', () => this.registerWithClaudeCode()),
      vscode.commands.registerCommand('claudeMirror.remoteControl.copyMcpConfig', async () => {
        await vscode.env.clipboard.writeText(clientConfigs(this.nodeCommand()).generic.config);
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
