import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { CodexExecDemux } from '../process/CodexExecDemux';
import { findWorkingCodexCliCandidates, pickPreferredCodexCliCandidate } from '../process/CodexCliDetector';
import { CodexMessageHandler, type CodexSessionController } from '../webview/CodexMessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import { CodexConversationReader } from './CodexConversationReader';
import { CodexBackgroundSession } from './CodexBackgroundSession';
import { CodexSessionNamer } from './CodexSessionNamer';
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
  SerializedChatMessage,
  SessionSummary,
  WebviewImageData,
  WebviewToExtensionMessage,
} from '../types/webview-messages';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';
import type { HandoffProvider, HandoffSourceSnapshot } from './handoff/HandoffTypes';
import type { ContentBlock } from '../types/stream-json';

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
  private webviewPostDeliveryQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private baseTitle = '';
  private isBusy = false;
  private thinkingAnimTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingFrame = 0;
  private static readonly THINKING_FRAMES = ['|', '/', '-', '\\'];
  private static readonly TURN_COMPLETE_EXIT_WATCHDOG_MS = 10_000;
  private static readonly STEER_CANCEL_TIMEOUT_MS = 8_000;
  private turnCompletedExitWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fileLogger: FileLogger | null = null;
  private readonly sessionNamer: CodexSessionNamer;
  private sessionActive = false;
  private threadId: string | null = null;
  private currentModel = '';
  private sessionCwd: string | undefined;
  private sessionStartedAt = '';
  private analyticsSaved = false;
  private firstPrompt = '';
  private turnAuthFailureDetected = false;
  private turnCliMissingDetected = false;
  private turnStructuredErrorDetected = false;
  private turnFailureText: string[] = [];
  private codexLoginLaunchInProgress = false;
  private codexInstallGuidanceShownAt = 0;
  private sessionNamingRequested = false;
  /** Auto-generated name produced before Codex emits thread.started (avoid title overwrite race). */
  private deferredAutoSessionName: string | null = null;
  /** Fork initialization data (history snapshot + prompt text) for new forked tabs */
  private forkInitData: { promptText: string; messages: SerializedChatMessage[] } | null = null;
  /** Background session for the "btw" side-conversation overlay */
  private btwSession: CodexBackgroundSession | null = null;
  private turnDiagSeq = 0;
  private turnDiagHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activeTurnDiag: {
    id: number;
    startedAt: number;
    lastActivityAt: number;
    promptLen: number;
    threadIdAtStart: string | null;
    modelAtStart: string;
    cwdAtStart?: string;
    jsonEvents: number;
    rawEvents: number;
    stderrEvents: number;
    lastJsonType: string;
    lastRawPreview: string;
    lastStderrPreview: string;
    sawTurnStarted: boolean;
    sawTurnCompleted: boolean;
  } | null = null;
  /** Waiters that resolve on the next assistant reply (used by provider handoff orchestration). */
  private assistantReplyWaiters: Array<(ok: boolean) => void> = [];
  /** Subscription for VS Code window state changes (focus/blur) */
  private windowStateSubscription: vscode.Disposable | null = null;
  /** Debounced timer for delayed focusInput after window-focus events */
  private focusInputTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamp of last posted focusInput message (dedupe/throttle) */
  private lastFocusInputPostAt = 0;
  private static readonly FOCUS_INPUT_THROTTLE_MS = 250;
  private static readonly WINDOW_FOCUS_INPUT_DELAY_MS = 180;

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
    this.messageHandler.setSecrets(context.secrets);
    this.messageHandler.setExtensionMeta(
      String((context.extension.packageJSON as { version?: unknown } | undefined)?.version ?? '0.0.0'),
      logDir || '',
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
    const messageTranslator = new MessageTranslator();
    messageTranslator.setLogger(tabLog);
    this.messageHandler.setMessageTranslator(messageTranslator);
    this.sessionNamer = new CodexSessionNamer();
    this.sessionNamer.setLogger(tabLog);

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
    if (msg.type === 'assistantMessage') {
      this.resolveAssistantReplyWaiters(true);
    }
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

  getProvider(): HandoffProvider {
    return 'codex';
  }

  /** Stage one-time handoff context to inject on the first user message in this tab. */
  setPendingHandoffPrompt(prompt: string): void {
    this.messageHandler.setPendingHandoffPrompt(prompt);
  }

  async startSession(options?: { resume?: string; fork?: boolean; cwd?: string }): Promise<void> {
    this.messageHandler.resetTransientStateForHostLifecycle(
      options?.resume
        ? 'CodexSessionTab.startSession(resume)'
        : options?.fork
          ? 'CodexSessionTab.startSession(fork)'
          : 'CodexSessionTab.startSession',
    );
    const isFork = !!options?.fork;

    this.sessionCwd =
      options?.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      this.sessionCwd;
    this.sessionActive = true;
    this.threadId = isFork ? null : (options?.resume || null);
    this.currentModel = this.getCurrentModel();
    this.sessionStartedAt = isFork ? new Date().toISOString() : (this.sessionStartedAt || new Date().toISOString());
    this.analyticsSaved = false;
    this.sessionNamingRequested = false;
    this.deferredAutoSessionName = null;
    this.achievementService.onSessionStart(this.id);

    if (options?.resume && !isFork) {
      this.restoreSessionName(options.resume);
      this.loadAndSendConversationHistory(options.resume);
      this.persistSessionMetadata();
    }

    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.threadId || 'pending',
      model: this.currentModel || 'Codex (default)',
      isResume: !!options?.resume && !isFork,
      provider: 'codex',
    });

    if (this.forkInitData) {
      this.postMessage({
        type: 'forkInit',
        promptText: this.forkInitData.promptText,
        messages: this.forkInitData.messages,
      });
      this.forkInitData = null;
    }
  }

  async clearSession(options?: { cwd?: string }): Promise<void> {
    this.messageHandler.resetTransientStateForHostLifecycle('CodexSessionTab.clearSession');
    this.saveProjectAnalytics();
    this.clearTurnCompletedExitWatchdog();
    if (this.processManager.isTurnRunning) {
      this.processManager.cancelTurn();
    }
    this.threadId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    this.sessionActive = false;
    this.deferredAutoSessionName = null;
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
    await this.startSession({ cwd: options?.cwd });
  }

  stopSession(): void {
    this.messageHandler.resetTransientStateForHostLifecycle('CodexSessionTab.stopSession');
    this.saveProjectAnalytics();
    this.clearTurnCompletedExitWatchdog();
    if (this.processManager.isTurnRunning) {
      this.processManager.cancelTurn();
    }
    this.achievementService.onSessionEnd(this.id);
    this.sessionActive = false;
    this.threadId = null;
    this.firstPrompt = '';
    this.sessionStartedAt = '';
    this.deferredAutoSessionName = null;
    this.postMessage({ type: 'processBusy', busy: false });
    this.postMessage({ type: 'sessionEnded', reason: 'stopped' });
  }

  // --- BTW Background Session ---

  /** Start a Codex-backed BTW side conversation. */
  startBtwSession(promptText: string): void {
    this.closeBtwSession();

    const cwd = this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const model = this.currentModel || this.getCurrentModel() || undefined;

    this.log(`[Codex Tab ${this.tabNumber}] Starting btw Codex background session`);
    this.btwSession = new CodexBackgroundSession(
      this.context,
      (msg) => this.log(`[Codex Tab ${this.tabNumber}] ${msg}`),
    );
    const activeBtw = this.btwSession;
    this.wireBtwSessionEvents(activeBtw);
    this.postMessage({ type: 'btwSessionStarted' });

    void this.buildBtwBootstrapPrompt(promptText)
      .then((bootstrapPrompt) => {
        if (this.btwSession !== activeBtw || !activeBtw) {
          return;
        }
        return activeBtw.start(bootstrapPrompt, { cwd, model });
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`[Codex Tab ${this.tabNumber}] btw session start failed: ${errMsg}`);
        this.postMessage({ type: 'btwSessionEnded', error: errMsg });
        this.closeBtwSession();
      });
  }

  /** Send a follow-up message in the active Codex BTW session. */
  sendBtwMessage(text: string): void {
    if (!this.btwSession) {
      this.log(`[Codex Tab ${this.tabNumber}] Cannot send btw message: no active btw session.`);
      return;
    }
    const cwd = this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const model = this.currentModel || this.getCurrentModel() || undefined;
    void this.btwSession.sendMessage(text, { cwd, model }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Codex Tab ${this.tabNumber}] btw send failed: ${errMsg}`);
      this.postMessage({ type: 'error', message: `BTW (Codex) failed: ${errMsg}` });
      this.postMessage({ type: 'btwResult' });
    });
  }

  /** Close and dispose the active Codex BTW session. */
  closeBtwSession(): void {
    if (!this.btwSession) {
      return;
    }
    this.log(`[Codex Tab ${this.tabNumber}] Closing btw session.`);
    this.btwSession.dispose();
    this.btwSession = null;
  }

  /** Wire Codex BTW session events and relay them to the webview. */
  private wireBtwSessionEvents(btw: CodexBackgroundSession): void {
    const tabLog = (msg: string) => this.log(`[Codex Tab ${this.tabNumber}] [BTW->WV] ${msg}`);

    btw.on('messageStart', (data: { messageId: string }) => {
      tabLog(`btwMessageStart msgId=${data.messageId}`);
      this.postMessage({ type: 'btwMessageStart', messageId: data.messageId });
    });

    btw.on('textDelta', (data: { blockIndex: number; text: string }) => {
      this.postMessage({
        type: 'btwStreamingText',
        blockIndex: data.blockIndex,
        text: data.text,
      });
    });

    btw.on('assistantMessage', (data: { message: { id: string; content: unknown[]; model?: string } }) => {
      const msg = data.message;
      const content = Array.isArray(msg?.content) ? (msg.content as ContentBlock[]) : [];
      tabLog(`btwAssistantMessage msgId=${msg?.id} contentBlocks=${content.length}`);
      this.postMessage({
        type: 'btwAssistantMessage',
        messageId: msg?.id,
        content,
        model: msg?.model,
      });
    });

    btw.on('messageStop', () => {
      this.postMessage({ type: 'btwMessageStop' });
    });

    btw.on('result', () => {
      tabLog('btwResult');
      this.postMessage({ type: 'btwResult' });
    });

    btw.on('error', (err: Error) => {
      tabLog(`btwError message=${err.message}`);
      this.postMessage({ type: 'error', message: `BTW (Codex) error: ${err.message}` });
    });

    btw.on('ended', () => {
      tabLog('btwSessionEnded');
      this.postMessage({ type: 'btwSessionEnded' });
      if (this.btwSession === btw) {
        this.btwSession = null;
      }
    });
  }

  /** Build a bootstrap prompt so Codex BTW starts with recent context from this tab. */
  private async buildBtwBootstrapPrompt(promptText: string): Promise<string> {
    let snapshot: HandoffSourceSnapshot | null = null;
    try {
      snapshot = await this.collectHandoffSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[Codex Tab ${this.tabNumber}] BTW context snapshot failed: ${message}`);
    }

    const recent = snapshot?.messages?.slice(-10) ?? [];
    const lines = recent
      .map((msg, idx) => {
        const role = msg.role === 'assistant' ? 'Assistant' : 'User';
        const text = this.extractTextFromSerializedContent(msg.content);
        if (!text) {
          return '';
        }
        const clipped = text.length > 1200 ? `${text.slice(0, 1180)}\n...[truncated]` : text;
        return `${idx + 1}. ${role}:\n${clipped}`;
      })
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return promptText;
    }

    return [
      'Context from the current Codex session. Treat it as prior conversation history for this side thread.',
      'Recent conversation:',
      lines.join('\n\n'),
      'New BTW user message:',
      promptText,
    ].join('\n\n');
  }

  private extractTextFromSerializedContent(content: SerializedChatMessage['content']): string {
    if (!Array.isArray(content)) {
      return '';
    }

    const parts: string[] = [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
        continue;
      }
      if (block?.type === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'tool';
        parts.push(`[tool_use:${name}]`);
        continue;
      }
      if (block?.type === 'tool_result') {
        parts.push('[tool_result]');
      }
    }
    return parts.join('\n').trim();
  }

  async sendText(text: string, options?: { steer?: boolean }): Promise<void> {
    await this.sendTurn(text, undefined, options);
  }

  async sendWithImages(
    text: string,
    images: Array<{ base64: string; mediaType: string }>,
    options?: { steer?: boolean }
  ): Promise<void> {
    await this.sendTurn(text, images as WebviewImageData[], options);
  }

  private async sendTurn(text: string, images?: WebviewImageData[], options?: { steer?: boolean }): Promise<void> {
    if (!this.sessionActive) {
      await this.startSession();
    }
    if (this.processManager.isTurnRunning) {
      if (!this.isBusy) {
        this.log(
          `[Codex Tab ${this.tabNumber}] sendTurn requested while process is still running but UI is idle; forcing stop() before retry`
        );
        this.noteTurnDiagnosticsActivity('lifecycle', 'sendTurn idle-running recovery: forcing stop()');
        this.clearTurnCompletedExitWatchdog();
        this.processManager.stop();
      }
      if (this.processManager.isTurnRunning) {
        if (!options?.steer) {
          throw new Error('A Codex turn is already running');
        }
        this.log(
          `[Codex Tab ${this.tabNumber}] Steer requested while turn is busy; canceling active turn before retry`
        );
        this.noteTurnDiagnosticsActivity('lifecycle', 'steer requested: cancel active turn');
        this.clearTurnCompletedExitWatchdog();
        this.processManager.cancelTurn();
        const turnStopped = await this.waitForTurnStop(CodexSessionTab.STEER_CANCEL_TIMEOUT_MS);
        if (!turnStopped && this.processManager.isTurnRunning) {
          this.noteTurnDiagnosticsActivity(
            'lifecycle',
            `steer cancel timeout after ${CodexSessionTab.STEER_CANCEL_TIMEOUT_MS}ms`
          );
          throw new Error('Could not stop the current Codex turn in time. Click Stop and retry.');
        }
      }
      if (this.processManager.isTurnRunning) {
        throw new Error('A Codex turn is already running');
      }
    }

    if (!this.firstPrompt) {
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim();
      if (firstLine) {
        this.firstPrompt = firstLine;
      }
    }

    this.currentModel = this.getCurrentModel();
    this.triggerSessionNaming(text);
    this.resetTurnFailureCapture();
    this.clearTurnCompletedExitWatchdog();
    this.beginTurnDiagnostics(text);
    const tempImages = images?.length ? this.processManager.createTempImageFiles(images) : null;
    let cleanupOnce: (() => void) | null = null;
    if (tempImages) {
      const cleanup = tempImages.cleanup;
      cleanupOnce = () => {
        this.processManager.off('exit', cleanupOnce!);
        this.processManager.off('error', cleanupOnce!);
        cleanup();
      };
      this.processManager.once('exit', cleanupOnce);
      this.processManager.once('error', cleanupOnce);
    }
    try {
      await this.processManager.runTurn({
        prompt: text,
        threadId: this.threadId || undefined,
        cwd: this.sessionCwd,
        model: this.currentModel || undefined,
        imagePaths: tempImages?.paths,
      });
    } catch (err) {
      if (cleanupOnce) {
        this.processManager.off('exit', cleanupOnce);
        this.processManager.off('error', cleanupOnce);
      }
      tempImages?.cleanup();
      throw err;
    }
    this.noteTurnDiagnosticsActivity('lifecycle', 'runTurn dispatched');
  }

  private waitForTurnStop(timeoutMs: number): Promise<boolean> {
    if (!this.processManager.isTurnRunning) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (stopped: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.processManager.off('exit', onExit);
        this.processManager.off('error', onError);
        resolve(stopped);
      };
      const onExit = () => finish(true);
      const onError = () => finish(true);
      const timer = setTimeout(() => finish(!this.processManager.isTurnRunning), timeoutMs);
      this.processManager.once('exit', onExit);
      this.processManager.once('error', onError);
    });
  }

  cancelRequest(): void {
    this.noteTurnDiagnosticsActivity('lifecycle', 'cancelRequest');
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
    this.messageHandler.dispose();
    this.clearTurnCompletedExitWatchdog();
    this.endTurnDiagnostics('tab dispose()');
    this.stopThinkingAnimation();
    this.resolveAssistantReplyWaiters(false);
    this.clearFocusInputTimer();
    this.windowStateSubscription?.dispose();
    this.windowStateSubscription = null;
    this.saveProjectAnalytics();
    this.closeBtwSession();
    this.processManager.stop();
    this.achievementService.onSessionEnd(this.id);
    this.achievementService.unregisterTab(this.id);
    this.skillGenService?.unregisterTab(this.id);
    this.fileLogger?.dispose();
    this.panel.dispose();
  }

  setForkInit(init: { promptText: string; messages: SerializedChatMessage[] }): void {
    this.forkInitData = init;
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
      model: this.currentModel || existing?.model || 'Codex (default)',
      provider: 'codex',
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
      workspacePath: existing?.workspacePath || this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  }

  /** Fire-and-forget: spawn a Codex CLI request to auto-name this session */
  private triggerSessionNaming(userText: string): void {
    const trimmed = userText.trim();
    if (!trimmed) {
      return;
    }

    const config = vscode.workspace.getConfiguration('claudeMirror');
    const autoName = config.get<boolean>('autoNameSessions', true);
    if (!autoName) {
      this.log(`[Codex Tab ${this.tabNumber}] [SessionNaming] SKIPPED: autoNameSessions is disabled`);
      return;
    }

    if (this.sessionNamingRequested) {
      this.log(`[Codex Tab ${this.tabNumber}] [SessionNaming] SKIPPED: naming already requested`);
      return;
    }

    this.sessionNamingRequested = true;
    this.log(`[Codex Tab ${this.tabNumber}] [SessionNaming] Launching CodexSessionNamer...`);

    void this.sessionNamer
      .generateName(trimmed, {
        model: this.currentModel || undefined,
        cwd: this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      })
      .then((name) => {
        this.log(`[Codex Tab ${this.tabNumber}] [SessionNaming] generateName returned: "${name}"`);
        if (!name || this.disposed) {
          return;
        }
        this.setTabName(name);
        this.fileLogger?.updateSessionName(name);
        if (!this.threadId) {
          this.deferredAutoSessionName = name;
          this.log(
            `[Codex Tab ${this.tabNumber}] [SessionNaming] Deferring session metadata save until thread id is available`
          );
          return;
        }
        this.deferredAutoSessionName = null;
        this.persistSessionMetadata(name);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`[Codex Tab ${this.tabNumber}] [SessionNaming] ERROR: ${message}`);
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
      model: this.currentModel || this.getCurrentModel() || 'Codex (default)',
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

  openCodexLoginTerminal(): void {
    void this.launchCodexLoginFlow({ precheckCli: true });
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

  isTurnRunning(): boolean {
    return this.processManager.isTurnRunning;
  }

  isBusyState(): boolean {
    return this.isBusy;
  }

  async collectHandoffSnapshot(): Promise<HandoffSourceSnapshot> {
    const sessionId = this.threadId || undefined;
    const workspacePath = this.sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const reader = new CodexConversationReader((msg) => this.log(`[Codex Tab ${this.tabNumber}] ${msg}`));
    const messages = sessionId ? reader.readSession(sessionId, workspacePath) : [];
    const repoRoot = this.detectGitRepoRoot(workspacePath);
    const branch = this.detectGitBranch(repoRoot || workspacePath);

    return {
      provider: 'codex',
      tabId: this.id,
      sessionId,
      cwd: workspacePath,
      repoRoot,
      branch,
      model: this.currentModel || this.getCurrentModel() || undefined,
      messages,
      createdAtIso: new Date().toISOString(),
    };
  }

  waitForNextAssistantReply(timeoutMs = 120_000): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const waiter = (ok: boolean) => {
        clearTimeout(timer);
        this.assistantReplyWaiters = this.assistantReplyWaiters.filter((w) => w !== waiter);
        resolve(ok);
      };
      const timer = setTimeout(() => waiter(false), timeoutMs);
      this.assistantReplyWaiters.push(waiter);
    });
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
      this.log(
        `[Codex Tab ${this.tabNumber}] ViewState changed: active=${e.webviewPanel.active} visible=${e.webviewPanel.visible}`,
      );
      if (e.webviewPanel.active) {
        this.callbacks.onFocused(this.id);
        this.postFocusInput('view-state active');
      }
    });

    // When VS Code window regains OS focus, schedule a delayed focusInput without
    // panel.reveal(); reveal() here can steal the first click in UI controls.
    this.windowStateSubscription = vscode.window.onDidChangeWindowState((e) => {
      this.log(
        `[Codex Tab ${this.tabNumber}] Window focus changed: focused=${e.focused} panelActive=${this.panel?.active ?? false}`,
      );
      if (e.focused && this.panel?.active) {
        this.scheduleWindowFocusInput();
      }
    });

    this.panel.onDidDispose(() => {
      this.disposed = true;
      try {
        this.clearTurnCompletedExitWatchdog();
        this.endTurnDiagnostics('panel onDidDispose');
        this.stopThinkingAnimation();
        this.resolveAssistantReplyWaiters(false);
        this.clearFocusInputTimer();
        this.windowStateSubscription?.dispose();
        this.windowStateSubscription = null;
        this.saveProjectAnalytics();
        this.closeBtwSession();
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
      this.noteTurnDiagnosticsActivity('json', event.type);
      if (event.type === 'turn.started') {
        this.clearTurnCompletedExitWatchdog();
        this.turnStructuredErrorDetected = false;
      }
      if (event.type === 'error' || event.type === 'turn.failed') {
        this.turnStructuredErrorDetected = true;
      }
      if (event.type === 'turn.completed') {
        this.turnStructuredErrorDetected = false;
        this.scheduleTurnCompletedExitWatchdog();
      }
      this.demux.handleEvent(event);
    });

    this.processManager.on('raw', (text: string) => {
      tabLog(`Codex raw: ${text}`);
      this.noteTurnDiagnosticsActivity('raw', text);
      this.captureTurnFailureText(text);
      this.maybeMarkTurnCliMissing(text, tabLog);
      this.maybeMarkTurnAuthFailure(text, tabLog);
    });

    this.processManager.on('stderr', (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      tabLog(`Codex STDERR: ${trimmed}`);
      this.noteTurnDiagnosticsActivity('stderr', trimmed);
      if (this.isKnownNonFatalCodexStderr(trimmed)) {
        tabLog(`Ignoring known non-fatal Codex stderr noise`);
        return;
      }
      this.captureTurnFailureText(trimmed);
      this.maybeMarkTurnCliMissing(trimmed, tabLog);
      if (this.turnCliMissingDetected) {
        // Let the exit/error handler emit a single friendly install guidance message.
        return;
      }
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
      this.clearTurnCompletedExitWatchdog();
      this.noteTurnDiagnosticsActivity('lifecycle', `process exit code=${info.code ?? 'null'} signal=${info.signal ?? 'null'}`);
      this.endTurnDiagnostics(`process exit code=${info.code ?? 'null'} signal=${info.signal ?? 'null'}`);
      if (this.processManager.cancelledByUser) {
        tabLog('Codex turn cancelled by user');
        this.postMessage({ type: 'processBusy', busy: false });
        this.resetTurnFailureCapture();
        return;
      }
      if (info.code !== 0 && info.code !== null) {
        this.achievementService.onRuntimeError(this.id);
        this.postMessage({ type: 'processBusy', busy: false });
        if (!this.turnCliMissingDetected && this.isLikelyCodexCliMissing(this.turnFailureText.join('\n'))) {
          this.turnCliMissingDetected = true;
        }
        if (this.turnCliMissingDetected) {
          tabLog('Codex CLI missing/not found detected; attempting auto-detection before showing guidance');
          void this.handleCodexCliMissing(tabLog);
          this.resetTurnFailureCapture();
          return;
        }
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
        if (!this.turnStructuredErrorDetected && this.turnFailureText.length === 0) {
          this.postMessage({
            type: 'error',
            message: `Codex process exited with code ${info.code}. Check output logs for details.`,
          });
        }
      }
      this.resetTurnFailureCapture();
    });

    this.processManager.on('error', (err: Error) => {
      tabLog(`Codex process error: ${err.message}`);
      this.clearTurnCompletedExitWatchdog();
      this.noteTurnDiagnosticsActivity('lifecycle', `process error: ${err.message}`);
      this.endTurnDiagnostics(`process error: ${err.message}`);
      this.captureTurnFailureText(err.message);
      this.maybeMarkTurnCliMissing(err.message, tabLog);
      this.maybeMarkTurnAuthFailure(err.message, tabLog);
      this.achievementService.onRuntimeError(this.id);
      this.postMessage({ type: 'processBusy', busy: false });
      if (this.turnCliMissingDetected) {
        void this.handleCodexCliMissing(tabLog);
      } else if (this.turnAuthFailureDetected) {
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
    this.turnCliMissingDetected = false;
    this.turnStructuredErrorDetected = false;
    this.turnFailureText = [];
  }

  private beginTurnDiagnostics(text: string): void {
    const id = ++this.turnDiagSeq;
    const now = Date.now();
    this.endTurnDiagnostics(`superseded by new turn #${id}`);
    this.activeTurnDiag = {
      id,
      startedAt: now,
      lastActivityAt: now,
      promptLen: text.length,
      threadIdAtStart: this.threadId,
      modelAtStart: this.currentModel || this.getCurrentModel() || 'Codex (default)',
      cwdAtStart: this.sessionCwd,
      jsonEvents: 0,
      rawEvents: 0,
      stderrEvents: 0,
      lastJsonType: '',
      lastRawPreview: '',
      lastStderrPreview: '',
      sawTurnStarted: false,
      sawTurnCompleted: false,
    };
    this.log(
      `[Codex Tab ${this.tabNumber}] [TurnDiag #${id}] BEGIN promptLen=${text.length} thread=${this.threadId || 'pending'} ` +
        `model="${this.activeTurnDiag.modelAtStart}" cwd="${this.sessionCwd || '(none)'}" busy=${this.isBusy}`
    );
    this.turnDiagHeartbeatTimer = setInterval(() => {
      this.logTurnDiagnosticsHeartbeat();
    }, 15000);
  }

  private clearTurnCompletedExitWatchdog(): void {
    if (this.turnCompletedExitWatchdogTimer) {
      clearTimeout(this.turnCompletedExitWatchdogTimer);
      this.turnCompletedExitWatchdogTimer = null;
    }
  }

  private scheduleTurnCompletedExitWatchdog(): void {
    this.clearTurnCompletedExitWatchdog();
    const activeDiagId = this.activeTurnDiag?.id ?? null;
    this.turnCompletedExitWatchdogTimer = setTimeout(() => {
      this.turnCompletedExitWatchdogTimer = null;
      if (this.disposed) {
        return;
      }
      if (!this.processManager.isTurnRunning) {
        return;
      }
      if (activeDiagId !== null && this.activeTurnDiag?.id !== activeDiagId) {
        return;
      }
      this.log(
        `[Codex Tab ${this.tabNumber}] Turn-complete watchdog fired after ` +
          `${CodexSessionTab.TURN_COMPLETE_EXIT_WATCHDOG_MS}ms; forcing stop()`
      );
      this.noteTurnDiagnosticsActivity(
        'lifecycle',
        `turn-complete watchdog forced stop after ${CodexSessionTab.TURN_COMPLETE_EXIT_WATCHDOG_MS}ms`
      );
      this.endTurnDiagnostics('turn-complete watchdog forced stop');
      this.processManager.stop();
      this.postMessage({ type: 'processBusy', busy: false });
      this.resetTurnFailureCapture();
    }, CodexSessionTab.TURN_COMPLETE_EXIT_WATCHDOG_MS);
  }

  private noteTurnDiagnosticsActivity(
    source: 'json' | 'raw' | 'stderr' | 'lifecycle',
    detail: string
  ): void {
    const diag = this.activeTurnDiag;
    if (!diag) {
      return;
    }
    diag.lastActivityAt = Date.now();
    if (source === 'json') {
      diag.jsonEvents += 1;
      diag.lastJsonType = detail;
      if (detail === 'turn.started') {
        diag.sawTurnStarted = true;
      } else if (detail === 'turn.completed') {
        diag.sawTurnCompleted = true;
      }
    } else if (source === 'raw') {
      diag.rawEvents += 1;
      diag.lastRawPreview = this.summarizeTurnDiagText(detail);
    } else if (source === 'stderr') {
      diag.stderrEvents += 1;
      diag.lastStderrPreview = this.summarizeTurnDiagText(detail);
    }

    if (source === 'lifecycle') {
      this.log(`[Codex Tab ${this.tabNumber}] [TurnDiag #${diag.id}] ${detail}`);
      return;
    }

    const count = source === 'json' ? diag.jsonEvents : source === 'raw' ? diag.rawEvents : diag.stderrEvents;
    if (count <= 3 || count % 20 === 0) {
      const extra =
        source === 'json'
          ? detail
          : source === 'raw'
            ? `preview="${diag.lastRawPreview}"`
            : `preview="${diag.lastStderrPreview}"`;
      this.log(`[Codex Tab ${this.tabNumber}] [TurnDiag #${diag.id}] ${source}#${count} ${extra}`);
    }
  }

  private logTurnDiagnosticsHeartbeat(): void {
    const diag = this.activeTurnDiag;
    if (!diag) {
      return;
    }
    const now = Date.now();
    const elapsedMs = Math.max(0, now - diag.startedAt);
    const idleMs = Math.max(0, now - diag.lastActivityAt);
    this.log(
      `[Codex Tab ${this.tabNumber}] [TurnDiag #${diag.id}] HEARTBEAT elapsed=${elapsedMs}ms idle=${idleMs}ms ` +
        `running=${this.processManager.isTurnRunning} busy=${this.isBusy} cancelled=${this.processManager.cancelledByUser} ` +
        `json=${diag.jsonEvents} raw=${diag.rawEvents} stderr=${diag.stderrEvents} ` +
        `turnStarted=${diag.sawTurnStarted} turnCompleted=${diag.sawTurnCompleted} lastJson=${diag.lastJsonType || '(none)'} ` +
        `structuredError=${this.turnStructuredErrorDetected} cliMissing=${this.turnCliMissingDetected} authFailure=${this.turnAuthFailureDetected}`
    );
  }

  private endTurnDiagnostics(reason: string): void {
    if (this.turnDiagHeartbeatTimer) {
      clearInterval(this.turnDiagHeartbeatTimer);
      this.turnDiagHeartbeatTimer = null;
    }
    const diag = this.activeTurnDiag;
    if (!diag) {
      return;
    }
    const now = Date.now();
    this.log(
      `[Codex Tab ${this.tabNumber}] [TurnDiag #${diag.id}] END reason="${reason}" elapsed=${Math.max(0, now - diag.startedAt)}ms ` +
        `idle=${Math.max(0, now - diag.lastActivityAt)}ms json=${diag.jsonEvents} raw=${diag.rawEvents} stderr=${diag.stderrEvents} ` +
        `turnStarted=${diag.sawTurnStarted} turnCompleted=${diag.sawTurnCompleted} lastJson=${diag.lastJsonType || '(none)'} ` +
        `lastRaw="${diag.lastRawPreview || ''}" lastStderr="${diag.lastStderrPreview || ''}"`
    );
    this.activeTurnDiag = null;
  }

  private summarizeTurnDiagText(text: string): string {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
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

  private maybeMarkTurnCliMissing(text: string, log: (msg: string) => void): void {
    if (this.turnCliMissingDetected) {
      return;
    }
    if (!this.isLikelyCodexCliMissing(text)) {
      return;
    }
    this.turnCliMissingDetected = true;
    log(`Detected Codex CLI missing/not found failure: ${text.trim()}`);
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

  private isLikelyCodexCliMissing(text: string): boolean {
    const normalized = text.toLowerCase();
    const missingPatterns = [
      /'codex'\s+is not recognized as an internal or external command/i,
      /\bcodex:\s+command not found\b/i,
      /\bspawn\b.*\bcodex\b.*\benoent\b/i,
      /\benoent\b.*\bcodex\b/i,
      // Windows "The system cannot find the path/file specified" — often emitted by
      // extension-bundled codex.exe binaries that pass --version but fail on exec.
      /the system cannot find the (path|file) specified/i,
    ];
    return missingPatterns.some((pattern) => pattern.test(normalized));
  }

  private isKnownNonFatalCodexStderr(text: string): boolean {
    const knownNoisePatterns = [
      /WARN\s+codex_core::shell_snapshot/i,
      /ERROR\s+codex_core::rollout::list:\s*state db missing rollout path for thread/i,
    ];
    return knownNoisePatterns.some((pattern) => pattern.test(text));
  }

  private async launchCodexLoginFlow(options?: { precheckCli?: boolean }): Promise<void> {
    if (this.codexLoginLaunchInProgress) {
      return;
    }
    this.codexLoginLaunchInProgress = true;
    try {
      let cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('codex.cliPath', 'codex') || 'codex';
      if (options?.precheckCli) {
        const cliAvailable = await this.probeCodexCliAvailability(cliPath);
        if (!cliAvailable) {
          // Try auto-detection before giving up
          const autoDetected = await this.tryAutoDetectCodexCli();
          if (autoDetected) {
            // Re-read the now-updated setting and proceed to login
            cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('codex.cliPath', 'codex') || 'codex';
          } else {
            const terminal = vscode.window.createTerminal({ name: 'Codex Setup' });
            terminal.show();
            this.sendTerminalInfoLine(terminal, 'Codex CLI was not found on PATH (or at the configured path).');
            this.sendTerminalInfoLine(terminal, 'Note: Signing in to the official Codex VS Code extension does not expose the "codex" command to ClaUi.');
            this.sendTerminalInfoLine(terminal, 'Install Codex CLI first: https://github.com/openai/codex');
            this.sendTerminalInfoLine(terminal, 'Checking whether the command is visible on PATH...');
            terminal.sendText(process.platform === 'win32' ? 'where.exe codex' : 'which codex', true);
            this.sendTerminalInfoLine(terminal, 'If not found, set claudeMirror.codex.cliPath to the full path of codex.exe/codex.cmd.');
            this.sendTerminalInfoLine(terminal, 'Then run: codex login');
            void this.showCodexCliMissingGuidance();
            return;
          }
        }
      }
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

  private probeCodexCliAvailability(cliPath: string): Promise<boolean> {
    const candidate = (cliPath || 'codex').trim() || 'codex';
    return new Promise((resolve) => {
      exec(
        `${this.quoteTerminalArg(candidate)} --version`,
        { timeout: 5000, windowsHide: true },
        (err, stdout, stderr) => {
          if (!err) {
            resolve(true);
            return;
          }
          const combined = [stdout, stderr, err.message].filter(Boolean).join('\n');
          if (this.isLikelyCodexCliMissing(combined)) {
            resolve(false);
            return;
          }
          // If the probe failed for another reason, assume the CLI exists and let login try.
          resolve(true);
        }
      );
    });
  }

  /**
   * Try to auto-detect a working Codex CLI and save it to settings.
   * Returns true if a candidate was found and configured.
   */
  private async tryAutoDetectCodexCli(): Promise<boolean> {
    const candidates = await findWorkingCodexCliCandidates();
    if (candidates.length === 0) {
      return false;
    }
    const selected = pickPreferredCodexCliCandidate(candidates);
    await vscode.workspace.getConfiguration('claudeMirror').update('codex.cliPath', selected.path, true);
    void vscode.window.showInformationMessage(
      `Codex CLI auto-detected at "${selected.path}" (${selected.version ?? 'unknown'}). Setting saved. Please retry your message.`,
    );
    return true;
  }

  /**
   * Called when the Codex CLI is detected as missing during a turn.
   * Tries auto-detection first; if that fails, shows install guidance.
   */
  private async handleCodexCliMissing(log: (msg: string) => void): Promise<void> {
    const autoDetected = await this.tryAutoDetectCodexCli();
    if (autoDetected) {
      log('Codex CLI auto-detected and configured; clearing error');
      this.postMessage({ type: 'error', message: '' });
      this.postMessage({ type: 'processBusy', busy: false });
      return;
    }
    log('Codex CLI auto-detection found nothing; showing install guidance');
    this.postMessage({
      type: 'error',
      message:
        'Codex CLI not found. ClaUi Codex mode wraps the Codex CLI (not the VS Code extension). Install Codex and/or set "claudeMirror.codex.cliPath", then run "codex login" and retry.',
    });
    void this.showCodexCliMissingGuidance();
  }

  private async showCodexCliMissingGuidance(): Promise<void> {
    const now = Date.now();
    if (now - this.codexInstallGuidanceShownAt < 1500) {
      return;
    }
    this.codexInstallGuidanceShownAt = now;
    const installGuideUrl = 'https://github.com/openai/codex';

    const choice = await vscode.window.showErrorMessage(
      'Codex CLI was not found. Even if the official Codex VS Code extension is installed and signed in, ClaUi still needs the "codex" CLI command on PATH (or configured via claudeMirror.codex.cliPath). Then run "codex login".',
      'Open Install Guide',
      'Open Settings'
    );

    if (choice === 'Open Install Guide') {
      await vscode.env.openExternal(vscode.Uri.parse(installGuideUrl));
      return;
    }
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeMirror.codex.cliPath');
    }
  }

  private quoteTerminalArg(value: string): string {
    if (!value || !/[\s"]/u.test(value)) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private sendTerminalInfoLine(terminal: vscode.Terminal, text: string): void {
    const escaped = text.replace(/'/g, "''");
    if (process.platform === 'win32') {
      terminal.sendText(`Write-Host '${escaped}'`, true);
      return;
    }
    terminal.sendText(`printf '%s\\n' '${escaped}'`, true);
  }

  private resolveAssistantReplyWaiters(ok: boolean): void {
    if (this.assistantReplyWaiters.length === 0) {
      return;
    }
    const waiters = [...this.assistantReplyWaiters];
    this.assistantReplyWaiters = [];
    for (const waiter of waiters) {
      try {
        waiter(ok);
      } catch {
        // no-op
      }
    }
  }

  private detectGitBranch(cwd?: string): string | undefined {
    if (!cwd) {
      return undefined;
    }
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
      return branch || undefined;
    } catch {
      return undefined;
    }
  }

  private detectGitRepoRoot(cwd?: string): string | undefined {
    if (!cwd) {
      return undefined;
    }
    try {
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
      return repoRoot || undefined;
    } catch {
      return undefined;
    }
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
      this.callbacks.onSessionIdAssigned?.(this.id, data.threadId);
      const restored = this.restoreSessionName(data.threadId);
      if (restored) {
        this.deferredAutoSessionName = null;
      } else if (this.deferredAutoSessionName) {
        tabLog(`Applying deferred auto session name: "${this.deferredAutoSessionName}"`);
        this.setTabName(this.deferredAutoSessionName);
        this.fileLogger?.updateSessionName(this.deferredAutoSessionName);
        this.persistSessionMetadata(this.deferredAutoSessionName);
        this.deferredAutoSessionName = null;
        return;
      } else {
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
    this.callbacks.onNameChanged?.(this.id, name);
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
    this.log(`[Codex Tab ${this.tabNumber}] setBusy(${busy}) prev=${this.isBusy}`);
    this.noteTurnDiagnosticsActivity('lifecycle', `setBusy(${busy})`);
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
      this.deferredAutoSessionName = null;
      this.persistSessionMetadata(newName);
    }
  }

  private clearFocusInputTimer(): void {
    if (this.focusInputTimer) {
      clearTimeout(this.focusInputTimer);
      this.focusInputTimer = null;
    }
  }

  private postFocusInput(reason: string): void {
    if (this.disposed || !this.panel?.active) {
      return;
    }
    const now = Date.now();
    const sinceLast = now - this.lastFocusInputPostAt;
    if (sinceLast < CodexSessionTab.FOCUS_INPUT_THROTTLE_MS) {
      this.log(
        `[Codex Tab ${this.tabNumber}] Suppressing focusInput (${reason}) due to throttle (${sinceLast}ms < ${CodexSessionTab.FOCUS_INPUT_THROTTLE_MS}ms)`,
      );
      return;
    }
    this.lastFocusInputPostAt = now;
    this.log(`[Codex Tab ${this.tabNumber}] Posting focusInput (${reason})`);
    this.postMessage({ type: 'focusInput' });
  }

  private scheduleWindowFocusInput(): void {
    this.clearFocusInputTimer();
    this.log(
      `[Codex Tab ${this.tabNumber}] Scheduling focusInput (window focus delay=${CodexSessionTab.WINDOW_FOCUS_INPUT_DELAY_MS}ms)`,
    );
    this.focusInputTimer = setTimeout(() => {
      this.focusInputTimer = null;
      this.postFocusInput('window focus timer');
    }, CodexSessionTab.WINDOW_FOCUS_INPUT_DELAY_MS);
  }

  private flushPendingMessages(): void {
    if (this.disposed || this.pendingMessages.length === 0) {
      return;
    }
    const queued = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queued) {
      this.enqueueWebviewPost(message);
    }
  }

  /**
   * VS Code webview.postMessage() is async (Thenable<boolean>). Queue deliveries to
   * preserve message order at the actual webview boundary (not just caller order).
   */
  private enqueueWebviewPost(msg: ExtensionToWebviewMessage): void {
    this.webviewPostDeliveryQueue = this.webviewPostDeliveryQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || !this.isWebviewReady) {
          return;
        }
        try {
          const delivered = await this.panel.webview.postMessage(msg);
          if (delivered === false) {
            this.log(`[Codex Tab ${this.tabNumber}] webview.postMessage(${msg.type}) returned false`);
          }
        } catch {
          this.disposed = true;
        }
      });
  }
}
