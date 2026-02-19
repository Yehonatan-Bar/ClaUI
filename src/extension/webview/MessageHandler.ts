import * as vscode from 'vscode';
import type { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import type { ControlProtocol } from '../process/ControlProtocol';
import type { StreamDemux } from '../process/StreamDemux';
import type { SessionNamer } from '../session/SessionNamer';
import type { ActivitySummarizer, ActivitySummary } from '../session/ActivitySummarizer';
import type { AdventureInterpreter } from '../session/AdventureInterpreter';
import type { MessageTranslator } from '../session/MessageTranslator';
import type { PromptHistoryStore } from '../session/PromptHistoryStore';
import type { AchievementService } from '../achievements/AchievementService';
import type {
  ExtensionToWebviewMessage,
  TypingTheme,
  TurnCategory,
  TurnRecord,
  WebviewToExtensionMessage,
} from '../types/webview-messages';
import type {
  SystemInitEvent,
  AssistantMessage,
  UserMessage,
  ResultSuccess,
  ResultError,
} from '../types/stream-json';

/**
 * Minimal interface that MessageHandler needs to communicate with a webview.
 * Decouples MessageHandler from the concrete WebviewProvider class,
 * allowing each SessionTab to provide its own panel-based bridge.
 */
export interface WebviewBridge {
  postMessage(msg: ExtensionToWebviewMessage): void;
  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void;
  /** Signal that a deliberate stop+restart is in progress (e.g. edit-and-resend).
   *  The exit handler should suppress the sessionEnded message for this cycle. */
  setSuppressNextExit?(suppress: boolean): void;
  /** Switch the running session to a different model (stop + resume with new --model flag) */
  switchModel?(model: string): Promise<void>;
}

/**
 * Bridges communication between the webview UI and the Claude process.
 * Translates webview postMessages into CLI commands and
 * StreamDemux events into webview messages.
 */
/** Tool names that require user approval when the CLI pauses after calling them */
const APPROVAL_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];

function isApprovalToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return APPROVAL_TOOLS.some((tool) => {
    const t = tool.toLowerCase();
    return normalized === t || normalized.endsWith(`.${t}`);
  });
}

function isEnterPlanModeTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'enterplanmode' || normalized.endsWith('.enterplanmode');
}

/** Tool name sets for turn categorization (Session Vitals) */
const CODE_WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'];
const RESEARCH_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
const COMMAND_TOOLS = ['Bash', 'Terminal'];

function categorizeTurn(toolNames: string[], isError: boolean): TurnCategory {
  if (isError) return 'error';
  if (toolNames.length === 0) return 'discussion';
  const baseNames = toolNames.map(n => n.includes('__') ? n.split('__').pop()! : n);
  if (baseNames.some(n => CODE_WRITE_TOOLS.includes(n))) return 'code-write';
  if (baseNames.some(n => COMMAND_TOOLS.includes(n))) return 'command';
  if (baseNames.some(n => RESEARCH_TOOLS.includes(n))) return 'research';
  return 'success';
}

export class MessageHandler {
  private log: (msg: string) => void = () => {};
  private firstMessageSent = false;
  private sessionNamer: SessionNamer | null = null;
  private titleCallback: ((title: string) => void) | null = null;
  private firstPromptCallback: ((prompt: string) => void) | null = null;

  /** Tool names seen in the current assistant message (cleared on messageStart) */
  private currentMessageToolNames: string[] = [];
  /** Set when the CLI pauses waiting for plan/question approval */
  private pendingApprovalTool: string | null = null;
  /** Set after user responds to approval - suppresses stale re-notifications from late events */
  private approvalResponseProcessed = false;
  /** After user approves ExitPlanMode, auto-approve subsequent ExitPlanMode calls in the same turn */
  private autoApproveExitPlanMode = false;
  /** Tracks whether EnterPlanMode was called in this session (prevents stale ExitPlanMode after compaction) */
  private planModeActive = false;

  /** Activity summarizer: periodically summarizes tool activity via Haiku */
  private activitySummarizer: ActivitySummarizer | null = null;
  private activitySummaryCallback: ((summary: ActivitySummary) => void) | null = null;
  /** Maps blockIndex -> toolName for tool_use blocks in the current message */
  private toolBlockNames: Map<number, string> = new Map();
  /** Maps blockIndex -> first chunk of partial JSON (for enrichment context) */
  private toolBlockContexts: Map<number, string> = new Map();
  /** Getter for the session/tab name, injected by SessionTab */
  private getSessionName: (() => string) | null = null;
  /** Message translator for Hebrew translation feature */
  private messageTranslator: MessageTranslator | null = null;
  /** Adventure interpreter for dungeon crawler beat generation */
  private adventureInterpreter: AdventureInterpreter | null = null;

  /** Turn counter for Session Vitals (reset on session clear) */
  private turnIndex = 0;
  /** Last assistant message ID for TurnRecord association */
  private lastMessageId = '';

  constructor(
    private readonly tabId: string,
    private readonly webview: WebviewBridge,
    private readonly processManager: ClaudeProcessManager,
    private readonly control: ControlProtocol,
    private readonly demux: StreamDemux,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService
  ) {}

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Attach a SessionNamer for auto-generating tab titles */
  setSessionNamer(namer: SessionNamer): void {
    this.sessionNamer = namer;
  }

