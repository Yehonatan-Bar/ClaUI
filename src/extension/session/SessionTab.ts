import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { ControlProtocol } from '../process/ControlProtocol';
import { SessionNamer } from './SessionNamer';
import type { SessionStore } from './SessionStore';
import { MessageHandler, type WebviewBridge } from '../webview/MessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import type { CliOutputEvent, AssistantMessage } from '../types/stream-json';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    tabNumber: number,
    viewColumn: vscode.ViewColumn,
    tabColor: string,
    private readonly log: (msg: string) => void,
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly callbacks: SessionTabCallbacks,
    private readonly sessionStore: SessionStore
  ) {
    this.tabNumber = tabNumber;
    this.id = `tab-${tabNumber}`;

    // Instantiate per-tab components
    this.processManager = new ClaudeProcessManager(context);
    this.demux = new StreamDemux();
    this.control = new ControlProtocol(this.processManager);
    this.messageHandler = new MessageHandler(this, this.processManager, this.control, this.demux);

    // Set up per-tab logging with prefix
    const tabLog = (msg: string) => log(`[Tab ${tabNumber}] ${msg}`);
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
      }
    });

    // Create webview panel in the specified column
    this.panel = vscode.window.createWebviewPanel(
      'claudeMirror.chat',
      `Claude Mirror ${tabNumber}`,
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
  }

  // --- WebviewBridge implementation ---

  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this.disposed || !this.panel) {
      return;
    }
    if (!this.isWebviewReady) {
      this.pendingMessages.push(msg);
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
  }

  // --- Public API ---

  /** Start a new Claude CLI session in this tab */
  async startSession(options?: { resume?: string; fork?: boolean; cwd?: string }): Promise<void> {
    await this.processManager.start(options);
    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.processManager.currentSessionId || 'pending',
      model: 'connecting...',
      isResume: !!options?.resume,
    });
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
    this.panel.reveal();
  }

  /** The ViewColumn this panel currently lives in */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel.viewColumn;
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
    return this.panel.visible;
  }

  /** Clean up all resources for this tab */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.processManager.stop();
    this.panel.dispose();
  }

  /** Persist session metadata to the session store */
  private persistSessionMetadata(name?: string): void {
    const sid = this.processManager.currentSessionId;
    if (!sid) {
      return;
    }
    void this.sessionStore.saveSession({
      sessionId: sid,
      name: name || `Session ${this.tabNumber}`,
      model: this.currentModel,
      startedAt: this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
  }

  /** Update the VS Code panel title */
  private setTabName(name: string): void {
    this.panel.title = name;
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
    const currentName = this.panel.title;
    const newName = await vscode.window.showInputBox({
      prompt: 'Rename this tab',
      value: currentName,
      placeHolder: 'Tab name...',
    });
    if (newName && newName !== currentName) {
      this.setTabName(newName);
      this.log(`[Tab ${this.tabNumber}] Renamed to "${newName}"`);
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
      this.processManager.stop();
      this.callbacks.onClosed(this.id);
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
          message: `Claude process exited with code ${info.code}. Check "Claude Mirror" output channel for details.`,
        });

        if (autoRestart && currentSessionId) {
          vscode.window
            .showWarningMessage(
              `Claude Mirror ${this.tabNumber}: process exited (code ${info.code}). Restart?`,
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
      // Only show status bar if this is the active/focused tab
      if (this.panel.active) {
        this.statusBarItem.text = `$(loading~spin) Claude thinking... (Tab ${this.tabNumber})`;
        this.statusBarItem.show();
      }
    });

    this.demux.on('assistantMessage', (_event: AssistantMessage) => {
      if (this.panel.active) {
        this.statusBarItem.hide();
      }
    });
  }

  /** Save session metadata to store when init event fires */
  private wireDemuxSessionStore(tabLog: (msg: string) => void): void {
    this.demux.on('init', (event: import('../types/stream-json').SystemInitEvent) => {
      this.currentModel = event.model;
      this.sessionStartedAt = new Date().toISOString();
      tabLog(`[SessionStore] Saving initial metadata: session=${event.session_id}, model=${event.model}`);
      this.persistSessionMetadata();
    });
  }

  /** Update the panel title to include the session ID */
  updateTitle(sessionId: string): void {
    const shortId = sessionId.slice(0, 8);
    this.panel.title = `Claude Mirror ${this.tabNumber} [${shortId}]`;
  }

  private flushPendingMessages(): void {
    if (this.disposed || this.pendingMessages.length === 0) {
      return;
    }
    const queued = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queued) {
      void this.panel.webview.postMessage(message);
    }
  }
}
