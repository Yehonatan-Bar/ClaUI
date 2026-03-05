import * as vscode from 'vscode';
import * as path from 'path';
import type { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import type { ControlProtocol } from '../process/ControlProtocol';
import type { StreamDemux } from '../process/StreamDemux';
import type { SessionNamer } from '../session/SessionNamer';
import type { ActivitySummarizer, ActivitySummary } from '../session/ActivitySummarizer';
import type { AdventureInterpreter } from '../session/AdventureInterpreter';
import type { TurnAnalyzer } from '../session/TurnAnalyzer';
import type { MessageTranslator } from '../session/MessageTranslator';
import type { PromptEnhancer } from '../session/PromptEnhancer';
import type { PromptTranslator } from '../session/PromptTranslator';
import type { PromptHistoryStore } from '../session/PromptHistoryStore';
import type { ProjectAnalyticsStore } from '../session/ProjectAnalyticsStore';
import type { AchievementService } from '../achievements/AchievementService';
import type { SkillGenService } from '../skillgen/SkillGenService';
import { getStoredApiKey, setStoredApiKey, maskApiKey } from '../process/envUtils';
import type { TokenUsageRatioTracker } from '../session/TokenUsageRatioTracker';
import { AuthManager } from '../auth/AuthManager';
import { BugReportService } from '../feedback/BugReportService';
import { openHtmlPreviewPanel } from './HtmlPreviewPanel';
import type {
  AdventureBeatMessage,
  ExtensionToWebviewMessage,
  ProviderCapabilities,
  ProviderId,
  TurnSemantics,
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
  ContentBlock,
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
  /** Save project analytics immediately (called before session clear/reset to avoid data loss) */
  saveProjectAnalyticsNow?(): void;
  /** Optional per-tab CLI override (e.g. Happy provider uses `happy` instead of `claude`) */
  getCliPathOverride?(): string | null;
  /** Provider currently routed by this tab */
  getProvider?(): ProviderId;
}

/**
 * Bridges communication between the webview UI and the Claude process.
 * Translates webview postMessages into CLI commands and
 * StreamDemux events into webview messages.
 */
/** Tool names that require user approval when the CLI pauses after calling them */
const APPROVAL_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];
/** If ExitPlanMode approve does not auto-resume quickly, send a proceed nudge */
/** Max times Bug 10 can re-open an ExitPlanMode approval cycle before permanently suppressing.
 *  Without this limit, the model can loop: work -> ExitPlanMode -> approve -> work -> ExitPlanMode... */
const MAX_EXITPLANMODE_REOPENS = 2;
const EXIT_PLANMODE_APPROVE_RESUME_FALLBACK_DELAY_MS = 5000;
const EXIT_PLANMODE_APPROVE_MAX_WAIT_MS = 30000;

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

const CLAUDE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsPlanApproval: true,
  supportsCompact: true,
  supportsFork: true,
  supportsImages: true,
  supportsGitPush: true,
  supportsTranslation: true,
  supportsPromptEnhancer: true,
  supportsCodexConsult: true,
  supportsPermissionModeSelector: true,
  supportsLiveTextStreaming: true,
  supportsConversationDiskReplay: true,
  supportsCostUsd: true,
};

function categorizeTurn(toolNames: string[], isError: boolean): TurnCategory {
  if (isError) return 'error';
  if (toolNames.length === 0) return 'discussion';
  const baseNames = toolNames.map(n => n.includes('__') ? n.split('__').pop()! : n);
  if (baseNames.some(n => n === 'Skill')) return 'skill';
  if (baseNames.some(n => CODE_WRITE_TOOLS.includes(n))) return 'code-write';
  if (baseNames.some(n => COMMAND_TOOLS.includes(n))) return 'command';
  if (baseNames.some(n => RESEARCH_TOOLS.includes(n))) return 'research';
  return 'success';
}

/**
 * Extract plain text from a CLI content field.
 * The CLI's `content` may be a plain string OR a ContentBlock[] array (CLI data format gotcha).
 */
function extractTextFromContent(content: string | ContentBlock[] | unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  }
  return String(content ?? '');
}

export class MessageHandler {
  private log: (msg: string) => void = () => {};
  private firstMessageSent = false;
  private sessionNamer: SessionNamer | null = null;
  private titleCallback: ((title: string) => void) | null = null;
  private firstPromptCallback: ((prompt: string) => void) | null = null;

  /** Tool names seen in the current assistant message (cleared on messageStart) */
  private currentMessageToolNames: string[] = [];
  /** Adventure semantic metadata collected during the current assistant message */
  private currentAdventureArtifacts = new Set<string>();
  private currentAdventureIndicators = new Set<string>();
  private currentAdventureCommandTags = new Set<string>();
  /** Set when the CLI pauses waiting for plan/question approval */
  private pendingApprovalTool: string | null = null;
  /** Set after user responds to approval - suppresses stale re-notifications from late events */
  private approvalResponseProcessed = false;
  /** Last known input_tokens from AssistantMessage (always present, unlike ResultSuccess.usage) */
  private lastAssistantInputTokens = 0;
  /** Tracks whether EnterPlanMode was called in this session */
  private planModeActive = false;
  /** Tracks whether an ExitPlanMode approval cycle completed in this session.
   *  Set true when the user responds to ExitPlanMode (any action: approve/reject/feedback).
   *  Reset to false when EnterPlanMode is detected (new plan cycle starts).
   *  Used to suppress stale re-triggers from late assistantMessage events or replayed sessions. */
  private exitPlanModeProcessed = false;
  /** True once non-plan tool activity is seen after ExitPlanMode was approved. */
  private postExitPlanNonPlanActivityObserved = false;
  /** How many times Bug 10 re-open logic fired in the current macro-session.
   *  After MAX_EXITPLANMODE_REOPENS, further re-opens are suppressed. Reset on
   *  EnterPlanMode or session restart. */
  private exitPlanModeReopenCount = 0;
  /** Monotonic ID for approval-bar cycles (ExitPlanMode / AskUserQuestion) */
  private nextApprovalCycleId = 1;
  /** Cycle ID for the currently visible/preserved approval bar */
  private pendingApprovalCycleId: number | null = null;
  /** True if a post-approval assistant turn started (auto-resume observed) */
  private pendingApprovalCycleResumeObserved = false;
  /** True if the Claude turn completed after the approval bar appeared */
  private pendingApprovalCycleResultObserved = false;
  /** Delayed fallback: nudge Claude to proceed if ExitPlanMode approve did not auto-resume */
  private exitPlanApproveResumeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set when a compact request is sent to CLI. On next messageStart, resets exitPlanModeProcessed
   *  so the model can call ExitPlanMode again after compaction re-activates plan mode. */
  private compactPending = false;
  private exitPlanApproveResumeFallbackCycleId: number | null = null;
  /** True while the CLI is between messageStart and result (assistant turn in progress) */
  private inAssistantTurn = false;
  /** Thinking effort level detected from system init or content blocks */
  private currentThinkingEffort: string | null = null;
  /** Separate timer for post-approve nudge, decoupled from approval cycle state so it
   *  won't be cancelled by result-handler cleanup or markApprovalCycleResumeObserved. */
  private postApproveNudgeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Activity summarizer: periodically summarizes tool activity via Haiku */
  private activitySummarizer: ActivitySummarizer | null = null;
  private activitySummaryCallback: ((summary: ActivitySummary) => void) | null = null;
  /** Maps blockIndex -> toolName for tool_use blocks in the current message */
  private toolBlockNames: Map<number, string> = new Map();
  /** Maps blockIndex -> accumulated input_json_delta chunks (for enrichment context) */
  private toolBlockContexts: Map<number, string> = new Map();
  /** True once at least one tool blockStop was seen in the current message */
  private sawToolBlockStopThisMessage = false;
  /** Guard against duplicate fallback extraction from repeated assistant snapshots */
  private fallbackToolUseRecordedForMessage = false;
  /** Getter for the session/tab name, injected by SessionTab */
  private getSessionName: (() => string) | null = null;
  /** Message translator for Hebrew translation feature */
  private messageTranslator: MessageTranslator | null = null;
  /** Adventure interpreter for dungeon crawler beat generation */
  private adventureInterpreter: AdventureInterpreter | null = null;
  /** Turn analyzer for semantic analysis (dashboard insights) */
  private turnAnalyzer: TurnAnalyzer | null = null;
  /** Prompt enhancer for AI-powered prompt improvement */
  private promptEnhancer: PromptEnhancer | null = null;
  /** Prompt translator for translating prompts to English */
  private promptTranslator: PromptTranslator | null = null;
  /** Babel Fish: unified bi-directional translation toggle */
  private babelFishEnabled = false;
  /** Babel Fish: track message IDs already sent for translation (dedup partial snapshots) */
  private babelFishTranslatedIds = new Set<string>();
  /** Skill generation service (global, shared across tabs) */
  private skillGenService: SkillGenService | null = null;
  /** Global token-usage ratio tracker (shared across all tabs) */
  private tokenRatioTracker: TokenUsageRatioTracker | null = null;

  /** Bash command strings seen in the current assistant message */
  private currentBashCommands: string[] = [];
  /** Last user message text (for TurnAnalyzer context) */
  private lastUserMessageText = '';
  /** Ring buffer of last 5 user message texts (for bug-repeat detection) */
  private recentUserMessages: string[] = [];
  /** Dedup: last userMessage text posted to webview, with timestamp.
   *  Prevents duplicate display from key-repeat, CLI echo, or any other source. */
  private lastPostedUserMsg: { text: string; time: number } | null = null;
  /** One-time handoff context staged by provider switch. Appended only to the first user turn. */
  private pendingHandoffPrompt: string | null = null;

  /** Turn counter for Session Vitals (reset on session clear) */
  private turnIndex = 0;
  /** Monotonic beat counter for Adventure widget (must be unique per beat, not per turn). */
  private adventureBeatIndex = 0;
  /** Last assistant message ID for TurnRecord association */
  private lastMessageId = '';

  /** Codex consultation: timestamp when the request was sent (for latency tracking) */
  private _codexConsultStartedAt: number | null = null;
  /** Codex consultation: timeout timer to cancel hung MCP calls */
  private _codexConsultTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Codex consultation timeout in ms (default: 120 seconds) */
  private static readonly CODEX_CONSULT_TIMEOUT_MS = 120_000;

  /** Extension-side TurnRecord accumulator for project analytics persistence */
  private turnRecords: TurnRecord[] = [];
  /** Project analytics store (injected, may be null if not wired) */
  private projectAnalyticsStore: ProjectAnalyticsStore | null = null;
  private secrets: vscode.SecretStorage | null = null;
  private authManager: AuthManager | null = null;
  private bugReportService: BugReportService | null = null;
  private logDir = '';
  private extensionVersion = '0.0.0';

