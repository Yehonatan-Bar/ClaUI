import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { ControlProtocol } from '../process/ControlProtocol';
import { SessionNamer } from './SessionNamer';
import { ActivitySummarizer } from './ActivitySummarizer';
import { ConversationReader } from './ConversationReader';
import { FileLogger } from './FileLogger';
import type { SessionStore } from './SessionStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import { MessageHandler, type WebviewBridge } from '../webview/MessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import type { CliOutputEvent, AssistantMessage } from '../types/stream-json';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  SerializedChatMessage,
} from '../types/webview-messages';

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

  constructor(
    private readonly context: vscode.ExtensionContext,
    tabNumber: number,
    viewColumn: vscode.ViewColumn,
    tabColor: string,
    private readonly log: (msg: string) => void,
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly callbacks: SessionTabCallbacks,
    private readonly sessionStore: SessionStore,
    private readonly promptHistoryStore: PromptHistoryStore,
    logDir: string | null
  ) {
    this.tabNumber = tabNumber;
    this.id = `tab-${tabNumber}`;

    // Instantiate per-tab components
    this.processManager = new ClaudeProcessManager(context);
    this.demux = new StreamDemux();
    this.control = new ControlProtocol(this.processManager);
    this.messageHandler = new MessageHandler(this, this.processManager, this.control, this.demux, this.promptHistoryStore);
    this.messageHandler.setSessionNameGetter(() => this.baseTitle);

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
    // Intercept processBusy messages to update the tab title indicator
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

  // --- Public API ---

  /** Set fork initialization data (must be called before startSession) */
  setForkInit(init: { promptText: string; messages: SerializedChatMessage[] }): void {
    this.forkInitData = init;
  }

  /** Start a new Claude CLI session in this tab */
  async startSession(options?: { resume?: string; fork?: boolean; cwd?: string }): Promise<void> {
    await this.processManager.start(options);
    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.processManager.currentSessionId || 'pending',
      model: 'connecting...',
      isResume: !!options?.resume,
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
    this.processManager.stop();
    this.fileLogger?.dispose();
    this.panel.dispose();
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
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
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
            .start({ resume: sessionToResume })
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

      const config = vscode.workspace.getConfiguration('claudeMirror');
      const autoRestart = config.get<boolean>('autoRestart', true);
      const currentSessionId = this.processManager.currentSessionId;

      if (info.code !== 0 && info.code !== null) {
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
                  await this.processManager.start({ resume: currentSessionId });
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
        this.postMessage({ type: 'sessionEnded', reason: 'completed' });
      }
    });

    this.processManager.on('stderr', (text: string) => {
      tabLog(`STDERR: ${text}`);
      this.postMessage({ type: 'error', message: text.trim() });
    });

    this.processManager.on('error', (err: Error) => {
      tabLog(`Process error: ${err.message}`);
      vscode.window.showErrorMessage(
        `Claude CLI error (Tab ${this.tabNumber}): ${err.message}. Is "claude" in your PATH?`
      );
      this.postMessage({ type: 'error', message: `Process error: ${err.message}` });
      this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
    });
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

    this.demux.on('assistantMessage', (_event: AssistantMessage) => {
      if (this.disposed) return;
      try {
        if (this.panel.active) {
          this.statusBarItem.hide();
        }
      } catch {
        // Panel may have been disposed between our check and the access
      }
    });
  }

  /** Save session metadata to store when init event fires */
  private wireDemuxSessionStore(tabLog: (msg: string) => void): void {
    this.demux.on('init', (event: import('../types/stream-json').SystemInitEvent) => {
      this.currentModel = event.model;
      this.sessionStartedAt = new Date().toISOString();

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
    });
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
