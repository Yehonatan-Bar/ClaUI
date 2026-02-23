import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { CodexExecDemux } from '../process/CodexExecDemux';
import { CodexMessageHandler, type CodexSessionController } from '../webview/CodexMessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import { CodexConversationReader } from './CodexConversationReader';
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
  SerializedChatMessage,
  SessionSummary,
  WebviewToExtensionMessage,
} from '../types/webview-messages';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';

/**
 * Codex runtime tab (Stage 2 MVP): logical session per tab, one `codex exec` process per turn.
 */
export class CodexSessionTab implements WebviewBridge, CodexSessionController {
  readonly id: string;
  readonly tabNumber: number;

  private readonly processManager: CodexExecProcessManager;
  private readonly demux: CodexExecDemux;
  private readonly messageHandler: CodexMessageHandler;
  private readonly panel: vscode.WebviewPanel;

  private messageCallback: ((msg: WebviewToExtensionMessage) => void) | null = null;
  private isWebviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private disposed = false;
  private baseTitle = '';
  private isBusy = false;
  private thinkingAnimTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingFrame = 0;
  private static readonly THINKING_FRAMES = ['|', '/', '-', '\\'];
  private readonly fileLogger: FileLogger | null = null;
  private sessionActive = false;
  private threadId: string | null = null;
  private currentModel = '';
  private sessionCwd: string | undefined;
  private sessionStartedAt = '';
  private analyticsSaved = false;
  private firstPrompt = '';
  private turnAuthFailureDetected = false;
  private turnFailureText: string[] = [];
  private codexLoginLaunchInProgress = false;

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

    this.processManager = new CodexExecProcessManager(context);
    this.demux = new CodexExecDemux();
    this.messageHandler = new CodexMessageHandler(
      this.id,
      this,
      this,
      this.demux,
      this.promptHistoryStore,
      this.achievementService,
      this.projectAnalyticsStore
    );

    if (logDir) {
      this.fileLogger = new FileLogger(logDir, `codex-session-${tabNumber}`);
    }

    const tabLog = (msg: string) => {
      const prefixed = `[Codex Tab ${tabNumber}] ${msg}`;
      log(prefixed);
      if (this.fileLogger) {
        const timestamp = new Date().toISOString().slice(11, 23);
        this.fileLogger.write(`[${timestamp}] ${prefixed}`);
      }
    };
    this.processManager.setLogger(tabLog);
    this.messageHandler.setLogger(tabLog);

