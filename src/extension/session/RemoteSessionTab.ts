/**
 * Remote session tab (Happy Coder relay).
 * Third tab type following the same patterns as CodexSessionTab.
 * Bundles HappyClient, HappyCrypto, RemoteDemux, and RemoteMessageHandler.
 */

import * as vscode from 'vscode';
import { HappyClient } from '../remote/HappyClient';
import { HappyCrypto } from '../remote/HappyCrypto';
import { RemoteDemux } from '../remote/RemoteDemux';
import { RemoteMessageHandler, type RemoteSessionController } from '../webview/RemoteMessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import { MessageTranslator } from './MessageTranslator';
import { FileLogger } from './FileLogger';
import type { WebviewBridge } from '../webview/MessageHandler';
import type { SessionTabCallbacks } from './SessionTab';
import type { SessionStore } from './SessionStore';
import type { ProjectAnalyticsStore } from './ProjectAnalyticsStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import type { AchievementService } from '../achievements/AchievementService';
import type { SkillGenService } from '../skillgen/SkillGenService';
import type {
  ExtensionToWebviewMessage,
  SessionSummary,
  WebviewToExtensionMessage,
} from '../types/webview-messages';
import type { HappyEnvelope, HappyConnectionState } from '../remote/HappyTypes';

export class RemoteSessionTab implements WebviewBridge, RemoteSessionController {
  readonly id: string;
  readonly tabNumber: number;

  private client: HappyClient | null = null;
  private readonly cryptoModule: HappyCrypto;
  private readonly demux: RemoteDemux;
  private readonly messageHandler: RemoteMessageHandler;
  private readonly panel: vscode.WebviewPanel;
  private fileLogger: FileLogger | null = null;

  private isWebviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private messageCallback: ((msg: WebviewToExtensionMessage) => void) | null = null;
  private webviewPostQueue: Promise<void> = Promise.resolve();

  private sessionActive = false;
  private remoteSessionId: string | null = null;
  private currentModel_ = '';
  private firstPrompt = '';
  private sessionStartedAt = '';
  private sessionCwd = '';
  private baseTitle: string;
  private disposed = false;
  private analyticsSaved = false;

  private thinkingTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingFrameIndex = 0;
  private static readonly THINKING_FRAMES = ['$(loading~spin)', '$(loading~spin)'];

  constructor(
    private readonly context: vscode.ExtensionContext,
    tabNumber: number,
    viewColumn: vscode.ViewColumn,
    tabColor: string,
    private readonly log: (msg: string) => void,
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly callbacks: SessionTabCallbacks,
    private readonly sessionStore: SessionStore,
    private readonly projectAnalyticsStore: ProjectAnalyticsStore,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService,
    logDir: string | null,
    private readonly skillGenService?: SkillGenService
  ) {
    this.tabNumber = tabNumber;
    this.id = `tab-${tabNumber}`;

    this.cryptoModule = new HappyCrypto(context.secrets);
    this.demux = new RemoteDemux();
    this.messageHandler = new RemoteMessageHandler(
      this.id,
      this,
      this,
      this.demux,
      this.promptHistoryStore,
      this.achievementService,
      this.projectAnalyticsStore
    );
    this.messageHandler.setSecrets(context.secrets);
    this.messageHandler.setExtensionMeta(
      String((context.extension.packageJSON as { version?: unknown } | undefined)?.version ?? '0.0.0'),
      logDir || '',
    );

    if (logDir) {
      this.fileLogger = new FileLogger(logDir, `remote-session-${tabNumber}`);
    }

    const tabLog = (msg: string) => {
      const prefixed = `[Remote Tab ${tabNumber}] ${msg}`;
      log(prefixed);
      if (this.fileLogger) {
        const timestamp = new Date().toISOString().slice(11, 23);
        this.fileLogger.write(`[${timestamp}] ${prefixed}`);
      }
    };
    this.messageHandler.setLogger(tabLog);
    const messageTranslator = new MessageTranslator();
    messageTranslator.setLogger(tabLog);
    this.messageHandler.setMessageTranslator(messageTranslator);

    this.baseTitle = `Remote ${tabNumber}`;
    this.panel = vscode.window.createWebviewPanel(
      'claudeMirror.chat',
      this.baseTitle,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );

    this.setTabIcon(tabColor);
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context);
    this.achievementService.registerTab(this.id, (msg) => this.postMessage(msg));
    this.skillGenService?.registerTab(this.id, (msg) => this.postMessage(msg as ExtensionToWebviewMessage));

