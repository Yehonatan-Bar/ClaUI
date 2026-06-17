import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { ControlProtocol } from '../process/ControlProtocol';
import { SessionNamer } from './SessionNamer';
import { SessionSummarizer } from './SessionSummarizer';
import { MessageTranslator } from './MessageTranslator';
import { ActivitySummarizer } from './ActivitySummarizer';
import { VisualProgressProcessor } from './VisualProgressProcessor';
import { AdventureInterpreter } from './AdventureInterpreter';
import { TurnAnalyzer } from './TurnAnalyzer';
import { PromptEnhancer } from './PromptEnhancer';
import { PromptTranslator } from './PromptTranslator';
import { ConversationReader } from './ConversationReader';
import { FileLogger } from './FileLogger';
import { CheckpointManager } from './CheckpointManager';
import type { AchievementService } from '../achievements/AchievementService';
import type { SessionStore } from './SessionStore';
import type { ProjectAnalyticsStore } from './ProjectAnalyticsStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import { MessageHandler, type WebviewBridge } from '../webview/MessageHandler';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import type { SkillGenService } from '../skillgen/SkillGenService';
import type { TokenUsageRatioTracker } from './TokenUsageRatioTracker';
import { AuthManager } from '../auth/AuthManager';
import type { ClaudeAccountProfile } from '../auth/ClaudeAccountProfileStore';
import { TeamWatcher } from '../teams/TeamWatcher';
import { TeamDetector } from '../teams/TeamDetector';
import { TeamActions } from '../teams/TeamActions';
import type { TeamStateSnapshot } from '../teams/TeamTypes';
import type { CliOutputEvent, AssistantMessage, ResultSuccess, ResultError } from '../types/stream-json';
import type {
  ExtensionToWebviewMessage,
  ProviderId,
  WebviewToExtensionMessage,
  SerializedChatMessage,
  SessionSummary,
  TurnRecord,
} from '../types/webview-messages';
import type { HandoffProvider, HandoffSourceSnapshot } from './handoff/HandoffTypes';
import { BackgroundSession } from './BackgroundSession';
import { MergeAssistantSession, type MergeAssistantStartOptions } from './MergeAssistantSession';
import {
  ReviewLoopOrchestrator,
  CodexReviewerSession,
  ReviewVerdictClassifier,
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
} from '../review-loop';