    this.baseTitle = `Codex ${tabNumber}`;
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
    this.wireProcessEvents(tabLog);
    this.wireDemuxStatusBar();
    this.wireDemuxSessionState(tabLog);
    this.messageHandler.initialize();
    this.moveTabToEnd();
  }

  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this.disposed) {
      return;
    }
    if (msg.type === 'processBusy') {
      this.setBusy(msg.busy);
    }
    if (!this.isWebviewReady) {
      this.pendingMessages.push(msg);
      return;
    }
    try {
      void this.panel.webview.postMessage(msg);
    } catch {
      this.disposed = true;
    }
  }

  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
  }

  setSuppressNextExit(_suppress: boolean): void {
    // No persistent process in Codex path; no-op.
  }

  saveProjectAnalyticsNow(): void {
    this.saveProjectAnalytics();
  }

  async switchModel(model: string): Promise<void> {
    this.currentModel = model;
    await vscode.workspace.getConfiguration('claudeMirror').update('codex.model', model, true);
  }

  async startSession(options?: { resume?: string; fork?: boolean; cwd?: string }): Promise<void> {
    if (options?.fork) {
      this.postMessage({ type: 'error', message: 'Fork is not supported in Codex MVP yet.' });
      return;
    }

    this.sessionCwd =
      options?.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      this.sessionCwd;
    this.sessionActive = true;
    this.threadId = options?.resume || null;
    this.currentModel = this.getCurrentModel();
    this.sessionStartedAt = this.sessionStartedAt || new Date().toISOString();
    this.analyticsSaved = false;
    this.achievementService.onSessionStart(this.id);

    if (options?.resume) {
      this.restoreSessionName(options.resume);
      this.loadAndSendConversationHistory(options.resume);
      this.persistSessionMetadata();
    }

    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.threadId || 'pending',
      model: this.currentModel || 'codex',
      isResume: !!options?.resume,
      provider: 'codex',
    });
  }

  async clearSession(options?: { cwd?: string }): Promise<void> {
    this.saveProjectAnalytics();
    if (this.processManager.isTurnRunning) {
      this.processManager.cancelTurn();
    }
    this.threadId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    this.sessionActive = false;
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
    await this.startSession({ cwd: options?.cwd });
  }

  stopSession(): void {
    this.saveProjectAnalytics();
    if (this.processManager.isTurnRunning) {
      this.processManager.cancelTurn();
    }
    this.achievementService.onSessionEnd(this.id);
    this.sessionActive = false;
    this.threadId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    this.postMessage({ type: 'processBusy', busy: false });
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
  }

  async sendText(text: string): Promise<void> {
    if (!this.sessionActive) {
      await this.startSession();
    }
    if (this.processManager.isTurnRunning) {
      throw new Error('A Codex turn is already running');
    }

    if (!this.firstPrompt) {
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim();
      if (firstLine) {
        this.firstPrompt = firstLine;
      }
    }

    this.currentModel = this.getCurrentModel();
    this.resetTurnFailureCapture();
    await this.processManager.runTurn({
      prompt: text,
      threadId: this.threadId || undefined,
      cwd: this.sessionCwd,
      model: this.currentModel || undefined,
    });
  }

  cancelRequest(): void {
    this.postMessage({ type: 'processBusy', busy: false });
    this.processManager.cancelTurn();
  }

  compact(_instructions?: string): void {
    this.postMessage({ type: 'error', message: 'Compact is not supported in Codex MVP yet.' });
  }

  reveal(): void {
    if (this.disposed) return;
    try {
      this.panel.reveal();
    } catch {
      this.disposed = true;
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get viewColumn(): vscode.ViewColumn | undefined {
    return this.disposed ? undefined : this.panel.viewColumn;
  }

  get isRunning(): boolean {
    return this.sessionActive;
  }

  get sessionId(): string | null {
    return this.threadId;
  }

  get isVisible(): boolean {
    return this.disposed ? false : this.panel.visible;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopThinkingAnimation();
    this.saveProjectAnalytics();
    this.processManager.stop();
    this.achievementService.onSessionEnd(this.id);
    this.achievementService.unregisterTab(this.id);
    this.skillGenService?.unregisterTab(this.id);
    this.fileLogger?.dispose();
    this.panel.dispose();
  }

  setForkInit(_init: { promptText: string; messages: SerializedChatMessage[] }): void {
    this.postMessage({ type: 'error', message: 'Fork is not supported in Codex MVP yet.' });
  }

  private restoreSessionName(sessionId: string): boolean {
    const existing = this.sessionStore.getSession(sessionId);
    if (!existing) {
      return false;
    }

    if (existing.firstPrompt) {
      this.firstPrompt = existing.firstPrompt;
    }
    if (existing.startedAt) {
      this.sessionStartedAt = existing.startedAt;
    }
    if (existing.model) {
      this.currentModel = existing.model;
    }

    if (existing.name && !existing.name.startsWith('Session ')) {
      this.log(`[Codex Tab ${this.tabNumber}] Restoring session name: "${existing.name}"`);
      this.setTabName(existing.name);
      return true;
    }

    return false;
  }

  private loadAndSendConversationHistory(sessionId: string): void {
    const reader = new CodexConversationReader((msg) => this.log(`[Codex Tab ${this.tabNumber}] ${msg}`));
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this.sessionCwd;
    const messages = reader.readSession(sessionId, workspacePath);

    if (messages.length > 0) {
      this.log(`[Codex Tab ${this.tabNumber}] Loaded ${messages.length} history messages for resumed session`);
      this.postMessage({
        type: 'conversationHistory',
        messages,
      });
    } else {
      this.log(`[Codex Tab ${this.tabNumber}] No history messages found for session ${sessionId}`);
    }
  }

  private persistSessionMetadata(name?: string): void {
    if (!this.threadId) {
      return;
    }

    const existing = this.sessionStore.getSession(this.threadId);
    void this.sessionStore.saveSession({
      sessionId: this.threadId,
      name: name || existing?.name || this.baseTitle || `Codex ${this.tabNumber}`,
      model: this.currentModel || existing?.model || 'codex',
      provider: 'codex',
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
    });
  }

  /** Build and persist a SessionSummary from accumulated Codex turn records */
  private saveProjectAnalytics(): void {
    if (this.analyticsSaved) {
      this.log(`[Codex Tab ${this.tabNumber}] [ProjectAnalytics] Already saved for this session, skipping`);
      return;
    }

    const turnRecords = this.messageHandler.flushTurnRecords();
    if (turnRecords.length === 0) {
      this.log(`[Codex Tab ${this.tabNumber}] [ProjectAnalytics] No turns to save`);
      return;
    }
    this.analyticsSaved = true;

    const sessionId = this.threadId || this.id;
    const now = new Date().toISOString();

    let totalCostUsd = 0;
    let totalErrors = 0;
    let totalToolUses = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalBashCommands = 0;
    let totalDurationMs = 0;
    const toolFrequency: Record<string, number> = {};
    const categoryDistribution: Record<string, number> = {};
    const taskTypeDistribution: Record<string, number> = {};

    for (const turn of turnRecords) {
      totalCostUsd += turn.costUsd ?? 0;
      if (turn.isError) totalErrors++;
      totalToolUses += turn.toolCount ?? 0;
      totalInputTokens += turn.inputTokens ?? 0;
      totalOutputTokens += turn.outputTokens ?? 0;
      totalCacheCreationTokens += turn.cacheCreationTokens ?? 0;
      totalCacheReadTokens += turn.cacheReadTokens ?? 0;
      totalBashCommands += turn.bashCommands?.length ?? 0;
      totalDurationMs += turn.durationMs ?? 0;

      for (const name of turn.toolNames) {
        const base = name.includes('__') ? name.split('__').pop()! : name;
        toolFrequency[base] = (toolFrequency[base] ?? 0) + 1;
      }

      categoryDistribution[turn.category] = (categoryDistribution[turn.category] ?? 0) + 1;

      if (turn.semantics?.taskType) {
        const tt = turn.semantics.taskType;
        taskTypeDistribution[tt] = (taskTypeDistribution[tt] ?? 0) + 1;
      }
    }

    const totalTurns = turnRecords.length;
    const summary: SessionSummary = {
      sessionId,
      provider: 'codex',
      sessionName: this.baseTitle || `Codex ${this.tabNumber}`,
      model: this.currentModel || this.getCurrentModel() || 'codex',
      startedAt: this.sessionStartedAt || now,
      endedAt: now,
      durationMs: totalDurationMs,
      totalCostUsd,
      totalTurns,
      totalErrors,
      totalToolUses,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      totalBashCommands,
      toolFrequency,
      categoryDistribution,
      taskTypeDistribution,
      avgCostPerTurn: totalTurns > 0 ? totalCostUsd / totalTurns : 0,
      avgDurationMs: totalTurns > 0 ? totalDurationMs / totalTurns : 0,
      errorRate: totalTurns > 0 ? (totalErrors / totalTurns) * 100 : 0,
    };

    this.log(
      `[Codex Tab ${this.tabNumber}] [ProjectAnalytics] Saving summary: session=${sessionId} turns=${totalTurns} cost=$${totalCostUsd.toFixed(4)}`
    );
    void this.projectAnalyticsStore.saveSummary(summary);
  }

  updateTitle(sessionId: string): void {
    const shortId = sessionId.slice(0, 8);
    this.setTabName(`Codex ${this.tabNumber} [${shortId}]`);
  }

  isSessionActive(): boolean {
    return this.sessionActive;
  }

  getSessionId(): string | null {
    return this.threadId;
  }

  getCurrentModel(): string {
    if (this.currentModel) {
      return this.currentModel;
    }
    const configured = vscode.workspace.getConfiguration('claudeMirror').get<string>('codex.model', '');
    return configured || '';
  }

  private wireWebviewEvents(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.panel.webview.onDidReceiveMessage((message: any) => {
      if (message.type === 'diag') {
        this.log(`[Codex Tab ${this.tabNumber}] Webview DIAG: phase="${message.phase}" ${message.detail || ''}`);
        return;
      }
      if (message.type === 'renameTab') {
        void this.handleRenameRequest();
        return;
      }
      if (message.type === 'ready') {
        this.isWebviewReady = true;
        this.flushPendingMessages();
      }
      this.messageCallback?.(message as WebviewToExtensionMessage);
    });

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.callbacks.onFocused(this.id);
      }
    });

    this.panel.onDidDispose(() => {
      this.disposed = true;
      try {
        this.stopThinkingAnimation();
        this.saveProjectAnalytics();
        this.processManager.stop();
        this.achievementService.onSessionEnd(this.id);
        this.achievementService.unregisterTab(this.id);
        this.skillGenService?.unregisterTab(this.id);
        this.fileLogger?.dispose();
      } finally {
        this.callbacks.onClosed(this.id);
      }
    });
  }

  private wireProcessEvents(tabLog: (msg: string) => void): void {
    this.processManager.on('event', (event: CodexExecJsonEvent) => {
      tabLog(`Codex JSON: ${event.type}`);
      this.demux.handleEvent(event);
    });

    this.processManager.on('raw', (text: string) => {
      tabLog(`Codex raw: ${text}`);
      this.captureTurnFailureText(text);
      this.maybeMarkTurnAuthFailure(text, tabLog);
    });

    this.processManager.on('stderr', (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      tabLog(`Codex STDERR: ${trimmed}`);
      this.captureTurnFailureText(trimmed);
      // Codex often emits non-fatal warnings on stderr (e.g. shell snapshot support).
      if (/WARN\s+codex_core::shell_snapshot/i.test(trimmed)) {
        return;
      }
      if (this.isLikelyCodexAuthFailure(trimmed)) {
        this.maybeMarkTurnAuthFailure(trimmed, tabLog);
        return;
      }
      this.maybeMarkTurnAuthFailure(trimmed, tabLog);
      this.postMessage({ type: 'error', message: trimmed });
    });

    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      tabLog(`Codex turn process exited: code=${info.code}, signal=${info.signal}`);
      if (this.processManager.cancelledByUser) {
        tabLog('Codex turn cancelled by user');
        this.postMessage({ type: 'processBusy', busy: false });
        this.resetTurnFailureCapture();
        return;
      }
      if (info.code !== 0 && info.code !== null) {
        this.achievementService.onRuntimeError(this.id);
        this.postMessage({ type: 'processBusy', busy: false });
        if (!this.turnAuthFailureDetected && this.isLikelyCodexAuthFailure(this.turnFailureText.join('\n'))) {
          this.turnAuthFailureDetected = true;
        }
        if (this.turnAuthFailureDetected) {
          tabLog('Codex auth failure detected; triggering login redirect flow');
          void this.launchCodexLoginFlow();
          this.postMessage({
            type: 'error',
            message: 'Codex is not signed in. Opened a terminal to run "codex login". Complete login and retry.',
          });
          this.resetTurnFailureCapture();
          return;
        }
        this.postMessage({
          type: 'error',
          message: `Codex process exited with code ${info.code}. Check output logs for details.`,
        });
      }
      this.resetTurnFailureCapture();
    });

    this.processManager.on('error', (err: Error) => {
      tabLog(`Codex process error: ${err.message}`);
      this.captureTurnFailureText(err.message);
      this.maybeMarkTurnAuthFailure(err.message, tabLog);
      this.achievementService.onRuntimeError(this.id);
      this.postMessage({ type: 'processBusy', busy: false });
      if (this.turnAuthFailureDetected) {
        void this.launchCodexLoginFlow();
        this.postMessage({
          type: 'error',
          message: 'Codex is not signed in. Opened a terminal to run "codex login". Complete login and retry.',
        });
      } else {
        this.postMessage({ type: 'error', message: `Codex process error: ${err.message}` });
      }
      this.resetTurnFailureCapture();
    });
  }

  private resetTurnFailureCapture(): void {
    this.turnAuthFailureDetected = false;
    this.turnFailureText = [];
  }

  private captureTurnFailureText(text: string): void {
    const trimmed = text?.trim();
    if (!trimmed) {
      return;
    }
    if (this.turnFailureText.length >= 20) {
      this.turnFailureText.shift();
    }
    this.turnFailureText.push(trimmed);
  }

  private maybeMarkTurnAuthFailure(text: string, log: (msg: string) => void): void {
    if (this.turnAuthFailureDetected) {
      return;
    }
    if (!this.isLikelyCodexAuthFailure(text)) {
      return;
    }
    this.turnAuthFailureDetected = true;
    log(`Detected Codex authentication/login failure: ${text.trim()}`);
  }

  private isLikelyCodexAuthFailure(text: string): boolean {
    const normalized = text.toLowerCase();
    const authPatterns = [
      /no auth credentials found/i,
      /\b401\b.*unauthorized/i,
      /unauthorized.*no auth/i,
      /please .*codex login/i,
      /run .*codex login/i,
      /error logging in/i,
      /token exchange failed/i,
      /oauth\/token/i,
      /not logged in/i,
    ];
    return authPatterns.some((pattern) => pattern.test(normalized));
  }

  private async launchCodexLoginFlow(): Promise<void> {
    if (this.codexLoginLaunchInProgress) {
      return;
    }
    this.codexLoginLaunchInProgress = true;
    try {
      const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('codex.cliPath', 'codex') || 'codex';
      const terminal = vscode.window.createTerminal({ name: 'Codex Login' });
      terminal.show();
      terminal.sendText(`${this.quoteTerminalArg(cliPath)} login`, true);
      void vscode.window.showWarningMessage(
        'Codex is not signed in. A terminal was opened to run "codex login". Complete the login flow, then resend your message.'
      );
    } finally {
      setTimeout(() => {
        this.codexLoginLaunchInProgress = false;
      }, 1500);
    }
  }

  private quoteTerminalArg(value: string): string {
    if (!value || !/[\s"]/u.test(value)) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private wireDemuxStatusBar(): void {
    this.demux.on('turnStarted', () => {
      if (this.disposed) return;
      try {
        if (this.panel.active) {
          this.statusBarItem.text = `$(loading~spin) Codex thinking... (Tab ${this.tabNumber})`;
          this.statusBarItem.show();
        }
      } catch {
        // ignore panel race
      }
    });

    this.demux.on('turnCompleted', () => {
      if (this.disposed) return;
      try {
        if (this.panel.active) {
          this.statusBarItem.hide();
        }
      } catch {
        // ignore panel race
      }
    });
  }

  private wireDemuxSessionState(tabLog: (msg: string) => void): void {
    this.demux.on('threadStarted', (data: { threadId: string }) => {
      this.threadId = data.threadId;
      this.sessionActive = true;
      this.sessionStartedAt = this.sessionStartedAt || new Date().toISOString();
      this.analyticsSaved = false;
      tabLog(`Codex thread id set: ${data.threadId}`);
      const restored = this.restoreSessionName(data.threadId);
      if (!restored) {
        this.updateTitle(data.threadId);
      }
      this.persistSessionMetadata();
    });

    this.demux.on('turnCompleted', () => {
      this.persistSessionMetadata();
    });
  }

  private setTabName(name: string): void {
    this.baseTitle = name;
    if (this.disposed) return;
    if (this.isBusy) {
      this.applyThinkingFrame();
    } else {
      this.panel.title = name;
    }
  }

  setBusy(busy: boolean): void {
    if (this.isBusy === busy) {
      return;
    }
    this.isBusy = busy;
    if (busy) {
      this.startThinkingAnimation();
    } else {
      this.stopThinkingAnimation();
    }
  }

  private startThinkingAnimation(): void {
    this.stopThinkingAnimation();
    this.thinkingFrame = 0;
    this.applyThinkingFrame();
    this.thinkingAnimTimer = setInterval(() => {
      this.thinkingFrame = (this.thinkingFrame + 1) % CodexSessionTab.THINKING_FRAMES.length;
      this.applyThinkingFrame();
    }, 120);
  }

  private stopThinkingAnimation(): void {
    if (this.thinkingAnimTimer) {
      clearInterval(this.thinkingAnimTimer);
      this.thinkingAnimTimer = null;
    }
    if (this.baseTitle && !this.disposed) {
      this.panel.title = this.baseTitle;
    }
  }

  private applyThinkingFrame(): void {
    if (!this.baseTitle || this.disposed) {
      return;
    }
    const frame = CodexSessionTab.THINKING_FRAMES[this.thinkingFrame];
    this.panel.title = `${this.baseTitle} ${frame}`;
  }

  private moveTabToEnd(): void {
    void vscode.commands.executeCommand('moveActiveEditor', {
      by: 'tab',
      to: 'last',
    });
  }

  private setTabIcon(color: string): void {
    try {
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`;
      const storageDir = this.context.globalStorageUri.fsPath;
      fs.mkdirSync(storageDir, { recursive: true });
      const iconPath = path.join(storageDir, `codex-tab-icon-${this.tabNumber}.svg`);
      fs.writeFileSync(iconPath, svgContent, 'utf-8');
      this.panel.iconPath = vscode.Uri.file(iconPath);
    } catch {
      // non-critical
    }
  }

  private async handleRenameRequest(): Promise<void> {
    if (this.disposed) return;
    const currentName = this.baseTitle || `Codex ${this.tabNumber}`;
    const newName = await vscode.window.showInputBox({
      prompt: 'Rename this tab',
      value: currentName,
      placeHolder: 'Tab name...',
    });
    if (newName && newName !== currentName && !this.disposed) {
      this.setTabName(newName);
      this.fileLogger?.updateSessionName(newName);
    }
  }

  private flushPendingMessages(): void {
    if (this.disposed || this.pendingMessages.length === 0) {
      return;
    }
    const queued = this.pendingMessages;
    this.pendingMessages = [];
    try {
      for (const message of queued) {
        void this.panel.webview.postMessage(message);
      }
    } catch {
      this.disposed = true;
    }
  }
}