    this.wireWebviewEvents();
    this.wireConnectionEvents(tabLog);
    this.messageHandler.initialize();
    this.moveTabToEnd();
  }

  // -----------------------------------------------------------------------
  // WebviewBridge implementation
  // -----------------------------------------------------------------------

  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this.disposed) { return; }
    if (msg.type === 'processBusy') {
      this.setBusy(msg.busy);
    }
    if (!this.isWebviewReady) {
      this.pendingMessages.push(msg);
      return;
    }
    this.enqueueWebviewPost(msg);
  }

  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
  }

  setSuppressNextExit(_suppress: boolean): void { /* no-op for remote */ }

  saveProjectAnalyticsNow(): void { this.saveProjectAnalytics(); }

  // -----------------------------------------------------------------------
  // RemoteSessionController implementation
  // -----------------------------------------------------------------------

  async startSession(options?: { resume?: string; cwd?: string }): Promise<void> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      this.postMessage({
        type: 'error',
        message: 'No remote server URL configured. Set claudeMirror.remote.serverUrl in settings.',
      });
      return;
    }

    this.sessionCwd =
      options?.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      this.sessionCwd;
    this.sessionActive = true;
    this.analyticsSaved = false;
    this.currentModel_ = '';
    this.sessionStartedAt = new Date().toISOString();
    this.achievementService.onSessionStart(this.id);

    try {
      // Initialize crypto
      await this.cryptoModule.init();
      this.log(`[Remote Tab ${this.tabNumber}] Crypto initialized`);

      // Create Happy client and connect
      this.client = new HappyClient(serverUrl, this.cryptoModule, this.log);
      this.wireClientEvents();

      await this.client.authenticate();
      this.client.connect();

      if (options?.resume) {
        await this.client.joinSession(options.resume);
        this.remoteSessionId = options.resume;
      } else {
        const info = await this.client.createSession({
          name: this.baseTitle,
          cwd: this.sessionCwd,
        });
        this.remoteSessionId = info.sessionId;
        this.currentModel_ = info.model || '';
      }

      this.postMessage({
        type: 'sessionStarted',
        sessionId: this.remoteSessionId || 'pending',
        model: this.currentModel_ || 'remote',
        provider: 'remote',
      });

      this.persistSessionMetadata();
    } catch (err) {
      this.sessionActive = false;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log(`[Remote Tab ${this.tabNumber}] Start failed: ${errorMessage}`);
      this.postMessage({ type: 'error', message: `Remote connection failed: ${errorMessage}` });
      throw err;
    }
  }

  stopSession(): void {
    this.saveProjectAnalytics();
    this.achievementService.onSessionEnd(this.id);
    this.sessionActive = false;
    this.remoteSessionId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.demux.reset();
    this.postMessage({ type: 'processBusy', busy: false });
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
  }

  async clearSession(options?: { cwd?: string }): Promise<void> {
    this.saveProjectAnalytics();
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.remoteSessionId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    this.sessionActive = false;
    this.demux.reset();
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
    await this.startSession({ cwd: options?.cwd });
  }

  async sendText(text: string): Promise<void> {
    if (!this.sessionActive || !this.client) {
      throw new Error('No active remote session');
    }

    if (!this.firstPrompt) {
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim();
      if (firstLine) { this.firstPrompt = firstLine; }
    }

    const envelope: HappyEnvelope = {
      id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: Date.now(),
      role: 'user',
      turn: 0,
      ev: { type: 'text', text },
    };

    this.client.sendMessage(envelope);
  }

  async sendWithImages(_text: string, _images: Array<{ base64: string; mediaType: string }>): Promise<void> {
    // Images not supported in remote sessions yet
    this.postMessage({ type: 'error', message: 'Image sending is not yet supported for remote sessions.' });
  }

  cancelRequest(): void {
    this.postMessage({ type: 'processBusy', busy: false });
    // Send a cancel signal via the socket
    if (this.client && this.remoteSessionId) {
      const cancelEnvelope: HappyEnvelope = {
        id: `env-cancel-${Date.now()}`,
        time: Date.now(),
        role: 'system',
        turn: 0,
        ev: { type: 'stop', reason: 'user_cancelled' },
      };
      this.client.sendMessage(cancelEnvelope);
    }
  }

  isSessionActive(): boolean { return this.sessionActive; }
  getSessionId(): string | null { return this.remoteSessionId; }
  getCurrentModel(): string { return this.currentModel_ || 'remote'; }

  compact(_instructions?: string): void {
    this.postMessage({ type: 'error', message: 'Compact is not supported for remote sessions.' });
  }

  reveal(): void {
    if (this.disposed) { return; }
    try { this.panel.reveal(); } catch { this.disposed = true; }
  }

  get isDisposed(): boolean { return this.disposed; }

  get viewColumn(): vscode.ViewColumn | undefined {
    return this.disposed ? undefined : this.panel.viewColumn;
  }

  get isRunning(): boolean { return this.sessionActive; }

  get sessionId(): string | null { return this.remoteSessionId; }

  get isVisible(): boolean {
    return this.disposed ? false : this.panel.visible;
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.stopThinkingAnimation();
    this.saveProjectAnalytics();
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.cryptoModule.dispose();
    this.achievementService.onSessionEnd(this.id);
    this.achievementService.unregisterTab(this.id);
    this.skillGenService?.unregisterTab(this.id);
    this.fileLogger?.dispose();
    this.panel.dispose();
  }

  setForkInit(_init: { promptText: string; messages: unknown[] }): void {
    // Fork not supported for remote sessions
  }

  // -----------------------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------------------

  private wireWebviewEvents(): void {
    this.panel.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      if (msg.type === 'ready') {
        this.isWebviewReady = true;
        for (const pending of this.pendingMessages) {
          this.enqueueWebviewPost(pending);
        }
        this.pendingMessages = [];
      }

      this.messageCallback?.(msg);
    });

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.callbacks.onFocused(this.id);
      }
    });

    this.panel.onDidDispose(() => {
      this.disposed = true;
      this.callbacks.onClosed(this.id);
    });
  }

  private wireClientEvents(): void {
    if (!this.client) { return; }

    this.client.on('message', (envelope: HappyEnvelope) => {
      this.demux.handleEnvelope(envelope);
    });

    this.client.on('stateChange', (state: HappyConnectionState) => {
      this.log(`[Remote Tab ${this.tabNumber}] Connection state: ${state}`);
      if (state === 'connected') {
        this.postMessage({ type: 'processBusy', busy: false });
      }
    });

    this.client.on('connectionFailed', (reason: string) => {
      this.log(`[Remote Tab ${this.tabNumber}] Connection failed: ${reason}`);
      this.postMessage({ type: 'error', message: reason });
      this.postMessage({ type: 'processBusy', busy: false });
    });

    this.client.on('error', (err: Error) => {
      this.log(`[Remote Tab ${this.tabNumber}] Client error: ${err.message}`);
      this.postMessage({ type: 'error', message: err.message });
    });
  }

  private wireConnectionEvents(tabLog: (msg: string) => void): void {
    // Demux events that affect tab-level state
    this.demux.on('sessionStarted', (data: { sessionId: string; model: string }) => {
      this.remoteSessionId = data.sessionId;
      if (data.model) { this.currentModel_ = data.model; }
      this.persistSessionMetadata();
      tabLog(`Remote session confirmed: ${data.sessionId}`);
    });

    this.demux.on('sessionEnded', () => {
      this.sessionActive = false;
      this.postMessage({ type: 'sessionEnded', reason: 'completed' });
    });

    this.demux.on('turnStarted', () => {
      this.startThinkingAnimation();
    });

    this.demux.on('turnCompleted', () => {
      this.stopThinkingAnimation();
    });
  }

  // -----------------------------------------------------------------------
  // Status bar animation
  // -----------------------------------------------------------------------

  private setBusy(busy: boolean): void {
    if (busy) {
      this.startThinkingAnimation();
    } else {
      this.stopThinkingAnimation();
    }
  }

  private startThinkingAnimation(): void {
    if (this.thinkingTimer) { return; }
    this.thinkingFrameIndex = 0;
    this.statusBarItem.text = `${RemoteSessionTab.THINKING_FRAMES[0]} Remote thinking...`;
    this.statusBarItem.show();
    this.thinkingTimer = setInterval(() => {
      this.thinkingFrameIndex = (this.thinkingFrameIndex + 1) % RemoteSessionTab.THINKING_FRAMES.length;
      this.statusBarItem.text = `${RemoteSessionTab.THINKING_FRAMES[this.thinkingFrameIndex]} Remote thinking...`;
    }, 500);
  }

  private stopThinkingAnimation(): void {
    if (this.thinkingTimer) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    this.statusBarItem.hide();
  }

  // -----------------------------------------------------------------------
  // Tab icon & move
  // -----------------------------------------------------------------------

  private setTabIcon(tabColor: string): void {
    this.panel.iconPath = {
      light: vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${tabColor}"/></svg>`
      )}`),
      dark: vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${tabColor}"/></svg>`
      )}`),
    };
  }

  private moveTabToEnd(): void {
    try {
      void vscode.commands.executeCommand('moveActiveEditor', {
        to: 'last',
        by: 'tab',
      });
    } catch { /* best effort */ }
  }

  // -----------------------------------------------------------------------
  // Webview post queue
  // -----------------------------------------------------------------------

  private enqueueWebviewPost(msg: ExtensionToWebviewMessage): void {
    this.webviewPostQueue = this.webviewPostQueue
      .catch(() => undefined)
      .then(() => {
        if (!this.disposed) {
          try {
            this.panel.webview.postMessage(msg);
          } catch {
            /* panel may be disposed */
          }
        }
      });
  }

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  private getServerUrl(): string {
    return vscode.workspace.getConfiguration('claudeMirror').get<string>('remote.serverUrl', '');
  }

  // -----------------------------------------------------------------------
  // Analytics
  // -----------------------------------------------------------------------

  private persistSessionMetadata(): void {
    if (!this.remoteSessionId) { return; }
    const existing = this.sessionStore.getSession(this.remoteSessionId);
    void this.sessionStore.saveSession({
      sessionId: this.remoteSessionId,
      name: existing?.name || this.baseTitle,
      model: this.currentModel_ || existing?.model || 'remote',
      provider: 'remote',
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
      workspacePath: existing?.workspacePath || this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  }

  private saveProjectAnalytics(): void {
    if (this.analyticsSaved || !this.remoteSessionId) { return; }
    this.analyticsSaved = true;

    const turns = this.messageHandler.flushTurnRecords();
    if (turns.length === 0) { return; }

    const summary: SessionSummary = {
      sessionId: this.remoteSessionId,
      provider: 'remote',
      sessionName: this.baseTitle,
      model: this.currentModel_ || 'remote',
      startedAt: this.sessionStartedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: this.sessionStartedAt ? Date.now() - new Date(this.sessionStartedAt).getTime() : 0,
      totalCostUsd: turns.reduce((s, t) => s + t.costUsd, 0),
      totalTurns: turns.length,
      totalErrors: turns.filter(t => t.isError).length,
      totalToolUses: turns.reduce((s, t) => s + t.toolCount, 0),
      totalInputTokens: turns.reduce((s, t) => s + (t.inputTokens ?? 0), 0),
      totalOutputTokens: turns.reduce((s, t) => s + (t.outputTokens ?? 0), 0),
      totalCacheCreationTokens: turns.reduce((s, t) => s + (t.cacheCreationTokens ?? 0), 0),
      totalCacheReadTokens: turns.reduce((s, t) => s + (t.cacheReadTokens ?? 0), 0),
      totalBashCommands: turns.reduce((s, t) => s + (t.bashCommands?.length ?? 0), 0),
      toolFrequency: {},
      categoryDistribution: {},
      taskTypeDistribution: {},
      avgCostPerTurn: 0,
      avgDurationMs: 0,
      errorRate: 0,
    };

    // Aggregate frequencies
    for (const t of turns) {
      for (const tool of t.toolNames) {
        summary.toolFrequency[tool] = (summary.toolFrequency[tool] || 0) + 1;
      }
      summary.categoryDistribution[t.category] = (summary.categoryDistribution[t.category] || 0) + 1;
    }

    summary.avgCostPerTurn = summary.totalTurns > 0 ? summary.totalCostUsd / summary.totalTurns : 0;
    summary.avgDurationMs = summary.totalTurns > 0 ? summary.durationMs / summary.totalTurns : 0;
    summary.errorRate = summary.totalTurns > 0 ? summary.totalErrors / summary.totalTurns : 0;

    void this.projectAnalyticsStore.saveSummary(summary);
  }
}