  constructor(
    private readonly tabId: string,
    private readonly webview: WebviewBridge,
    private readonly processManager: ClaudeProcessManager,
    private readonly control: ControlProtocol,
    private readonly demux: StreamDemux,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService,
    skillGenServiceParam?: SkillGenService
  ) {
    if (skillGenServiceParam) {
      this.skillGenService = skillGenServiceParam;
    }
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Stage one-time handoff context to be injected into the next user turn. */
  setPendingHandoffPrompt(prompt: string): void {
    const trimmed = prompt.trim();
    this.pendingHandoffPrompt = trimmed || null;
    this.log(`[Handoff] staged deferred context: chars=${trimmed.length}`);
  }

  /** Clear staged one-time handoff context (called on fresh/restarted sessions). */
  clearPendingHandoffPrompt(): void {
    this.pendingHandoffPrompt = null;
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

  /** Attach a PromptEnhancer for AI-powered prompt improvement */
  setPromptEnhancer(enhancer: PromptEnhancer): void {
    this.promptEnhancer = enhancer;
  }

  /** Attach a PromptTranslator for translating prompts to English */
  setPromptTranslator(translator: PromptTranslator): void {
    this.promptTranslator = translator;
  }

  /** Attach the global SkillGenService */
  setSkillGenService(service: SkillGenService): void {
    this.skillGenService = service;
  }

  /** Attach a TurnAnalyzer for semantic analysis (dashboard insights) */
  setTurnAnalyzer(analyzer: TurnAnalyzer): void {
    this.turnAnalyzer = analyzer;
    analyzer.onAnalysisComplete((messageId: string, semantics: TurnSemantics) => {
      this.webview.postMessage({ type: 'turnSemantics', messageId, semantics });
    });
  }

  /** Attach a ProjectAnalyticsStore for persisting session summaries */
  setProjectAnalyticsStore(store: ProjectAnalyticsStore): void {
    this.projectAnalyticsStore = store;
  }

  /** Attach the global TokenUsageRatioTracker */
  setTokenRatioTracker(tracker: TokenUsageRatioTracker): void {
    this.tokenRatioTracker = tracker;
  }

  /** Set the log directory path for bug reports */
  setLogDir(dir: string): void {
    this.logDir = dir;
  }

  /** Set the extension version for bug reports */
  setExtensionVersion(version: string): void {
    this.extensionVersion = version;
  }

  /** Provide SecretStorage for API key management */
  setSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  /** Provide Claude auth manager for login/logout/status actions */
  setAuthManager(manager: AuthManager): void {
    this.authManager = manager;
  }

  /** Read the API key from SecretStorage (returns undefined if no key set) */
  private async getApiKey(): Promise<string | undefined> {
    if (!this.secrets) return undefined;
    return getStoredApiKey(this.secrets);
  }

  /** Send current API key status to the webview */
  private async sendApiKeySetting(): Promise<void> {
    if (!this.secrets) {
      this.webview.postMessage({ type: 'apiKeySetting', hasKey: false, maskedKey: '' });
      return;
    }
    const key = await this.secrets.get('claudeMirror.anthropicApiKey');
    this.webview.postMessage({
      type: 'apiKeySetting',
      hasKey: !!key,
      maskedKey: maskApiKey(key ?? undefined),
    });
  }

  private getClaudeCliPath(): string {
    const configured = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
    return (configured || 'claude').trim() || 'claude';
  }

  private quoteTerminalArg(value: string): string {
    if (!value || !/[\s"]/u.test(value)) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private getActiveProvider(): ProviderId {
    return this.webview.getProvider?.() ?? 'claude';
  }

  private getCliPathOverride(): string | undefined {
    return this.webview.getCliPathOverride?.() ?? undefined;
  }

  private async sendClaudeAuthStatus(): Promise<void> {
    const fallback = { loggedIn: false, email: '', subscriptionType: '' };
    if (!this.authManager) {
      this.webview.postMessage({ type: 'claudeAuthStatus', ...fallback });
      return;
    }

    try {
      const status = await this.authManager.getAuthStatus(this.getClaudeCliPath());
      this.webview.postMessage({ type: 'claudeAuthStatus', ...status });
    } catch (err) {
      this.log(`Failed to get Claude auth status: ${err}`);
      this.webview.postMessage({ type: 'claudeAuthStatus', ...fallback });
    }
  }

  /** Update API key for all scheduler-based spawners (TurnAnalyzer, ActivitySummarizer) */
  private async refreshSchedulerApiKeys(): Promise<void> {
    const key = await this.getApiKey();
    this.turnAnalyzer?.setApiKey(key);
    this.activitySummarizer?.setApiKey(key);
  }

  /** Get accumulated TurnRecords for building a session summary */
  getTurnRecords(): TurnRecord[] {
    return this.turnRecords;
  }

  /**
   * Return accumulated TurnRecords and clear the internal buffer.
   * Used by SessionTab before clearing/restarting so analytics are captured.
   */
  flushTurnRecords(): TurnRecord[] {
    const records = this.turnRecords;
    this.turnRecords = [];
    return records;
  }

  /**
   * Post a userMessage to the webview, deduplicating identical text within 2 s.
   * This is the single chokepoint for ALL user-message display: optimistic send,
   * CLI echo, edit-and-resend, and plan-feedback -- so dedup here catches every
   * duplicate source (key-repeat, CLI echo after optimistic, double postMessage, etc.).
   */
  private postUserMessage(content: ContentBlock[]): void {
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text || '')
      .join('');
    const now = Date.now();
    if (this.lastPostedUserMsg && this.lastPostedUserMsg.text === text && now - this.lastPostedUserMsg.time < 2000) {
      this.log(`Suppressed duplicate userMessage: "${text.slice(0, 60)}..."`);
      return;
    }
    this.lastPostedUserMsg = { text, time: now };
    this.webview.postMessage({ type: 'userMessage', content });
  }

  /**
   * Inject staged handoff context into the first outgoing user turn after provider switch.
   * The webview still shows only the user's raw text; this affects only the payload sent to CLI.
   */
  private consumeDeferredHandoffContext(userText: string, opts?: { imageCount?: number }): string {
    const staged = this.pendingHandoffPrompt;
    if (!staged) {
      return userText;
    }

    this.pendingHandoffPrompt = null;
    const trimmedUser = userText.trim();
    const userPayload =
      trimmedUser ||
      ((opts?.imageCount ?? 0) > 0
        ? '[User attached image(s) without additional text.]'
        : '[User sent an empty message.]');

    this.log(
      `[Handoff] injecting deferred context into first user turn: contextChars=${staged.length} userChars=${trimmedUser.length} images=${opts?.imageCount ?? 0}`,
    );

    return [
      'Context migrated from a previous provider session. Treat it as prior conversation history for this chat.',
      staged,
      'New user message:',
      userPayload,
    ].join('\n\n');
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
          this.logApprovalState('sendMessage-entry');
          // If there was a pending ExitPlanMode approval, mark it as processed so
          // subsequent ExitPlanMode calls from the model are suppressed. Without this,
          // typing text (instead of clicking an approve button) leaves
          // exitPlanModeProcessed=false, causing the approval bar to re-appear when
          // the model spuriously calls ExitPlanMode in its response to the user text.
          if (this.pendingApprovalTool) {
            const pendingNorm = this.pendingApprovalTool.trim().toLowerCase();
            if (pendingNorm === 'exitplanmode' || pendingNorm.endsWith('.exitplanmode')) {
              this.markExitPlanModeProcessed('user sent text while ExitPlanMode approval bar was active');
            }
          }
          this.cancelExitPlanApproveResumeFallback();
          this.cancelPostApproveNudge();
          this.clearApprovalTracking();
          this.clearCodexConsultTimeout();
          this._codexConsultStartedAt = null;
          this.achievementService.onUserPrompt(this.tabId, msg.text);
          // Optimistic: show user message in UI immediately (before CLI echoes it back)
          this.postUserMessage([{ type: 'text', text: msg.text } as ContentBlock]);
          this.control.sendText(this.consumeDeferredHandoffContext(msg.text));
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          // Persist prompt to project and global history
          void this.promptHistoryStore.addPrompt(msg.text);
          break;

        case 'sendMessageWithImages': {
          this.log(`Sending message with ${msg.images.length} images`);
          // Same ExitPlanMode guard as sendMessage (user may paste images while bar is active)
          if (this.pendingApprovalTool) {
            const pendingNorm2 = this.pendingApprovalTool.trim().toLowerCase();
            if (pendingNorm2 === 'exitplanmode' || pendingNorm2.endsWith('.exitplanmode')) {
              this.markExitPlanModeProcessed('user sent images while ExitPlanMode approval bar was active');
            }
          }
          this.cancelExitPlanApproveResumeFallback();
          this.cancelPostApproveNudge();
          this.clearApprovalTracking();
          if (msg.text.trim()) {
            this.achievementService.onUserPrompt(this.tabId, msg.text);
          }
          // Optimistic: show user message in UI immediately (before CLI echoes it back)
          const imgContent: ContentBlock[] = [];
          if (msg.text) {
            imgContent.push({ type: 'text', text: msg.text });
          }
          for (const img of msg.images) {
            imgContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data: img.base64,
              },
            } as ContentBlock);
          }
          this.postUserMessage(imgContent);
          this.control.sendWithImages(
            this.consumeDeferredHandoffContext(msg.text, { imageCount: msg.images.length }),
            msg.images,
          );
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          if (msg.text.trim()) {
            void this.promptHistoryStore.addPrompt(msg.text);
          }
          break;
        }

        case 'cancelRequest':
          this.log('Cancel requested - killing process');
          // Immediate UI feedback so the user sees the cancel take effect
          this.webview.postMessage({ type: 'processBusy', busy: false });
          this.clearApprovalTracking();
          this.clearCodexConsultTimeout();
          this._codexConsultStartedAt = null;
          this.achievementService.onCancel(this.tabId);
          try {
            this.control.cancel();
          } catch (err) {
            this.log(`Cancel error (non-fatal): ${err}`);
          }
          break;

        case 'compact':
          this.compactPending = true;
          this.control.compact(msg.instructions);
          break;

        case 'startSession':
          this.firstMessageSent = false;
          this.clearPendingHandoffPrompt();
          this.activitySummarizer?.reset();
          this.adventureInterpreter?.reset();
          // If already running, just sync the webview state
          if (this.processManager.isRunning) {
            this.log('startSession - process already running, syncing state');
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.processManager.currentSessionId || 'active',
              model: 'connected',
              provider: this.getActiveProvider(),
            });
            break;
          }
          this.processManager
            .start({
              cwd: msg.workspacePath,
              cliPathOverride: this.getCliPathOverride(),
            })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
              this.log('Process started from webview button');
              this.webview.postMessage({
                type: 'sessionStarted',
                sessionId: this.processManager.currentSessionId || 'pending',
                model: 'connecting...',
                provider: this.getActiveProvider(),
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
          this.clearPendingHandoffPrompt();
          this.processManager.stop();
          this.achievementService.onSessionEnd(this.tabId);
          this.webview.postMessage({
            type: 'sessionEnded',
            reason: 'stopped',
          });
          break;

        case 'resumeSession':
          this.firstMessageSent = false;
          this.clearPendingHandoffPrompt();
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager
            .start({
              resume: msg.sessionId,
              cliPathOverride: this.getCliPathOverride(),
            })
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
          this.clearPendingHandoffPrompt();
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager
            .start({
              resume: msg.sessionId,
              fork: true,
              cliPathOverride: this.getCliPathOverride(),
            })
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
          // Save analytics for the current session BEFORE clearing records
          this.webview.saveProjectAnalyticsNow?.();
          this.firstMessageSent = false;
          this.clearPendingHandoffPrompt();
          this.activitySummarizer?.reset();
          this.adventureInterpreter?.reset();
          this.turnRecords = [];
          this.log('clearSession - stopping current process and starting fresh');
          this.achievementService.onSessionEnd(this.tabId);
          this.processManager.stop();
          this.processManager
            .start({
              cwd: msg.workspacePath,
              cliPathOverride: this.getCliPathOverride(),
            })
            .then(() => {
              this.achievementService.onSessionStart(this.tabId);
              this.log('Process restarted after clear');
              this.webview.postMessage({
                type: 'sessionStarted',
                sessionId: this.processManager.currentSessionId || 'pending',
                model: 'connecting...',
                provider: this.getActiveProvider(),
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

        case 'setProvider':
          this.log(`Setting provider to: "${msg.provider}"`);
          void vscode.workspace.getConfiguration('claudeMirror').update('provider', msg.provider, true)
            .then(() => {
              const saved = vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
              this.log(`Provider setting saved: "${saved}" (requested "${msg.provider}")`);
              this.webview.postMessage({ type: 'providerSetting', provider: saved });
            }, (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to save provider setting "${msg.provider}": ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to save provider setting: ${message}` });
            });
          break;

        case 'openProviderTab':
          this.log(`Open provider tab requested: "${msg.provider}"`);
          void vscode.workspace.getConfiguration('claudeMirror').update('provider', msg.provider, true)
            .then(() => {
              const saved = vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
              this.log(`Provider setting saved before opening tab: "${saved}" (requested "${msg.provider}")`);
              this.webview.postMessage({ type: 'providerSetting', provider: saved });
              void vscode.commands.executeCommand('claudeMirror.startSession').then(
                () => this.log(`Requested new provider tab via command: provider="${msg.provider}"`),
                (err: unknown) => {
                  const message = err instanceof Error ? err.message : String(err);
                  this.log(`Failed to open provider tab "${msg.provider}": ${message}`);
                  this.webview.postMessage({ type: 'error', message: `Failed to open ${msg.provider} tab: ${message}` });
                }
              );
            }, (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to save provider setting before opening tab "${msg.provider}": ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to open ${msg.provider} tab: ${message}` });
            });
          break;

        case 'switchProviderWithContext':
          this.log(`Switch provider with context requested: "${msg.targetProvider}"`);
          void vscode.commands.executeCommand('claudeMirror.switchProviderWithContext', {
            sourceTabId: this.tabId,
            targetProvider: msg.targetProvider,
            keepSourceOpen: msg.keepSourceOpen ?? true,
          }).then(
            () => undefined,
            (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed switchProviderWithContext: ${message}`);
              this.webview.postMessage({ type: 'error', message: `Provider handoff failed: ${message}` });
            },
          );
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

        case 'adventureDebugLog': {
          let payloadText = '';
          if (msg.payload) {
            try {
              payloadText = ` ${JSON.stringify(msg.payload)}`;
            } catch {
              payloadText = ' [payload-unserializable]';
            }
          }
          this.log(`[AdventureDebug][${msg.source}] ${msg.event}${payloadText}`);
          break;
        }

        case 'uiDebugLog': {
          let payloadText = '';
          if (msg.payload) {
            try {
              payloadText = ` ${JSON.stringify(msg.payload)}`;
            } catch {
              payloadText = ' [payload-unserializable]';
            }
          }
          this.log(`[UiDebug][${msg.source}] ${msg.event}${payloadText}`);
          break;
        }

        case 'openSettings':
          this.log(`Opening VS Code Settings with query: ${(msg as any).query}`);
          vscode.commands.executeCommand('workbench.action.openSettings', (msg as any).query || 'claudeMirror');
          break;

        case 'setTurnAnalysisEnabled':
          this.log(`Setting turn analysis to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('turnAnalysis.enabled', msg.enabled, true);
          break;

        case 'setAnalysisModel':
          this.log(`Setting analysis model to: ${msg.model}`);
          vscode.workspace.getConfiguration('claudeMirror').update('analysisModel', msg.model, true);
          break;

        case 'enhancePrompt': {
          this.log(`Enhance prompt request (${msg.text.length} chars)`);
          if (!this.promptEnhancer) {
            this.webview.postMessage({
              type: 'enhancePromptResult',
              enhancedText: null,
              success: false,
              error: 'Prompt enhancer not available',
            });
            break;
          }
          this.getApiKey().then((apiKey) => this.promptEnhancer!
            .enhance(msg.text, msg.model, apiKey))
            .then((enhanced) => {
              this.log(`Prompt enhancement result: success=${!!enhanced}, length=${enhanced?.length ?? 0}`);
              this.webview.postMessage({
                type: 'enhancePromptResult',
                enhancedText: enhanced,
                success: !!enhanced,
                error: enhanced ? undefined : 'Enhancement failed',
              });
            })
            .catch((err) => {
              this.log(`Prompt enhancement error: ${err}`);
              this.webview.postMessage({
                type: 'enhancePromptResult',
                enhancedText: null,
                success: false,
                error: `Enhancement error: ${err.message}`,
              });
            });
          break;
        }

        case 'setAutoEnhance':
          this.log(`Setting auto-enhance to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('promptEnhancer.autoEnhance', msg.enabled, true);
          break;

        case 'setEnhancerModel':
          this.log(`Setting enhancer model to: ${msg.model}`);
          vscode.workspace.getConfiguration('claudeMirror').update('promptEnhancer.model', msg.model, true);
          break;

        // --- Prompt Translation ---
        case 'translatePrompt': {
          this.log(`Translate prompt request (${msg.text.length} chars)`);
          if (!this.promptTranslator) {
            this.webview.postMessage({
              type: 'translatePromptResult',
              translatedText: null,
              success: false,
              error: 'Prompt translator not available',
            });
            break;
          }
          this.getApiKey().then((apiKey) => this.promptTranslator!.translate(msg.text, apiKey))
            .then((translated) => {
              this.log(`Prompt translation result: success=${!!translated}, length=${translated?.length ?? 0}`);
              this.webview.postMessage({
                type: 'translatePromptResult',
                translatedText: translated,
                success: !!translated,
                error: translated ? undefined : 'Translation failed',
              });
            })
            .catch((err) => {
              this.log(`Prompt translation error: ${err}`);
              this.webview.postMessage({
                type: 'translatePromptResult',
                translatedText: null,
                success: false,
                error: `Translation error: ${err.message}`,
              });
            });
          break;
        }

        case 'setPromptTranslationEnabled':
          this.log(`Setting prompt translation to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('promptTranslator.enabled', msg.enabled, true);
          break;

        case 'setAutoTranslate':
          this.log(`Setting auto-translate to: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('promptTranslator.autoTranslate', msg.enabled, true);
          break;

        case 'setBabelFishEnabled': {
          const enabled = msg.enabled;
          this.babelFishEnabled = enabled;
          this.log(`[BabelFish] Setting enabled to: ${enabled}`);
          const bfConfig = vscode.workspace.getConfiguration('claudeMirror');
          // Chain config updates sequentially to avoid race condition:
          // concurrent writes to settings.json can clobber each other's changes.
          bfConfig.update('babelFish.enabled', enabled, true)
            .then(() => bfConfig.update('promptTranslator.enabled', enabled, true))
            .then(() => bfConfig.update('promptTranslator.autoTranslate', enabled, true))
            .then(
              () => this.log(`[BabelFish] Config saved: enabled=${enabled}`),
              (err: unknown) => this.log(`[BabelFish] Error saving config: ${err}`),
            );
          // Send explicit values to webview immediately (don't wait for config writes)
          const bfLanguage = bfConfig.get<string>('translationLanguage', 'Hebrew');
          this.webview.postMessage({ type: 'babelFishSettings', enabled, language: bfLanguage });
          this.webview.postMessage({ type: 'promptTranslatorSettings', translateEnabled: enabled, autoTranslate: enabled });
          break;
        }

        // --- Skill Generation ---
        case 'setSkillGenEnabled':
          this.log(`[SkillGen:Msg][INFO] setSkillGenEnabled | enabled=${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('skillGen.enabled', msg.enabled, true);
          break;

        case 'setSkillGenThreshold': {
          const newThreshold = Math.max(5, Math.min(100, Math.round(msg.threshold)));
          this.log(`[SkillGen:Msg][INFO] setSkillGenThreshold | threshold=${newThreshold}`);
          vscode.workspace.getConfiguration('claudeMirror').update('skillGen.threshold', newThreshold, true);
          break;
        }

        case 'skillGenTrigger':
          this.log(`[SkillGen:Msg][INFO] skillGenTrigger received | serviceAvailable=${!!this.skillGenService}`);
          if (this.skillGenService) {
            void this.skillGenService.scanDocuments().then(() => {
              this.log('[SkillGen:Msg][INFO] Scan complete, routing to triggerPipeline');
              void this.skillGenService!.triggerPipeline();
            });
          } else {
            this.log('[SkillGen:Msg][WARNING] skillGenTrigger rejected: SkillGenService not available');
          }
          break;

        case 'skillGenCancel':
          this.log(`[SkillGen:Msg][INFO] skillGenCancel received | serviceAvailable=${!!this.skillGenService}`);
          this.skillGenService?.cancelPipeline();
          break;

        case 'getSkillGenStatus':
          if (this.skillGenService) {
            const status = this.skillGenService.getStatus();
            this.log(`[SkillGen:Msg][DEBUG] getSkillGenStatus | pending=${status.pendingDocs} runStatus=${status.runStatus}`);
            this.webview.postMessage(status);
          }
          break;

        case 'skillGenUiLog': {
          const dataStr = msg.data ? ' | ' + Object.entries(msg.data).map(([k, v]) => `${k}=${v}`).join(' ') : '';
          this.log(`[SkillGen:UI][${msg.level}] ${msg.event}${dataStr}`);
          break;
        }

        case 'openSkillGenGuide': {
          const guidePath = path.join(__dirname, '..', 'sr-ptd-skill', 'assets', 'skills-pipeline-guide.html');
          this.log(`[SkillGen:UI][INFO] openSkillGenGuide | path=${guidePath}`);
          void vscode.env.openExternal(vscode.Uri.file(guidePath));
          break;
        }

        case 'showHistory':
          this.log('Webview requested history view');
          vscode.commands.executeCommand('claudeMirror.showHistory');
          break;

        case 'openPlanDocs':
          this.log('Webview requested plan docs viewer');
          vscode.commands.executeCommand('claudeMirror.openPlanDocs');
          break;

        case 'openFeedback':
          this.log('Webview requested feedback dialog (legacy)');
          vscode.commands.executeCommand('claudeMirror.sendFeedback');
          break;

        case 'feedbackAction': {
          const action = msg.action;
          this.log(`Webview feedback action: ${action}`);
          if (action === 'bug') {
            void (async () => {
              try {
                await vscode.commands.executeCommand('vscode.openIssueReporter', {
                  extensionId: 'JhonBar.claude-code-mirror',
                });
              } catch {
                try {
                  await vscode.commands.executeCommand('workbench.action.openIssueReporter');
                } catch {
                  await vscode.env.openExternal(vscode.Uri.parse('https://github.com/Yehonatan-Bar/ClaUI/issues'));
                }
              }
            })();
          } else if (action === 'feature') {
            const url = 'https://github.com/Yehonatan-Bar/ClaUI/issues/new'
              + '?labels=enhancement'
              + '&title=Feature%20request%3A%20'
              + '&body=' + encodeURIComponent(
                ['## What would you like to see?', '', '', '## Why is it useful?', '', '', '## Additional context / screenshots', ''].join('\n')
              );
            void vscode.env.openExternal(vscode.Uri.parse(url));
          } else if (action === 'email') {
            const mailSubject = encodeURIComponent('ClaUi Feedback');
            const mailBody = encodeURIComponent(
              ['Hi,', '', 'Feedback for ClaUi:', '', '', `Extension version: ${this.extensionVersion}`, `VS Code version: ${vscode.version}`, '', '(Optional) Steps to reproduce / context:', ''].join('\n')
            );
            void vscode.env.openExternal(vscode.Uri.parse(`mailto:yonzbar@gmail.com?subject=${mailSubject}&body=${mailBody}`));
          } else if (action === 'fullBugReport') {
            this.webview.postMessage({ type: 'bugReportOpen' });
          }
          break;
        }

        // ----- Bug Report -----
        case 'bugReportInit': {
          this.log('[BugReport] Init requested');
          void (async () => {
            const apiKey = await this.getApiKey();
            this.bugReportService = new BugReportService(
              this.webview,
              this.log,
              this.extensionVersion,
              this.logDir,
              apiKey,
            );
            this.bugReportService.startAutoCollection();
          })();
          break;
        }
        case 'bugReportChat':
          if (this.bugReportService) {
            this.bugReportService.handleChatMessage(msg.message);
          }
          break;
        case 'bugReportApproveScript':
          if (this.bugReportService) {
            this.bugReportService.executeScript(msg.command, msg.index);
          }
          break;
        case 'bugReportSubmit':
          if (this.bugReportService) {
            this.bugReportService.submit(msg.mode, msg.description);
          }
          break;
        case 'bugReportGetPreview':
          if (this.bugReportService) {
            const files = this.bugReportService.getPreview();
            this.webview.postMessage({ type: 'bugReportPreview', files });
          }
          break;
        case 'bugReportClose':
          this.log('[BugReport] Close requested');
          if (this.bugReportService) {
            this.bugReportService.dispose();
            this.bugReportService = null;
          }
          break;

        // ----- Agent Teams -----
        case 'teamPanelOpen':
          this.log('[Teams] Panel open requested');
          break;
        case 'teamSendMessage': {
          this.log(`[Teams] Send message to ${msg.agentName}`);
          const teamActions = (this.webview as import('../session/SessionTab').SessionTab).getTeamActions?.();
          if (teamActions) {
            teamActions.sendMessage(msg.agentName, msg.content);
          }
          break;
        }
        case 'teamCreateTask': {
          this.log(`[Teams] Create task: ${msg.subject}`);
          const teamActions2 = (this.webview as import('../session/SessionTab').SessionTab).getTeamActions?.();
          if (teamActions2) {
            teamActions2.createTask({ subject: msg.subject, description: msg.description, status: 'pending' });
          }
          break;
        }
        case 'teamUpdateTask': {
          this.log(`[Teams] Update task #${msg.taskId}`);
          const teamActions3 = (this.webview as import('../session/SessionTab').SessionTab).getTeamActions?.();
          if (teamActions3) {
            teamActions3.updateTask(msg.taskId, msg.updates);
          }
          break;
        }
        case 'teamShutdownAgent': {
          this.log(`[Teams] Shutdown agent: ${msg.agentName}`);
          const teamActions4 = (this.webview as import('../session/SessionTab').SessionTab).getTeamActions?.();
          if (teamActions4) {
            teamActions4.shutdownAgent(msg.agentName);
          }
          break;
        }

        case 'planApprovalResponse':
          this.log(`Plan approval response: action=${msg.action} toolName=${msg.toolName || '(none)'} pendingTool=${this.pendingApprovalTool || '(none)'}`);
          this.logApprovalState('planApprovalResponse-entry');
          {
          const sendApprovalText = (text: string, context: string): boolean => {
            try {
              this.control.sendText(text);
              this.log(`[EPM_APPROVE] Sent text (${context}): "${text.slice(0, 120)}"`);
              return true;
            } catch (err) {
              const errorText = err instanceof Error ? err.message : String(err);
              this.log(`[EPM_APPROVE] Failed to send text (${context}): ${errorText}`);
              this.webview.postMessage({
                type: 'error',
                message: `Plan approval action failed (${context}): ${errorText}`,
              });
              return false;
            }
          };
          // Use msg.toolName from webview as primary source - it's reliable because
          // the webview stores it when the approval bar is shown. Fall back to
          // this.pendingApprovalTool which may have been cleared by a `result` event
          // that races between showing the approval bar and the user clicking Approve.
          const effectiveToolName = msg.toolName || this.pendingApprovalTool || '';
          const norm = effectiveToolName.trim().toLowerCase();
          const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
          const isApproveAction = msg.action === 'approve' || msg.action === 'approveClearBypass' || msg.action === 'approveManual';
          const approvalCycleId = this.pendingApprovalCycleId;
          let scheduleExitPlanApproveFallback = false;

          if (isExitPlanMode) {
            // Plan mode cycle complete
            this.markExitPlanModeProcessed(`planApprovalResponse:${msg.action}`);
          }

          // ExitPlanMode: DO NOT send approve/reject text to the CLI.
          // The CLI already auto-approves ExitPlanMode (via bypassPermissions or
          // allowedTools). Sending "Yes, proceed" creates a spurious conversation
          // turn that causes the model to call ExitPlanMode again (infinite loop).
          // Exception 1: approve actions schedule a delayed fallback nudge if no
          // post-approval activity is observed within a short timeout.
          // Exception 2: feedback IS sent to the CLI - it provides real user
          // content that directs the model to revise the plan (not a loop risk).
          if (isExitPlanMode) {
            if (msg.action === 'feedback' && msg.feedback?.trim()) {
              // Feedback provides real user content that should reach Claude so
              // it can revise the plan. Unlike approve (which would loop),
              // feedback directs the model to change course. Reset
              // exitPlanModeProcessed so a new ExitPlanMode notification can
              // appear after the model revises the plan.
              this.resetExitPlanModeProcessed('ExitPlanMode feedback requested plan revision');
              this.log(`ExitPlanMode feedback - sending user feedback to CLI`);
              // Optimistic: show user message in UI immediately
              this.postUserMessage([{ type: 'text', text: msg.feedback.trim() } as ContentBlock]);
              sendApprovalText(msg.feedback.trim(), 'ExitPlanMode feedback');
            } else {
              this.log(`ExitPlanMode ${msg.action} - closing bar without sending user message (CLI auto-approves)`);
              if (msg.action === 'approveClearBypass') {
                this.log('Plan approval: also compacting context');
                this.compactPending = true;
                try {
                  this.control.compact();
                  this.log('[EPM_APPROVE] Compact request sent');
                } catch (err) {
                  const errorText = err instanceof Error ? err.message : String(err);
                  this.log(`[EPM_APPROVE] Compact request failed: ${errorText}`);
                  this.webview.postMessage({
                    type: 'error',
                    message: `Plan approval action failed (compact): ${errorText}`,
                  });
                }
              } else if (msg.action === 'approveManual') {
                this.log('Plan approval: switching to supervised mode');
                vscode.workspace.getConfiguration('claudeMirror').update('permissionMode', 'supervised', true);
                this.webview.postMessage({ type: 'permissionModeSetting', mode: 'supervised' });
              }
              // Don't send text - just close the bar
              if (isApproveAction) {
                scheduleExitPlanApproveFallback = true;
              } else {
                this.cancelExitPlanApproveResumeFallback();
                this.cancelPostApproveNudge();
              }
            }
          } else if (msg.action === 'approve') {
            sendApprovalText('Continue with the implementation.', 'approve');
          } else if (msg.action === 'approveClearBypass') {
            this.log('Plan approval: approving, then clearing context (compact)');
            this.compactPending = true;
            sendApprovalText('Continue with the implementation. Please compact context to free up space.', 'approveClearBypass');
            try {
              this.control.compact();
            } catch (err) {
              const errorText = err instanceof Error ? err.message : String(err);
              this.log(`[EPM_APPROVE] Non-ExitPlan compact request failed: ${errorText}`);
              this.webview.postMessage({
                type: 'error',
                message: `Plan approval action failed (compact): ${errorText}`,
              });
            }
          } else if (msg.action === 'approveManual') {
            this.log('Plan approval: switching to supervised mode for manual edit approval');
            vscode.workspace.getConfiguration('claudeMirror').update('permissionMode', 'supervised', true);
            this.webview.postMessage({ type: 'permissionModeSetting', mode: 'supervised' });
            sendApprovalText('Continue with the implementation.', 'approveManual');
          } else if (msg.action === 'reject') {
            sendApprovalText('No, I reject this plan. Please revise it.', 'reject');
          } else if (msg.action === 'feedback') {
            sendApprovalText(msg.feedback || 'Please revise the plan.', 'feedback');
          } else if (msg.action === 'questionAnswer') {
            // User selected option(s) from an AskUserQuestion prompt
            const answer = msg.selectedOptions?.join(', ') || msg.feedback || '';
            this.log(`Question answer: "${answer}"`);
            sendApprovalText(answer, 'questionAnswer');
          }
          this.clearApprovalTracking({
            preserveApprovalCycle: isExitPlanMode && scheduleExitPlanApproveFallback,
          });
          // Suppress stale re-notifications from late assistantMessage events
          // that may arrive after the user has already responded.
          this.approvalResponseProcessed = true;
          if (isExitPlanMode && scheduleExitPlanApproveFallback) {
            this.log(`[EPM_APPROVE] Scheduling ExitPlan fallback: action=${msg.action} cycle=${approvalCycleId ?? 'null'}`);
            this.scheduleExitPlanApproveResumeFallback(approvalCycleId);
          }
          // For ExitPlanMode approve: DON'T send processBusy:true. The CLI already
          // auto-approved and may have already finished executing (sent result
          // with processBusy:false). Sending processBusy:true here would create
          // a stuck "Thinking..." indicator with no matching processBusy:false.
          // The delayed fallback above sends processBusy:true only if it
          // actually sends a proceed nudge to the CLI.
          // For ExitPlanMode feedback: DO send processBusy:true - we just sent
          // user text to the CLI and the model will respond.
          // For all other approvals: text was sent to the CLI, so we are busy.
          const isExitPlanFeedback = isExitPlanMode && msg.action === 'feedback';
          if (!isExitPlanMode || isExitPlanFeedback) {
            this.webview.postMessage({ type: 'processBusy', busy: true });
          }
          }
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
          this.log(`Edit-and-resend: resuming session with edited prompt`);
          // Save analytics for the current session BEFORE clearing records
          this.webview.saveProjectAnalyticsNow?.();
          this.clearApprovalTracking();
          this.planModeActive = false;
          this.exitPlanModeReopenCount = 0;
          this.resetExitPlanModeProcessed('edit-and-resend restart');
          this.activitySummarizer?.reset();
          this.turnRecords = [];
          this.achievementService.abandonSession(this.tabId);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          {
            const editedText = msg.text;
            // Capture the session ID BEFORE stopping so we can resume it.
            // This lets Claude keep the full conversation context instead of
            // starting from scratch (which made Claude lose all prior context).
            const sessionToResume = this.processManager.currentSessionId;
            this.log(`Edit-and-resend: will resume session ${sessionToResume || '(none)'}`);
            // Tell the exit handler not to send sessionEnded - we're restarting intentionally
            this.webview.setSuppressNextExit?.(true);
            this.processManager.stop();
            this.processManager
              .start(sessionToResume
                ? {
                  resume: sessionToResume,
                  skipReplay: true,
                  cliPathOverride: this.getCliPathOverride(),
                }
                : { cliPathOverride: this.getCliPathOverride() })
              .then(() => {
                this.achievementService.onSessionStart(this.tabId);
                this.log('Session resumed for edit-and-resend');
                this.webview.postMessage({
                  type: 'sessionStarted',
                  sessionId: this.processManager.currentSessionId || 'pending',
                  model: 'connecting...',
                  provider: this.getActiveProvider(),
                });
                // Send the edited message immediately - don't wait for system/init.
                // The CLI in pipe mode only emits init AFTER receiving the first message,
                // so waiting for init before sending would deadlock.
                this.log(`Edit-and-resend: sending edited prompt`);
                this.control.sendText(editedText);
                // Don't rename the session tab - this is an edit, not a new conversation
                void this.promptHistoryStore.addPrompt(editedText);
              })
              .catch((err) => {
                this.webview.postMessage({ type: 'processBusy', busy: false });
                this.webview.postMessage({
                  type: 'error',
                  message: `Failed to resume session for edit: ${err.message}`,
                });
              });
          }
          break;

        case 'requestSessionRecapSnapshot':
          this.log('Manual session recap snapshot requested');
          this.achievementService.sendSessionRecapSnapshot(this.tabId);
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

        case 'openTerminal':
          this.log(`Opening terminal with command: "${msg.command || ''}"`);
          {
            const terminal = vscode.window.createTerminal({ name: 'Claude Code Setup' });
            terminal.show();
            if (msg.command) {
              terminal.sendText(msg.command, false);
            }
          }
          break;

        case 'claudeAuthLogin': {
          const cliPath = this.getClaudeCliPath();
          this.log(`Opening Claude login terminal (cliPath="${cliPath}")`);
          const terminal = vscode.window.createTerminal({ name: 'Claude Login' });
          terminal.show();
          terminal.sendText(`${this.quoteTerminalArg(cliPath)} auth login`, true);
          break;
        }

        case 'claudeAuthLogout': {
          const cliPath = this.getClaudeCliPath();
          this.log(`Running Claude logout (cliPath="${cliPath}")`);
          void (async () => {
            const ok = this.authManager ? await this.authManager.logout(cliPath) : false;
            if (!ok) {
              this.webview.postMessage({
                type: 'error',
                message: 'Claude logout failed. Check that the Claude CLI is installed and the path is correct.',
              });
            }
            await this.sendClaudeAuthStatus();
          })();
          break;
        }

        case 'claudeAuthStatus':
          this.log('Refreshing Claude auth status');
          void this.sendClaudeAuthStatus();
          break;

        case 'copyToClipboard':
          this.log(`Copying to clipboard: "${(msg.text || '').slice(0, 50)}"`);
          vscode.env.clipboard.writeText(msg.text || '').then(
            () => this.log('Copied to clipboard'),
            (err) => this.log(`Clipboard write failed: ${err}`)
          );
          break;

        case 'openHtmlPreview':
          this.log(`Opening HTML preview (${((msg as any).html || '').length} chars)`);
          openHtmlPreviewPanel((msg as any).html || '');
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

        case 'setGitHubSyncEnabled':
          vscode.workspace.getConfiguration('claudeMirror').update('achievements.githubSync', msg.enabled, true);
          break;

        case 'githubSync': {
          const syncService = this.achievementService.getSyncService();
          if (!syncService) break;
          if (msg.action === 'connect') {
            void syncService.connect().then((result) => {
              if (result.success) {
                this.sendGitHubSyncStatus();
              } else {
                this.webview.postMessage({
                  type: 'friendActionResult',
                  action: 'add',
                  username: '',
                  success: false,
                  error: result.error || 'Connection failed',
                });
              }
              this.sendGitHubSyncStatus();
            });
          } else if (msg.action === 'publish') {
            const profile = this.achievementService.getCurrentProfile();
            if (profile) {
              void syncService.publish(profile).then(() => {
                this.sendGitHubSyncStatus();
              });
            }
          } else if (msg.action === 'disconnect') {
            void syncService.disconnect().then(() => {
              this.sendGitHubSyncStatus();
            });
          }
          break;
        }

        case 'addFriend': {
          const syncSvc = this.achievementService.getSyncService();
          if (!syncSvc) break;
          void syncSvc.addFriend(msg.username).then((result) => {
            this.webview.postMessage({
              type: 'friendActionResult',
              action: 'add',
              username: msg.username,
              success: result.success,
              error: result.error,
              profile: result.profile ? {
                username: result.profile.username,
                displayName: result.profile.displayName,
                avatarUrl: result.profile.avatarUrl,
                totalXp: result.profile.totalXp,
                level: result.profile.level,
                unlockedIds: result.profile.unlockedIds,
                stats: result.profile.stats,
                lastUpdated: result.profile.lastUpdated,
              } : undefined,
            });
            this.sendCommunityData();
          });
          break;
        }

        case 'removeFriend': {
          const syncSvc2 = this.achievementService.getSyncService();
          if (!syncSvc2) break;
          void syncSvc2.removeFriend(msg.username).then(() => {
            this.webview.postMessage({
              type: 'friendActionResult',
              action: 'remove',
              username: msg.username,
              success: true,
            });
            this.sendCommunityData();
          });
          break;
        }

        case 'refreshFriends': {
          const syncSvc3 = this.achievementService.getSyncService();
          if (!syncSvc3) break;
          void syncSvc3.refreshFriends().then(() => {
            this.sendCommunityData();
          });
          break;
        }

        case 'getCommunityData':
          this.sendGitHubSyncStatus();
          this.sendCommunityData();
          break;

        case 'copyShareCard': {
          const syncSvc4 = this.achievementService.getSyncService();
          if (!syncSvc4) break;
          let text = '';
          if (msg.format === 'shields-badge') {
            text = syncSvc4.generateShieldsBadges();
          } else {
            const profile = this.achievementService.getCurrentProfile();
            if (profile) {
              text = syncSvc4.generateProfileCard(profile);
            }
          }
          if (text) {
            void vscode.env.clipboard.writeText(text).then(() => {
              this.webview.postMessage({ type: 'shareCardCopied', success: true, format: msg.format });
            });
          } else {
            this.webview.postMessage({ type: 'shareCardCopied', success: false, format: msg.format });
          }
          break;
        }

        case 'getProjectAnalytics':
          if (this.projectAnalyticsStore) {
            void this.projectAnalyticsStore
              .getSummariesAfterPendingWrites()
              .then((sessions) => {
                this.log(`Sending project analytics: ${sessions.length} sessions`);
                this.webview.postMessage({ type: 'projectAnalyticsData', sessions });
              })
              .catch((err) => {
                this.log(`Failed to load project analytics: ${err instanceof Error ? err.message : String(err)}`);
                this.webview.postMessage({ type: 'projectAnalyticsData', sessions: [] });
              });
          }
          break;

        case 'setTranslationLanguage': {
          const lang = msg.language;
          this.log(`Setting translation language: ${lang}`);
          vscode.workspace.getConfiguration('claudeMirror').update('translationLanguage', lang, true);
          break;
        }

        case 'translateMessage': {
          const config = vscode.workspace.getConfiguration('claudeMirror');
          const targetLang = msg.language?.trim() || config.get<string>('translationLanguage', 'Hebrew');
          this.log(`Translate request: messageId=${msg.messageId}, textLength=${msg.textContent.length}, language=${targetLang}`);
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
          this.getApiKey().then((apiKey) => this.messageTranslator!
            .translate(msg.textContent, targetLang, apiKey))
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
        }

        case 'codexConsult': {
          const question = msg.question.trim();
          this.log(`[CODEX_CONSULT] Received consultation request (${question.length} chars): "${question.slice(0, 100)}..."`);
          if (!question) {
            this.log('[CODEX_CONSULT] Empty question, ignoring');
            break;
          }
          const processRunning = this.processManager.isRunning;
          const sessionId = this.processManager.currentSessionId;
          this.log(`[CODEX_CONSULT] Process state: running=${processRunning}, sessionId=${sessionId}`);
          if (!processRunning) {
            this.log('[CODEX_CONSULT] ERROR: Process not running, cannot send consultation');
            this.webview.postMessage({ type: 'error', message: 'Cannot consult Codex: no active session' });
            break;
          }
          const codexPrompt = [
            '[Codex Consultation Request]',
            'The user wants to consult with the Codex GPT expert about the following question.',
            '',
            'INSTRUCTIONS:',
            '1. Formulate a comprehensive consultation prompt that includes:',
            '   - Background context about the system/codebase you are working on',
            '   - The specific problem or question described below',
            '   - Any relevant code context from our recent conversation',
            '2. Call the mcp__codex__codex tool with this enriched prompt.',
            '   CRITICAL: You MUST pass these parameters to prevent the Codex session from hanging:',
            '   - "approval-policy": "never"  (there is no interactive user to approve shell commands)',
            '   - "sandbox": "workspace-write"  (allow read/write access for code analysis)',
            '3. Present the Codex response clearly to the user',
            '4. Then analyze the response and continue with implementation based on the advice',
            '',
            "USER'S QUESTION:",
            question,
          ].join('\n');
          this.log(`[CODEX_CONSULT] Built prompt (${codexPrompt.length} chars), sending to CLI...`);
          this._codexConsultStartedAt = Date.now();
          this.clearCodexConsultTimeout();
          this.clearApprovalTracking();
          try {
            this.control.sendText(codexPrompt);
            this.log('[CODEX_CONSULT] Prompt sent to CLI successfully');
          } catch (err) {
            this.log(`[CODEX_CONSULT] ERROR sending to CLI: ${err instanceof Error ? err.message : String(err)}`);
            this.webview.postMessage({ type: 'error', message: `Codex consultation failed: ${err instanceof Error ? err.message : String(err)}` });
            break;
          }
          this.webview.postMessage({ type: 'processBusy', busy: true });
          // Start a timeout to cancel the consultation if it hangs (e.g., approval deadlock)
          this._codexConsultTimeoutTimer = setTimeout(() => {
            if (this._codexConsultStartedAt) {
              const elapsed = Date.now() - this._codexConsultStartedAt;
              this.log(`[CODEX_CONSULT] TIMEOUT after ${elapsed}ms - cancelling hung consultation`);
              this._codexConsultStartedAt = null;
              this._codexConsultTimeoutTimer = null;
              try {
                this.control.cancel();
              } catch (cancelErr) {
                this.log(`[CODEX_CONSULT] Error cancelling request: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`);
              }
              this.webview.postMessage({
                type: 'error',
                message: 'Codex consultation timed out after 2 minutes. The Codex MCP session may have hung (e.g., waiting for shell command approval). The request has been cancelled.',
              });
            }
          }, MessageHandler.CODEX_CONSULT_TIMEOUT_MS);
          this.log(`[CODEX_CONSULT] Timeout set for ${MessageHandler.CODEX_CONSULT_TIMEOUT_MS}ms`);
          break;
        }

        case 'setApiKey': {
          if (!this.secrets) {
            this.log('setApiKey: no secrets available');
            break;
          }
          void setStoredApiKey(this.secrets, msg.apiKey).then(async () => {
            this.log(`API key ${msg.apiKey.trim() ? 'saved' : 'cleared'}`);
            void this.sendApiKeySetting();
            // Push fresh key to all scheduler-based spawners across this tab
            await this.refreshSchedulerApiKeys();
          });
          break;
        }

        case 'requestUsage': {
          this.log('Fetching Claude usage data');
          void this.fetchAndSendUsage();
          break;
        }

        case 'setUsageWidgetEnabled': {
          this.log(`Setting usage widget enabled: ${msg.enabled}`);
          vscode.workspace.getConfiguration('claudeMirror').update('usageWidget', msg.enabled, true);
          break;
        }

        case 'getTokenRatioData': {
          this.log('Sending token ratio data to webview');
          this.sendTokenRatioData();
          break;
        }

        case 'clearTokenRatioData': {
          this.log('Clearing all token ratio data');
          this.tokenRatioTracker?.clearAll();
          this.sendTokenRatioData();
          break;
        }

        case 'forceResampleTokenRatio': {
          this.log('Force resampling token ratio data');
          void this.sampleTokenUsageRatio();
          break;
        }

        case 'ready':
          this.log('Webview ready');
          // Send text display settings
          this.sendTextSettings();
          // Send typing theme setting
          this.sendTypingThemeSetting();
          // Send model setting
          this.sendModelSetting();
          // Send default provider setting for new sessions
          this.sendProviderSetting();
          // Send current tab/provider capability flags for UI gating
          this.sendProviderCapabilities();
          // Send permission mode setting
          this.sendPermissionModeSetting();
          // Send git push settings
          this.sendGitPushSettings();
          // Send session vitals setting
          this.sendVitalsSetting();
          // Send adventure widget setting
          this.sendAdventureWidgetSetting();
          // Send usage widget setting
          this.sendUsageWidgetSetting();
          // Send translation language setting
          this.sendTranslationLanguageSetting();
          // Send turn analysis settings
          this.sendTurnAnalysisSettings();
          // Send prompt enhancer settings
          this.sendPromptEnhancerSettings();
          // Send prompt translator settings
          this.sendPromptTranslatorSettings();
          // Send Babel Fish settings
          this.sendBabelFishSettings();
          // Send skill generation settings and status
          this.sendSkillGenSettings();
          this.sendSkillGenStatus();
          // Send achievement settings/snapshot
          this.webview.postMessage(this.achievementService.buildSettingsMessage());
          this.webview.postMessage(this.achievementService.buildSnapshotMessage(this.tabId));
          // Send API key status
          void this.sendApiKeySetting();
          // Send Claude auth status
          void this.sendClaudeAuthStatus();
          // Refresh API key for scheduler-based spawners
          void this.refreshSchedulerApiKeys();
          // Send GitHub sync status
          this.sendGitHubSyncStatus();
          // If process is already running, tell the webview
          if (this.processManager.isRunning && this.processManager.currentSessionId) {
            this.log('Sending existing session info to webview');
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.processManager.currentSessionId,
              model: 'unknown',
              provider: this.getActiveProvider(),
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

  /** Read default provider setting from VS Code config and send to webview */
  private sendProviderSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const provider = config.get<ProviderId>('provider', 'claude');
    this.log(`Sending provider setting: "${provider}"`);
    this.webview.postMessage({
      type: 'providerSetting',
      provider,
    });
  }

  /** Send per-provider feature support flags so the webview can hide unsupported UI */
  private sendProviderCapabilities(): void {
    this.webview.postMessage({
      type: 'providerCapabilities',
      capabilities: CLAUDE_PROVIDER_CAPABILITIES,
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
    const enabled = config.get<boolean>('sessionVitals', false);
    this.log(`Sending vitals setting: enabled=${enabled}`);
    this.webview.postMessage({
      type: 'vitalsSetting',
      enabled,
    });
  }

  /** Read adventure widget setting from VS Code config and send to webview */
  private sendAdventureWidgetSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('adventureWidget', false);
    this.log(`Sending adventure widget setting: enabled=${enabled}`);
    this.webview.postMessage({
      type: 'adventureWidgetSetting',
      enabled,
    });
  }

  /** Read usage widget setting from VS Code config and send to webview */
  private sendUsageWidgetSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('usageWidget', false);
    this.log(`Sending usage widget setting: enabled=${enabled}`);
    this.webview.postMessage({ type: 'usageWidgetSetting', enabled });
  }

  /** Fetch Claude usage data from CLI and send to the webview */
  private async fetchAndSendUsage(): Promise<void> {
    const { UsageFetcher } = await import('../process/UsageFetcher');
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
    const apiKey = await this.getApiKey();
    const fetcher = new UsageFetcher(cliPath, apiKey);
    const result = await fetcher.fetch();
    this.log(`Usage fetch result: ${result.stats.length} stats, error=${result.error ?? 'none'}`);
    this.webview.postMessage({
      type: 'usageData',
      stats: result.stats,
      fetchedAt: result.fetchedAt,
      error: result.error,
    });
  }

  /** Fetch usage data and create token-ratio samples */
  private async sampleTokenUsageRatio(): Promise<void> {
    if (!this.tokenRatioTracker) return;
    try {
      const { UsageFetcher } = await import('../process/UsageFetcher');
      const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
      const apiKey = await this.getApiKey();
      const fetcher = new UsageFetcher(cliPath, apiKey);
      const result = await fetcher.fetch();
      if (result.stats.length > 0) {
        this.tokenRatioTracker.createSamples(result.stats);
        this.sendTokenRatioData();
        this.log(`Token ratio: sampled ${result.stats.length} buckets`);
      }
    } catch (err) {
      this.log(`Token ratio sample failed: ${err}`);
    }
  }

  /** Send current token ratio data to the webview */
  private sendTokenRatioData(): void {
    if (!this.tokenRatioTracker) return;
    const history = this.tokenRatioTracker.getHistory();
    const summaries = this.tokenRatioTracker.computeSummaries();
    this.webview.postMessage({
      type: 'tokenRatioData',
      samples: history.samples,
      summaries,
      globalTurnCount: history.globalTurnCount,
      cumulativeTokens: history.cumulativeTokens,
      cumulativeWeightedTokens: history.cumulativeWeightedTokens,
    });
  }

  /** Read turn analysis settings from VS Code config and send to webview */
  private sendTurnAnalysisSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('turnAnalysis.enabled', true);
    const analysisModel = config.get<string>('analysisModel', 'claude-haiku-4-5-20251001');
    this.log(`Sending turn analysis settings: enabled=${enabled}, model=${analysisModel}`);
    this.webview.postMessage({
      type: 'turnAnalysisSettings',
      enabled,
      analysisModel,
    });
  }

  /** Read prompt enhancer settings from VS Code config and send to webview */
  private sendPromptEnhancerSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const autoEnhance = config.get<boolean>('promptEnhancer.autoEnhance', false);
    const enhancerModel = config.get<string>('promptEnhancer.model', 'claude-sonnet-4-6');
    this.log(`Sending prompt enhancer settings: auto=${autoEnhance}, model=${enhancerModel}`);
    this.webview.postMessage({
      type: 'promptEnhancerSettings',
      autoEnhance,
      enhancerModel,
    });
  }

  /** Read prompt translator settings from VS Code config and send to webview.
   *  Always respects babelFish.enabled as the master switch — if BabelFish is off,
   *  prompt translation is forced off regardless of the individual promptTranslator config. */
  private sendPromptTranslatorSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const babelFishEnabled = config.get<boolean>('babelFish.enabled', false);
    // BabelFish is the master switch: promptTranslator is only active when BabelFish is on
    const translateEnabled = babelFishEnabled && config.get<boolean>('promptTranslator.enabled', false);
    const autoTranslate = babelFishEnabled && config.get<boolean>('promptTranslator.autoTranslate', false);
    this.log(`Sending prompt translator settings: enabled=${translateEnabled}, auto=${autoTranslate} (babelFish=${babelFishEnabled})`);
    this.webview.postMessage({
      type: 'promptTranslatorSettings',
      translateEnabled,
      autoTranslate,
    });
  }

  /** Read Babel Fish settings from VS Code config and send to webview.
   *  Also syncs promptTranslator state to ensure consistency. */
  private sendBabelFishSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('babelFish.enabled', false);
    const language = config.get<string>('translationLanguage', 'Hebrew');
    this.babelFishEnabled = enabled;
    this.log(`[BabelFish] Sending settings: enabled=${enabled}, language=${language}`);
    this.webview.postMessage({
      type: 'babelFishSettings',
      enabled,
      language,
    });
    // When Babel Fish is off, ensure prompt translator is also off in the webview
    if (!enabled) {
      this.webview.postMessage({
        type: 'promptTranslatorSettings',
        translateEnabled: false,
        autoTranslate: false,
      });
    }
  }

  /** Read skill generation settings and send to webview */
  private sendSkillGenSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    this.webview.postMessage({
      type: 'skillGenSettings',
      enabled: config.get<boolean>('skillGen.enabled', true),
      threshold: config.get<number>('skillGen.threshold', 30),
      docsDirectory: config.get<string>('skillGen.docsDirectory', ''),
      autoRun: config.get<boolean>('skillGen.autoRun', false),
    });
  }

  /** Send current skill generation status to webview */
  private sendSkillGenStatus(): void {
    if (this.skillGenService) {
      this.webview.postMessage(this.skillGenService.getStatus());
    }
  }

  /** Send current GitHub sync status to webview */
  private sendGitHubSyncStatus(): void {
    const syncService = this.achievementService.getSyncService();
    if (!syncService) {
      this.webview.postMessage({
        type: 'githubSyncStatus',
        connected: false,
        username: '',
        gistId: '',
        gistUrl: '',
        lastSyncedAt: '',
        syncEnabled: false,
      });
      return;
    }
    const status = syncService.getStatus();
    this.webview.postMessage({ type: 'githubSyncStatus', ...status });
  }

  /** Send community friends data to webview */
  private sendCommunityData(): void {
    const syncService = this.achievementService.getSyncService();
    if (!syncService) {
      this.webview.postMessage({ type: 'communityData', friends: [] });
      return;
    }
    void syncService.getCommunityFriends().then((friends) => {
      this.webview.postMessage({
        type: 'communityData',
        friends: friends.map((f) => ({
          username: f.username,
          displayName: f.displayName,
          avatarUrl: f.avatarUrl,
          totalXp: f.totalXp,
          level: f.level,
          unlockedIds: f.unlockedIds,
          stats: f.stats,
          lastUpdated: f.lastUpdated,
        })),
      });
    });
  }

  /** Read translation language setting from VS Code config and send to webview */
  private sendTranslationLanguageSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const language = config.get<string>('translationLanguage', 'Hebrew');
    this.log(`Sending translation language setting: language=${language}`);
    this.webview.postMessage({
      type: 'translationLanguageSetting',
      language,
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
      if (e.affectsConfiguration('claudeMirror.provider')) {
        this.log('Configuration changed: claudeMirror.provider');
        this.sendProviderSetting();
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
      if (e.affectsConfiguration('claudeMirror.usageWidget')) {
        this.sendUsageWidgetSetting();
      }
      if (e.affectsConfiguration('claudeMirror.translationLanguage')) {
        this.sendTranslationLanguageSetting();
      }
      if (e.affectsConfiguration('claudeMirror.turnAnalysis.enabled') ||
          e.affectsConfiguration('claudeMirror.analysisModel')) {
        this.sendTurnAnalysisSettings();
      }
      if (e.affectsConfiguration('claudeMirror.promptEnhancer')) {
        this.sendPromptEnhancerSettings();
      }
      if (e.affectsConfiguration('claudeMirror.promptTranslator')) {
        this.sendPromptTranslatorSettings();
      }
      if (e.affectsConfiguration('claudeMirror.babelFish')) {
        const bfCfg = vscode.workspace.getConfiguration('claudeMirror');
        const bfEnabled = bfCfg.get<boolean>('babelFish.enabled', false);
        this.babelFishEnabled = bfEnabled;
        // When Babel Fish is disabled via VS Code Settings, also disable promptTranslator
        // settings — chain sequentially to avoid concurrent write race in settings.json
        if (!bfEnabled) {
          bfCfg.update('promptTranslator.enabled', false, true)
            .then(() => bfCfg.update('promptTranslator.autoTranslate', false, true))
            .then(undefined, (err: unknown) => this.log(`[BabelFish] Error syncing promptTranslator config: ${err}`));
        }
        const bfLang = bfCfg.get<string>('translationLanguage', 'Hebrew');
        this.webview.postMessage({ type: 'babelFishSettings', enabled: bfEnabled, language: bfLang });
        // Send synced prompt translator state
        this.webview.postMessage({
          type: 'promptTranslatorSettings',
          translateEnabled: bfEnabled ? bfCfg.get<boolean>('promptTranslator.enabled', false) : false,
          autoTranslate: bfEnabled ? bfCfg.get<boolean>('promptTranslator.autoTranslate', false) : false,
        });
      }
      if (e.affectsConfiguration('claudeMirror.skillGen')) {
        this.sendSkillGenSettings();
      }
      if (
        e.affectsConfiguration('claudeMirror.achievements.enabled') ||
        e.affectsConfiguration('claudeMirror.achievements.sound') ||
        e.affectsConfiguration('claudeMirror.achievements.aiInsight')
      ) {
        this.achievementService.onConfigChanged();
      }
      if (e.affectsConfiguration('claudeMirror.achievements.githubSync')) {
        this.sendGitHubSyncStatus();
      }
    });
  }

  /** Forward StreamDemux events TO the webview */
  private bindDemuxEvents(): void {
    this.demux.on(
      'init',
      (event: SystemInitEvent) => {
        this.log(`system/init received: session=${event.session_id}, model=${event.model}`);
        // Capture thinking effort from system init if available
        if (event.thinking_effort) {
          this.currentThinkingEffort = event.thinking_effort;
          this.log(`system/init thinking_effort=${event.thinking_effort}`);
        }
        // Update webview with real session info (replaces the "connecting..." placeholder)
        this.webview.postMessage({
          type: 'sessionStarted',
          sessionId: event.session_id,
          model: event.model,
          provider: this.getActiveProvider(),
        });
        // Send session metadata for Context Inspector tab
        const mcpNames = Array.isArray(event.mcp_servers)
          ? event.mcp_servers.map((s: any) => String(s.name || s.id || JSON.stringify(s))).filter(Boolean)
          : [];
        this.webview.postMessage({
          type: 'sessionMetadata',
          tools: event.tools ?? [],
          model: event.model ?? '',
          cwd: event.cwd ?? '',
          mcpServers: mcpNames,
        });
      }
    );

    this.demux.on(
      'textDelta',
      (data: { messageId: string; blockIndex: number; text: string }) => {
        this.markApprovalCycleResumeObserved('textDelta');
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
        this.markApprovalCycleResumeObserved(`toolUseStart:${data.toolName}`);
        this.log(`-> webview: toolUseStart ${data.toolName}`);
        // Codex consultation: detect when the MCP tool is invoked
        if (data.toolName.includes('codex') && this._codexConsultStartedAt) {
          const elapsed = Date.now() - this._codexConsultStartedAt;
          this.log(`[CODEX_CONSULT] Tool invoked: ${data.toolName} (${elapsed}ms since request)`);
        }
        this.currentMessageToolNames.push(data.toolName);
        // Track plan mode: EnterPlanMode sets the flag so ExitPlanMode knows it's legitimate
        if (isEnterPlanModeTool(data.toolName)) {
          this.planModeActive = true;
          this.exitPlanModeReopenCount = 0;
          this.resetExitPlanModeProcessed('EnterPlanMode detected');
          this.log('Plan mode activated (EnterPlanMode detected, reopen counter reset)');
        } else {
          this.notePostExitPlanNonPlanActivity(data.toolName);
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
        // Real-time tool activity indicator (instant, no API calls)
        const baseTool = data.toolName.includes('__') ? data.toolName.split('__').pop() || data.toolName : data.toolName;
        this.webview.postMessage({
          type: 'toolActivity',
          toolName: data.toolName,
          detail: `Using ${baseTool}`,
        });
        if (this.adventureInterpreter) {
          this.emitAdventureBeat(this.buildLiveToolBeat(data.toolName), 'toolUseStart');
        }
      }
    );

    this.demux.on(
      'toolUseDelta',
      (data: { messageId: string; blockIndex: number; partialJson: string }) => {
        // Accumulate streamed JSON input so enrichment can parse real tool arguments.
        const prev = this.toolBlockContexts.get(data.blockIndex) || '';
        const combined = prev + data.partialJson;
        // Guard memory growth in unusually large tool payloads.
        this.toolBlockContexts.set(data.blockIndex, combined.length > 8000 ? combined.slice(0, 8000) : combined);
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
        if (toolName) {
          this.sawToolBlockStopThisMessage = true;
          if (this.activitySummarizer) {
            const enriched = this.enrichToolNameFromRaw(toolName, rawInput);
            this.activitySummarizer.recordToolUse(enriched);
          }
          this.achievementService.onToolUse(this.tabId, toolName, rawInput);
          this.collectAdventureContext(toolName, rawInput);
          // Real-time tool activity: send enriched detail now that we have full input
          this.webview.postMessage({
            type: 'toolActivity',
            toolName,
            detail: this.formatToolActivity(toolName, rawInput),
          });
          // Extract Bash command strings for dashboard
          if (toolName === 'Bash') {
            try {
              const parsed = JSON.parse(rawInput);
              if (parsed.command && typeof parsed.command === 'string') {
                this.currentBashCommands.push(parsed.command.trim());
              }
            } catch {
              // ignore malformed JSON - rawInput may be partial
            }
          }
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
            this.log(`messageDelta: detected approval tool=${approvalTool} in tools=[${this.currentMessageToolNames.join(',')}]`);
            this.logApprovalState('messageDelta-before-notify');
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
        // Babel Fish: auto-translate each assistant message as it arrives (intermediate + final)
        if (this.babelFishEnabled && this.messageTranslator && !this.babelFishTranslatedIds.has(event.message.id)) {
          this.babelFishTranslatedIds.add(event.message.id);
          const textForTranslation = event.message.content
            .filter((block) => block.type === 'text')
            .map((block) => (block as any).text || '')
            .join('\n\n')
            .replace(/```[\w]*\n[\s\S]*?```/g, '')
            .trim();
          if (textForTranslation) {
            const msgId = event.message.id;
            const config = vscode.workspace.getConfiguration('claudeMirror');
            const targetLang = config.get<string>('translationLanguage', 'Hebrew');
            this.webview.postMessage({ type: 'autoTranslateStarted', messageId: msgId });
            this.log(`[BabelFish] Auto-translating message ${msgId} to ${targetLang} (${textForTranslation.length} chars)`);
            this.getApiKey().then((apiKey) =>
              this.messageTranslator!.translate(textForTranslation, targetLang, apiKey)
            ).then((translatedText) => {
              this.webview.postMessage({
                type: 'translationResult',
                messageId: msgId,
                translatedText,
                success: !!translatedText,
                error: translatedText ? undefined : 'Translation failed',
              });
              this.log(`[BabelFish] Auto-translation ${translatedText ? 'succeeded' : 'failed'} for message ${msgId}`);
            }).catch((err) => {
              this.log(`[BabelFish] Auto-translation error for message ${msgId}: ${err}`);
            });
          }
        }
        this.recordToolUseFallbackFromAssistantMessage(event.message.content);
        // Track input tokens for context usage indicator (always present in AssistantMessage)
        // Total context = input_tokens + cache_creation + cache_read
        const assistUsage = event.message.usage;
        if (assistUsage) {
          const totalAssistInput = (assistUsage.input_tokens ?? 0)
            + (assistUsage.cache_creation_input_tokens ?? 0)
            + (assistUsage.cache_read_input_tokens ?? 0);
          if (totalAssistInput > 0) {
            this.lastAssistantInputTokens = totalAssistInput;
          }
        }
        // Detect thinking effort from content blocks (presence of 'thinking' type blocks)
        const hasThinkingBlocks = event.message.content.some((b: any) => b.type === 'thinking');
        if (hasThinkingBlocks && !this.currentThinkingEffort) {
          this.currentThinkingEffort = 'high';
        }
        const effortForMessage = this.currentThinkingEffort || this.demux.getThinkingEffort() || undefined;
        this.log(`-> webview: assistantMessage id=${event.message.id} blocks=[${blockTypes}] usage=${JSON.stringify(event.message.usage)} thinkingEffort=${effortForMessage}`);
        this.webview.postMessage({
          type: 'assistantMessage',
          messageId: event.message.id,
          content: event.message.content,
          model: event.message.model,
          thinkingEffort: effortForMessage,
        });
        // Fallback for CLI variants that don't emit (or reorder) message_delta.
        // Detect approval waits directly from assistant stop_reason + tool blocks.
        if (!this.pendingApprovalTool && event.message.stop_reason === 'tool_use') {
          const approvalToolBlock = event.message.content.find(
            (block) => block.type === 'tool_use' && !!block.name && isApprovalToolName(block.name)
          );
          if (approvalToolBlock?.name) {
            this.log(`assistantMessage fallback: detected approval tool=${approvalToolBlock.name}`);
            this.logApprovalState('assistantMessage-fallback-before-notify');
            this.notifyPlanApprovalRequired(approvalToolBlock.name);
          }
        }
        // Don't set busy=false here - intermediate assistant events arrive mid-stream.
        // Busy is cleared on 'result' event only.
      }
    );

    this.demux.on(
      'messageStart',
      (data: { messageId: string; model: string; inputTokens?: number }) => {
        this.log(`-> webview: messageStart id=${data.messageId} inputTokens=${data.inputTokens}`);
        this.inAssistantTurn = true;
        // Reset per-message thinking effort (will be set if thinking blocks arrive)
        this.currentThinkingEffort = null;
        // Track input tokens from message_start (reliable during live streaming)
        if (data.inputTokens && data.inputTokens > 0) {
          this.lastAssistantInputTokens = data.inputTokens;
        }
        this.logApprovalState('messageStart');
        this.lastMessageId = data.messageId;
        this.currentMessageToolNames = [];
        this.pendingApprovalTool = null;
        this.approvalResponseProcessed = false;
        // After context compaction, the model may re-enter plan mode and call
        // ExitPlanMode without first calling EnterPlanMode. Reset the guard so
        // the approval bar can show again. See BUG_EXITPLANMODE_INFINITE_LOOP.md Bug 9.
        if (this.compactPending) {
          this.log('Post-compact messageStart: resetting exitPlanModeProcessed');
          this.exitPlanModeReopenCount = 0;
          this.resetExitPlanModeProcessed('post-compact messageStart');
          this.compactPending = false;
        }
        this.toolBlockNames.clear();
        this.toolBlockContexts.clear();
        this.currentAdventureArtifacts.clear();
        this.currentAdventureIndicators.clear();
        this.currentAdventureCommandTags.clear();
        this.sawToolBlockStopThisMessage = false;
        this.fallbackToolUseRecordedForMessage = false;
        this.currentBashCommands = [];
        this.webview.postMessage({
          type: 'messageStart',
          messageId: data.messageId,
          model: data.model,
          inputTokens: data.inputTokens,
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
      'thinkingDetected',
      (data: { effort: string }) => {
        this.log(`-> webview: thinkingDetected effort=${data.effort}`);
        this.currentThinkingEffort = data.effort;
        this.webview.postMessage({
          type: 'thinkingEffortUpdate',
          effort: data.effort,
        });
      }
    );

    this.demux.on(
      'userMessage',
      (event: UserMessage) => {
        // Capture user message text for TurnAnalyzer context
        const userText = extractTextFromContent(event.message.content).slice(0, 600);
        this.lastUserMessageText = userText;
        this.recentUserMessages = [...this.recentUserMessages.slice(-4), userText];
        // Post to webview (postUserMessage deduplicates against the optimistic send)
        this.postUserMessage(
          Array.isArray(event.message.content)
            ? event.message.content
            : [{ type: 'text', text: String(event.message.content) } as ContentBlock]
        );
      }
    );

    this.demux.on(
      'result',
      (event: ResultSuccess | ResultError) => {
        this.log(`[RESULT_HANDLER] Entered result handler: subtype=${event.subtype} raw=${JSON.stringify(event).slice(0, 500)}`);
        this.inAssistantTurn = false;
        try {
        // Codex consultation: log result timing if a consultation was in flight
        if (this._codexConsultStartedAt) {
          const elapsed = Date.now() - this._codexConsultStartedAt;
          const hadCodexTool = this.currentMessageToolNames.some(n => n.includes('codex'));
          this.log(`[CODEX_CONSULT] Result received: elapsed=${elapsed}ms, subtype=${event.subtype}, codexToolUsed=${hadCodexTool}, tools=[${this.currentMessageToolNames.join(',')}]`);
          this._codexConsultStartedAt = null;
          this.clearCodexConsultTimeout();
        }
        this.logApprovalState(`result:${event.subtype}`);
        // Snapshot BEFORE clearing (clearApprovalTracking resets the array)
        const toolNamesSnapshot = [...this.currentMessageToolNames];
        const adventureSnapshot = this.snapshotAdventureMetadata();
        const bashCommandsSnapshot = [...this.currentBashCommands];
        const messageIdSnapshot = this.lastMessageId;
        if (toolNamesSnapshot.length > 0 || this.pendingApprovalCycleResumeObserved) {
          this.markApprovalCycleResultObserved(`result:${event.subtype}`);
        }

        // Preserve pendingApprovalTool across the result event if an approval
        // bar is currently visible in the webview. The `result` event fires
        // when the CLI turn completes, but the user may not have responded to
        // the approval bar yet. Without this, the approval response handler
        // can't identify which tool was pending.
        const savedApprovalTool = this.pendingApprovalTool;
        this.clearApprovalTracking({
          preserveApprovalCycle: !!savedApprovalTool || this.pendingApprovalCycleId != null,
        });
        if (savedApprovalTool) {
          this.pendingApprovalTool = savedApprovalTool;
          this.log(`Preserved pendingApprovalTool=${savedApprovalTool} across result event`);
        }
        if (event.subtype === 'success') {
          this.achievementService.onResult(this.tabId, true);
          const success = event as ResultSuccess;
          // result.usage is CUMULATIVE across all API calls in the turn.
          // For context-window display we need the LAST API call's input
          // tokens (= actual prompt size). lastAssistantInputTokens is set
          // from the most recent message_start event and reflects that.
          // Only fall back to the cumulative value when no messageStart was seen.
          const resultTotalInput = (success.usage?.input_tokens ?? 0)
            + (success.usage?.cache_creation_input_tokens ?? 0)
            + (success.usage?.cache_read_input_tokens ?? 0);
          const contextWindowTokens = this.lastAssistantInputTokens || resultTotalInput;
          this.log(`costUpdate: result.total=${resultTotalInput} (input=${success.usage?.input_tokens} cache_create=${success.usage?.cache_creation_input_tokens} cache_read=${success.usage?.cache_read_input_tokens}) lastAssistant=${this.lastAssistantInputTokens} contextWindow=${contextWindowTokens}`);
          this.webview.postMessage({
            type: 'costUpdate',
            costUsd: success.cost_usd ?? 0,
            totalCostUsd: success.total_cost_usd ?? 0,
            inputTokens: contextWindowTokens,
            outputTokens: success.usage?.output_tokens ?? 0,
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
            messageId: messageIdSnapshot,
            adventureArtifacts: adventureSnapshot.artifacts,
            adventureIndicators: adventureSnapshot.indicators,
            adventureCommandTags: adventureSnapshot.commandTags,
            inputTokens: (success as any).usage?.input_tokens ?? 0,
            outputTokens: (success as any).usage?.output_tokens ?? 0,
            cacheCreationTokens: (success as any).usage?.cache_creation_input_tokens ?? 0,
            cacheReadTokens: (success as any).usage?.cache_read_input_tokens ?? 0,
            bashCommands: bashCommandsSnapshot,
          };
          this.log(`Emitting turnComplete: turn=${successTurn.turnIndex} category=${successTurn.category} tools=[${successTurn.toolNames.join(',')}]`);
          this.webview.postMessage({ type: 'turnComplete', turn: successTurn });
          this.turnRecords.push(successTurn as TurnRecord);
          // Token-Usage Ratio Tracker: record turn and sample if due
          if (this.tokenRatioTracker) {
            const shouldSample = this.tokenRatioTracker.recordTurn({
              inputTokens: successTurn.inputTokens ?? 0,
              outputTokens: successTurn.outputTokens ?? 0,
              cacheCreationTokens: successTurn.cacheCreationTokens ?? 0,
              cacheReadTokens: successTurn.cacheReadTokens ?? 0,
            });
            if (shouldSample) {
              void this.sampleTokenUsageRatio();
            }
          }
          // TurnAnalyzer: fire-and-forget semantic analysis
          if (this.turnAnalyzer) {
            void this.turnAnalyzer.analyze({
              messageId: messageIdSnapshot,
              userMessage: this.lastUserMessageText,
              toolNames: toolNamesSnapshot,
              bashCommands: bashCommandsSnapshot,
              isError: false,
              recentUserMessages: this.recentUserMessages.slice(-3),
            });
          }
          // Adventure Widget: generate and send beat
          if (this.adventureInterpreter) {
            const beat = this.adventureInterpreter.interpret(successTurn as TurnRecord);
            this.emitAdventureBeat(beat, 'resultSuccess');
          }
          // Babel Fish: clear dedup set at end of turn
          this.babelFishTranslatedIds.clear();
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
            messageId: messageIdSnapshot,
            adventureArtifacts: adventureSnapshot.artifacts,
            adventureIndicators: adventureSnapshot.indicators,
            adventureCommandTags: adventureSnapshot.commandTags,
            bashCommands: bashCommandsSnapshot,
          };
          this.log(`Emitting turnComplete (error): turn=${errorTurn.turnIndex}`);
          this.webview.postMessage({ type: 'turnComplete', turn: errorTurn });
          this.turnRecords.push(errorTurn as TurnRecord);
          // Token-Usage Ratio Tracker: record turn (0 tokens for error turns)
          if (this.tokenRatioTracker) {
            const shouldSample = this.tokenRatioTracker.recordTurn({
              inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
            });
            if (shouldSample) {
              void this.sampleTokenUsageRatio();
            }
          }
          // TurnAnalyzer: fire-and-forget semantic analysis for error turns
          if (this.turnAnalyzer) {
            void this.turnAnalyzer.analyze({
              messageId: messageIdSnapshot,
              userMessage: this.lastUserMessageText,
              toolNames: toolNamesSnapshot,
              bashCommands: bashCommandsSnapshot,
              isError: true,
              recentUserMessages: this.recentUserMessages.slice(-3),
            });
          }
          // Adventure Widget: generate and send beat
          if (this.adventureInterpreter) {
            const beat = this.adventureInterpreter.interpret(errorTurn as TurnRecord);
            this.emitAdventureBeat(beat, 'resultError');
          }
        }
        this.currentAdventureArtifacts.clear();
        this.currentAdventureIndicators.clear();
        this.currentAdventureCommandTags.clear();
        // Clear tool activity indicator before marking idle
        this.webview.postMessage({ type: 'toolActivity', toolName: '', detail: '' });
        this.webview.postMessage({ type: 'processBusy', busy: false });
        } catch (err) {
          this.log(`[RESULT_HANDLER] ERROR in result handler: ${err instanceof Error ? err.stack || err.message : String(err)}`);
        }
      }
    );
  }

  /** Emit adventure beat with a unique monotonically increasing index (not tied to turnIndex). */
  private emitAdventureBeat(beat: AdventureBeatMessage['beat'], source: string): void {
    const emittedBeat: AdventureBeatMessage['beat'] = {
      ...beat,
      turnIndex: this.adventureBeatIndex++,
      timestamp: beat.timestamp || Date.now(),
    };
    this.log(
      `Emitting adventureBeat [${source}]: beatIdx=${emittedBeat.turnIndex} beat=${emittedBeat.beat} intensity=${emittedBeat.intensity}`
    );
    this.webview.postMessage({ type: 'adventureBeat', beat: emittedBeat });
  }

  /** Generate a live beat from a single tool-use event to keep movement flowing during long turns. */
  private buildLiveToolBeat(toolName: string): AdventureBeatMessage['beat'] {
    const baseName = toolName.includes('__') ? toolName.split('__').pop() || toolName : toolName;

    let beat: AdventureBeatMessage['beat']['beat'] = 'wander';
    let roomType: AdventureBeatMessage['beat']['roomType'] = 'corridor';
    let labelShort = 'Exploring...';
    let outcome: AdventureBeatMessage['beat']['outcome'] = 'neutral';
    let intensity: AdventureBeatMessage['beat']['intensity'] = 1;
    const artifacts: string[] = [];
    const indicators: string[] = [];
    const commandTags: string[] = [];

    if (baseName === 'Read') {
      beat = 'read';
      roomType = 'library';
      labelShort = 'Reading scrolls';
      outcome = 'success';
      intensity = 2;
      artifacts.push('scroll');
      indicators.push('lore-scan');
    } else if (RESEARCH_TOOLS.includes(baseName)) {
      beat = 'scout';
      roomType = 'library';
      labelShort = 'Searching the map';
      outcome = 'success';
      intensity = 2;
      artifacts.push('map-fragment');
      indicators.push('recon');
    } else if (CODE_WRITE_TOOLS.includes(baseName)) {
      beat = 'carve';
      roomType = 'forge';
      labelShort = 'Mining the wall';
      outcome = 'success';
      intensity = 2;
      artifacts.push('rune-shard');
      indicators.push('crafting');
    } else if (COMMAND_TOOLS.includes(baseName)) {
      beat = 'forge';
      roomType = 'arena';
      labelShort = 'Working the forge';
      outcome = 'success';
      intensity = 2;
      artifacts.push('gear');
      indicators.push('execution');
      commandTags.push('build');
    } else if (baseName === 'ExitPlanMode' || baseName === 'AskUserQuestion') {
      beat = 'fork';
      roomType = 'junction';
      labelShort = 'Crossroads';
      outcome = 'neutral';
      intensity = 1;
      artifacts.push('junction-key');
      indicators.push('planning');
    }

    return {
      turnIndex: -1,
      timestamp: Date.now(),
      beat,
      intensity,
      outcome,
      toolNames: [toolName],
      labelShort,
      tooltipDetail: toolName,
      roomType,
      isHaikuEnhanced: false,
      artifacts,
      indicators,
      commandTags,
    };
  }

  /** Mark ExitPlanMode as handled by the user and start stale-event suppression. */
  private markExitPlanModeProcessed(reason: string): void {
    this.planModeActive = false;
    this.exitPlanModeProcessed = true;
    this.postExitPlanNonPlanActivityObserved = false;
    this.log(`ExitPlanMode marked as processed (${reason})`);
  }

  /** Reset ExitPlanMode stale-event suppression state. */
  private resetExitPlanModeProcessed(reason: string): void {
    this.exitPlanModeProcessed = false;
    this.postExitPlanNonPlanActivityObserved = false;
    this.log(`ExitPlanMode processed flag reset (${reason})`);
  }

  /** Dump all approval-related state for diagnostics. Call at key lifecycle moments. */
  private logApprovalState(context: string): void {
    this.log(
      `[APPROVAL_STATE] ${context} | ` +
      `pendingTool=${this.pendingApprovalTool ?? 'null'} ` +
      `approvalRespProcessed=${this.approvalResponseProcessed} ` +
      `planModeActive=${this.planModeActive} ` +
      `exitPlanProcessed=${this.exitPlanModeProcessed} ` +
      `postActivity=${this.postExitPlanNonPlanActivityObserved} ` +
      `reopenCount=${this.exitPlanModeReopenCount}/${MAX_EXITPLANMODE_REOPENS} ` +
      `cycleId=${this.pendingApprovalCycleId ?? 'null'} ` +
      `resumeObs=${this.pendingApprovalCycleResumeObserved} ` +
      `resultObs=${this.pendingApprovalCycleResultObserved} ` +
      `inAssistantTurn=${this.inAssistantTurn} ` +
      `compactPending=${this.compactPending} ` +
      `tools=[${this.currentMessageToolNames.join(',')}]`
    );
  }

  /** Track concrete post-approval execution so a future ExitPlanMode is treated as a new cycle. */
  private notePostExitPlanNonPlanActivity(toolName: string): void {
    if (!this.exitPlanModeProcessed) {
      return; // Not post-approval yet; skip silently (would be extremely noisy)
    }
    if (this.postExitPlanNonPlanActivityObserved) {
      return; // Already tracked once; skip silently
    }
    if (this.pendingApprovalTool) {
      // IMPORTANT: this means the CLI auto-resumed (started a new turn with non-plan tools)
      // BEFORE the user clicked approve. The timing gap between CLI auto-approval and user
      // click means this tool won't be counted as post-approval activity.
      // If this shows up in logs frequently, it indicates a race between CLI speed and user
      // click speed — which is why Bug 10 re-open tracking may not work as expected.
      this.log(`[EPM_TRACK] notePostExitPlanNonPlanActivity(${toolName}): skipped - approval bar still visible (pendingApprovalTool=${this.pendingApprovalTool}). CLI ran tool before user clicked approve.`);
      return;
    }
    if (isApprovalToolName(toolName) || isEnterPlanModeTool(toolName)) {
      return; // Plan-related tools don't count as implementation activity
    }
    this.postExitPlanNonPlanActivityObserved = true;
    this.log(`[EPM_TRACK] ExitPlanMode cycle: post-approval non-plan activity observed via ${toolName} (exitPlanModeProcessed=${this.exitPlanModeProcessed} reopenCount=${this.exitPlanModeReopenCount})`);
  }

  /** Reset tool name tracking and pending approval state */
  private clearApprovalTracking(options?: { preserveApprovalCycle?: boolean }): void {
    this.currentMessageToolNames = [];
    this.pendingApprovalTool = null;
    if (!options?.preserveApprovalCycle) {
      this.clearApprovalCycleState();
    }
  }

  /** Clear the Codex consultation timeout timer */
  private clearCodexConsultTimeout(): void {
    if (this._codexConsultTimeoutTimer) {
      clearTimeout(this._codexConsultTimeoutTimer);
      this._codexConsultTimeoutTimer = null;
    }
  }

  /** Reset approval-cycle metadata and any delayed ExitPlanMode fallback nudge */
  private clearApprovalCycleState(): void {
    this.pendingApprovalCycleId = null;
    this.pendingApprovalCycleResumeObserved = false;
    this.pendingApprovalCycleResultObserved = false;
    this.cancelExitPlanApproveResumeFallback();
  }

  /** Cancel a scheduled ExitPlanMode approve fallback nudge (if any) */
  private cancelExitPlanApproveResumeFallback(): void {
    if (this.exitPlanApproveResumeFallbackTimer) {
      clearTimeout(this.exitPlanApproveResumeFallbackTimer);
      this.exitPlanApproveResumeFallbackTimer = null;
    }
    this.exitPlanApproveResumeFallbackCycleId = null;
  }

  /** Cancel the post-approve nudge timer (separate from approval cycle state) */
  private cancelPostApproveNudge(): void {
    if (this.postApproveNudgeTimer) {
      clearTimeout(this.postApproveNudgeTimer);
      this.postApproveNudgeTimer = null;
    }
  }

  /** Record post-approval meaningful progress (tool/text activity) */
  private markApprovalCycleResumeObserved(source: string): void {
    if (this.pendingApprovalCycleId == null || this.pendingApprovalCycleResumeObserved) {
      return;
    }
    // Ignore events that belong to the original approval-generating turn.
    // After the approval bar is shown, `pendingApprovalTool` remains set until a
    // new assistant turn starts or the user clicks a button.
    if (this.pendingApprovalTool) {
      // The CLI auto-resumed into a new turn while the approval bar is still visible
      // (user hasn't clicked yet). This is the race condition window.
      this.log(`[EPM_CYCLE] markApprovalCycleResumeObserved(${source}): skipped - approval bar still visible (pendingApprovalTool=${this.pendingApprovalTool}). CLI resumed before user click.`);
      return;
    }
    this.pendingApprovalCycleResumeObserved = true;
    this.log(`[EPM_CYCLE] Approval cycle ${this.pendingApprovalCycleId}: resume observed via ${source}`);
    if (this.exitPlanApproveResumeFallbackCycleId === this.pendingApprovalCycleId) {
      this.cancelExitPlanApproveResumeFallback();
      this.log(`[EPM_CYCLE] ExitPlanMode approve fallback cancelled - auto-resume observed (cycle ${this.pendingApprovalCycleId})`);
    }
  }

  /** Record that the Claude turn completed after the approval bar was shown */
  private markApprovalCycleResultObserved(source: string): void {
    if (this.pendingApprovalCycleId == null || this.pendingApprovalCycleResultObserved) {
      return;
    }
    this.pendingApprovalCycleResultObserved = true;
    this.log(`[EPM_CYCLE] Approval cycle ${this.pendingApprovalCycleId}: result observed via ${source} (pendingApprovalTool=${this.pendingApprovalTool ?? 'null'})`);
    // Do NOT cancel the fallback timer here. If a timer is running, its
    // callback now checks pendingApprovalCycleResultObserved and will send
    // the proceed nudge when it fires (Bug 7 fix). Cancelling here would
    // prevent the nudge from being sent when the CLI auto-resumed with
    // brief text and went idle.
  }

  /** If ExitPlanMode approve does not auto-resume, send a proceed nudge.
   *
   * Bug 15 fix: one delayed check was not enough. If it fired while the CLI
   * was still inside a non-executing turn (for example compaction), the nudge
   * was skipped permanently and the click became a no-op. This logic now
   * re-checks until either real non-plan progress is observed, CLI goes idle,
   * or a max-wait timeout forces one final nudge. */
  private scheduleExitPlanApproveResumeFallback(
    cycleId: number | null,
    startedAt = Date.now(),
    attempt = 1
  ): void {
    if (cycleId == null) {
      this.log('ExitPlanMode approve fallback skipped - no approval cycle id');
      return;
    }
    if (this.pendingApprovalCycleId !== cycleId) {
      this.log(`ExitPlanMode approve fallback skipped - stale cycle ${cycleId}, current=${this.pendingApprovalCycleId ?? 'none'}`);
      return;
    }

    this.cancelPostApproveNudge();
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const sawNonPlanProgress = this.postExitPlanNonPlanActivityObserved;

    // Primary check: is the CLI currently between messageStart and result?
    if (!this.inAssistantTurn) {
      if (sawNonPlanProgress) {
        this.log(`ExitPlanMode approve nudge skipped - CLI idle but non-plan progress already observed (cycle ${cycleId}, elapsed=${elapsedMs}ms)`);
        this.logApprovalState('approve-nudge-skip-idle-progress');
        this.clearApprovalCycleState();
        return;
      }
      // CLI is idle and there was no post-approval execution progress: nudge now.
      this.log(`ExitPlanMode approve - CLI idle (attempt=${attempt}, elapsed=${elapsedMs}ms), sending proceed nudge (cycle ${cycleId})`);
      this.logApprovalState('approve-nudge-immediate');
      try {
        this.control.sendText('Continue with the implementation.');
        this.webview.postMessage({ type: 'processBusy', busy: true });
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        this.log(`ExitPlanMode approve nudge failed: ${errorText}`);
        this.webview.postMessage({
          type: 'error',
          message: `Plan approval follow-up failed: ${errorText}`,
        });
      } finally {
        this.clearApprovalCycleState();
      }
      return;
    }

    // CLI is currently busy. If real non-plan progress is already observed,
    // do not inject any nudge; implementation is underway.
    if (sawNonPlanProgress) {
      this.log(`ExitPlanMode approve nudge skipped - CLI busy and non-plan progress observed (cycle ${cycleId}, elapsed=${elapsedMs}ms)`);
      this.logApprovalState('approve-nudge-skip-busy-progress');
      this.clearApprovalCycleState();
      return;
    }

    // No post-approval execution progress yet. Retry while waiting for idle,
    // and force one last nudge if we exceed the max wait.
    if (elapsedMs >= EXIT_PLANMODE_APPROVE_MAX_WAIT_MS) {
      this.log(
        `ExitPlanMode approve nudge timeout - forcing proceed nudge after ${elapsedMs}ms ` +
        `(cycle ${cycleId}, attempt=${attempt}, inAssistantTurn=${this.inAssistantTurn})`
      );
      this.logApprovalState('approve-nudge-timeout-force');
      try {
        this.control.sendText('Continue with the implementation.');
        this.webview.postMessage({ type: 'processBusy', busy: true });
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        this.log(`ExitPlanMode approve forced nudge failed: ${errorText}`);
        this.webview.postMessage({
          type: 'error',
          message: `Plan approval follow-up failed after timeout: ${errorText}`,
        });
      } finally {
        this.clearApprovalCycleState();
      }
      return;
    }

    const remainingMs = EXIT_PLANMODE_APPROVE_MAX_WAIT_MS - elapsedMs;
    const nextDelayMs = Math.min(EXIT_PLANMODE_APPROVE_RESUME_FALLBACK_DELAY_MS, remainingMs);
    this.log(
      `ExitPlanMode approve - CLI busy with no non-plan progress yet; retrying nudge check in ${nextDelayMs}ms ` +
      `(cycle ${cycleId}, attempt=${attempt}, elapsed=${elapsedMs}ms)`
    );
    this.logApprovalState('approve-nudge-retry-scheduled');
    this.postApproveNudgeTimer = setTimeout(() => {
      this.postApproveNudgeTimer = null;
      this.scheduleExitPlanApproveResumeFallback(cycleId, startedAt, attempt + 1);
    }, nextDelayMs);
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
    // Suppress stale ExitPlanMode notifications when an ExitPlanMode cycle already
    // completed in this session. If we already saw concrete non-plan activity
    // after that approval (e.g., TodoWrite/Read), treat the new ExitPlanMode call
    // as a fresh cycle instead of a stale replay to avoid deadlock in plan mode.
    // Bug 11 fix: limit re-opens to MAX_EXITPLANMODE_REOPENS to prevent the model
    // from looping: work -> ExitPlanMode -> approve -> work -> ExitPlanMode...
    const norm = toolName.trim().toLowerCase();
    const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
    if (isExitPlanMode && this.exitPlanModeProcessed) {
      if (this.postExitPlanNonPlanActivityObserved) {
        if (this.exitPlanModeReopenCount >= MAX_EXITPLANMODE_REOPENS) {
          this.log(
            `Suppressing ExitPlanMode reopen - hit max reopens (${this.exitPlanModeReopenCount}/${MAX_EXITPLANMODE_REOPENS}). ` +
            `Model is likely in an ExitPlanMode loop. Will not show approval bar again until EnterPlanMode.`
          );
          this.logApprovalState('reopen-limit-hit');
          return;
        }
        this.exitPlanModeReopenCount++;
        this.log(
          `ExitPlanMode detected after post-approval execution activity; ` +
          `treating as a new approval cycle (reopen ${this.exitPlanModeReopenCount}/${MAX_EXITPLANMODE_REOPENS})`
        );
        this.resetExitPlanModeProcessed('post-approval non-plan activity detected');
      } else {
        this.log(`Suppressing stale ExitPlanMode notification - already processed in this plan cycle`);
        this.logApprovalState('stale-suppression');
        return;
      }
    }
    // NOTE: We intentionally do NOT auto-approve ExitPlanMode by sending user
    // messages. The CLI already auto-approves ExitPlanMode (via bypassPermissions
    // or allowedTools). Sending approval-sounding text as a user message creates
    // a spurious conversation turn that causes the model to call ExitPlanMode
    // again (infinite loop). Instead, we always show the approval bar and let
    // the user interact with it. The approve action closes the bar; a delayed
    // fallback nudge fires only if no post-approval activity is observed.
    // IMPORTANT: Both button-click AND typed-text paths must set
    // exitPlanModeProcessed=true to suppress re-triggers. The button path
    // does this via planApprovalResponse; the typed-text path does this via
    // the sendMessage handler (which checks pendingApprovalTool).
    this.cancelExitPlanApproveResumeFallback();
    this.cancelPostApproveNudge();
    this.pendingApprovalCycleId = this.nextApprovalCycleId++;
    this.pendingApprovalCycleResumeObserved = false;
    this.pendingApprovalCycleResultObserved = false;
    this.log(`Plan approval required: tool=${toolName} cycle=${this.pendingApprovalCycleId}`);
    this.logApprovalState('showing-approval-bar');
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

  /** Fallback: extract tool uses from assistant snapshots if blockStop events are missing */
  private recordToolUseFallbackFromAssistantMessage(content: ContentBlock[]): void {
    if (this.sawToolBlockStopThisMessage || this.fallbackToolUseRecordedForMessage) {
      return;
    }

    const toolBlocks = content.filter(
      (block): block is ContentBlock => block.type === 'tool_use' && typeof block.name === 'string' && !!block.name.trim()
    );
    if (toolBlocks.length === 0) {
      return;
    }

    this.log(`[ToolUseFallback] Extracting ${toolBlocks.length} tool uses from assistantMessage (no tool blockStop seen)`);
    for (const block of toolBlocks) {
      const toolName = (block.name || '').trim();
      if (!toolName) {
        continue;
      }
      const rawInput = this.serializeToolInput(block.input);
      if (this.activitySummarizer) {
        const enriched = this.enrichToolNameFromRaw(toolName, rawInput);
        this.activitySummarizer.recordToolUse(enriched);
      }
      this.achievementService.onToolUse(this.tabId, toolName, rawInput);
      this.collectAdventureContext(toolName, rawInput);
      if (!this.currentMessageToolNames.includes(toolName)) {
        this.currentMessageToolNames.push(toolName);
      }
    }

    this.fallbackToolUseRecordedForMessage = true;
  }

  /** Snapshot semantic adventure metadata collected across tool calls in this turn. */
  private snapshotAdventureMetadata(): {
    artifacts: string[];
    indicators: string[];
    commandTags: string[];
  } {
    return {
      artifacts: Array.from(this.currentAdventureArtifacts).slice(0, 8),
      indicators: Array.from(this.currentAdventureIndicators).slice(0, 8),
      commandTags: Array.from(this.currentAdventureCommandTags).slice(0, 8),
    };
  }

  /** Extract game-facing semantic signals from tool usage so visuals can react meaningfully. */
  private collectAdventureContext(toolName: string, rawInput: string): void {
    const baseName = toolName.includes('__') ? toolName.split('__').pop() || toolName : toolName;

    if (baseName === 'Read') {
      this.currentAdventureArtifacts.add('scroll');
      this.currentAdventureIndicators.add('lore-scan');
    } else if (RESEARCH_TOOLS.includes(baseName)) {
      this.currentAdventureArtifacts.add('map-fragment');
      this.currentAdventureIndicators.add('recon');
    } else if (CODE_WRITE_TOOLS.includes(baseName)) {
      this.currentAdventureArtifacts.add('rune-shard');
      this.currentAdventureIndicators.add('crafting');
    } else if (COMMAND_TOOLS.includes(baseName)) {
      this.currentAdventureArtifacts.add('gear');
      this.currentAdventureIndicators.add('execution');
    } else if (baseName === 'ExitPlanMode' || baseName === 'AskUserQuestion' || baseName === 'EnterPlanMode') {
      this.currentAdventureArtifacts.add('junction-key');
      this.currentAdventureIndicators.add('planning');
    }

    const commands = this.extractCommandTexts(rawInput);
    for (const command of commands) {
      const tags = this.classifyCommandTags(command);
      for (const tag of tags) {
        this.currentAdventureCommandTags.add(tag);
        switch (tag) {
          case 'git':
            this.currentAdventureArtifacts.add('commit-sigil');
            this.currentAdventureIndicators.add('vcs-flow');
            break;
          case 'test':
            this.currentAdventureArtifacts.add('trial-mark');
            this.currentAdventureIndicators.add('validation');
            break;
          case 'build':
            this.currentAdventureArtifacts.add('blueprint');
            this.currentAdventureIndicators.add('assembly');
            break;
          case 'deploy':
            this.currentAdventureArtifacts.add('portal-seal');
            this.currentAdventureIndicators.add('release-window');
            break;
          case 'search':
            this.currentAdventureArtifacts.add('tracker-lens');
            this.currentAdventureIndicators.add('trace-hunt');
            break;
        }
      }
    }
  }

  private extractCommandTexts(rawInput: string): string[] {
    if (!rawInput) return [];
    const commands = new Set<string>();
    const pushCommand = (value: unknown): void => {
      if (typeof value !== 'string') return;
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      commands.add(normalized.slice(0, 180));
    };

    try {
      const parsed = JSON.parse(rawInput) as unknown;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
              const payload = entry as Record<string, unknown>;
              pushCommand(payload.command);
            }
          }
        } else {
          const payload = parsed as Record<string, unknown>;
          pushCommand(payload.command);
          pushCommand(payload.cmd);
          if (Array.isArray(payload.commands)) {
            for (const entry of payload.commands) pushCommand(entry);
          }
          if (Array.isArray(payload.tool_uses)) {
            for (const toolUse of payload.tool_uses) {
              if (!toolUse || typeof toolUse !== 'object') continue;
              const use = toolUse as Record<string, unknown>;
              const params = use.parameters;
              if (!params || typeof params !== 'object' || Array.isArray(params)) continue;
              pushCommand((params as Record<string, unknown>).command);
            }
          }
        }
      }
    } catch {
      // Fallback regex for partial/invalid tool JSON fragments.
    }

    if (commands.size === 0) {
      const regex = /"command"\s*:\s*"([^"]{1,500})"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(rawInput)) !== null) {
        pushCommand(match[1]);
        if (commands.size >= 6) break;
      }
    }

    return Array.from(commands).slice(0, 6);
  }

  private classifyCommandTags(command: string): string[] {
    const normalized = command.toLowerCase();
    const tags = new Set<string>();

    if (/\bgit\b/.test(normalized)) tags.add('git');
    if (/\b(test|jest|vitest|pytest)\b/.test(normalized) || normalized.includes('go test') || normalized.includes('cargo test')) {
      tags.add('test');
    }
    if (
      /\b(build|compile|tsc)\b/.test(normalized) ||
      normalized.includes('vite build') ||
      normalized.includes('webpack') ||
      normalized.includes('cargo build') ||
      normalized.includes('go build')
    ) {
      tags.add('build');
    }
    if (/\b(deploy|release|publish|docker|kubectl|terraform)\b/.test(normalized)) tags.add('deploy');
    if (/\b(rg|grep|find|ls|dir|cat)\b/.test(normalized)) tags.add('search');

    return Array.from(tags);
  }

  /** Serialize tool input to a JSON string for enrichment and achievement classification */
  private serializeToolInput(input: unknown): string {
    if (typeof input === 'string') {
      return input;
    }
    if (input === null || input === undefined) {
      return '';
    }
    try {
      return JSON.stringify(input);
    } catch {
      return '';
    }
  }

  /**
   * Create a human-readable tool activity description for the busy indicator.
   * Returns a short label like "Reading src/app.ts" or "Running: npm test".
   */
  private formatToolActivity(toolName: string, rawJson: string): string {
    const baseName = toolName.includes('__') ? toolName.split('__').pop() || toolName : toolName;

    let key = '';
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      key =
        (typeof parsed.file_path === 'string' && parsed.file_path) ||
        (typeof parsed.path === 'string' && parsed.path) ||
        (typeof parsed.command === 'string' && parsed.command) ||
        (typeof parsed.pattern === 'string' && parsed.pattern) ||
        (typeof parsed.query === 'string' && parsed.query) ||
        (typeof parsed.url === 'string' && parsed.url) ||
        (typeof parsed.prompt === 'string' && parsed.prompt) ||
        '';
    } catch {
      // Partial JSON - try regex fallback
      const m = rawJson.match(/"(?:file_path|path|command|pattern|query|url)"\s*:\s*"([^"]{1,200})"/);
      if (m?.[1]) key = m[1];
    }

    // Truncate long values
    if (key.length > 60) key = key.slice(0, 57) + '...';

    // Extract just the filename from paths for Read/Write/Edit
    const filename = (val: string) => {
      const parts = val.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || val;
    };

    switch (baseName) {
      case 'Read':
        return key ? `Reading ${filename(key)}` : 'Reading file';
      case 'Write':
        return key ? `Writing ${filename(key)}` : 'Writing file';
      case 'Edit':
        return key ? `Editing ${filename(key)}` : 'Editing file';
      case 'Bash':
        return key ? `Running: ${key.length > 50 ? key.slice(0, 47) + '...' : key}` : 'Running command';
      case 'Grep':
        return key ? `Searching: ${key}` : 'Searching code';
      case 'Glob':
        return key ? `Finding files: ${key}` : 'Finding files';
      case 'Task':
        return 'Running agent';
      case 'WebFetch':
        return key ? `Fetching: ${key.length > 40 ? key.slice(0, 37) + '...' : key}` : 'Fetching URL';
      case 'WebSearch':
        return key ? `Searching web: ${key}` : 'Searching web';
      case 'TodoWrite':
        return 'Updating tasks';
      case 'NotebookEdit':
        return 'Editing notebook';
      default:
        return `Using ${baseName}`;
    }
  }

  /** Enrich a tool name using raw JSON tool input */
  private enrichToolNameFromRaw(toolName: string, rawJson: string): string {
    if (!rawJson) {
      return toolName;
    }

    const snippets: string[] = [];
    const seenLabels = new Set<string>();

    const normalizeSnippet = (value: string, maxLen = 90): string => {
      const compact = value.replace(/\s+/g, ' ').trim();
      if (compact.length <= maxLen) {
        return compact;
      }
      return `${compact.slice(0, maxLen - 3)}...`;
    };

    const addSnippet = (label: string, value: unknown): void => {
      if (snippets.length >= 4 || seenLabels.has(label) || typeof value !== 'string') {
        return;
      }
      const cleaned = normalizeSnippet(value);
      if (!cleaned) {
        return;
      }
      snippets.push(`${label}=${cleaned}`);
      seenLabels.add(label);
    };

    const extractSearchQuery = (value: unknown): string | null => {
      if (!Array.isArray(value)) {
        return null;
      }
      for (const entry of value) {
        if (entry && typeof entry === 'object') {
          const q = (entry as Record<string, unknown>).q;
          if (typeof q === 'string' && q.trim()) {
            return q.trim();
          }
        }
      }
      return null;
    };

    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const payload = parsed as Record<string, unknown>;

        addSnippet('file', payload.file_path);
        addSnippet('path', payload.path);
        addSnippet('pattern', payload.pattern);
        addSnippet('query', payload.query);
        addSnippet('url', payload.url);
        addSnippet('command', payload.command);
        addSnippet('prompt', payload.prompt);

        const q = extractSearchQuery(payload.search_query);
        if (q) {
          addSnippet('query', q);
        }

        if (Array.isArray(payload.open)) {
          for (const entry of payload.open) {
            if (entry && typeof entry === 'object') {
              addSnippet('ref', (entry as Record<string, unknown>).ref_id);
              if (snippets.length >= 4) {
                break;
              }
            }
          }
        }

        if (Array.isArray(payload.tool_uses)) {
          for (const toolUse of payload.tool_uses) {
            if (!toolUse || typeof toolUse !== 'object') {
              continue;
            }
            const use = toolUse as Record<string, unknown>;
            addSnippet('tool', use.recipient_name);
            const parameters = use.parameters;
            if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
              const params = parameters as Record<string, unknown>;
              addSnippet('command', params.command);
              addSnippet('query', params.q);
              addSnippet('path', params.path);
              addSnippet('pattern', params.pattern);
            }
            if (snippets.length >= 4) {
              break;
            }
          }
        }
      }
    } catch {
      // Keep regex fallback below for partially streamed or invalid JSON fragments.
    }

    if (snippets.length === 0) {
      const patterns: Array<{ label: string; regex: RegExp }> = [
        { label: 'file', regex: /"(?:file_path|filepath)"\s*:\s*"([^"]{1,200})"/ },
        { label: 'path', regex: /"(?:path|relative_workspace_path)"\s*:\s*"([^"]{1,200})"/ },
        { label: 'pattern', regex: /"pattern"\s*:\s*"([^"]{1,200})"/ },
        { label: 'query', regex: /"(?:query|q)"\s*:\s*"([^"]{1,200})"/ },
        { label: 'url', regex: /"url"\s*:\s*"([^"]{1,200})"/ },
        { label: 'command', regex: /"command"\s*:\s*"([^"]{1,400})"/ },
      ];

      for (const entry of patterns) {
        const match = rawJson.match(entry.regex);
        if (match?.[1]) {
          addSnippet(entry.label, match[1]);
        }
        if (snippets.length >= 4) {
          break;
        }
      }
    }

    if (snippets.length === 0) {
      return toolName;
    }

    const details = snippets.join('; ');
    return `${toolName} (${details})`;
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

    this.getApiKey().then((apiKey) => this.sessionNamer!
      .generateName(userText, apiKey))
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