  /** Register a callback invoked when a session name is generated */
  onSessionNameGenerated(callback: (title: string) => void): void {
    this.titleCallback = callback;
  }

  /** Register a callback invoked when the first user prompt is captured */
  onFirstPromptCaptured(callback: (prompt: string) => void): void {
    this.firstPromptCallback = callback;
  }

  /** Attach an ActivitySummarizer for periodic tool activity summaries */
  setActivitySummarizer(summarizer: ActivitySummarizer): void {
    this.activitySummarizer = summarizer;
  }

  /** Register a callback invoked when an activity summary is generated */
  onActivitySummaryGenerated(callback: (summary: ActivitySummary) => void): void {
    this.activitySummaryCallback = callback;
  }

  /** Inject a getter for the current session/tab name (used for git push commit messages) */
  setSessionNameGetter(getter: () => string): void {
    this.getSessionName = getter;
  }

  /** Attach a MessageTranslator for Hebrew translation feature */
  setMessageTranslator(translator: MessageTranslator): void {
    this.messageTranslator = translator;
  }

  /** Attach an AdventureInterpreter for dungeon crawler beat generation */
  setAdventureInterpreter(interpreter: AdventureInterpreter): void {
    this.adventureInterpreter = interpreter;
  }

  /** Wire up all event listeners */
  initialize(): void {
    this.bindWebviewMessages();
    this.bindDemuxEvents();
    this.watchConfigChanges();
    this.wireActivitySummarizer();
  }

  /** Handle messages coming FROM the webview */
  private bindWebviewMessages(): void {
    this.webview.onMessage((msg: WebviewToExtensionMessage) => {
      this.log(`Webview -> Extension: ${msg.type}`);

      switch (msg.type) {
        case 'sendMessage':
          this.log(`Sending user message: "${msg.text.slice(0, 80)}..."`);
          // If there was a pending approval, the user's message implicitly responds to it
          this.clearApprovalTracking();
          this.autoApproveExitPlanMode = false;
          this.achievementService.onUserPrompt(this.tabId, msg.text);
          this.control.sendText(msg.text);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          // Persist prompt to project and global history
          void this.promptHistoryStore.addPrompt(msg.text);
          break;

        case 'sendMessageWithImages':
          this.log(`Sending message with ${msg.images.length} images`);
          // If there was a pending approval, the user's message implicitly responds to it
          this.clearApprovalTracking();
          this.autoApproveExitPlanMode = false;
          if (msg.text.trim()) {
            this.achievementService.onUserPrompt(this.tabId, msg.text);
          }
          this.control.sendWithImages(msg.text, msg.images);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          if (msg.text.trim()) {
            void this.promptHistoryStore.addPrompt(msg.text);
          }
          break;

        case 'cancelRequest':
          this.log('Cancel requested - killing process');
          // Immediate UI feedback so the user sees the cancel take effect
          this.webview.postMessage({ type: 'processBusy', busy: false });
          this.clearApprovalTracking();
          this.achievementService.onCancel(this.tabId);
          try {
            this.control.cancel();
          } catch (err) {
            this.log(`Cancel error (non-fatal): ${err}`);
          }
          break;

        case 'compact':
          this.control.compact(msg.instructions);
          break;

        case 'startSession':
          this.firstMessageSent = false;
          this.activitySummarizer?.reset();
          this.adventureInterpreter?.reset();
          // If already running, just sync the webview state
          if (this.processManager.isRunning) {
            this.log('startSession - process already running, syncing state');
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.processManager.currentSessionId || 'active',
              model: 'connected',
            });
            break;
          }
          this.processManager
            .start({ cwd: msg.workspacePath })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
              this.log('Process started from webview button');
              this.webview.postMessage({
                type: 'sessionStarted',
                sessionId: this.processManager.currentSessionId || 'pending',
                model: 'connecting...',
              });
            })
            .catch((err) => {
              this.webview.postMessage({
                type: 'error',
                message: `Failed to start session: ${err.message}`,
              });
            });
          break;

        case 'stopSession':
          this.processManager.stop();
          this.achievementService.onSessionEnd(this.tabId);
          this.webview.postMessage({
            type: 'sessionEnded',
            reason: 'stopped',
          });
          break;

