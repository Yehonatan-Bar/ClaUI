import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { ControlProtocol } from '../process/ControlProtocol';
import { SessionNamer } from './SessionNamer';
import { MessageTranslator } from './MessageTranslator';
import { ActivitySummarizer } from './ActivitySummarizer';
import { VisualProgressProcessor } from './VisualProgressProcessor';
import { AdventureInterpreter } from './AdventureInterpreter';
import { TurnAnalyzer } from './TurnAnalyzer';
import { PromptEnhancer } from './PromptEnhancer';
import { PromptTranslator } from './PromptTranslator';
import { ConversationReader } from './ConversationReader';
import { FileLogger } from './FileLogger';
import type { AchievementService } from '../achievements/AchievementService';
import type { SessionStore } from './SessionStore';
import type { ProjectAnalyticsStore } from './ProjectAnalyticsStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import { MessageHandler, type WebviewBridge } from '../webview/MessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import type { SkillGenService } from '../skillgen/SkillGenService';
import type { TokenUsageRatioTracker } from './TokenUsageRatioTracker';
import { AuthManager } from '../auth/AuthManager';
import { TeamWatcher } from '../teams/TeamWatcher';
import { TeamDetector } from '../teams/TeamDetector';
import { TeamActions } from '../teams/TeamActions';
import type { TeamStateSnapshot } from '../teams/TeamTypes';
import type { CliOutputEvent, AssistantMessage } from '../types/stream-json';
import type {
  ExtensionToWebviewMessage,
  ProviderId,
  WebviewToExtensionMessage,
  SerializedChatMessage,
  SessionSummary,
  TurnRecord,
} from '../types/webview-messages';
import type { HandoffProvider, HandoffSourceSnapshot } from './handoff/HandoffTypes';

export interface SessionTabCallbacks {
  onClosed: (tabId: string) => void;
  onFocused: (tabId: string) => void;
}

/**
 * Bundles all per-tab resources for a single Claude session:
 * process manager, stream demux, control protocol, webview panel,
 * message handler, and all event wiring between them.
 */
export class SessionTab implements WebviewBridge {
  readonly id: string;
  readonly tabNumber: number;

  private readonly processManager: ClaudeProcessManager;
  private readonly demux: StreamDemux;
  private readonly control: ControlProtocol;
  private readonly messageHandler: MessageHandler;
  private readonly panel: vscode.WebviewPanel;