export interface SessionTabCallbacks {
  onClosed: (tabId: string) => void;
  onFocused: (tabId: string) => void;
  /** Fired once when the CLI reports its persistent session/thread id. */
  onSessionIdAssigned?: (tabId: string, sessionId: string) => void;
  /** Fired whenever the tab's display name changes (auto-named, restored, or user-renamed). */
  onNameChanged?: (tabId: string, name: string) => void;
  /** Fired after the end-of-session summarizer writes a new summary for this session. */
  onSummaryGenerated?: (sessionId: string) => void;
  /** Fired when the per-tab provider/cliPathOverride changes at runtime
   *  (e.g. auto-fallback from Happy to Claude when the Happy CLI is missing).
   *  TabManager uses this to update the persisted snapshot entry. */
  onProviderChanged?: (tabId: string, provider: ProviderId, cliPathOverride: string | null) => void;
  onBusyStateChanged?: (tabId: string, busy: boolean) => void;
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
  /** True only after a summary has been successfully saved — blocks further attempts. */
  private summarizerRan = false;
  /** Concurrency guard so multiple triggers (stop -> exit -> dispose) don't race. */
  private summarizerInFlight = false;
  /** Most-recent CLI session id seen on this tab. Survives processManager.stop(),
   *  which resets `processManager.currentSessionId`, so the stop path can still summarize. */
  private lastKnownSessionId: string | null = null;
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
  /** Lazy-resume state: when set, the CLI process has not been spawned yet
   *  and will be started the first time the user focuses this tab after
   *  TabManager arms the wake (post-restore). */
  private pendingResumeSessionId: string | null = null;
  /** True only after TabManager finishes the restore loop. Prevents the
   *  view-state changes triggered by panel creation from waking lazy tabs
   *  before the user has actually clicked them. */
  private lazyWakeArmed: boolean = false;
  /** Tracks whether stderr indicates Claude CLI is not installed */
  private claudeCliMissingDetected = false;
  /** Tracks whether stderr indicates Happy CLI authentication is required */
  private happyAuthDetected = false;
  /** Tracks whether the CLI rejected our --resume target ("No conversation found
   *  with session ID: ..."). When true the silent-resume classifier MUST decline
   *  so we do not loop forever on a stale session id. Cleared on each spawn. */
  private resumeTargetMissingDetected = false;
  /** Silent crash resume: armed state distinguishes a mid-session crash recovery
   *  from boot-time lazy resume. While armed, the next user send (or focus) silently
   *  respawns the CLI with --resume <sid> and flushes the queued message(s). */
  private silentResumeArmedFlag = false;
  /** Silent crash resume: consecutive attempt count (cap = config.maxAttempts). */
  private silentResumeAttempts = 0;
  /** Silent crash resume: messages queued while a silent respawn is in flight. */
  private silentResumeQueue: Array<{ id: string; text: string; ts: number }> = [];
  /** Silent crash resume: true between beginSilentResume() and flush/escalation. */
  private silentResumeInFlight = false;
  /** Silent crash resume: timer that escalates to visible UX if system/init never arrives. */
  private silentResumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Silent crash resume: timer for the subtle "(reconnecting...)" hint. */
  private silentResumeHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Streaming message id observed since the most recent message_start (cleared on result). */
  private currentStreamingMessageId: string | null = null;
  /** True between message_start and result; informs whether a crash interrupted streaming. */
  private currentlyStreaming = false;
  /** Monotonic counter for deferred-message ids. */
  private deferredIdSeq = 0;
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
  /** Subscription for VS Code window state changes (focus/blur) */
  private windowStateSubscription: vscode.Disposable | null = null;
  /** Debounced timer for delayed focusInput after window-focus events */
  private focusInputTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamp of last posted focusInput message (dedupe/throttle) */
  private lastFocusInputPostAt = 0;
  private static readonly FOCUS_INPUT_THROTTLE_MS = 250;
  private static readonly WINDOW_FOCUS_INPUT_DELAY_MS = 180;
  /** Waiters that resolve when the next assistant reply arrives (handoff orchestration). */
  private assistantReplyWaiters: Array<(ok: boolean) => void> = [];
  /** Background session for the "btw" side-conversation overlay */
  private btwSession: BackgroundSession | null = null;
  /** Automatic Claude<->Codex review loop orchestrator (null when idle). */
  private reviewLoop: ReviewLoopOrchestrator | null = null;
  /** Per-session override: when false, auto-review is suppressed for THIS tab only
   *  (in-memory; does not affect the global setting or other tabs). Resets on reload. */
  private reviewLoopEnabledThisSession = true;
  /** Headless Codex reviewer backing the review loop (kept across rounds). */
  private reviewerSession: CodexReviewerSession | null = null;
  /** When set, the next finished turn's final assistant text is captured (review loop). */
  private turnCapture: {
    answerParts: string[];
    fallbackParts: string[];
    timer: ReturnType<typeof setTimeout>;
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null = null;
  /** True when the next finished turn was started by a user message (drives review-loop auto-start). */
  private pendingUserTurn = false;
  /** True when the current turn used at least one tool (auto-start skips tool-less text-only turns). */
  private pendingTurnUsedTools = false;
  /** Fresh, merge-focused session for the Merge Wizard's conflict assistant */
  private mergeAssistant: MergeAssistantSession | null = null;
  /**
   * Epoch for the merge-assistant slot, bumped each time a new assistant starts.
   * A close captures the current epoch; its terminal `mergeAssistantSessionEnded`
   * fires only if the epoch is still current, so a slow exit from an older
   * assistant cannot finalize the merge for a newer one (restart race).
   */
  private mergeAssistantGeneration = 0;
  /** Smart Search: tab kind (default 'chat'). When 'search', spawn flags are altered. */
  private kind: 'chat' | 'search' = 'chat';
  /** Smart Search: appended to the agent system prompt at spawn time. */
  private appendSystemPrompt: string | null = null;
  /** Smart Search: read-only allowed-tools list (e.g. ['Read','Glob','Grep','Bash']). */
  private allowedTools: string[] | null = null;
  /** Smart Search: cwd override (so transcripts under $HOME are reachable). */
  private cwdOverride: string | null = null;
  /** Worktree this tab's session runs in (absolute path). Null = primary/main worktree (workspace root). */
  private worktreePath: string | null = null;
  private claudeAccountProfile: ClaudeAccountProfile | null = null;
  private claudeAccountProfileId: string | null = null;
  private claudeConfigDir: string | null = null;
  /** Particle Accelerator service reference for context file lifecycle */
  private particleAcceleratorService: import('../particle-accelerator/ParticleAcceleratorService').ParticleAcceleratorService | null = null;
  /** Secret Protection service reference for DLP scanning */
  private secretProtectionService: import('../secret-protection/SecretProtectionService').SecretProtectionService | null = null;
  private superParticleAcceleratorService: import('../super-particle-accelerator/SuperParticleAcceleratorService').SuperParticleAcceleratorService | null = null;
  private workspaceAccessGuardService: import('../workspace-access-guard/WorkspaceAccessGuardService').WorkspaceAccessGuardService | null = null;

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
    private readonly tokenRatioTracker?: TokenUsageRatioTracker,
    private readonly skillUsageTracker?: import('../skillgen/SkillUsageTracker').SkillUsageTracker,
    private readonly memorySampler?: import('../process/ProcessMemorySampler').ProcessMemorySampler
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
    this.messageHandler.setGlobalState(context.globalState);
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
    if (this.skillUsageTracker) {
      this.messageHandler.setSkillUsageTracker(this.skillUsageTracker);
    }
    if (this.memorySampler) {
      this.messageHandler.setMemorySampler(this.memorySampler);
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

    // Wire per-session checkpoint manager for file revert/redo
    const checkpointMgr = new CheckpointManager(tabLog);
    checkpointMgr.setWorkspaceRoot(vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? '');
    this.messageHandler.setCheckpointManager(checkpointMgr);

    // One-shot CLI helpers must spawn with this tab's Claude account profile;
    // resolved at spawn time so later profile changes (handoff/restore) apply.
    const claudeConfigDirProvider = (): string | undefined => this.claudeConfigDir ?? undefined;

    // Wire auto-naming: Haiku generates a short title from the first message
    const sessionNamer = new SessionNamer();
    sessionNamer.setLogger(tabLog);
    sessionNamer.setClaudeConfigDirProvider(claudeConfigDirProvider);
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
    activitySummarizer
      .setClaudeConfigDirProvider(claudeConfigDirProvider);
    this.messageHandler.setActivitySummarizer(activitySummarizer);
    // Wire Visual Progress Mode processor
    const vpmProcessor = new VisualProgressProcessor();
    vpmProcessor
      .setClaudeConfigDirProvider(claudeConfigDirProvider);
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
    messageTranslator.setClaudeConfigDirProvider(claudeConfigDirProvider);
    this.messageHandler.setMessageTranslator(messageTranslator);

    // Wire adventure interpreter for dungeon crawler beat generation
    const adventureInterpreter = new AdventureInterpreter();
    adventureInterpreter.setLogger(tabLog);
    this.messageHandler.setAdventureInterpreter(adventureInterpreter);

    // Wire turn analyzer for semantic analysis (dashboard insights)
    const turnAnalyzer = new TurnAnalyzer();
    turnAnalyzer.setLogger(tabLog);
    turnAnalyzer
      .setClaudeConfigDirProvider(claudeConfigDirProvider);
    this.messageHandler.setTurnAnalyzer(turnAnalyzer);

    // Wire prompt enhancer for AI-powered prompt improvement
    const promptEnhancer = new PromptEnhancer();
    promptEnhancer.setLogger(tabLog);
    promptEnhancer
      .setClaudeConfigDirProvider(claudeConfigDirProvider);
    this.messageHandler.setPromptEnhancer(promptEnhancer);

    // Wire prompt translator for translating prompts to English
    const promptTranslator = new PromptTranslator();
    promptTranslator.setLogger(tabLog);
    promptTranslator
      .setClaudeConfigDirProvider(claudeConfigDirProvider);
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
    this.wireTurnCaptureEvents();
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
        ? { ...msg, provider: this.getProvider(), tabKind: this.kind, ...this.worktreeDisplay() }
        : msg;
    // Intercept processBusy messages to update the tab title indicator
    if (outbound.type === 'processBusy') {
      this.setBusy(outbound.busy);
    }
    // When a session ends, always stop the busy animation —
    // processBusy:false may never arrive if handleResultEvent didn't fire
    if (outbound.type === 'sessionEnded') {
      this.setBusy(false);
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

  setClaudeAccountProfile(profile: ClaudeAccountProfile | null): void {
    if (!profile || profile.isDefault || !profile.configDir.trim()) {
      this.claudeAccountProfile = null;
      this.claudeAccountProfileId = null;
      this.claudeConfigDir = null;
      this.messageHandler.refreshClaudeAuthStatus();
      return;
    }
    this.claudeAccountProfile = profile;
    this.claudeAccountProfileId = profile.id;
    this.claudeConfigDir = profile.configDir;
    this.messageHandler.refreshClaudeAuthStatus();
  }

  getClaudeAccountProfile(): ClaudeAccountProfile | null {
    return this.claudeAccountProfile;
  }

  getClaudeAccountProfileId(): string | null {
    return this.claudeAccountProfileId;
  }

  getClaudeConfigDir(): string | null {
    return this.claudeConfigDir;
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
    const messages = sessionId ? reader.readSession(sessionId, workspacePath, this.claudeConfigDir ?? undefined) : [];
    const repoRoot = this.detectGitRepoRoot(workspacePath);
    const branch = this.detectGitBranch(repoRoot || workspacePath);

    return {
      provider: provider as HandoffProvider,
      tabId: this.id,
      sessionId,
      accountProfileId: this.claudeAccountProfileId ?? undefined,
      accountProfileLabel: this.claudeAccountProfile?.label,
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
    const atSessionStart = this.messageHandler.isAtSessionStart;

    // At the beginning of a session (no messages sent yet), restart fresh with the new model
    // rather than resuming, so the session is clean and uses the correct model from the start.
    if (atSessionStart) {
      this.log(`[Tab ${this.tabNumber}] Switching model to "${model}" at session start (fresh restart)`);
      this.suppressNextExit = true;
      this.postMessage({ type: 'processBusy', busy: true });
      this.processManager.stop();
      try {
        await this.processManager.start({
          model,
          cwd: this.getEffectiveCwd(),
          cliPathOverride: this.cliPathOverride ?? undefined,
          ...this.claudeAccountProcessOptions(),
        });
        this.log(`[Tab ${this.tabNumber}] Session restarted fresh with model "${model}"`);
        this.postMessage({ type: 'processBusy', busy: false });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`[Tab ${this.tabNumber}] Failed to restart with model: ${errMsg}`);
        this.postMessage({ type: 'error', message: `Failed to restart with model: ${errMsg}` });
        this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
      }
      return;
    }

    if (!sessionToResume) {
      this.log(`[Tab ${this.tabNumber}] Cannot switch model: no active session`);
      return;
    }

    this.log(`[Tab ${this.tabNumber}] Switching model to "${model}" (session ${sessionToResume})`);
    this.suppressNextExit = true;
    this.postMessage({ type: 'processBusy', busy: true });
    this.processManager.stop();

    try {
      await this.processManager.start({
        resume: sessionToResume,
        model,
        cwd: this.getEffectiveCwd(),
        cliPathOverride: this.cliPathOverride ?? undefined,
        ...this.claudeAccountProcessOptions(),
      });
      this.log(`[Tab ${this.tabNumber}] Session resumed with model "${model}"`);
      this.postMessage({ type: 'processBusy', busy: false });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] Failed to switch model: ${errMsg}`);
      this.postMessage({ type: 'error', message: `Failed to switch model: ${errMsg}` });
      this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
    }
  }

  /** Restart the CLI process while preserving the live conversation (stop +
   *  --resume). Used by the MCP panel "Restart session now" action so updated
   *  MCP config is loaded without losing the chat. Mirrors switchModel()'s
   *  stop+resume cycle: skipReplay keeps the webview history intact (no
   *  duplicated messages) and the session id is re-seeded so features that
   *  read it before the next system/init (snapshots, a second restart,
   *  crash recovery) keep working. Throws when no session id is known yet. */
  async restartWithCurrentSession(): Promise<void> {
    const sessionToResume = this.processManager.currentSessionId;
    if (!sessionToResume) {
      throw new Error('No running Claude session is available to restart.');
    }

    this.log(`[Tab ${this.tabNumber}] Restarting session ${sessionToResume} to reload MCP config`);
    this.suppressNextExit = true;
    this.postMessage({ type: 'processBusy', busy: true });
    this.processManager.stop();

    // This restart supersedes any armed lazy-wake / silent-resume cycle for
    // this tab; clear them so a later focus event cannot double-spawn the CLI.
    this.lazyWakeArmed = false;
    this.silentResumeArmedFlag = false;
    this.silentResumeInFlight = false;
    this.pendingResumeSessionId = null;
    this.clearSilentResumeTimers();

    try {
      await this.processManager.start({
        resume: sessionToResume,
        skipReplay: true,
        model: this.currentModel || undefined,
        cwd: this.getEffectiveCwd(),
        cliPathOverride: this.cliPathOverride ?? undefined,
        appendSystemPrompt: this.appendSystemPrompt ?? undefined,
        allowedTools: this.allowedTools ?? undefined,
        ...this.claudeAccountProcessOptions(),
      });
      // In pipe mode the CLI emits system/init only after the first stdin
      // message, so re-seed the id now to avoid a null-session window.
      this.processManager.seedSessionId(sessionToResume);
      this.postMessage({ type: 'processBusy', busy: false });
      this.flushSilentResumeQueue();
      this.log(`[Tab ${this.tabNumber}] Session ${sessionToResume} resumed after MCP restart`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] Failed to restart session for MCP reload: ${errMsg}`);
      this.postMessage({ type: 'processBusy', busy: false });
      this.postMessage({ type: 'error', message: `Failed to restart session: ${errMsg}` });
      this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
      throw err instanceof Error ? err : new Error(errMsg);
    }
  }

  // --- Public API ---

  /** Set fork initialization data (must be called before startSession) */
  setForkInit(init: { promptText: string; messages: SerializedChatMessage[] }): void {
    this.forkInitData = init;
  }

  /** Mark this tab for lazy resume: the CLI process is NOT spawned now.
   *  The tab title is restored from sessionStore so the user can identify it,
   *  and the session id is seeded into the process manager so features that
   *  read tab.sessionId before the spawn (e.g. snapshot persistence) still
   *  return the correct id. The actual spawn happens the first time the user
   *  focuses this tab after armLazyWake() is called. */
  prepareForLazyResume(sessionId: string, nameHint?: string): void {
    if (this.disposed) {
      return;
    }
    this.pendingResumeSessionId = sessionId;
    this.lazyWakeArmed = false;
    this.processManager.seedSessionId(sessionId);
    this.restoreSessionName(sessionId);
    if (nameHint && this.baseTitle === `ClaUi ${this.tabNumber}`) {
      this.setTabName(nameHint);
    }
    this.log(
      `[Tab ${this.tabNumber}] Lazy-resume prepared for session ${sessionId.slice(0, 8)}; CLI will spawn on first user focus.`,
    );
  }

  /** TabManager calls this once the restore loop has finished creating all
   *  panels. After this, the next view-state-active event from the user
   *  triggers the deferred startSession({ resume }). */
  armLazyWake(): void {
    if (this.pendingResumeSessionId) {
      this.lazyWakeArmed = true;
    }
  }

  /** Whether this tab is in lazy-resume state (CLI not spawned yet). */
  get isPendingLazyResume(): boolean {
    return this.pendingResumeSessionId !== null;
  }

  // ====== Silent crash resume API ======

  /** Read silent-crash-resume configuration (lazily so it can be toggled at runtime). */
  private getSilentResumeConfig(): {
    enabled: boolean;
    maxAttempts: number;
    timeoutMs: number;
    hintDelayMs: number;
  } {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    return {
      enabled: config.get<boolean>('silentCrashResume.enabled', true),
      maxAttempts: Math.max(
        1,
        Math.min(5, config.get<number>('silentCrashResume.maxAttempts', 2)),
      ),
      timeoutMs: Math.max(
        3000,
        Math.min(60000, config.get<number>('silentCrashResume.timeoutMs', 15000)),
      ),
      hintDelayMs: Math.max(
        1000,
        Math.min(30000, config.get<number>('silentCrashResume.reconnectingHintDelayMs', 4000)),
      ),
    };
  }

  /** True iff this tab is armed for a silent resume on next user send/focus. */
  isSilentResumeArmed(): boolean {
    return (
      this.silentResumeArmedFlag &&
      this.pendingResumeSessionId !== null &&
      !this.processManager.isRunning
    );
  }

  /** Allocate a deferred-message id, queue the text, and kick off the silent respawn.
   *  Returns the id so the caller can correlate `messageDeferred` ↔ delivered/failed. */
  enqueueSilentResume(text: string): { id: string } {
    const id = `def-${++this.deferredIdSeq}-${Date.now().toString(36)}`;
    this.silentResumeQueue.push({ id, text, ts: Date.now() });
    void this.beginSilentResume();
    return { id };
  }

  /** Eligibility classifier + suppress visible UX + arm for next-send respawn. */
  private armSilentResume(
    sessionId: string,
    exitCode: number | null,
    tabLog: (msg: string) => void,
  ): void {
    const cfg = this.getSilentResumeConfig();
    // Save analytics defensively in case the silent resume itself fails later.
    this.saveProjectAnalytics();
    this.silentResumeAttempts++;
    tabLog(
      `[SilentResume] armed code=${exitCode} session=${sessionId.slice(0, 8)} ` +
        `attempts=${this.silentResumeAttempts}/${cfg.maxAttempts}`,
    );
    if (exitCode === 2147483651) {
      // STATUS_BREAKPOINT (0x80000003) — flagged for monitoring; behavior unchanged.
      tabLog('[SilentResume] note: STATUS_BREAKPOINT exit observed (recurrence tracked).');
    }

    this.silentResumeArmedFlag = true;
    this.pendingResumeSessionId = sessionId;
    this.processManager.seedSessionId(sessionId);

    // Finalize any in-progress assistant bubble so the user is not left looking at a spinner.
    if (this.currentlyStreaming) {
      this.postMessage({
        type: 'interruptedAssistantMessage',
        messageId: this.currentStreamingMessageId,
      });
    }
    this.currentlyStreaming = false;
    this.currentStreamingMessageId = null;

    // Clear busy state so the user can type immediately.
    this.postMessage({ type: 'processBusy', busy: false });
    // Deliberately NOT posting sessionEnded or any error toast.
  }

  /** Idempotently begin the silent resume: spawn CLI with --resume + skipReplay. */
  private async beginSilentResume(): Promise<void> {
    if (this.disposed) return;
    if (!this.silentResumeArmedFlag) return;
    if (this.silentResumeInFlight) return; // already spawning; queue will flush when ready
    if (!this.pendingResumeSessionId) return;
    if (this.processManager.isRunning) {
      // Process is somehow alive (race with focus + send) — just flush.
      this.flushSilentResumeQueue();
      return;
    }

    const cfg = this.getSilentResumeConfig();
    const sid = this.pendingResumeSessionId;
    this.silentResumeInFlight = true;
    // Clear any stale "stale resume target" flag carried over from a prior spawn.
    this.resumeTargetMissingDetected = false;
    const startTs = Date.now();

    this.log(
      `[Tab ${this.tabNumber}] [SilentResume] spawning session=${sid.slice(0, 8)} ` +
        `queuedMessages=${this.silentResumeQueue.length}`,
    );

    // Schedule a subtle "(reconnecting...)" hint after a small delay so brief resumes feel snappy.
    this.clearSilentResumeTimers();
    this.silentResumeHintTimer = setTimeout(() => {
      if (this.silentResumeInFlight && !this.disposed) {
        this.postMessage({ type: 'silentResumeStatus', active: true });
      }
    }, cfg.hintDelayMs);

    // Hard timeout: if system/init never arrives, escalate.
    this.silentResumeTimer = setTimeout(() => {
      if (this.silentResumeInFlight) {
        this.log(
          `[Tab ${this.tabNumber}] [SilentResume] timeout session=${sid.slice(0, 8)} ` +
            `after ${cfg.timeoutMs}ms`,
        );
        this.escalateToVisibleCrash('timeout');
      }
    }, cfg.timeoutMs);

    try {
      await this.processManager.start({
        resume: sid,
        skipReplay: true,
        cwd: this.getEffectiveCwd(),
        cliPathOverride: this.cliPathOverride ?? undefined,
        appendSystemPrompt: this.appendSystemPrompt ?? undefined,
        allowedTools: this.allowedTools ?? undefined,
        ...this.claudeAccountProcessOptions(),
      });
      this.log(
        `[Tab ${this.tabNumber}] [SilentResume] start() resolved in ${Date.now() - startTs}ms; ` +
          `awaiting system/init`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] [SilentResume] spawn error: ${msg}`);
      this.escalateToVisibleCrash('spawn-error');
    }
  }

  /** Called by the event listener when the resumed CLI emits its first system/init. */
  private handleSilentResumeReady(newSessionId: string, tabLog: (msg: string) => void): void {
    if (!this.silentResumeInFlight) return;
    const expected = this.pendingResumeSessionId;
    const startupMs = this.silentResumeTimer ? '(under timeout)' : '(timer cleared)';
    this.clearSilentResumeTimers();
    this.silentResumeInFlight = false;
    this.silentResumeArmedFlag = false;
    this.pendingResumeSessionId = null;

    if (expected && newSessionId !== expected) {
      // CLI started a fresh session (JSONL missing / corrupt). Warn the user once.
      tabLog(
        `[SilentResume] resumed-with-fresh-session expected=${expected.slice(0, 8)} ` +
          `got=${newSessionId.slice(0, 8)} ${startupMs}`,
      );
      try {
        vscode.window.showWarningMessage(
          `ClaUi ${this.tabNumber}: could not restore previous conversation; starting fresh.`,
        );
      } catch {
        /* test harness or non-VS Code environment */
      }
    } else {
      tabLog(
        `[SilentResume] resumed session=${newSessionId.slice(0, 8)} ` +
          `queuedMessages=${this.silentResumeQueue.length} ${startupMs}`,
      );
    }

    // Hide the "(reconnecting...)" hint if it was shown.
    this.postMessage({ type: 'silentResumeStatus', active: false });

    // Reset the attempts counter on success so a future crash gets the full budget again.
    this.silentResumeAttempts = 0;
    this.flushSilentResumeQueue();
  }

  /** Flush all queued messages through the (newly spawned) CLI in arrival order. */
  private flushSilentResumeQueue(): void {
    if (this.silentResumeQueue.length === 0) return;
    const queue = this.silentResumeQueue.splice(0, this.silentResumeQueue.length);
    for (const item of queue) {
      try {
        this.control.sendText(item.text);
        this.postMessage({ type: 'messageDeferredDelivered', id: item.id });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log(
          `[Tab ${this.tabNumber}] [SilentResume] flush error for id=${item.id}: ${reason}`,
        );
        this.postMessage({
          type: 'messageDeferredFailed',
          id: item.id,
          text: item.text,
          reason: 'spawn-error',
        });
      }
    }
    // Once we've flushed, the user is effectively in a normal turn — busy until the result.
    this.postMessage({ type: 'processBusy', busy: true });
  }

  /** Bail to the visible crash UX after a silent-resume failure. Idempotent — repeated
   *  calls within the same crash cycle are no-ops. */
  private escalateToVisibleCrash(
    reason: 'timeout' | 'spawn-error' | 'exit-while-spawning' | 'cap-exhausted' | 'fresh-session',
  ): void {
    // Idempotency guard: if we already escalated (and nothing has re-armed since),
    // ignore subsequent calls. Avoids duplicate Restart toasts when both the
    // result/error path and the exit path try to escalate.
    if (!this.silentResumeArmedFlag && !this.silentResumeInFlight && this.silentResumeQueue.length === 0) {
      return;
    }

    const sid = this.pendingResumeSessionId;
    this.log(
      `[Tab ${this.tabNumber}] [SilentResume] failed reason=${reason} ` +
        `session=${sid?.slice(0, 8) ?? 'null'}`,
    );

    // Restore any queued messages to the input area (most recent wins; earlier are dropped
    // since the input field can only hold one draft — log the discards so we don't lose audit).
    const queue = this.silentResumeQueue.splice(0, this.silentResumeQueue.length);
    for (const item of queue) {
      this.postMessage({
        type: 'messageDeferredFailed',
        id: item.id,
        text: item.text,
        reason,
      });
    }

    this.clearSilentResumeTimers();
    this.silentResumeInFlight = false;
    this.silentResumeArmedFlag = false;
    // Hide reconnecting hint.
    this.postMessage({ type: 'silentResumeStatus', active: false });

    // Lock silent resume out for this tab until a clean turn happens. Without
    // this, an exit fired AFTER escalation could re-engage the classifier and
    // we'd loop back into another silent attempt with the same broken sid.
    const cfg = this.getSilentResumeConfig();
    this.silentResumeAttempts = Math.max(this.silentResumeAttempts, cfg.maxAttempts);

    // Make sure any half-spawned process is torn down so the visible Restart prompt
    // can spawn cleanly.
    try {
      this.processManager.stop();
    } catch {
      /* idempotent */
    }

    // Surface the visible crash UX (mirrors the existing path in the exit handler).
    this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
    const detail = (() => {
      switch (reason) {
        case 'timeout':
          return 'Could not reconnect within the configured timeout.';
        case 'spawn-error':
          return 'Failed to launch the CLI. Verify the executable is on PATH.';
        case 'exit-while-spawning':
          return 'The CLI exited before it finished starting.';
        case 'cap-exhausted':
          return 'The session keeps crashing. Please review the Output -> ClaUi log.';
        case 'fresh-session':
          return 'Could not restore the previous conversation: no conversation file found on disk. Start a fresh session to continue.';
      }
    })();
    this.postMessage({
      type: 'error',
      message: `Tab ${this.tabNumber}: ${detail} Check "ClaUi" output channel for details.`,
    });

    // Restart prompt only makes sense when the session id is potentially recoverable.
    // For 'fresh-session' the id is broken on disk — restarting would just fail again.
    if (sid && reason !== 'fresh-session') {
      vscode.window
        .showWarningMessage(
          `ClaUi ${this.tabNumber}: silent reconnect failed (${reason}). Restart?`,
          'Restart',
          'Show Log',
          'Cancel',
        )
        .then(async (choice) => {
          if (choice === 'Restart') {
            try {
              await this.processManager.start({
                resume: sid,
                cwd: this.getEffectiveCwd(),
                cliPathOverride: this.cliPathOverride ?? undefined,
                ...this.claudeAccountProcessOptions(),
              });
            } catch {
              vscode.window.showErrorMessage(
                `Tab ${this.tabNumber}: Failed to restart Claude session.`,
              );
            }
          } else if (choice === 'Show Log') {
            vscode.commands.executeCommand('workbench.action.output.toggleOutput');
          }
        });
    }
  }

  private clearSilentResumeTimers(): void {
    if (this.silentResumeTimer) {
      clearTimeout(this.silentResumeTimer);
      this.silentResumeTimer = null;
    }
    if (this.silentResumeHintTimer) {
      clearTimeout(this.silentResumeHintTimer);
      this.silentResumeHintTimer = null;
    }
  }

  /** Stage one-time handoff context to inject on the first user message in this tab. */
  setPendingHandoffPrompt(prompt: string): void {
    this.messageHandler.setPendingHandoffPrompt(prompt);
  }

  setCliPathOverride(pathOrNull: string | null): void {
    this.cliPathOverride = pathOrNull;
  }

  /** Set the worktree this tab's session runs in. Call before startSession so it
   *  takes effect on the first spawn; it then persists across every re-spawn
   *  (model switch, silent resume, crash restart) so the session never silently
   *  jumps back to the main repo. */
  setWorktreePath(pathOrNull: string | null): void {
    this.worktreePath = pathOrNull;
  }

  /** Absolute worktree path for this tab, or null when it runs in the primary worktree. */
  getWorktreePath(): string | null {
    return this.worktreePath;
  }

  /** Worktree identity stamped onto every `sessionStarted` post (see postMessage)
   *  to drive the in-chat indicator. Returns nulls when the session runs in the
   *  primary worktree (no path set, or the path resolves to the workspace root)
   *  so the webview suppresses the chip; otherwise the absolute path plus its
   *  basename for display. */
  private worktreeDisplay(): { worktreePath: string | null; worktreeName: string | null } {
    const worktreePath = this.worktreePath;
    if (!worktreePath) {
      return { worktreePath: null, worktreeName: null };
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const normalizePath = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
    if (workspaceRoot && normalizePath(workspaceRoot) === normalizePath(worktreePath)) {
      return { worktreePath: null, worktreeName: null };
    }
    return { worktreePath, worktreeName: path.basename(worktreePath) };
  }

  /** Effective spawn cwd: worktree first, then a Smart Search override, else the
   *  workspace root (resolved inside ClaudeProcessManager when undefined). */
  private getEffectiveCwd(): string | undefined {
    return this.worktreePath ?? this.cwdOverride ?? undefined;
  }

  private claudeAccountProcessOptions(): {
    claudeConfigDir?: string;
    claudeAccountProfileId?: string;
  } {
    if (!this.claudeConfigDir) {
      return {};
    }
    return {
      claudeConfigDir: this.claudeConfigDir,
      claudeAccountProfileId: this.claudeAccountProfileId ?? undefined,
    };
  }

  /** Tab kind ('chat' default, 'search' for Smart Search tabs). */
  getTabKind(): 'chat' | 'search' {
    return this.kind;
  }

  /** Configure this tab as a Smart Search tab. Must be called BEFORE startSession.
   *  The flags are forwarded to ClaudeProcessManager.start() each spawn. */
  configureSearchMode(opts: {
    appendSystemPrompt: string;
    allowedTools: string[];
    cwdOverride: string;
  }): void {
    this.kind = 'search';
    this.appendSystemPrompt = opts.appendSystemPrompt;
    this.allowedTools = [...opts.allowedTools];
    this.cwdOverride = opts.cwdOverride;
    // Distinct title so search tabs are easy to spot in the VS Code tab bar.
    this.setTabName(`Search ${this.tabNumber}`);
  }

  /** Start a new CLI session in this tab (Claude by default, Happy when overridden) */
  async startSession(options?: { resume?: string; fork?: boolean; skipReplay?: boolean; truncatedFork?: boolean; cwd?: string; model?: string }): Promise<void> {
    this.messageHandler.resetTransientStateForHostLifecycle(
      options?.resume
        ? 'SessionTab.startSession(resume)'
        : options?.fork
          ? 'SessionTab.startSession(fork)'
          : 'SessionTab.startSession',
    );
    this.claudeCliMissingDetected = false;
    this.happyAuthDetected = false;
    this.resumeTargetMissingDetected = false;
    const effectiveCwd = options?.cwd ?? this.getEffectiveCwd();

    // Create Particle Accelerator context file before spawning CLI (env vars reference it)
    if (this.particleAcceleratorService?.isEnabled()) {
      const contextStore = this.particleAcceleratorService.getContextStore();
      if (contextStore) {
        const workspacePath = effectiveCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        await contextStore.createContext(this.id, 'claude', workspacePath).catch(() => {});
      }
    }

    await this.processManager.start({
      ...(options ?? {}),
      cwd: effectiveCwd,
      cliPathOverride: this.cliPathOverride ?? undefined,
      appendSystemPrompt: this.appendSystemPrompt ?? undefined,
      allowedTools: this.allowedTools ?? undefined,
      ...this.claudeAccountProcessOptions(),
    });
    this.achievementService.onSessionStart(this.id);
    this.postMessage({
      type: 'sessionStarted',
      sessionId: this.processManager.currentSessionId || 'pending',
      model: this.processManager.configuredModel,
      isResume: !!options?.resume,
      provider: this.getProvider(),
      tabKind: this.kind,
      claudeAccountProfileId: this.claudeAccountProfileId,
      claudeAccountProfileLabel: this.claudeAccountProfile?.label ?? null,
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

    // Restore the session name for both resume and fork so the tab keeps its
    // existing title and auto-naming doesn't overwrite it.
    if (options?.resume) {
      this.restoreSessionName(options.resume);
    }

    // Load conversation history only for resume (fork sends its own via forkInit).
    if (options?.resume && !options?.fork && !options?.truncatedFork) {
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
    const messages = reader.readSession(sessionId, workspacePath, this.claudeConfigDir ?? undefined);

    // Seed the process manager with the resumed id so features that need it
    // before the CLI emits system/init (e.g. edit-and-resend) don't see null.
    this.processManager.seedSessionId(sessionId);

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
    this.messageHandler.resetTransientStateForHostLifecycle('SessionTab.stopSession');
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

  /** Reveal (focus) this tab's panel. When `viewColumn` is supplied, the panel
   *  is moved to that column (used by TabManager.applyTabLayout to redistribute
   *  panels between horizontal and vertical arrangements). */
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
    if (this.disposed) {
      return;
    }
    try {
      if (viewColumn === undefined) {
        this.panel.reveal();
      } else {
        this.panel.reveal(viewColumn, preserveFocus);
      }
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

  /** Display name shown on the tab; falls back to "Tab N" before naming. */
  get displayName(): string {
    return this.baseTitle || `Tab ${this.tabNumber}`;
  }

  /** PID of the spawned Claude CLI process for this tab, or undefined if not running. */
  get cliPid(): number | undefined {
    return this.processManager.pid;
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
    this.messageHandler.dispose();
    this.stopThinkingAnimation();
    this.resolveAssistantReplyWaiters(false);
    this.clearFocusInputTimer();
    this.windowStateSubscription?.dispose();
    this.windowStateSubscription = null;
    // Clean up team watcher
    if (this.teamWatcher) {
      this.teamWatcher.dispose();
      this.teamWatcher = null;
    }
    // Save analytics BEFORE stopping the process to ensure data is persisted.
    // Same idea for the end-of-session summary: capture the sessionId before
    // processManager.stop() resets it. Fire-and-forget; the saveSession call
    // inside the summarizer is async but the summary write does not need to
    // block the dispose path.
    this.saveProjectAnalytics();
    void this.maybeRunSummarizer('completed').catch((err) =>
      this.log(`[Summarizer] dispose-branch failure: ${err instanceof Error ? err.message : String(err)}`),
    );
    this.achievementService.onSessionEnd(this.id);
    this.achievementService.unregisterTab(this.id);
    this.skillGenService?.unregisterTab(this.id);
    // Clean up Particle Accelerator context file
    if (this.particleAcceleratorService?.isEnabled()) {
      void this.particleAcceleratorService.getContextStore()?.disposeContext(this.id).catch(() => {});
    }
    this.reviewLoop?.stop('Tab closed.');
    this.closeReviewLoop();
    this.closeBtwSession();
    this.closeMergeAssistant();
    this.processManager.stop();
    this.fileLogger?.dispose();
    this.panel.dispose();
  }

  // --- BTW Background Session ---

  /** Create a background session for the btw overlay, forked from the current session. */
  startBtwSession(promptText: string): void {
    const sessionId = this.processManager.currentSessionId;
    if (!sessionId) {
      this.log(`[Tab ${this.tabNumber}] Cannot start btw session: no active session.`);
      this.postMessage({ type: 'btwSessionEnded', error: 'No active session.' });
      return;
    }

    // Close any existing btw session first
    this.closeBtwSession();

    this.log(`[Tab ${this.tabNumber}] Starting btw background session from ${sessionId}`);
    this.btwSession = new BackgroundSession(
      this.context,
      (msg) => this.log(`[Tab ${this.tabNumber}] ${msg}`),
      this.claudeAccountProcessOptions(),
    );
    this.wireBtwSessionEvents();
    this.log(`[Tab ${this.tabNumber}] [BTW->WV] btwSessionStarted`);
    this.postMessage({ type: 'btwSessionStarted' });

    this.btwSession.startFork(sessionId, promptText).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] btw session fork failed: ${errMsg}`);
      this.postMessage({ type: 'btwSessionEnded', error: errMsg });
      this.closeBtwSession();
    });
  }

  /** Wire demux events from the btw background session to the webview. */
  private wireBtwSessionEvents(): void {
    if (!this.btwSession) { return; }
    const btw = this.btwSession;

    const tabLog = (msg: string) => this.log(`[Tab ${this.tabNumber}] [BTW->WV] ${msg}`);

    btw.on('userMessage', (data: { message: { content: unknown } }) => {
      const rawContent = data.message?.content;
      const content = Array.isArray(rawContent)
        ? rawContent
        : typeof rawContent === 'string'
          ? [{ type: 'text' as const, text: rawContent }]
          : [];
      tabLog('btwUserMessage');
      this.postMessage({ type: 'btwUserMessage', content });
    });

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
      const contentLen = Array.isArray(msg?.content) ? msg.content.length : 0;
      tabLog(`btwAssistantMessage msgId=${msg?.id} contentBlocks=${contentLen}`);
      this.postMessage({
        type: 'btwAssistantMessage',
        messageId: msg?.id,
        content: Array.isArray(msg?.content) ? msg.content as any : [],
        model: msg?.model,
      });
    });

    btw.on('messageStop', () => {
      tabLog('btwMessageStop');
      this.postMessage({ type: 'btwMessageStop' });
    });

    btw.on('result', () => {
      tabLog('btwResult');
      this.postMessage({ type: 'btwResult' });
    });

    btw.on('ended', (data?: { error?: string; code?: number }) => {
      tabLog(`btwSessionEnded error=${data?.error} code=${data?.code}`);
      this.postMessage({ type: 'btwSessionEnded', error: data?.error });
      this.btwSession = null;
    });
  }

  /** Send a follow-up message in the btw background session. */
  sendBtwMessage(text: string): void {
    if (!this.btwSession) {
      this.log(`[Tab ${this.tabNumber}] Cannot send btw message: no active btw session.`);
      return;
    }
    this.btwSession.sendMessage(text);
  }

  /** Close and dispose the btw background session. */
  closeBtwSession(): void {
    if (this.btwSession) {
      this.log(`[Tab ${this.tabNumber}] Closing btw session.`);
      this.btwSession.dispose();
      this.btwSession = null;
    }
  }

  // --- Review Loop (automatic Claude<->Codex review) ---

  /**
   * Inject a prompt into the live session and resolve with the final assistant
   * text of that turn. Used by the review loop to capture the developer's handover.
   */
  captureNextTurn(prompt: string, timeoutMs: number): Promise<string> {
    if (this.disposed) {
      return Promise.reject(new Error('Tab is disposed.'));
    }
    if (this.turnCapture) {
      return Promise.reject(new Error('A turn capture is already in progress.'));
    }
    if (!this.processManager.isRunning) {
      return Promise.reject(new Error('No running session to capture a turn from.'));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failTurnCapture(new Error('Developer turn timed out.'));
      }, timeoutMs);
      this.turnCapture = { answerParts: [], fallbackParts: [], timer, resolve, reject };
      try {
        this.control.sendText(prompt);
        this.postMessage({ type: 'processBusy', busy: true });
      } catch (err) {
        this.failTurnCapture(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Accumulate assistant text for an in-flight turn capture (mirrors HeadlessAgentRunner). */
  private wireTurnCaptureEvents(): void {
    // Track whether the current turn used any tool, so auto-start can skip
    // pure text-only Q&A turns (nothing was done, so nothing to review).
    this.demux.on('toolUseStart', () => {
      this.pendingTurnUsedTools = true;
    });
    this.demux.on('assistantMessage', (event: AssistantMessage) => {
      const capture = this.turnCapture;
      if (!capture) {
        return;
      }
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      const textParts = blocks
        .filter((block) => block.type === 'text' && typeof block.text === 'string' && block.text)
        .map((block) => block.text as string);
      if (textParts.length === 0) {
        return;
      }
      const joined = textParts.join('\n');
      capture.fallbackParts.push(joined);
      // The final, non-tool_use message is the answer; tool_use messages are interim narration.
      if (event.message?.stop_reason !== 'tool_use') {
        capture.answerParts.push(joined);
      }
    });
  }

  private resolveTurnCapture(): void {
    const capture = this.turnCapture;
    if (!capture) {
      return;
    }
    this.turnCapture = null;
    clearTimeout(capture.timer);
    const answer = capture.answerParts.join('\n\n').trim();
    const fallback = capture.fallbackParts.join('\n\n').trim();
    capture.resolve(answer || fallback);
  }

  private failTurnCapture(err: Error): void {
    const capture = this.turnCapture;
    if (!capture) {
      return;
    }
    this.turnCapture = null;
    clearTimeout(capture.timer);
    capture.reject(err);
  }

  /** Read review-loop configuration from settings. */
  private getReviewLoopConfig(): ReviewLoopConfig {
    const config = vscode.workspace.getConfiguration('claudeMirror.reviewLoop');
    const defaults = DEFAULT_REVIEW_LOOP_CONFIG;
    return {
      maxRounds: Math.max(1, Math.min(20, config.get<number>('maxRounds', defaults.maxRounds))),
      reviewerModel: config.get<string>('reviewerModel', defaults.reviewerModel),
      reviewerReasoningEffort: config.get<string>('reviewerReasoningEffort', defaults.reviewerReasoningEffort),
      reviewerServiceTier: config.get<string>('reviewerServiceTier', defaults.reviewerServiceTier),
      classifierModel: config.get<string>('classifierModel', defaults.classifierModel),
      turnTimeoutMs: Math.max(30_000, config.get<number>('turnTimeoutMs', defaults.turnTimeoutMs)),
    };
  }

  /** Start the automatic Claude<->Codex review loop on this tab. Resumes the
   *  Claude session if its process has exited (e.g. at session end) so the loop
   *  can always ask the developer for a handover instead of bailing. */
  async startReviewLoop(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.reviewLoop?.isRunning) {
      this.log(`[Tab ${this.tabNumber}] Review loop already running.`);
      return;
    }
    if (this.isBusy) {
      this.postMessage({
        type: 'reviewLoopEvent',
        event: { kind: 'error', round: 0, text: 'Session is busy. Wait for the current turn to finish before starting a review.' },
      });
      return;
    }

    // The Codex reviewer reads the workspace by path, but the developer (handover
    // and fixes) needs a live Claude CLI. If the process exited, resume it.
    if (!this.processManager.isRunning) {
      const sid = this.processManager.currentSessionId ?? this.lastKnownSessionId;
      if (!sid) {
        this.postMessage({ type: 'reviewLoopEvent', event: { kind: 'error', round: 0, text: 'No session to review yet — send a message first.' } });
        return;
      }
      this.postMessage({ type: 'reviewLoopEvent', event: { kind: 'info', round: 0, text: 'Resuming the session to run the review...' } });
      try {
        await this.processManager.start({
          resume: sid,
          skipReplay: true,
          cwd: this.getEffectiveCwd(),
          cliPathOverride: this.cliPathOverride ?? undefined,
          appendSystemPrompt: this.appendSystemPrompt ?? undefined,
          allowedTools: this.allowedTools ?? undefined,
          ...this.claudeAccountProcessOptions(),
        });
        this.processManager.seedSessionId(sid);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.postMessage({ type: 'reviewLoopEvent', event: { kind: 'error', round: 0, text: `Could not resume the session to review: ${reason}` } });
        return;
      }
      if (this.disposed || this.reviewLoop?.isRunning) {
        return;
      }
    }

    const reviewCwd = this.getWorktreePath() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;
    const tabLog = (msg: string) => this.log(`[Tab ${this.tabNumber}] ${msg}`);

    this.reviewerSession = new CodexReviewerSession(this.context, tabLog);
    const classifier = new ReviewVerdictClassifier();
    classifier.setLogger(tabLog);
    classifier.setClaudeConfigDirProvider(() => this.claudeConfigDir ?? undefined);

    this.reviewLoop = new ReviewLoopOrchestrator({
      developer: {
        captureTurn: (prompt, timeoutMs) => this.captureNextTurn(prompt, timeoutMs),
        abortTurn: (hard) => {
          // Only act when a developer turn is actually in flight. During the
          // review/classify phases Claude is idle and must not be cancelled.
          if (!this.turnCapture) {
            return;
          }
          this.failTurnCapture(new Error('Review loop stopped.'));
          // Hard stop (Stop button) interrupts the live CLI turn; a soft stop
          // (user sent a message) only detaches so we never cancel-then-write.
          if (hard) {
            this.cancelRequest();
          }
        },
      },
      reviewer: this.reviewerSession,
      classifier,
      config: this.getReviewLoopConfig(),
      cwd: reviewCwd,
      emit: (event) => this.postMessage({ type: 'reviewLoopEvent', event }),
      log: tabLog,
    });

    void this.reviewLoop.start().finally(() => {
      this.closeReviewLoop();
    });
  }

  /** Stop an in-flight review loop (Stop button). */
  stopReviewLoop(): void {
    this.reviewLoop?.stop();
  }

  /** Per-session override: enable/disable auto-review for THIS tab only. In-memory;
   *  never touches the global setting or other tabs. Turning it off also stops any
   *  loop currently running on this tab. */
  setReviewLoopSessionEnabled(enabled: boolean): void {
    this.reviewLoopEnabledThisSession = enabled;
    this.log(`[Tab ${this.tabNumber}] Auto-review ${enabled ? 'enabled' : 'disabled'} for this session.`);
    if (!enabled) {
      this.reviewLoop?.stop('Auto-review disabled for this session.');
    }
  }

  /** Called when the user sends a manual message; stops any running review loop. */
  notifyUserActivity(): void {
    // A user-initiated turn is starting; mark it so the next completed turn can
    // optionally auto-start the review loop (and never chain off injected turns).
    this.pendingUserTurn = true;
    if (this.reviewLoop?.isRunning) {
      this.log(`[Tab ${this.tabNumber}] User activity detected; stopping review loop (soft).`);
      // Soft stop: detach our capture but never cancel the live Claude process,
      // because MessageHandler is about to send the user's message to it.
      this.reviewLoop.stop('Stopped because you sent a message.', false);
    }
  }

  /** Tear down the review loop and its reviewer session. */
  private closeReviewLoop(): void {
    if (this.reviewerSession) {
      this.reviewerSession.dispose();
      this.reviewerSession = null;
    }
    this.reviewLoop = null;
  }

  /**
   * Auto-start the review loop after a user-initiated Claude turn completes,
   * when claudeMirror.reviewLoop.autoStart is enabled. Never chains off the
   * loop's own injected turns (wasCapturingTurn) or non-user turns / replay.
   */
  private maybeAutoStartReviewLoop(resultEvent: ResultSuccess | ResultError, wasCapturingTurn: boolean): void {
    const userInitiated = this.pendingUserTurn;
    this.pendingUserTurn = false;
    const usedTools = this.pendingTurnUsedTools;
    this.pendingTurnUsedTools = false;
    // Only auto-review turns where Claude actually did work (used a tool); skip
    // pure text-only Q&A so we never run a Codex review after casual chat.
    if (wasCapturingTurn || !userInitiated || !usedTools) {
      return;
    }
    // Per-session opt-out (e.g. a simple task that does not need review).
    if (!this.reviewLoopEnabledThisSession) {
      return;
    }
    if (this.disposed || this.reviewLoop?.isRunning) {
      return;
    }
    if (resultEvent.subtype !== 'success') {
      return;
    }
    if (this.getProvider() !== 'claude') {
      return;
    }
    // A known session id is enough; the process may have exited at session end,
    // and startReviewLoop() will resume it before running the review.
    if (!this.processManager.currentSessionId && !this.lastKnownSessionId) {
      return;
    }
    const autoStart = vscode.workspace
      .getConfiguration('claudeMirror.reviewLoop')
      .get<boolean>('autoStart', false);
    if (!autoStart) {
      return;
    }
    // Defer so the just-finished turn fully settles before we inject the handover prompt.
    setTimeout(() => {
      if (this.disposed || this.reviewLoop?.isRunning || this.isBusy) {
        return;
      }
      // Re-validate the gates at fire time: the user may have flipped "This session"
      // off (or toggled the global Auto-review) during the 400 ms window.
      if (!this.reviewLoopEnabledThisSession) {
        return;
      }
      const stillAutoStart = vscode.workspace
        .getConfiguration('claudeMirror.reviewLoop')
        .get<boolean>('autoStart', false);
      if (!stillAutoStart) {
        return;
      }
      this.log(`[Tab ${this.tabNumber}] Auto-starting review loop (reviewLoop.autoStart).`);
      void this.startReviewLoop();
    }, 400);
  }

  // --- Merge Conflict Assistant ---

  /** Start a fresh, merge-focused session seeded with the conflict file list. */
  startMergeAssistant(opts: MergeAssistantStartOptions): void {
    // Close any existing merge assistant first
    this.closeMergeAssistant();

    this.mergeAssistantGeneration++;
    this.log(`[Tab ${this.tabNumber}] Starting merge assistant in ${opts.targetCwd}`);
    this.mergeAssistant = new MergeAssistantSession(
      this.context,
      (msg) => this.log(`[Tab ${this.tabNumber}] ${msg}`),
    );
    this.wireMergeAssistantEvents();

    this.mergeAssistant.start({
      ...opts,
      ...this.claudeAccountProcessOptions(),
    }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[Tab ${this.tabNumber}] merge assistant start failed: ${errMsg}`);
      this.closeMergeAssistant();
    });
  }

  /** Wire demux events from the merge assistant to the webview. */
  private wireMergeAssistantEvents(): void {
    if (!this.mergeAssistant) { return; }
    const ma = this.mergeAssistant;

    const tabLog = (msg: string) => this.log(`[Tab ${this.tabNumber}] [Merge->WV] ${msg}`);

    ma.on('userMessage', (data: { message: { content: unknown } }) => {
      const rawContent = data.message?.content;
      const content = Array.isArray(rawContent)
        ? rawContent
        : typeof rawContent === 'string'
          ? [{ type: 'text' as const, text: rawContent }]
          : [];
      tabLog('mergeAssistantUserMessage');
      this.postMessage({ type: 'mergeAssistantUserMessage', content });
    });

    ma.on('messageStart', (data: { messageId: string }) => {
      tabLog(`mergeAssistantMessageStart msgId=${data.messageId}`);
      this.postMessage({ type: 'mergeAssistantMessageStart', messageId: data.messageId });
    });

    ma.on('textDelta', (data: { blockIndex: number; text: string }) => {
      this.postMessage({
        type: 'mergeAssistantStreamingText',
        blockIndex: data.blockIndex,
        text: data.text,
      });
    });

    ma.on('toolUseStart', (data: { blockIndex: number; toolName: string }) => {
      tabLog(`mergeAssistantToolUse ${data.toolName} @${data.blockIndex}`);
      this.postMessage({
        type: 'mergeAssistantToolUse',
        blockIndex: data.blockIndex,
        toolName: data.toolName,
        summary: describeToolActivity(data.toolName),
      });
    });

    ma.on('assistantMessage', (data: { message: { id: string; content: unknown[]; model?: string } }) => {
      const msg = data.message;
      const contentLen = Array.isArray(msg?.content) ? msg.content.length : 0;
      tabLog(`mergeAssistantAssistantMessage msgId=${msg?.id} contentBlocks=${contentLen}`);
      this.postMessage({
        type: 'mergeAssistantAssistantMessage',
        messageId: msg?.id,
        content: Array.isArray(msg?.content) ? msg.content as any : [],
        model: msg?.model,
      });
    });

    ma.on('result', () => {
      tabLog('mergeAssistantResult');
      this.postMessage({ type: 'mergeAssistantResult' });
    });

    ma.on('ended', (data?: { error?: string; code?: number }) => {
      // Drop a natural-end signal from an assistant that is no longer the
      // current slot, so it cannot clobber a newer one (restart race).
      if (this.mergeAssistant !== ma) { return; }
      tabLog(`mergeAssistantSessionEnded error=${data?.error} code=${data?.code}`);
      this.postMessage({ type: 'mergeAssistantSessionEnded', error: data?.error });
      this.mergeAssistant = null;
    });

    // A Node EventEmitter 'error' with no listener throws. Give it one so a CLI
    // spawn/runtime failure surfaces to the webview instead of crashing the host.
    ma.on('error', (err: Error) => {
      tabLog(`mergeAssistantError ${err?.message}`);
      if (this.mergeAssistant === ma) {
        this.mergeAssistant = null;
        this.postMessage({ type: 'mergeAssistantSessionEnded', error: err?.message ?? 'merge assistant error' });
        ma.dispose();
      }
    });
  }

  /** Send a follow-up message in the merge assistant. */
  sendMergeAssistantMessage(text: string): void {
    if (!this.mergeAssistant) {
      this.log(`[Tab ${this.tabNumber}] Cannot send merge-assistant message: no active session.`);
      return;
    }
    this.mergeAssistant.sendMessage(text);
  }

  /**
   * Close and dispose the merge assistant (kill-before-teardown). The
   * `mergeAssistantSessionEnded` signal is posted only after the CLI process has
   * truly exited (dispose waits for the real 'exit'), so the webview never
   * finalizes the merge while the assistant could still touch the index. If a
   * newer assistant has been started meanwhile, the stale termination is dropped.
   */
  closeMergeAssistant(): void {
    if (!this.mergeAssistant) { return; }
    const ma = this.mergeAssistant;
    const gen = this.mergeAssistantGeneration;
    this.mergeAssistant = null;
    this.log(`[Tab ${this.tabNumber}] Closing merge assistant (awaiting real exit).`);
    ma.dispose(() => {
      if (gen === this.mergeAssistantGeneration && this.mergeAssistant === null) {
        this.postMessage({ type: 'mergeAssistantSessionEnded' });
      }
    });
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

  /** Persist session metadata to the session store, preserving existing fields (incl. summary). */
  private persistSessionMetadata(name?: string): void {
    const sid = this.processManager.currentSessionId;
    if (!sid) {
      return;
    }
    this.lastKnownSessionId = sid;
    // Spread existing first so unrelated fields (e.g. summary, summaryGeneratedAt,
    // summaryProvider, handoff metadata) survive routine metadata updates from
    // rename/resume/turn-completed.
    const existing = this.sessionStore.getSession(sid);
    void this.sessionStore.saveSession({
      ...(existing ?? {}),
      sessionId: sid,
      name: name || existing?.name || `Session ${this.tabNumber}`,
      model: this.currentModel,
      provider: this.getProvider(),
      startedAt: existing?.startedAt || this.sessionStartedAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      firstPrompt: this.firstPrompt || existing?.firstPrompt,
      workspacePath: existing?.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      claudeAccountProfileId: this.claudeAccountProfileId ?? undefined,
    });
  }

  /** Update the VS Code panel title */
  private setTabName(name: string): void {
    this.baseTitle = name;
    this.callbacks.onNameChanged?.(this.id, name);
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
    this.callbacks.onBusyStateChanged?.(this.id, busy);
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

  /** Re-color the native tab icon. Called by TabManager when this tab joins/leaves a folder. */
  applyTabColor(color: string): void {
    if (this.disposed) return;
    this.setTabIcon(color);
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
        // The per-session auto-review override lives in-memory on this tab and the
        // extension is its source of truth. Push the current value so the StatusBar
        // toggle reflects it after any (re)load WITHOUT mutating the flag here.
        // Resetting it on 'ready' would silently re-enable a session the user turned
        // off whenever 'ready' fires again mid-session (e.g. on a new session's first
        // turn) — that was the bug where "This session: Off" still ran the loop.
        this.postMessage({ type: 'reviewLoopSessionEnabledSetting', enabled: this.reviewLoopEnabledThisSession });
      }
      this.messageCallback?.(message as WebviewToExtensionMessage);
    });

    this.panel.onDidChangeViewState((e) => {
      this.log(
        `[Tab ${this.tabNumber}] ViewState changed: active=${e.webviewPanel.active} visible=${e.webviewPanel.visible}`,
      );
      if (e.webviewPanel.active) {
        // Wake silently for a mid-session crash recovery — different state path
        // from boot lazy-resume; this keeps history intact and may flush queued
        // messages once the resumed CLI sends system/init.
        if (this.silentResumeArmedFlag && this.pendingResumeSessionId) {
          this.log(
            `[Tab ${this.tabNumber}] [SilentResume] waking on focus session=` +
              `${this.pendingResumeSessionId.slice(0, 8)}`,
          );
          void this.beginSilentResume();
        } else if (this.lazyWakeArmed && this.pendingResumeSessionId) {
          // Boot-time lazy resume (post-restore): existing path, full startSession.
          const sid = this.pendingResumeSessionId;
          this.pendingResumeSessionId = null;
          this.lazyWakeArmed = false;
          this.log(`[Tab ${this.tabNumber}] Lazy-resume waking for session ${sid.slice(0, 8)}`);
          void this.startSession({ resume: sid }).catch((err) => {
            this.log(
              `[Tab ${this.tabNumber}] Lazy-resume startSession failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
        this.callbacks.onFocused(this.id);
        this.postFocusInput('view-state active');
      }
    });

    // When VS Code window regains OS focus, schedule a delayed focusInput without
    // panel.reveal(); reveal() here can steal the first click in UI controls.
    this.windowStateSubscription = vscode.window.onDidChangeWindowState((e) => {
      this.log(
        `[Tab ${this.tabNumber}] Window focus changed: focused=${e.focused} panelActive=${this.panel?.active ?? false}`,
      );
      if (e.focused && this.panel?.active) {
        this.scheduleWindowFocusInput();
      }
    });

    this.panel.onDidDispose(() => {
      this.disposed = true;
      try {
        this.stopThinkingAnimation();
        this.resolveAssistantReplyWaiters(false);
        this.clearFocusInputTimer();
        // Drop any in-flight silent-resume state (timers, queue) before tearing down.
        this.clearSilentResumeTimers();
        this.silentResumeQueue = [];
        this.silentResumeInFlight = false;
        this.silentResumeArmedFlag = false;
        this.windowStateSubscription?.dispose();
        this.windowStateSubscription = null;
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
    // Per-message fallback tracking for checkpoint capture. The demux's
    // 'blockStop' listener has been observed to silently not fire in
    // webpack production builds (same EventEmitter bug as 'result'), so we
    // observe content_block_* events directly here and trigger checkpoint
    // capture at content_block_stop for code-write tools. Idempotent with
    // the demux path -- CheckpointManager dedupes by absolute file path.
    const cpToolNames = new Map<number, string>();
    const cpToolInputs = new Map<number, string>();

    this.processManager.on('event', (event: CliOutputEvent) => {
      let detail = event.type;
      if ('subtype' in event) {
        detail += '/' + event.subtype;
      }
      if (event.type === 'stream_event') {
        const inner = (event as import('../types/stream-json').StreamEvent).event;
        // Silent-resume: track streaming state so a mid-stream crash can finalize the bubble.
        if (inner.type === 'message_start') {
          const ms = inner as import('../types/stream-json').MessageStart;
          this.currentlyStreaming = true;
          this.currentStreamingMessageId = ms.message?.id ?? null;
        } else if (inner.type === 'message_stop') {
          this.currentlyStreaming = false;
        }
        // Silent-resume: a system/init event during in-flight resume signals a successful spawn.
        // (handled at the top-level event branch below; this is the stream-event case)
        // Checkpoint fallback: track tool blocks from raw events
        if (inner.type === 'message_start') {
          cpToolNames.clear();
          cpToolInputs.clear();
        } else if (inner.type === 'content_block_start') {
          const block = (inner as import('../types/stream-json').ContentBlockStart).content_block;
          const idx = (inner as import('../types/stream-json').ContentBlockStart).index;
          if (block.type === 'tool_use' && block.name) {
            cpToolNames.set(idx, block.name);
            cpToolInputs.set(idx, '');
          }
        } else if (inner.type === 'content_block_delta') {
          const idx = (inner as import('../types/stream-json').ContentBlockDelta).index;
          const delta = (inner as import('../types/stream-json').ContentBlockDelta).delta;
          if (delta.type === 'input_json_delta' && cpToolNames.has(idx)) {
            const prev = cpToolInputs.get(idx) || '';
            cpToolInputs.set(idx, prev + (delta.partial_json || ''));
          }
        } else if (inner.type === 'content_block_stop') {
          const idx = (inner as import('../types/stream-json').ContentBlockStop).index;
          const toolName = cpToolNames.get(idx);
          if (toolName) {
            const rawInput = cpToolInputs.get(idx) || '';
            this.messageHandler.captureCheckpointForToolBlock(toolName, rawInput, 'wireProcessEvents');
          }
          cpToolNames.delete(idx);
          cpToolInputs.delete(idx);
        }
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
        // Silent-resume: a turn completed cleanly; clear streaming markers.
        this.currentlyStreaming = false;
        this.currentStreamingMessageId = null;
        const resultEvent = event as ResultSuccess | ResultError;
        // Silent-resume: a *successful* turn means the session is healthy again;
        // reset the consecutive-crash budget so a future legitimate crash gets
        // the full retry quota.
        if (resultEvent.subtype === 'success' && this.silentResumeAttempts > 0) {
          tabLog(
            `[SilentResume] clean turn observed; resetting attempts ` +
              `(was ${this.silentResumeAttempts}).`,
          );
          this.silentResumeAttempts = 0;
        }
        // Direct bypass: call MessageHandler.handleResultEvent directly.
        // The demux.on('result') listener has been observed to silently not fire
        // in webpack production builds despite being registered. This direct path
        // guarantees turnComplete events are emitted. A dedup guard in
        // handleResultEvent prevents double-processing if the demux path also fires.
        const wasCapturingTurn = this.turnCapture !== null;
        this.messageHandler.handleResultEvent(resultEvent, 'wireProcessEvents');
        this.resolveTurnCapture();
        this.maybeAutoStartReviewLoop(resultEvent, wasCapturingTurn);
      }
      // Silent-resume: detect successful resume spawn via system/init.
      if (event.type === 'system' && event.subtype === 'init' && this.silentResumeInFlight) {
        this.handleSilentResumeReady(event.session_id, tabLog);
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

    // Control protocol: the CLI blocked on an always-"ask" tool
    // (AskUserQuestion/ExitPlanMode). Hand it to MessageHandler, which shows the
    // approval bar and later calls processManager.respondPermission().
    this.processManager.on(
      'permissionRequest',
      (req: import('../process/ClaudeProcessManager').PermissionRequestPayload) => {
        tabLog(`CLI permissionRequest: tool=${req.toolName} requestId=${req.requestId}`);
        this.messageHandler.handlePermissionRequest(req);
      },
    );

    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      tabLog(`Process exited: code=${info.code}, signal=${info.signal}`);

      // Review loop: a process exit aborts any in-flight turn capture.
      this.failTurnCapture(new Error('Session process exited during a review-loop turn.'));

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
              ...this.claudeAccountProcessOptions(),
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

      const config = vscode.workspace.getConfiguration('claudeMirror');
      const autoRestart = config.get<boolean>('autoRestart', true);
      const currentSessionId = this.processManager.currentSessionId;

      if (info.code !== 0 && info.code !== null) {
        // ===== Silent crash resume classifier =====
        const silentCfg = this.getSilentResumeConfig();

        // Highest priority: stale --resume target. The CLI cannot recover by
        // retrying with the same id, so neither silent resume NOR the legacy
        // Restart prompt makes sense. Surface a single clear error and stop.
        if (this.resumeTargetMissingDetected) {
          tabLog(
            `[SilentResume] declining: --resume target missing on disk ` +
              `(silentResumeInFlight=${this.silentResumeInFlight})`,
          );
          this.resumeTargetMissingDetected = false;
          if (this.silentResumeInFlight) {
            // Drain any queued user prompts back to the input area, post UX,
            // tear down half-spawned process. Use 'fresh-session' reason so
            // escalate() picks the right toast text and skips the Restart prompt.
            this.escalateToVisibleCrash('fresh-session');
          } else {
            this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
            this.postMessage({
              type: 'error',
              message:
                `Tab ${this.tabNumber}: Could not resume session ` +
                `${currentSessionId?.slice(0, 8) ?? '(unknown)'}: ` +
                `no conversation file found on disk. Start a fresh session to continue.`,
            });
          }
          // Lock silent resume out for this tab until a clean turn happens.
          this.silentResumeAttempts = silentCfg.maxAttempts;
          return;
        }

        // Next: a silent resume was in flight and the resumed CLI exited before
        // sending system/init (a real "spawn-failed-after-arm" case).
        if (this.silentResumeInFlight) {
          tabLog(`[SilentResume] resumed CLI exited before system/init (code=${info.code})`);
          this.escalateToVisibleCrash('exit-while-spawning');
          return;
        }

        const eligibleForSilent =
          silentCfg.enabled &&
          !this.claudeCliMissingDetected &&
          !(this.happyAuthDetected && this.isHappyCliSession()) &&
          !this.resumeTargetMissingDetected &&
          !!currentSessionId &&
          this.silentResumeAttempts < silentCfg.maxAttempts;

        if (eligibleForSilent && currentSessionId) {
          this.armSilentResume(currentSessionId, info.code, tabLog);
          return;
        }

        // Not eligible (or feature disabled / cap exhausted): fall through to visible UX.
        if (silentCfg.enabled && this.silentResumeAttempts >= silentCfg.maxAttempts) {
          tabLog(
            `[SilentResume] cap-exhausted session=${currentSessionId} ` +
              `attempts=${this.silentResumeAttempts}/${silentCfg.maxAttempts}`,
          );
          // Reset so future tabs/sessions don't inherit a stuck cap.
          this.silentResumeAttempts = 0;
        }

        this.saveProjectAnalytics();
        this.achievementService.onSessionCrash(this.id);
        this.achievementService.onSessionEnd(this.id);
        void this.maybeRunSummarizer('crashed').catch((err) =>
          tabLog(`[Summarizer] crash-branch failure: ${err instanceof Error ? err.message : String(err)}`),
        );

        // Claude or Happy CLI not installed.
        // For Happy: auto-fall back to Claude in this same tab so a missing
        // optional provider never blocks the user.
        // For Claude: surface install guidance (no fallback target available).
        if (this.claudeCliMissingDetected) {
          this.claudeCliMissingDetected = false;
          if (this.isHappyCliSession()) {
            this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
            this.fallbackFromHappyToClaude('exit-handler');
            return;
          }
          tabLog('Claude CLI not found - showing install guidance');
          this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
          this.postMessage({
            type: 'error',
            message: this.getCliMissingMessage(),
          });
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
                    ...this.claudeAccountProcessOptions(),
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
        void this.maybeRunSummarizer('completed').catch((err) =>
          tabLog(`[Summarizer] completed-branch failure: ${err instanceof Error ? err.message : String(err)}`),
        );
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
      // Detect a stale --resume target (session id no longer exists on disk).
      // Without this, the silent-resume classifier would re-arm with the same
      // bad id and loop until the cap kicks in.
      if (this.isLikelyResumeTargetMissing(normalized)) {
        this.resumeTargetMissingDetected = true;
        tabLog('Detected stale --resume target from stderr; silent resume disabled for this exit');
        // Forward as-is so the user can see what is wrong; the exit handler will
        // also surface a clearer toast and skip the silent-resume path.
        this.postMessage({ type: 'error', message: normalized || trimmed });
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
        this.claudeCliMissingDetected = false;
        if (this.isHappyCliSession()) {
          this.postMessage({ type: 'sessionEnded', reason: 'crashed' });
          this.fallbackFromHappyToClaude('error-handler');
          return;
        }
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

  /** Check if stderr text indicates the CLI rejected our --resume target.
   *  Example: "No conversation found with session ID: <uuid>". */
  private isLikelyResumeTargetMissing(text: string): boolean {
    const normalized = this.stripAnsi(text);
    return /no conversation found with session id/i.test(normalized);
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

  /** Auto-fallback from Happy to Claude when the Happy CLI is missing on this
   *  machine. We clear the per-tab override, notify TabManager so the snapshot
   *  entry no longer marks this tab as remote, surface a non-modal toast, and
   *  spin up a fresh Claude session in the same tab so the user is never
   *  blocked by an uninstalled optional provider. */
  private fallbackFromHappyToClaude(reason: string): void {
    this.log(`[Tab ${this.tabNumber}] Happy CLI not found - falling back to Claude (${reason})`);
    this.cliPathOverride = null;
    this.callbacks.onProviderChanged?.(this.id, 'claude', null);
    void vscode.window
      .showInformationMessage(
        'Happy Coder CLI not found. Switched to Claude Code for this session. Install Happy Coder to use it.',
        'Configure Happy CLI Path'
      )
      .then((choice) => {
        if (choice === 'Configure Happy CLI Path') {
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'claudeMirror.happy.cliPath'
          );
        }
      });
    void this.startSession().catch((err) => {
      this.log(
        `[Tab ${this.tabNumber}] Auto-fallback startSession failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  /**
   * Public hook for the stop-button path (`MessageHandler.stopSession`).
   * Captures the current sessionId synchronously *before* `processManager.stop()` resets it,
   * then runs the summarizer fire-and-forget against that captured id.
   */
  requestEndOfSessionSummary(reason: 'completed' | 'crashed' | 'stopped'): void {
    const sid = this.processManager.currentSessionId ?? this.lastKnownSessionId;
    if (sid) {
      this.lastKnownSessionId = sid;
    }
    void this.maybeRunSummarizer(reason, sid).catch((err) =>
      this.log(`[Summarizer] requestEndOfSessionSummary failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /**
   * Generate a 1-3 sentence summary of this session and persist it on the SessionMetadata.
   * Fire-and-forget: failures are logged but do not impact the exit path. The success
   * flag (`summarizerRan`) is only set AFTER a summary is saved, so transient JSONL-flush
   * races (where the file isn't ready at exit time) are retryable on the next trigger.
   */
  private async maybeRunSummarizer(
    reason: 'completed' | 'crashed' | 'stopped',
    capturedSessionId?: string | null,
  ): Promise<void> {
    if (this.summarizerRan || this.summarizerInFlight) {
      return;
    }
    const config = vscode.workspace.getConfiguration('claudeMirror');
    if (!config.get<boolean>('sessionEndSummary', true)) {
      return;
    }
    const sid = capturedSessionId ?? this.processManager.currentSessionId ?? this.lastKnownSessionId;
    if (!sid) {
      this.log(`[Summarizer] Skipped (no sessionId yet, reason=${reason})`);
      return;
    }
    this.summarizerInFlight = true;
    this.log(`[Summarizer] Triggered (reason=${reason}, session=${sid.slice(0, 8)})`);

    try {
      const summarizer = new SessionSummarizer();
      summarizer.setLogger(this.log);
      const result = await summarizer.summarizeSession({
        sessionId: sid,
        provider: 'claude',
        cliPathOverride: this.cliPathOverride ?? undefined,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        claudeConfigDir: this.claudeConfigDir ?? undefined,
      });
      if (!result) {
        this.log('[Summarizer] No summary produced (transient — flag stays unset for retry)');
        return;
      }
      const existing = this.sessionStore.getSession(sid);
      if (!existing) {
        this.log('[Summarizer] No SessionMetadata to attach summary to');
        return;
      }
      await this.sessionStore.saveSession({
        ...existing,
        summary: result.text,
        summaryGeneratedAt: Date.now(),
        summaryProvider: result.source,
      });
      this.summarizerRan = true;
      this.callbacks.onSummaryGenerated?.(sid);
      this.log(`[Summarizer] Saved (${result.source}, ${result.text.length} chars)`);
    } catch (err) {
      this.log(`[Summarizer] Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.summarizerInFlight = false;
    }
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

    // Attach Particle Accelerator stats if the feature was active
    if (this.particleAcceleratorService?.isEnabled()) {
      const traceReader = this.particleAcceleratorService.getTraceReader();
      if (traceReader) {
        void traceReader.getAggregate(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        ).then(agg => {
          if (agg.totalCommands > 0) {
            summary.particleAccelerator = {
              commandCount: agg.totalCommands,
              failedCommandCount: agg.failedCommands,
              totalRawBytes: agg.totalRawBytes,
              totalFilteredBytes: agg.totalFilteredBytes,
              estimatedTokensSaved: agg.totalEstimatedTokensSaved,
              topCommandFamilies: agg.topCommandFamilies.slice(0, 5),
            };
            void this.projectAnalyticsStore.saveSummary(summary);
          }
        }).catch(() => {});
      }
    }

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
      this.callbacks.onSessionIdAssigned?.(this.id, event.session_id);

      // Update Particle Accelerator context with the CLI-assigned session ID
      if (this.particleAcceleratorService?.isEnabled()) {
        void this.particleAcceleratorService.getContextStore()
          ?.updateSessionId(this.id, event.session_id).catch(() => {});
      }

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

    // Show the auto-prompt in the UI so the user sees what happened.
    // Marked source='auto-prompt' so it stays out of Fork / Revert /
    // prompt-navigation actions (those are reserved for true input-box prompts).
    this.postMessage({
      type: 'userMessage',
      content: [{ type: 'text', text: autoPromptText }],
      source: 'auto-prompt',
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

  /** Inject the shared WorkstreamManager (forwarded to MessageHandler) */
  setWorkstreamManager(manager: import('../workstream/WorkstreamManager').WorkstreamManager): void {
    this.messageHandler.setWorkstreamManager(manager);
  }

  /** Inject the shared WorktreeController (forwarded to MessageHandler) */
  setWorktreeController(controller: import('../worktree/WorktreeController').WorktreeController): void {
    this.messageHandler.setWorktreeController(controller);
  }

  /** Inject the shared ParticleAcceleratorService (forwarded to MessageHandler + process manager env builder) */
  setParticleAcceleratorService(service: import('../particle-accelerator/ParticleAcceleratorService').ParticleAcceleratorService): void {
    this.particleAcceleratorService = service;
    this.messageHandler.setParticleAcceleratorService(service);

    if (service.isEnabled()) {
      const runtimePaths = service.getRuntimePaths();
      if (runtimePaths) {
        this.processManager.particleAcceleratorEnvBuilder = (baseEnv) => {
          if (!service.isEnabled()) return baseEnv;
          const contextStore = service.getContextStore();
          const spService = this.secretProtectionService;
          return service.buildAgentEnv({
            baseEnv,
            provider: 'claude',
            workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            tabRuntimeId: this.id,
            sessionId: this.processManager.currentSessionId ?? null,
            binDir: runtimePaths.binDir,
            storeDir: runtimePaths.storeDir,
            contextFilePath: contextStore?.getContextPath(this.id) ?? '',
            filterProfile: service.getSettings().filterProfile,
            storeRawLogs: service.getSettings().storeRawRedactedLogs,
            secretProtection: spService?.isEnabled() ? {
              enabled: true,
              mode: spService.getSettings().mode,
              enableEntropyScanner: spService.getSettings().enableEntropyScanner,
              scanTerminalOutput: spService.getSettings().scanTerminalOutput,
              scanMcp: spService.getSettings().scanMcp,
              exceptionsPath: spService.getExceptionStorePath(),
            } : undefined,
          });
        };
      }
    }
  }

  /** Inject the shared SecretProtectionService (forwarded to MessageHandler + process manager env flag) */
  setSecretProtectionService(service: import('../secret-protection/SecretProtectionService').SecretProtectionService): void {
    this.secretProtectionService = service;
    this.messageHandler.setSecretProtectionService(service);
    this.processManager.secretProtectionEnabled = service.isEnabled();
  }

  /** Inject the shared SuperParticleAcceleratorService for secret write blocking */
  setSuperParticleAcceleratorService(service: import('../super-particle-accelerator/SuperParticleAcceleratorService').SuperParticleAcceleratorService): void {
    this.superParticleAcceleratorService = service;
    this.messageHandler.setSuperParticleAcceleratorService(service);

    this.processManager.superParticleAcceleratorEnvBuilder = () => service.buildAgentEnv();
  }

  /** Inject the shared WorkspaceAccessGuardService for filesystem boundary enforcement */
  setWorkspaceAccessGuardService(service: import('../workspace-access-guard/WorkspaceAccessGuardService').WorkspaceAccessGuardService): void {
    this.messageHandler.setWorkspaceAccessGuardService(service);
    this.processManager.workspaceAccessGuardEnvBuilder = () => service.buildAgentEnv();
  }

  /** Inject the SessionStore (forwarded to MessageHandler for workstream classification) */
  setSessionStore(store: import('../session/SessionStore').SessionStore): void {
    this.messageHandler.setSessionStore(store);
  }

  /** Inject a getter for open tab session IDs (forwarded to MessageHandler for workstream scope). */
  setOpenTabSessionIdsGetter(getter: () => string[]): void {
    this.messageHandler.setOpenTabSessionIdsGetter(getter);
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
      const claudeDir = this.claudeConfigDir || require('path').join(homeDir, '.claude');
      const teamsDir = require('path').join(claudeDir, 'teams');
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
    if (sinceLast < SessionTab.FOCUS_INPUT_THROTTLE_MS) {
      this.log(
        `[Tab ${this.tabNumber}] Suppressing focusInput (${reason}) due to throttle (${sinceLast}ms < ${SessionTab.FOCUS_INPUT_THROTTLE_MS}ms)`,
      );
      return;
    }
    this.lastFocusInputPostAt = now;
    this.log(`[Tab ${this.tabNumber}] Posting focusInput (${reason})`);
    this.postMessage({ type: 'focusInput' });
  }

  private scheduleWindowFocusInput(): void {
    this.clearFocusInputTimer();
    this.log(
      `[Tab ${this.tabNumber}] Scheduling focusInput (window focus delay=${SessionTab.WINDOW_FOCUS_INPUT_DELAY_MS}ms)`,
    );
    this.focusInputTimer = setTimeout(() => {
      this.focusInputTimer = null;
      this.postFocusInput('window focus timer');
    }, SessionTab.WINDOW_FOCUS_INPUT_DELAY_MS);
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

/**
 * Human label for the live merge-assistant activity line.
 * The tool input (file path / command) is not yet available at toolUseStart,
 * so this is tool-name based; the detailed line renders later from the
 * assistant message's tool_use blocks.
 */
export function describeToolActivity(toolName: string): string {
  switch (toolName) {
    case 'Read': return 'Reading a file';
    case 'Edit':
    case 'MultiEdit': return 'Editing a file';
    case 'Write': return 'Writing a file';
    case 'Bash': return 'Running a command';
    case 'Grep': return 'Searching';
    case 'Glob': return 'Looking for files';
    default: return toolName;
  }
}