        case 'resumeSession':
          this.firstMessageSent = false;
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager
            .start({ resume: msg.sessionId })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
            })
            .catch((err) => {
              this.webview.postMessage({
                type: 'error',
                message: `Failed to resume session: ${err.message}`,
              });
            });
          break;

        case 'forkSession':
          this.firstMessageSent = false;
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager
            .start({ resume: msg.sessionId, fork: true })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
            })
            .catch((err) => {
              this.webview.postMessage({
                type: 'error',
                message: `Failed to fork session: ${err.message}`,
              });
            });
          break;

        case 'pickFiles':
          this.handlePickFiles();
          break;

        case 'fileSearch':
          this.handleFileSearch(msg.query, msg.requestId);
          break;

        case 'clearSession':
          this.firstMessageSent = false;
          this.activitySummarizer?.reset();
          this.adventureInterpreter?.reset();
          this.log('clearSession - stopping current process and starting fresh');
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager.stop();
          this.processManager
            .start({ cwd: msg.workspacePath })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
              this.log('Process restarted after clear');
              this.webview.postMessage({
                type: 'sessionStarted',
                sessionId: this.processManager.currentSessionId || 'pending',
                model: 'connecting...',
              });
            })
            .catch((err) => {
              this.webview.postMessage({
                type: 'error',
                message: `Failed to restart session: ${err.message}`,
              });
            });
          break;

        case 'setModel':
          this.log(`Setting model to: "${msg.model}"`);
          vscode.workspace.getConfiguration('claudeMirror').update('model', msg.model, true);
          break;

        case 'setTypingTheme':
          this.log(`Setting typing theme to: "${msg.theme}"`);
          vscode.workspace.getConfiguration('claudeMirror').update('typingTheme', msg.theme, true);
          break;


        case 'setPermissionMode':
          this.log(`Setting permission mode to: "${msg.mode}"`);
          vscode.workspace.getConfiguration('claudeMirror').update('permissionMode', msg.mode, true);
          break;

        case 'setVitalsEnabled':
          this.log(`Setting session vitals to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('sessionVitals', msg.enabled, true);
          break;

        case 'setAdventureWidgetEnabled':
          this.log(`Setting adventure widget to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('adventureWidget', msg.enabled, true);
          break;

        case 'showHistory':
          this.log('Webview requested history view');
          vscode.commands.executeCommand('claudeMirror.showHistory');
          break;

        case 'openPlanDocs':
          this.log('Webview requested plan docs viewer');
          vscode.commands.executeCommand('claudeMirror.openPlanDocs');
          break;

        case 'planApprovalResponse':
          this.log(`Plan approval response: action=${msg.action}`);
          // If user approves an ExitPlanMode, auto-approve subsequent ExitPlanMode
          // calls in the same turn so the user isn't interrupted repeatedly.
          if (msg.action === 'approve' && this.pendingApprovalTool) {
            const norm = this.pendingApprovalTool.trim().toLowerCase();
            if (norm === 'exitplanmode' || norm.endsWith('.exitplanmode')) {
              this.autoApproveExitPlanMode = true;
              // Plan mode cycle complete - clear the flag
              this.planModeActive = false;
            }
          }
          // Rejecting or giving feedback on ExitPlanMode also ends the plan cycle
          if ((msg.action === 'reject' || msg.action === 'feedback') && this.pendingApprovalTool) {
            const norm = this.pendingApprovalTool.trim().toLowerCase();
            if (norm === 'exitplanmode' || norm.endsWith('.exitplanmode')) {
              this.planModeActive = false;
            }
          }
          if (msg.action === 'approve') {
            this.control.sendText('Yes, proceed with the plan.');
          } else if (msg.action === 'reject') {
            this.control.sendText('No, I reject this plan. Please revise it.');
          } else if (msg.action === 'feedback') {
            this.control.sendText(msg.feedback || 'Please revise the plan.');
          } else if (msg.action === 'questionAnswer') {
            // User selected option(s) from an AskUserQuestion prompt
            const answer = msg.selectedOptions?.join(', ') || msg.feedback || '';
            this.log(`Question answer: "${answer}"`);
            this.control.sendText(answer);
          }
          this.clearApprovalTracking();
          // Suppress stale re-notifications from late assistantMessage events
          // that may arrive after the user has already responded.
          this.approvalResponseProcessed = true;
          this.webview.postMessage({ type: 'processBusy', busy: true });
          break;

        case 'forkFromMessage':
          this.log(`Fork from message: sessionId=${msg.sessionId}, index=${msg.forkMessageIndex}, historyLen=${msg.messages?.length ?? 0}`);
          vscode.commands.executeCommand(
            'claudeMirror.forkFromMessage',
            msg.sessionId,
            msg.forkMessageIndex,
            msg.promptText,
            msg.messages || []
          );
          break;

        case 'editAndResend':
          this.log(`Edit-and-resend: stopping session and restarting with edited prompt`);
          this.clearApprovalTracking();
          this.autoApproveExitPlanMode = false;
          this.firstMessageSent = false;
          this.activitySummarizer?.reset();
          this.achievementService.onSessionEnd(this.tabId);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          {
            const editedText = msg.text;
            // Tell the exit handler not to send sessionEnded - we're restarting intentionally
            this.webview.setSuppressNextExit?.(true);
            this.processManager.stop();
            this.processManager
              .start()
              .then(() => {
                this.achievementService.onSessionStart(this.tabId);
                this.log('New session started for edit-and-resend');
                this.webview.postMessage({
                  type: 'sessionStarted',
                  sessionId: this.processManager.currentSessionId || 'pending',
                  model: 'connecting...',
                });
                // Send the edited message immediately - don't wait for system/init.
                // The CLI in pipe mode only emits init AFTER receiving the first message,
                // so waiting for init before sending would deadlock.
                this.log(`Edit-and-resend: sending edited prompt`);
                this.control.sendText(editedText);
                this.triggerSessionNaming(editedText);
                void this.promptHistoryStore.addPrompt(editedText);
              })
              .catch((err) => {
                this.webview.postMessage({ type: 'processBusy', busy: false });
                this.webview.postMessage({
                  type: 'error',
                  message: `Failed to restart session for edit: ${err.message}`,
                });
              });
          }
          break;

        case 'getPromptHistory':
          this.log(`Fetching prompt history: scope=${msg.scope}`);
          {
            const prompts = msg.scope === 'project'
              ? this.promptHistoryStore.getProjectHistory()
              : this.promptHistoryStore.getGlobalHistory();
            this.webview.postMessage({
              type: 'promptHistoryResponse',
              scope: msg.scope,
              prompts,
            });
          }
          break;

        case 'openFile':
          this.log(`Opening file in editor: "${msg.filePath}"`);
          this.handleOpenFile(msg.filePath);
          break;

        case 'openUrl':
          this.log(`Opening URL in browser: "${msg.url}"`);
          this.handleOpenUrl(msg.url);
          break;

        case 'gitPush':
          this.handleGitPush();
          break;

        case 'gitPushConfig':
          this.log(`Git push config request: "${msg.instruction.slice(0, 80)}..."`);
          {
            const configPrompt = `Please help me configure git push for this VS Code extension project. The settings are VS Code settings under "claudeMirror.gitPush.*": enabled (boolean), scriptPath (string, relative to workspace), commitMessageTemplate (string, supports {sessionName} placeholder). ${msg.instruction}`;
            this.control.sendText(configPrompt);
            this.webview.postMessage({ type: 'processBusy', busy: true });
          }
          break;

        case 'getGitPushSettings':
          this.sendGitPushSettings();
          break;

        case 'setAchievementsEnabled':
          vscode.workspace.getConfiguration('claudeMirror').update('achievements.enabled', msg.enabled, true);
          break;

        case 'getAchievementsSnapshot':
          this.webview.postMessage(this.achievementService.buildSettingsMessage());
          this.webview.postMessage(this.achievementService.buildSnapshotMessage(this.tabId));
          break;

        case 'translateMessage':
          this.log(`Translate request: messageId=${msg.messageId}, textLength=${msg.textContent.length}`);
          if (!this.messageTranslator) {
            this.webview.postMessage({
              type: 'translationResult',
              messageId: msg.messageId,
              translatedText: null,
              success: false,
              error: 'Translator not available',
            });
            break;
          }
          this.messageTranslator
            .translate(msg.textContent)
            .then((translatedText) => {
              this.webview.postMessage({
                type: 'translationResult',
                messageId: msg.messageId,
                translatedText,
                success: !!translatedText,
                error: translatedText ? undefined : 'Translation failed',
              });
            })
            .catch((err) => {
              this.log(`Translation error: ${err}`);
              this.webview.postMessage({
                type: 'translationResult',
                messageId: msg.messageId,
                translatedText: null,
                success: false,
                error: `Translation error: ${err.message}`,
              });
            });
          break;

        case 'ready':
          this.log('Webview ready');
          // Send text display settings
          this.sendTextSettings();
          // Send typing theme setting
          this.sendTypingThemeSetting();
          // Send model setting
          this.sendModelSetting();
          // Send permission mode setting
          this.sendPermissionModeSetting();
          // Send git push settings
          this.sendGitPushSettings();
          // Send session vitals setting
          this.sendVitalsSetting();
          // Send adventure widget setting
          this.sendAdventureWidgetSetting();
          // Send achievement settings/snapshot
          this.webview.postMessage(this.achievementService.buildSettingsMessage());
          this.webview.postMessage(this.achievementService.buildSnapshotMessage(this.tabId));
          // If process is already running, tell the webview
          if (this.processManager.isRunning && this.processManager.currentSessionId) {
            this.log('Sending existing session info to webview');
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.processManager.currentSessionId,
              model: 'unknown',
            });
          }
          break;
      }
    });
  }

  /** Open a file picker dialog and send selected paths back to the webview */
  private async handlePickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: true,
      openLabel: 'Select',
    });

    if (uris && uris.length > 0) {
      const paths = uris.map((uri) => uri.fsPath);
      this.log(`File picker: ${paths.length} paths selected`);
      this.webview.postMessage({
        type: 'filePathsPicked',
        paths,
      });
    }
  }

  /** Search workspace files matching a query and send results to webview */
  private async handleFileSearch(query: string, requestId: number): Promise<void> {
    try {
      // Build case-insensitive glob: each letter becomes [aA] character class
      const ciQuery = query.replace(/[a-zA-Z]/g, c => `[${c.toLowerCase()}${c.toUpperCase()}]`);
      const glob = query ? `**/*${ciQuery}*` : '**/*';
      const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/.vscode/**}';
      const uris = await vscode.workspace.findFiles(glob, excludePattern, 50);

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const pathMod = require('path');

      const results = uris.map(uri => ({
        relativePath: pathMod.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/'),
        fileName: pathMod.basename(uri.fsPath),
      }));

      const queryLower = query.toLowerCase();
      results.sort((a: { relativePath: string; fileName: string }, b: { relativePath: string; fileName: string }) => {
        const aMatch = a.fileName.toLowerCase().includes(queryLower);
        const bMatch = b.fileName.toLowerCase().includes(queryLower);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return a.relativePath.localeCompare(b.relativePath);
      });

      this.webview.postMessage({
        type: 'fileSearchResults',
        results: results.slice(0, 50),
        requestId,
      });
    } catch (err) {
      this.log(`File search error: ${err}`);
      this.webview.postMessage({
        type: 'fileSearchResults',
        results: [],
        requestId,
      });
    }
  }

  /** Open a file in the VS Code editor, with optional :line:col navigation */
  private handleOpenFile(rawPath: string): void {
    // Parse optional :line and :line:col suffix
    let filePath = rawPath;
    let line: number | undefined;
    let col: number | undefined;

    const lineColMatch = filePath.match(/:(\d+)(?::(\d+))?$/);
    if (lineColMatch) {
      line = parseInt(lineColMatch[1], 10);
      col = lineColMatch[2] ? parseInt(lineColMatch[2], 10) : undefined;
      filePath = filePath.slice(0, lineColMatch.index);
    }

    // Resolve relative paths against workspace root
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/');
    if (!isAbsolute) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        const path = require('path');
        filePath = path.resolve(workspaceRoot, filePath);
      }
    }

    const uri = vscode.Uri.file(filePath);
    const openOptions: vscode.TextDocumentShowOptions = {};
    if (line !== undefined) {
      // VS Code lines are 0-indexed, file paths use 1-indexed
      const pos = new vscode.Position(line - 1, (col ?? 1) - 1);
      openOptions.selection = new vscode.Range(pos, pos);
    }

    vscode.commands.executeCommand('vscode.open', uri, openOptions).then(
      () => this.log(`Opened file: ${filePath}${line ? `:${line}` : ''}`),
      (err) => this.log(`Failed to open file: ${err}`)
    );
  }

  /** Open a URL in the user's default external browser */
  private handleOpenUrl(url: string): void {
    // Basic validation: only allow http/https URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.log(`Rejected non-HTTP URL: "${url}"`);
      return;
    }
    vscode.env.openExternal(vscode.Uri.parse(url)).then(
      (success) => this.log(`Opened URL: ${url} (success=${success})`),
      (err) => this.log(`Failed to open URL: ${err}`)
    );
  }

  /** Read text display settings from VS Code config and send to webview */
  private sendTextSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const fontSize = config.get<number>('chatFontSize', 14);
    const fontFamily = config.get<string>('chatFontFamily', '');
    this.log(`Sending text settings: fontSize=${fontSize}, fontFamily="${fontFamily}"`);
    this.webview.postMessage({
      type: 'textSettings',
      fontSize,
      fontFamily,
    });
  }

  /** Read typing theme setting from VS Code config and send to webview */
  private sendTypingThemeSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const theme = config.get<TypingTheme>('typingTheme', 'zen');
    this.log(`Sending typing theme setting: "${theme}"`);
    this.webview.postMessage({
      type: 'typingThemeSetting',
      theme,
    });
  }

  /** Read model setting from VS Code config and send to webview */
  private sendModelSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const model = config.get<string>('model', '');
    this.log(`Sending model setting: "${model}"`);
    this.webview.postMessage({
      type: 'modelSetting',
      model,
    });
  }

  /** Read permission mode setting from VS Code config and send to webview */
  private sendPermissionModeSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const mode = config.get<string>('permissionMode', 'full-access');
    this.log(`Sending permission mode setting: "${mode}"`);
    this.webview.postMessage({
      type: 'permissionModeSetting',
      mode: mode as 'full-access' | 'supervised',
    });
  }

  /** Read git push settings from VS Code config and send to webview */
  private sendGitPushSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('gitPush.enabled', true);
    const scriptPath = config.get<string>('gitPush.scriptPath', 'scripts/git-push.ps1');
    const commitMessageTemplate = config.get<string>('gitPush.commitMessageTemplate', '{sessionName}');
    this.log(`Sending git push settings: enabled=${enabled}, script="${scriptPath}"`);
    this.webview.postMessage({
      type: 'gitPushSettings',
      enabled,
      scriptPath,
      commitMessageTemplate,
    });
  }

  /** Read session vitals setting from VS Code config and send to webview */
  private sendVitalsSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('sessionVitals', true);
    this.log(`Sending vitals setting: enabled=${enabled}`);
    this.webview.postMessage({
      type: 'vitalsSetting',
      enabled,
    });
  }

  /** Read adventure widget setting from VS Code config and send to webview */
  private sendAdventureWidgetSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('adventureWidget', true);
    this.log(`Sending adventure widget setting: enabled=${enabled}`);
    this.webview.postMessage({
      type: 'adventureWidgetSetting',
      enabled,
    });
  }

  /** Execute the git push script */
  private handleGitPush(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('gitPush.enabled', true);

    if (!enabled) {
      this.webview.postMessage({
        type: 'gitPushResult',
        success: false,
        output: 'Git push is not configured. Please set it up first.',
      });
      return;
    }

    const scriptPath = config.get<string>('gitPush.scriptPath', 'scripts/git-push.ps1');
    const template = config.get<string>('gitPush.commitMessageTemplate', '{sessionName}');

    const sessionName = this.getSessionName?.() || 'Claude session';
    const commitMessage = template.replace('{sessionName}', sessionName);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.webview.postMessage({
        type: 'gitPushResult',
        success: false,
        output: 'No workspace folder open.',
      });
      return;
    }

    const path = require('path');
    const fullScriptPath = path.resolve(workspaceRoot, scriptPath);
    this.log(`Git push: running "${fullScriptPath}" with message "${commitMessage}"`);

    const cp = require('child_process');
    cp.execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fullScriptPath, '-Message', commitMessage],
      { cwd: workspaceRoot, timeout: 30000 },
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          this.log(`Git push failed: ${error.message}`);
          this.webview.postMessage({
            type: 'gitPushResult',
            success: false,
            output: stderr || error.message,
          });
        } else {
          this.log('Git push succeeded');
          this.webview.postMessage({
            type: 'gitPushResult',
            success: true,
            output: stdout,
          });
        }
      }
    );
  }

  /** Watch for settings changes and forward to webview */
  private watchConfigChanges(): void {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeMirror.chatFontSize') ||
          e.affectsConfiguration('claudeMirror.chatFontFamily')) {
        this.sendTextSettings();
      }
      if (e.affectsConfiguration('claudeMirror.model')) {
        this.sendModelSetting();
      }
      if (e.affectsConfiguration('claudeMirror.typingTheme')) {
        this.sendTypingThemeSetting();
      }
      if (e.affectsConfiguration('claudeMirror.permissionMode')) {
        this.sendPermissionModeSetting();
      }
      if (e.affectsConfiguration('claudeMirror.gitPush')) {
        this.sendGitPushSettings();
      }
      if (e.affectsConfiguration('claudeMirror.sessionVitals')) {
        this.sendVitalsSetting();
      }
      if (e.affectsConfiguration('claudeMirror.adventureWidget')) {
        this.sendAdventureWidgetSetting();
      }
      if (
        e.affectsConfiguration('claudeMirror.achievements.enabled') ||
        e.affectsConfiguration('claudeMirror.achievements.sound')
      ) {
        this.achievementService.onConfigChanged();
      }
    });
  }

  /** Forward StreamDemux events TO the webview */
  private bindDemuxEvents(): void {
    this.demux.on(
      'init',
      (event: SystemInitEvent) => {
        this.log(`system/init received: session=${event.session_id}, model=${event.model}`);
        // Update webview with real session info (replaces the "connecting..." placeholder)
        this.webview.postMessage({
          type: 'sessionStarted',
          sessionId: event.session_id,
          model: event.model,
        });
      }
    );

    this.demux.on(
      'textDelta',
      (data: { messageId: string; blockIndex: number; text: string }) => {
        this.log(`-> webview: streamingText msgId=${data.messageId} block=${data.blockIndex} "${data.text.slice(0, 40)}"`);
        this.webview.postMessage({
          type: 'streamingText',
          text: data.text,
          messageId: data.messageId,
          blockIndex: data.blockIndex,
        });
      }
    );

    this.demux.on(
      'toolUseStart',
      (data: { messageId: string; blockIndex: number; toolName: string; toolId: string }) => {
        this.log(`-> webview: toolUseStart ${data.toolName}`);
        this.currentMessageToolNames.push(data.toolName);
        // Track plan mode: EnterPlanMode sets the flag so ExitPlanMode knows it's legitimate
        if (isEnterPlanModeTool(data.toolName)) {
          this.planModeActive = true;
          this.log('Plan mode activated (EnterPlanMode detected)');
        }
        // Track for activity summarizer enrichment
        this.toolBlockNames.set(data.blockIndex, data.toolName);
        this.webview.postMessage({
          type: 'toolUseStart',
          messageId: data.messageId,
          blockIndex: data.blockIndex,
          toolName: data.toolName,
          toolId: data.toolId,
        });
      }
    );

    this.demux.on(
      'toolUseDelta',
      (data: { messageId: string; blockIndex: number; partialJson: string }) => {
        // Capture first chunk of JSON input for activity summarizer context
        if (!this.toolBlockContexts.has(data.blockIndex)) {
          this.toolBlockContexts.set(data.blockIndex, data.partialJson.slice(0, 150));
        }
        this.webview.postMessage({
          type: 'toolUseInput',
          messageId: data.messageId,
          blockIndex: data.blockIndex,
          partialJson: data.partialJson,
        });
      }
    );

    this.demux.on(
      'blockStop',
      (data: { blockIndex: number }) => {
        const toolName = this.toolBlockNames.get(data.blockIndex);
        const rawInput = this.toolBlockContexts.get(data.blockIndex) || '';
        if (toolName && this.activitySummarizer) {
          const enriched = this.enrichToolName(toolName, data.blockIndex);
          this.activitySummarizer.recordToolUse(enriched);
        }
        if (toolName) {
          this.achievementService.onToolUse(this.tabId, toolName, rawInput);
        }
        this.toolBlockNames.delete(data.blockIndex);
        this.toolBlockContexts.delete(data.blockIndex);
      }
    );

    this.demux.on(
      'messageDelta',
      (data: { stopReason: string | null }) => {
        // When stop_reason is 'tool_use', the CLI is pausing for tool execution.
        // If one of the tools is an approval tool (ExitPlanMode, AskUserQuestion),
        // the CLI is waiting for the user to respond - notify the webview.
        if (data.stopReason === 'tool_use') {
          const approvalTool = this.currentMessageToolNames.find(
            name => isApprovalToolName(name)
          );
          if (approvalTool) {
            this.notifyPlanApprovalRequired(approvalTool);
          }
        }
      }
    );

    this.demux.on(
      'assistantMessage',
      (event: AssistantMessage) => {
        const blockTypes = event.message.content.map(b => b.type).join(', ');
        const assistantText = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text || '')
          .join('\n');
        if (assistantText.trim()) {
          this.achievementService.onAssistantText(this.tabId, assistantText);
        }
        this.log(`-> webview: assistantMessage id=${event.message.id} blocks=[${blockTypes}]`);
        this.webview.postMessage({
          type: 'assistantMessage',
          messageId: event.message.id,
          content: event.message.content,
          model: event.message.model,
        });
        // Fallback for CLI variants that don't emit (or reorder) message_delta.
        // Detect approval waits directly from assistant stop_reason + tool blocks.
        if (!this.pendingApprovalTool && event.message.stop_reason === 'tool_use') {
          const approvalToolBlock = event.message.content.find(
            (block) => block.type === 'tool_use' && !!block.name && isApprovalToolName(block.name)
          );
          if (approvalToolBlock?.name) {
            this.notifyPlanApprovalRequired(approvalToolBlock.name);
          }
        }
        // Don't set busy=false here - intermediate assistant events arrive mid-stream.
        // Busy is cleared on 'result' event only.
      }
    );

    this.demux.on(
      'messageStart',
      (data: { messageId: string; model: string }) => {
        this.log(`-> webview: messageStart id=${data.messageId}`);
        this.lastMessageId = data.messageId;
        this.currentMessageToolNames = [];
        this.pendingApprovalTool = null;
        this.approvalResponseProcessed = false;
        this.toolBlockNames.clear();
        this.toolBlockContexts.clear();
        this.webview.postMessage({
          type: 'messageStart',
          messageId: data.messageId,
          model: data.model,
        });
      }
    );

    this.demux.on(
      'messageStop',
      () => {
        this.log(`-> webview: messageStop`);
        this.webview.postMessage({ type: 'messageStop' });
      }
    );

    this.demux.on(
      'userMessage',
      (event: UserMessage) => {
        this.webview.postMessage({
          type: 'userMessage',
          content: event.message.content,
        });
      }
    );

    this.demux.on(
      'result',
      (event: ResultSuccess | ResultError) => {
        // Snapshot tool names BEFORE clearing (clearApprovalTracking resets the array)
        const toolNamesSnapshot = [...this.currentMessageToolNames];

        this.clearApprovalTracking();
        this.autoApproveExitPlanMode = false;
        if (event.subtype === 'success') {
          this.achievementService.onResult(this.tabId, true);
          const success = event as ResultSuccess;
          this.webview.postMessage({
            type: 'costUpdate',
            costUsd: success.cost_usd,
            totalCostUsd: success.total_cost_usd,
            inputTokens: success.usage.input_tokens,
            outputTokens: success.usage.output_tokens,
          });
          // Session Vitals: emit turn completion record
          const successTurn = {
            turnIndex: this.turnIndex++,
            toolNames: toolNamesSnapshot,
            toolCount: toolNamesSnapshot.length,
            durationMs: (success as any).duration_ms ?? 0,
            costUsd: success.cost_usd ?? 0,
            totalCostUsd: success.total_cost_usd ?? 0,
            isError: false,
            category: categorizeTurn(toolNamesSnapshot, false),
            timestamp: Date.now(),
            messageId: this.lastMessageId,
          };
          this.webview.postMessage({ type: 'turnComplete', turn: successTurn });
          // Adventure Widget: generate and send beat
          if (this.adventureInterpreter) {
            const beat = this.adventureInterpreter.interpret(successTurn as TurnRecord);
            this.webview.postMessage({ type: 'adventureBeat', beat });
          }
        } else {
          this.achievementService.onResult(this.tabId, false);
          const error = event as ResultError;
          this.webview.postMessage({
            type: 'error',
            message: error.error,
          });
          // Session Vitals: emit error turn record
          const errorTurn = {
            turnIndex: this.turnIndex++,
            toolNames: toolNamesSnapshot,
            toolCount: toolNamesSnapshot.length,
            durationMs: 0,
            costUsd: 0,
            totalCostUsd: 0,
            isError: true,
            category: 'error' as const,
            timestamp: Date.now(),
            messageId: this.lastMessageId,
          };
          this.webview.postMessage({ type: 'turnComplete', turn: errorTurn });
          // Adventure Widget: generate and send beat
          if (this.adventureInterpreter) {
            const beat = this.adventureInterpreter.interpret(errorTurn as TurnRecord);
            this.webview.postMessage({ type: 'adventureBeat', beat });
          }
        }
        this.webview.postMessage({ type: 'processBusy', busy: false });
      }
    );
  }

  /** Reset tool name tracking and pending approval state */
  private clearApprovalTracking(): void {
    this.currentMessageToolNames = [];
    this.pendingApprovalTool = null;
  }

  /** Notify webview that user approval is required for a plan/question tool */
  private notifyPlanApprovalRequired(toolName: string): void {
    if (this.pendingApprovalTool === toolName) {
      return;
    }
    // After the user responds to an approval, late events (e.g. assistantMessage
    // fallback) can race with clearApprovalTracking and re-trigger. Suppress them.
    if (this.approvalResponseProcessed) {
      this.log(`Suppressing stale plan approval notification for ${toolName} - already responded`);
      return;
    }
    // Auto-approve subsequent ExitPlanMode calls after user already approved one
    // in this turn. This prevents repeated approval prompts when Claude re-enters
    // plan mode during implementation.
    const norm = toolName.trim().toLowerCase();
    const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
    if (isExitPlanMode && this.autoApproveExitPlanMode) {
      this.log(`Auto-approving subsequent ExitPlanMode (user already approved in this turn)`);
      this.approvalResponseProcessed = true; // suppress fallback events for this message
      this.control.sendText('Yes, proceed with the plan.');
      return;
    }
    // Auto-approve stale ExitPlanMode after context compaction: if EnterPlanMode
    // was never called in this session, ExitPlanMode is a stale artifact from
    // compacted context. Auto-approve to prevent the user from getting stuck.
    if (isExitPlanMode && !this.planModeActive) {
      this.log(`Auto-approving stale ExitPlanMode (no EnterPlanMode seen in session)`);
      this.approvalResponseProcessed = true;
      this.control.sendText('Yes, proceed with the plan.');
      return;
    }
    this.log(`Plan approval required: tool=${toolName}`);
    this.pendingApprovalTool = toolName;
    this.webview.postMessage({
      type: 'planApprovalRequired',
      toolName,
    });
  }

  /** Wire activity summarizer callback to forward summaries to webview and SessionTab */
  private wireActivitySummarizer(): void {
    if (!this.activitySummarizer) {
      return;
    }
    this.activitySummarizer.onSummaryGenerated((summary) => {
      this.log(`[ActivitySummary] Generated: "${summary.shortLabel}" | "${summary.fullSummary}"`);
      // Forward to webview for busy indicator
      this.webview.postMessage({
        type: 'activitySummary',
        shortLabel: summary.shortLabel,
        fullSummary: summary.fullSummary,
      });
      // Forward to SessionTab for tab title update
      this.activitySummaryCallback?.(summary);
    });
  }

  /** Enrich a tool name with context from its first JSON argument (e.g., file path) */
  private enrichToolName(toolName: string, blockIndex: number): string {
    const rawJson = this.toolBlockContexts.get(blockIndex) || '';
    if (!rawJson) {
      return toolName;
    }
    // Try to extract file_path, command, path, or pattern from partial JSON
    const pathMatch = rawJson.match(/"(?:file_path|path|command|pattern|query|url)":\s*"([^"]{1,80})/);
    if (pathMatch) {
      return `${toolName} (${pathMatch[1]})`;
    }
    return toolName;
  }

  /** Fire-and-forget: spawn a Haiku process to name this session */
  private triggerSessionNaming(userText: string): void {
    this.log(`[SessionNaming] triggerSessionNaming called, text="${userText.slice(0, 50)}..."`);

    const config = vscode.workspace.getConfiguration('claudeMirror');
    const autoName = config.get<boolean>('autoNameSessions', true);
    if (!autoName) {
      this.log('[SessionNaming] SKIPPED: autoNameSessions is disabled');
      return;
    }

    if (this.firstMessageSent) {
      this.log('[SessionNaming] SKIPPED: firstMessageSent is already true');
      return;
    }

    if (!this.sessionNamer) {
      this.log('[SessionNaming] SKIPPED: no sessionNamer attached');
      return;
    }

    this.firstMessageSent = true;

    // Capture the first line of the prompt for session history display
    const firstLine = userText.split('\n')[0].trim().slice(0, 120);
    if (firstLine && this.firstPromptCallback) {
      this.firstPromptCallback(firstLine);
    }

    this.log('[SessionNaming] Launching generateName...');

    this.sessionNamer
      .generateName(userText)
      .then((name) => {
        this.log(`[SessionNaming] generateName returned: "${name}"`);
        if (name && this.titleCallback) {
          this.log(`[SessionNaming] Calling titleCallback with "${name}"`);
          this.titleCallback(name);
        } else {
          this.log(`[SessionNaming] NOT calling titleCallback: name=${name}, hasCallback=${!!this.titleCallback}`);
        }
      })
      .catch((err) => {
        this.log(`[SessionNaming] ERROR: ${err}`);
      });
  }
}