  private messageCallback: ((msg: WebviewToExtensionMessage) => void) | null = null;
  private isWebviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private disposed = false;
  private currentModel = '';
  private sessionStartedAt = '';
  /** Guard to prevent saving project analytics twice (e.g. dispose + exit handler) */
  private analyticsSaved = false;
  /** First line of the user's first prompt (persisted to session history) */
  private firstPrompt = '';
  /** When true, the next process exit should NOT send sessionEnded (edit-and-resend restart) */
  private suppressNextExit = false;
  /** The base title (without any busy indicator) */
  private baseTitle = '';
  /** Whether Claude is currently processing */
  private isBusy = false;
  /** Timer handle for the animated thinking indicator */
  private thinkingAnimTimer: ReturnType<typeof setInterval> | null = null;
  /** Current frame index for the thinking animation */
  private thinkingFrame = 0;
  /** Braille-based spinner frames that create a smooth rotation effect */
  private static readonly THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  /** Per-tab file logger (null if file logging is disabled) */
  private readonly fileLogger: FileLogger | null = null;
  /** Fork initialization data (set before startSession when forking) */
  private forkInitData: { promptText: string; messages: SerializedChatMessage[] } | null = null;
  /** When true, the process exit is from fork phase 1 (--fork-session) and phase 2 should auto-start */
  private forkInProgress = false;
  /** Tracks whether stderr indicates Claude CLI is not installed */
  private claudeCliMissingDetected = false;
  /** Tracks whether stderr indicates Happy CLI authentication is required */
  private happyAuthDetected = false;
  /** Agent Teams support */
  private teamWatcher: TeamWatcher | null = null;
  private teamDetector = new TeamDetector();
  private teamActions: TeamActions | null = null;
  private activeTeamName: string | null = null;
  /** Guard: true once an auto-prompt has been sent for the current "all agents idle" state */
  private teamAutoPromptSent = false;
  /** Whether any agent has been seen as 'working' at least once (prevents triggering on fresh teams) */
  private teamHadWorkingAgent = false;
  /** Per-tab CLI override (used by Happy provider to spawn `happy` instead of `claude`) */
  private cliPathOverride: string | null = null;
  /** Waiters that resolve when the next assistant reply arrives (handoff orchestration). */
  private assistantReplyWaiters: Array<(ok: boolean) => void> = [];

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
    private readonly skillGenService?: SkillGenService,
    private readonly tokenRatioTracker?: TokenUsageRatioTracker
  ) {
    this.tabNumber = tabNumber;
    this.id = `tab-${tabNumber}`;

    // Instantiate per-tab components
    this.processManager = new ClaudeProcessManager(context);
    this.demux = new StreamDemux();
    this.control = new ControlProtocol(this.processManager);
    this.messageHandler = new MessageHandler(
      this.id,
      this,
      this.processManager,
      this.control,
      this.demux,
      this.promptHistoryStore,
      this.achievementService,
      this.skillGenService
    );
    this.messageHandler.setSessionNameGetter(() => this.baseTitle);
    this.messageHandler.setWorkspaceState(context.workspaceState);
    this.messageHandler.setProjectAnalyticsStore(this.projectAnalyticsStore);
    this.messageHandler.setSecrets(context.secrets);
    this.messageHandler.setAuthManager(new AuthManager());
    this.messageHandler.setExtensionVersion(
      String((context.extension.packageJSON as { version?: unknown })?.version ?? '0.0.0'),
    );
    if (logDir) {
      this.messageHandler.setLogDir(logDir);
    }
    if (this.tokenRatioTracker) {
      this.messageHandler.setTokenRatioTracker(this.tokenRatioTracker);
    }

    // Create per-tab file logger if file logging is enabled
    if (logDir) {
      this.fileLogger = new FileLogger(logDir, `session-${tabNumber}`);
    }

    // Set up per-tab logging with prefix, dual-writing to file
    const tabLog = (msg: string) => {
      const prefixed = `[Tab ${tabNumber}] ${msg}`;
      log(prefixed);
      if (this.fileLogger) {
        const timestamp = new Date().toISOString().slice(11, 23);
        this.fileLogger.write(`[${timestamp}] ${prefixed}`);
      }
    };
    this.processManager.setLogger(tabLog);
    this.messageHandler.setLogger(tabLog);

    // Wire auto-naming: Haiku generates a short title from the first message
    const sessionNamer = new SessionNamer();
    sessionNamer.setLogger(tabLog);
    this.messageHandler.setSessionNamer(sessionNamer);
    this.messageHandler.onSessionNameGenerated((name) => {
      tabLog(`[SessionNaming] Callback received name="${name}", disposed=${this.disposed}`);
      if (!this.disposed) {
        tabLog(`[SessionNaming] Calling setTabName("${name}")`);
        this.setTabName(name);
        // Update stored session name
        this.persistSessionMetadata(name);
        // Rename the log file to include the session name
        this.fileLogger?.updateSessionName(name);
      }
    });

    // Wire first prompt capture: store the first user message for history display
    this.messageHandler.onFirstPromptCaptured((prompt) => {
      if (!this.disposed) {
        this.firstPrompt = prompt;
        this.persistSessionMetadata();
      }
    });

    // Wire activity summarizer: Haiku periodically summarizes tool activity
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const summaryThreshold = config.get<number>('activitySummaryThreshold', 3);
    const activitySummarizer = new ActivitySummarizer({ threshold: summaryThreshold });
    activitySummarizer.setLogger(tabLog);
    this.messageHandler.setActivitySummarizer(activitySummarizer);
    // Wire Visual Progress Mode processor
    const vpmProcessor = new VisualProgressProcessor();
    this.messageHandler.setVpmProcessor(vpmProcessor);

    this.messageHandler.onActivitySummaryGenerated((summary) => {
      tabLog(`[ActivitySummary] Callback: "${summary.shortLabel}"`);
      if (!this.disposed) {
        try {
          if (this.panel.active) {
            this.statusBarItem.tooltip = summary.fullSummary;
          }
        } catch {
          // Panel may have been disposed between our flag check and the access
        }
      }
    });

    // Wire message translator for Hebrew translation feature
    const messageTranslator = new MessageTranslator();
    messageTranslator.setLogger(tabLog);
    this.messageHandler.setMessageTranslator(messageTranslator);

    // Wire adventure interpreter for dungeon crawler beat generation
    const adventureInterpreter = new AdventureInterpreter();
    adventureInterpreter.setLogger(tabLog);
    this.messageHandler.setAdventureInterpreter(adventureInterpreter);

    // Wire turn analyzer for semantic analysis (dashboard insights)
    const turnAnalyzer = new TurnAnalyzer();
    turnAnalyzer.setLogger(tabLog);
    this.messageHandler.setTurnAnalyzer(turnAnalyzer);

    // Wire prompt enhancer for AI-powered prompt improvement
    const promptEnhancer = new PromptEnhancer();
    promptEnhancer.setLogger(tabLog);
    this.messageHandler.setPromptEnhancer(promptEnhancer);

    // Wire prompt translator for translating prompts to English
    const promptTranslator = new PromptTranslator();
    promptTranslator.setLogger(tabLog);
    this.messageHandler.setPromptTranslator(promptTranslator);

    // Create webview panel in the specified column
    this.baseTitle = `ClaUi ${tabNumber}`;
    this.panel = vscode.window.createWebviewPanel(
      'claudeMirror.chat',
      this.baseTitle,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      }
    );

    // Set a colored circle icon on the VS Code tab so all tab colors are
    // visible at once in the tab bar, even when another tab is active.
    this.setTabIcon(tabColor);

    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context);
    this.achievementService.registerTab(this.id, (msg) => this.postMessage(msg));
    // Register with skill gen service for broadcast status updates
    this.skillGenService?.registerTab(this.id, (msg) => this.postMessage(msg as ExtensionToWebviewMessage));
    this.wireWebviewEvents();
    this.wireProcessEvents(tabLog);
    this.wireDemuxStatusBar();
    this.wireDemuxSessionStore(tabLog);
    this.messageHandler.initialize();

    // Move the new tab to the rightmost position in its editor group
    this.moveTabToEnd();
  }

  // --- WebviewBridge implementation ---

  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this.disposed || !this.panel) {
      return;
    }
    const outbound =
      msg.type === 'sessionStarted'
        ? { ...msg, provider: this.getProvider() }
        : msg;
    // Intercept processBusy messages to update the tab title indicator
    if (outbound.type === 'processBusy') {
      this.setBusy(outbound.busy);
    }
    if (outbound.type === 'assistantMessage') {
      this.resolveAssistantReplyWaiters(true);
    }
    if (!this.isWebviewReady) {
      this.pendingMessages.push(outbound);
      return;
    }
    try {
      void this.panel.webview.postMessage(outbound);
    } catch {
      // Panel may have been disposed between our flag check and the actual call
      this.disposed = true;
    }
  }

  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
  }

  setSuppressNextExit(suppress: boolean): void {
    this.suppressNextExit = suppress;
  }

  getProvider(): ProviderId {
    return this.isHappyCliSession() ? 'remote' : 'claude';
  }

  getCliPathOverride(): string | null {
    return this.cliPathOverride;
  }

  isBusyState(): boolean {
    return this.isBusy;
  }

  async collectHandoffSnapshot(): Promise<HandoffSourceSnapshot> {
    const provider = this.getProvider();
    if (provider !== 'claude' && provider !== 'codex') {
      throw new Error(`Provider "${provider}" does not support context handoff.`);
    }

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const sessionId = this.processManager.currentSessionId || undefined;
    const reader = new ConversationReader((msg) => this.log(`[Tab ${this.tabNumber}] ${msg}`));
    const messages = sessionId ? reader.readSession(sessionId, workspacePath) : [];
    const repoRoot = this.detectGitRepoRoot(workspacePath);
    const branch = this.detectGitBranch(repoRoot || workspacePath);

    return {
      provider: provider as HandoffProvider,
      tabId: this.id,
      sessionId,
      cwd: workspacePath,
      repoRoot,
      branch,
      model: this.currentModel || undefined,
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

  saveProjectAnalyticsNow(): void {
    this.saveProjectAnalytics();
  }

  async switchModel(model: string): Promise<void> {
    const sessionToResume = this.processManager.currentSessionId;
    if (!sessionToResume) {
      this.log(`[Tab ${this.tabNumber}] Cannot switch model: no active session`);
      return;
    }

    this.log(`[Tab ${this.tabNumber}] Switching model to "${model}" (session ${sessionToResume})`);
    this.suppressNextExit = true;
    this.postMessage({ type: 'processBusy', busy: false });
    this.processManager.stop();

    try {
      await this.processManager.start({
        resume: sessionToResume,
        model,
        cliPathOverride: this.cliPathOverride ?? undefined,
      });
      this.log(`[Tab ${this.tabNumber}] Session resumed with model "${model}"`);
      await vscode.workspace.getConfiguration('claudeMirror').update('model', model, true);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] Failed to switch model: ${errMsg}`);
      this.postMessage({ type: 'error', message: `Failed to switch model: ${errMsg}` });
      this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
    }
  }

  // --- Public API ---

  /** Set fork initialization data (must be called before startSession) */
  setForkInit(init: { promptText: string; messages: SerializedChatMessage[] }): void {
    this.forkInitData = init;
  }

  /** Stage one-time handoff context to inject on the first user message in this tab. */
  setPendingHandoffPrompt(prompt: string): void {
    this.messageHandler.setPendingHandoffPrompt(prompt);
  }

  setCliPathOverride(path: string): void {
    this.cliPathOverride = path;
  }

  /** Start a new CLI session in this tab (Claude by default, Happy when overridden) */
  async startSession(options?: { resume?: string; fork?: boolean; cwd?: string }): Promise<void> {
    this.messageHandler.clearPendingHandoffPrompt();
    if (options?.fork) {
      this.forkInProgress = true;
    }
    this.claudeCliMissingDetected = false;
    this.happyAuthDetected = false;
    await this.processManager.start({
      ...(options ?? {}),
      cliPathOverride: this.cliPathOverride ?? undefined,
    });
    this.achievementService.onSessionStart(this.id);
    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.processManager.currentSessionId || 'pending',
      model: 'connecting...',
      isResume: !!options?.resume,
      provider: this.getProvider(),
    });

    // If this is a fork, send the conversation history and prompt text
    // directly to the new webview (don't rely on CLI replay)
    if (this.forkInitData) {
      this.postMessage({
        type: 'forkInit',
        promptText: this.forkInitData.promptText,
        messages: this.forkInitData.messages,
      });
      this.forkInitData = null;
    }

    // If resuming (not forking), restore session name and load conversation
    // history immediately. The CLI in pipe mode doesn't emit system/init or
    // replay messages until user sends input, so we read from disk instead.
    if (options?.resume && !options?.fork) {
      this.restoreSessionName(options.resume);
      this.loadAndSendConversationHistory(options.resume);
    }
  }

  /** Restore the tab name from SessionStore metadata (for resumed sessions) */
  private restoreSessionName(sessionId: string): void {
    const existing = this.sessionStore.getSession(sessionId);
    if (existing?.name && !existing.name.startsWith('Session ')) {
      this.log(`[Tab ${this.tabNumber}] Restoring session name: "${existing.name}"`);
      this.setTabName(existing.name);
      if (existing.firstPrompt) {
        this.firstPrompt = existing.firstPrompt;
      }
    }
  }

  /** Read conversation history from Claude's session JSONL and send to webview */
  private loadAndSendConversationHistory(sessionId: string): void {
    const tabLog = this.log;
    const reader = new ConversationReader((msg) => tabLog(`[Tab ${this.tabNumber}] ${msg}`));
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const messages = reader.readSession(sessionId, workspacePath);

    if (messages.length > 0) {
      this.log(`[Tab ${this.tabNumber}] Loaded ${messages.length} history messages for resumed session`);
      this.postMessage({
        type: 'conversationHistory',
        messages,
      });
    } else {
      this.log(`[Tab ${this.tabNumber}] No history messages found for session ${sessionId}`);
    }
  }

  /** Stop the CLI session in this tab */
  stopSession(): void {
    this.processManager.stop();
  }

  /** Send a user text message to the CLI process */
  sendText(text: string): void {
    this.control.sendText(text);
  }

  /** Cancel the current in-flight request (pause - keeps session alive) */
  cancelRequest(): void {
    // Immediate UI feedback so the cancel feels instant
    this.postMessage({ type: 'processBusy', busy: false });
    this.control.cancel();
  }

  /** Request context compaction */
  compact(instructions?: string): void {
    this.control.compact(instructions);
  }

  /** Reveal (focus) this tab's panel in its current column */
  reveal(): void {
    if (this.disposed) {
      return;
    }
    try {
      this.panel.reveal();
    } catch {
      this.disposed = true;
    }
  }

  /** Whether this tab has been disposed */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** The ViewColumn this panel currently lives in */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.disposed ? undefined : this.panel.viewColumn;
  }

  /** Whether the underlying CLI process is running */
  get isRunning(): boolean {
    return this.processManager.isRunning;
  }

  /** The CLI session ID, if available */
  get sessionId(): string | null {
    return this.processManager.currentSessionId;
  }

  /** Whether this tab's panel is visible */
  get isVisible(): boolean {
    return this.disposed ? false : this.panel.visible;
  }

  /** Clean up all resources for this tab */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopThinkingAnimation();
    this.resolveAssistantReplyWaiters(false);
    // Clean up team watcher
    if (this.teamWatcher) {
      this.teamWatcher.dispose();
      this.teamWatcher = null;
    }
    // Save analytics BEFORE stopping the process to ensure data is persisted
    this.saveProjectAnalytics();
    this.achievementService.onSessionEnd(this.id);
    this.achievementService.unregisterTab(this.id);
    this.skillGenService?.unregisterTab(this.id);
    this.processManager.stop();
    this.fileLogger?.dispose();
    this.panel.dispose();
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

  /** Persist session metadata to the session store, preserving existing fields */
  private persistSessionMetadata(name?: string): void {
    const sid = this.processManager.currentSessionId;
    if (!sid) {
      return;
    }
    // Load existing metadata to preserve fields not being explicitly overridden
    const existing = this.sessionStore.getSession(sid);
    void this.sessionStore.saveSession({
      sessionId: sid,
      name: name || existing?.name || `Session ${this.tabNumber}`,
      model: this.currentModel,
      provider: this.getProvider(),
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
      workspacePath: existing?.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  }

  /** Update the VS Code panel title */
  private setTabName(name: string): void {
    this.baseTitle = name;
    if (this.disposed) {
      return;
    }
    if (this.isBusy) {
      this.applyThinkingFrame();
    } else {
      this.panel.title = name;
    }
  }

  /** Update the busy state and start/stop the animated thinking indicator */
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

  /** Start cycling through spinner frames in the tab title */
  private startThinkingAnimation(): void {
    this.stopThinkingAnimation(); // clear any previous timer
    this.thinkingFrame = 0;
    this.applyThinkingFrame();
    this.thinkingAnimTimer = setInterval(() => {
      this.thinkingFrame = (this.thinkingFrame + 1) % SessionTab.THINKING_FRAMES.length;
      this.applyThinkingFrame();
    }, 120);
  }

  /** Stop the spinner animation and restore the clean title */
  private stopThinkingAnimation(): void {
    if (this.thinkingAnimTimer) {
      clearInterval(this.thinkingAnimTimer);
      this.thinkingAnimTimer = null;
    }
    if (this.baseTitle && !this.disposed) {
      this.panel.title = this.baseTitle;
    }
  }

  /** Set the tab title to the current animation frame */
  private applyThinkingFrame(): void {
    if (!this.baseTitle || this.disposed) {
      return;
    }
    const frame = SessionTab.THINKING_FRAMES[this.thinkingFrame];
    this.panel.title = `${this.baseTitle} ${frame}`;
  }

  /** Move this tab to the rightmost position in its editor group */
  private moveTabToEnd(): void {
    // The panel is automatically focused on creation, so moveActiveEditor targets it
    vscode.commands.executeCommand('moveActiveEditor', {
      by: 'tab',
      to: 'last',
    });
  }

  /** Generate a colored SVG circle and set it as the panel's tab icon */
  private setTabIcon(color: string): void {
    try {
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`;
      const storageDir = this.context.globalStorageUri.fsPath;
      fs.mkdirSync(storageDir, { recursive: true });
      const iconPath = path.join(storageDir, `tab-icon-${this.tabNumber}.svg`);
      fs.writeFileSync(iconPath, svgContent, 'utf-8');
      this.panel.iconPath = vscode.Uri.file(iconPath);
    } catch {
      // Non-critical - tab just won't have a colored icon
    }
  }

  /** Prompt the user for a new tab name */
  private async handleRenameRequest(): Promise<void> {
    if (this.disposed) return;
    const currentName = this.baseTitle || `ClaUi ${this.tabNumber}`;
    const newName = await vscode.window.showInputBox({
      prompt: 'Rename this tab',
      value: currentName,
      placeHolder: 'Tab name...',
    });
    if (newName && newName !== currentName && !this.disposed) {
      this.setTabName(newName);
      this.log(`[Tab ${this.tabNumber}] Renamed to "${newName}"`);
      this.fileLogger?.updateSessionName(newName);
    }
  }

  // --- Internal wiring ---

  private wireWebviewEvents(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.panel.webview.onDidReceiveMessage((message: any) => {
      if (message.type === 'diag') {
        this.log(`[Tab ${this.tabNumber}] Webview DIAG: phase="${message.phase}" ${message.detail || ''}`);
        return;
      }
      // Handle rename request from the tab header bar (not from React)
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
        this.resolveAssistantReplyWaiters(false);
        // Save analytics BEFORE stopping the process to ensure data is persisted
        this.saveProjectAnalytics();
        this.achievementService.onSessionEnd(this.id);
        this.achievementService.unregisterTab(this.id);
        this.skillGenService?.unregisterTab(this.id);
        this.processManager.stop();
        this.fileLogger?.dispose();
      } finally {
        // Must always fire so TabManager removes this tab from its map
        this.callbacks.onClosed(this.id);
      }
    });
  }

  private wireProcessEvents(tabLog: (msg: string) => void): void {
    this.processManager.on('event', (event: CliOutputEvent) => {
      let detail = event.type;
      if ('subtype' in event) {
        detail += '/' + event.subtype;
      }
      if (event.type === 'stream_event') {
        const inner = (event as import('../types/stream-json').StreamEvent).event;
        detail += ` -> ${inner.type}`;
        if ('index' in inner) {
          detail += ` [${inner.index}]`;
        }
        if (inner.type === 'content_block_delta') {
          const delta = (inner as import('../types/stream-json').ContentBlockDelta).delta;
          if (delta.type === 'input_json_delta') {
            // Skip logging noisy input_json_delta events during tool use streaming
            this.demux.handleEvent(event);
            return;
          }
          detail += ` (${delta.type})`;
          if (delta.type === 'text_delta') {
            detail += `: "${(delta.text || '').slice(0, 50)}"`;
          }
        }
        if (inner.type === 'content_block_start') {
          const block = (inner as import('../types/stream-json').ContentBlockStart).content_block;
          detail += ` (${block.type}${block.name ? ': ' + block.name : ''})`;
        }
        // Diagnostic: log raw message_start to see if it has usage/input_tokens
        if (inner.type === 'message_start') {
          tabLog(`[DIAG] message_start raw: ${JSON.stringify(inner).slice(0, 500)}`);
        }
      }
      // Diagnostic: log raw result event
      if (event.type === 'result') {
        tabLog(`[DIAG] result raw: ${JSON.stringify(event).slice(0, 500)}`);
      }
      // Diagnostic: log raw assistant message usage
      if (event.type === 'assistant') {
        tabLog(`[DIAG] assistant raw usage: ${JSON.stringify((event as any).message?.usage).slice(0, 300)}`);
      }
      tabLog(`CLI: ${detail}`);
      this.demux.handleEvent(event);
    });

    this.processManager.on('raw', (text: string) => {
      tabLog(`CLI raw: ${text}`);
    });

    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      tabLog(`Process exited: code=${info.code}, signal=${info.signal}`);

      // Deliberate stop+restart (e.g. edit-and-resend): skip sessionEnded, the new start() handles it
      if (this.suppressNextExit) {
        tabLog('Suppressing exit handling (edit-and-resend restart in progress)');
        this.suppressNextExit = false;
        return;
      }

      if (this.processManager.cancelledByUser) {
        const sessionToResume = this.processManager.currentSessionId;
        tabLog(`Process exited after user cancel - auto-resuming session ${sessionToResume}`);
        // Clear busy state so the user can type immediately
        this.postMessage({ type: 'processBusy', busy: false });
        // Auto-resume the session so the user can keep chatting
        if (sessionToResume) {
          this.processManager
            .start({
              resume: sessionToResume,
              cliPathOverride: this.cliPathOverride ?? undefined,
            })
            .then(() => {
              tabLog('Session auto-resumed after cancel');
            })
            .catch((err) => {
              tabLog(`Failed to auto-resume after cancel: ${err.message}`);
              this.postMessage({ type: 'sessionEnded', reason: 'completed' });
            });
        }
        return;
      }

      // Fork phase 1 complete: --fork-session created the new session and exited.
      // Phase 2: resume the forked session as a normal interactive session.
      if (this.forkInProgress) {
        this.forkInProgress = false;
        const forkedSessionId = this.processManager.currentSessionId;
        if (forkedSessionId) {
          tabLog(`Fork phase 1 complete, new session: ${forkedSessionId}. Starting phase 2...`);
          this.processManager
            .start({
              resume: forkedSessionId,
              skipReplay: true,
              cliPathOverride: this.cliPathOverride ?? undefined,
            })
            .then(() => {
              tabLog(`Fork phase 2: interactive session started for ${forkedSessionId}`);
              this.postMessage({
                type: 'sessionStarted',
                sessionId: forkedSessionId,
                model: this.currentModel || 'connecting...',
                isResume: false,
                provider: this.getProvider(),
              });
            })
            .catch((err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              tabLog(`Fork phase 2 failed: ${errMsg}`);
              this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
              this.postMessage({
                type: 'error',
                message: `Fork failed: ${errMsg}`,
              });
            });
        } else {
          tabLog('Fork failed: no session ID captured from CLI');
          this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
          this.postMessage({
            type: 'error',
            message: 'Fork failed: could not determine the new session ID.',
          });
        }
        return;
      }

      const config = vscode.workspace.getConfiguration('claudeMirror');
      const autoRestart = config.get<boolean>('autoRestart', true);
      const currentSessionId = this.processManager.currentSessionId;

      if (info.code !== 0 && info.code !== null) {
        this.saveProjectAnalytics();
        this.achievementService.onSessionCrash(this.id);
        this.achievementService.onSessionEnd(this.id);

        // Claude CLI not installed - send informative error instead of generic crash
        if (this.claudeCliMissingDetected) {
          tabLog('Claude CLI not found - showing install guidance');
          this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
          this.postMessage({
            type: 'error',
            message: this.getCliMissingMessage(),
          });
          this.claudeCliMissingDetected = false;
          return;
        }

        if (this.happyAuthDetected && this.isHappyCliSession()) {
          tabLog('Happy CLI authentication required - showing auth guidance');
          this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
          this.postMessage({
            type: 'error',
            message: 'Happy Coder requires authentication. Run "ClaUi: Authenticate Happy Coder" from the Command Palette.',
          });
          this.happyAuthDetected = false;
          return;
        }

        this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
        this.postMessage({
          type: 'error',
          message: `Claude process exited with code ${info.code}. Check "ClaUi" output channel for details.`,
        });

        if (autoRestart && currentSessionId) {
          vscode.window
            .showWarningMessage(
              `ClaUi ${this.tabNumber}: process exited (code ${info.code}). Restart?`,
              'Restart',
              'Show Log',
              'Cancel'
            )
            .then(async (choice) => {
              if (choice === 'Restart') {
                try {
                  await this.processManager.start({
                    resume: currentSessionId,
                    cliPathOverride: this.cliPathOverride ?? undefined,
                  });
                } catch {
                  vscode.window.showErrorMessage(
                    `Tab ${this.tabNumber}: Failed to restart Claude session.`
                  );
                }
              } else if (choice === 'Show Log') {
                // Show the shared output channel
                vscode.commands.executeCommand(
                  'workbench.action.output.toggleOutput'
                );
              }
            });
        }
      } else {
        tabLog('Process completed normally');
        this.saveProjectAnalytics();
        this.achievementService.onSessionEnd(this.id);
        this.postMessage({ type: 'sessionEnded', reason: 'completed' });
      }
    });

    this.processManager.on('stderr', (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const normalized = this.stripAnsi(trimmed).trim();
      tabLog(`STDERR: ${trimmed}`);
      if (this.isKnownNonFatalCliStderr(normalized)) {
        tabLog('Ignoring known non-fatal CLI stderr notice');
        return;
      }
      // Detect Claude CLI not installed/not in PATH
      if (this.isLikelyClaudeCliMissing(normalized)) {
        this.claudeCliMissingDetected = true;
        tabLog('Detected Claude CLI missing from stderr');
        // Don't forward raw stderr - the exit handler will send a better message
        return;
      }
      if (this.isHappyCliSession() && this.isLikelyHappyAuthIssue(normalized)) {
        this.happyAuthDetected = true;
        tabLog('Detected Happy auth requirement from stderr');
        // Don't forward raw stderr - the exit handler will send actionable auth guidance
        return;
      }
      this.achievementService.onRuntimeError(this.id);
      this.postMessage({ type: 'error', message: normalized || trimmed });
    });

    this.processManager.on('error', (err: Error) => {
      tabLog(`Process error: ${err.message}`);
      this.achievementService.onRuntimeError(this.id);
      this.achievementService.onSessionCrash(this.id);
      this.achievementService.onSessionEnd(this.id);
      // Check for ENOENT (command not found without shell)
      if (this.isLikelyClaudeCliMissing(err.message)) {
        this.claudeCliMissingDetected = true;
      }
      if (this.claudeCliMissingDetected) {
        tabLog('Claude CLI not found - showing install guidance');
        this.postMessage({
          type: 'error',
          message: this.getCliMissingMessage(),
        });
        this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
        return;
      }
      if (this.isHappyCliSession() && this.isLikelyHappyAuthIssue(err.message)) {
        tabLog('Happy CLI authentication required - showing auth guidance');
        this.happyAuthDetected = true;
        this.postMessage({
          type: 'error',
          message: 'Happy Coder requires authentication. Run "ClaUi: Authenticate Happy Coder" from the Command Palette.',
        });
        this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
        return;
      }
      const cliCommand = this.isHappyCliSession() ? 'happy' : 'claude';
      vscode.window.showErrorMessage(
        `Claude CLI error (Tab ${this.tabNumber}): ${err.message}. Is "${cliCommand}" in your PATH?`
      );
      this.postMessage({ type: 'error', message: `Process error: ${err.message}` });
      this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
    });
  }

  /** Check if stderr/error text indicates Claude CLI is not installed or not in PATH */
  private isLikelyClaudeCliMissing(text: string): boolean {
    const normalized = this.stripAnsi(text);
    const missingPatterns = [
      /'claude'\s+is not recognized as an internal or external command/i,
      /'happy'\s+is not recognized as an internal or external command/i,
      /\bclaude:\s+command not found\b/i,
      /\bhappy:\s+command not found\b/i,
      /\bspawn\b.*\bclaude\b.*\benoent\b/i,
      /\bspawn\b.*\bhappy\b.*\benoent\b/i,
      /\benoent\b.*\bclaude\b/i,
      /\benoent\b.*\bhappy\b/i,
      /command not found.*claude/i,
      /command not found.*happy/i,
    ];
    return missingPatterns.some((pattern) => pattern.test(normalized));
  }

  private isHappyCliSession(): boolean {
    return this.cliPathOverride !== null;
  }

  private isLikelyHappyAuthIssue(text: string): boolean {
    const normalized = this.stripAnsi(text);
    const authPatterns = [
      /auth(entication)?\s+required/i,
      /not authenticated/i,
      /please authenticate/i,
      /qr\s*code/i,
      /token expired/i,
    ];
    return authPatterns.some((pattern) => pattern.test(normalized));
  }

  private isKnownNonFatalCliStderr(text: string): boolean {
    const knownNoisePatterns = [
      /^Using Claude Code v[\w.\-]+ from npm$/i,
    ];
    return knownNoisePatterns.some((pattern) => pattern.test(text));
  }

  private stripAnsi(text: string): string {
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private getCliMissingMessage(): string {
    if (this.isHappyCliSession()) {
      return 'Happy Coder CLI not found. Install Happy Coder CLI or set "claudeMirror.happy.cliPath" to the correct executable path.';
    }
    return 'Claude CLI not found. Install Claude Code CLI by running: npm install -g @anthropic-ai/claude-code';
  }

  /** Build and persist a SessionSummary from accumulated TurnRecords */
  private saveProjectAnalytics(): void {
    if (this.analyticsSaved) {
      this.log(`[ProjectAnalytics] Already saved for this session, skipping`);
      return;
    }
    const turnRecords = this.messageHandler.flushTurnRecords();
    if (turnRecords.length === 0) {
      this.log(`[ProjectAnalytics] No turns to save`);
      return;
    }
    this.analyticsSaved = true;

    const sessionId = this.processManager.currentSessionId || this.id;
    const now = new Date().toISOString();

    // Aggregate metrics
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
      provider: this.getProvider(),
      sessionName: this.baseTitle || `Session ${this.tabNumber}`,
      model: this.currentModel || 'unknown',
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

    this.log(`[ProjectAnalytics] Saving summary: session=${sessionId} turns=${totalTurns} cost=$${totalCostUsd.toFixed(4)}`);
    void this.projectAnalyticsStore.saveSummary(summary);
  }

  private wireDemuxStatusBar(): void {
    this.demux.on('messageStart', () => {
      if (this.disposed) return;
      // Only show status bar if this is the active/focused tab
      try {
        if (this.panel.active) {
          this.statusBarItem.text = `$(loading~spin) Claude thinking... (Tab ${this.tabNumber})`;
          this.statusBarItem.show();
        }
      } catch {
        // Panel may have been disposed between our check and the access
      }
    });

    this.demux.on('assistantMessage', (event: AssistantMessage) => {
      if (this.disposed) return;
      try {
        if (this.panel.active) {
          this.statusBarItem.hide();
        }
      } catch {
        // Panel may have been disposed between our check and the access
      }

      // Detect team activity in assistant messages
      if (event.message?.content) {
        const detection = this.teamDetector.detectTeamActivity(event.message.content);
        if (detection) {
          if (detection.action === 'create' && detection.teamName) {
            this.startTeamWatcher(detection.teamName);
          } else if (detection.action === 'delete') {
            this.stopTeamWatcher(detection.teamName);
          }
        }

        // Stream-based idle detection: scan text blocks for idle_notification JSON.
        // This is a backup mechanism for when file-based inbox reading misses notifications.
        if (this.teamWatcher) {
          for (const block of event.message.content) {
            if (block.type !== 'text' || !block.text) continue;
            try {
              const parsed = JSON.parse(block.text);
              if (parsed?.type === 'idle_notification' && typeof parsed.from === 'string') {
                this.teamWatcher.markAgentIdle(parsed.from);
              }
            } catch { /* not JSON, skip */ }
          }
        }
      }
    });
  }

  /** Save session metadata to store when init event fires */
  private wireDemuxSessionStore(tabLog: (msg: string) => void): void {
    this.demux.on('init', (event: import('../types/stream-json').SystemInitEvent) => {
      this.currentModel = event.model;
      this.sessionStartedAt = new Date().toISOString();
      this.analyticsSaved = false;

      // Restore existing metadata for resumed sessions (preserve name + firstPrompt)
      const existing = this.sessionStore.getSession(event.session_id);
      if (existing) {
        if (existing.firstPrompt) {
          this.firstPrompt = existing.firstPrompt;
        }
        if (existing.name && !existing.name.startsWith('Session ')) {
          this.setTabName(existing.name);
        }
        this.sessionStartedAt = existing.startedAt;
      }

      tabLog(`[SessionStore] Saving initial metadata: session=${event.session_id}, model=${event.model}`);
      this.persistSessionMetadata();

      // Startup recovery: if this session already owns a team, start watching it.
      // This covers VS Code reload and session resume scenarios.
      if (!this.teamWatcher) {
        this.recoverTeamForSession(event.session_id);
      }
    });
  }

  // --- Agent Teams ---

  /** Start watching a team's file system for real-time updates */
  private startTeamWatcher(teamName: string): void {
    // Don't restart if already watching this team
    if (this.activeTeamName === teamName && this.teamWatcher) return;

    this.stopTeamWatcher();
    this.activeTeamName = teamName;
    this.teamAutoPromptSent = false;
    this.teamHadWorkingAgent = false;
    this.log(`[Tab ${this.tabNumber}] Team detected: "${teamName}"`);

    this.teamWatcher = new TeamWatcher(teamName, this.log);
    this.teamActions = new TeamActions(teamName, this.log);

    this.teamWatcher.on('stateChange', (snapshot: TeamStateSnapshot) => {
      if (this.disposed) return;
      this.postMessage({
        type: 'teamStateUpdate',
        teamName: snapshot.teamName,
        config: snapshot.config,
        tasks: snapshot.tasks,
        agentStatuses: snapshot.agentStatuses,
        recentMessages: snapshot.recentMessages,
        lastUpdatedAt: snapshot.lastUpdatedAt,
      });

      // Auto-prompt: when all agents go idle and Claude is waiting for input,
      // send an automatic prompt to trigger Claude to continue and report results.
      this.checkAllAgentsIdleAutoPrompt(snapshot);
    });

    this.teamWatcher.start();
    this.postMessage({ type: 'teamDetected', teamName });
  }

  /**
   * Check whether all team agents are idle while Claude is waiting for input.
   * If so, send an automatic prompt to trigger Claude to continue and report results.
   */
  private checkAllAgentsIdleAutoPrompt(snapshot: TeamStateSnapshot): void {
    const members = snapshot.config?.members;
    if (!members || members.length === 0) return;

    const statuses = snapshot.agentStatuses;
    const agentNames = members.map(m => m.name);

    // Track if any agent has ever been 'working' (don't trigger on a brand-new team)
    const hasWorking = agentNames.some(n => statuses[n] === 'working');
    if (hasWorking) {
      this.teamHadWorkingAgent = true;
      // Reset the prompt guard since agents are working again
      this.teamAutoPromptSent = false;
      return;
    }

    // All agents must be idle
    const allIdle = agentNames.every(n => statuses[n] === 'idle');
    if (!allIdle) return;

    // Guard: only trigger once per idle cycle, and only if agents actually worked
    if (this.teamAutoPromptSent || !this.teamHadWorkingAgent) return;

    // Only trigger when Claude is NOT busy (i.e., waiting for user input)
    if (this.isBusy) return;

    // At least one agent must have sent a message (evidence of work done)
    if (!snapshot.recentMessages || snapshot.recentMessages.length === 0) return;

    this.teamAutoPromptSent = true;
    this.log(`[Tab ${this.tabNumber}] All agents idle — sending auto-prompt to Claude`);

    const autoPromptText = 'All team agents have completed their work and are now idle. Please check the inbox messages, review the results, and provide a summary report.';

    // Show the auto-prompt in the UI so the user sees what happened
    this.postMessage({
      type: 'userMessage',
      content: [{ type: 'text', text: autoPromptText }],
    });

    // Send to Claude Code process
    this.control.sendText(autoPromptText);

    // Mark as busy
    this.postMessage({ type: 'processBusy', busy: true });
  }

  /** Stop the team watcher and notify webview */
  private stopTeamWatcher(teamName?: string): void {
    if (this.teamWatcher) {
      this.teamWatcher.dispose();
      this.teamWatcher = null;
    }
    if (this.activeTeamName) {
      const dismissedName = teamName || this.activeTeamName;
      this.log(`[Tab ${this.tabNumber}] Team dismissed: "${dismissedName}"`);
      this.postMessage({ type: 'teamDismissed', teamName: dismissedName });
    }
    this.activeTeamName = null;
    this.teamActions = null;
  }

  /** Get the TeamActions instance (for MessageHandler delegation) */
  getTeamActions(): TeamActions | null {
    return this.teamActions;
  }

  /** Get the active team name */
  getActiveTeamName(): string | null {
    return this.activeTeamName;
  }

  /**
   * Startup recovery: scan ~/.claude/teams/ for any team whose config.leadSessionId
   * matches the given sessionId. If found, start watching that team so the widget
   * appears after VS Code restart without waiting for a new TeamCreate event.
   */
  private recoverTeamForSession(sessionId: string): void {
    try {
      const homeDir = process.env.USERPROFILE || process.env.HOME || '';
      const teamsDir = require('path').join(homeDir, '.claude', 'teams');
      const fs = require('fs') as typeof import('fs');
      if (!fs.existsSync(teamsDir)) return;

      const entries = fs.readdirSync(teamsDir);
      for (const entry of entries) {
        const configPath = require('path').join(teamsDir, entry, 'config.json');
        if (!fs.existsSync(configPath)) continue;
        try {
          const raw = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(raw) as { leadSessionId?: string; name?: string };
          if (config.leadSessionId === sessionId) {
            const teamName = config.name || entry;
            this.log(`[Tab ${this.tabNumber}] Startup recovery: found team "${teamName}" for session ${sessionId}`);
            this.startTeamWatcher(teamName);
            return;
          }
        } catch { /* skip unreadable configs */ }
      }
      this.log(`[Tab ${this.tabNumber}] Startup recovery: no team found for session ${sessionId}`);
    } catch (err) {
      this.log(`[Tab ${this.tabNumber}] Startup recovery error: ${err}`);
    }
  }

  /** Update the panel title to include the session ID */
  updateTitle(sessionId: string): void {
    const shortId = sessionId.slice(0, 8);
    this.setTabName(`ClaUi ${this.tabNumber} [${shortId}]`);
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
      // Panel may have been disposed between our flag check and the actual call
      this.disposed = true;
    }
  }
}
