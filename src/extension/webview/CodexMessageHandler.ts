import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import type { CodexExecDemux } from '../process/CodexExecDemux';
import type { PromptHistoryStore } from '../session/PromptHistoryStore';
import type { ProjectAnalyticsStore } from '../session/ProjectAnalyticsStore';
import type { AchievementService } from '../achievements/AchievementService';
import type { WebviewBridge } from './MessageHandler';
import type { ContentBlock } from '../types/stream-json';
import { setStoredApiKey, maskApiKey } from '../process/envUtils';
import { MessageTranslator } from '../session/MessageTranslator';
import { BugReportService } from '../feedback/BugReportService';
import type {
  CodexReasoningEffort,
  CodexServiceTier,
  CodexModelOption,
  DlpMessageMetadata,
  ExtensionToWebviewMessage,
  ProviderCapabilities,
  ProviderId,
  TurnRecord,
  TurnCategory,
  TypingTheme,
  WebviewImageData,
  WebviewToExtensionMessage,
} from '../types/webview-messages';
import type { DlpDecision } from '../../shared/secret-protection/types';

export interface CodexSessionController {
  startSession(options?: { resume?: string; cwd?: string }): Promise<void>;
  stopSession(): void;
  clearSession(options?: { cwd?: string }): Promise<void>;
  sendText(text: string, options?: { steer?: boolean }): Promise<void>;
  sendWithImages(
    text: string,
    images: Array<{ base64: string; mediaType: string }>,
    options?: { steer?: boolean }
  ): Promise<void>;
  cancelRequest(): void;
  openCodexLoginTerminal(): void;
  isSessionActive(): boolean;
  getSessionId(): string | null;
  getCurrentModel(): string;
  isTurnRunning(): boolean;
  isBusyState(): boolean;
  startBtwSession?(promptText: string): void;
  sendBtwMessage?(text: string): void;
  closeBtwSession?(): void;
}

function codexTurnCategory(hasCommands: boolean): TurnCategory {
  return hasCommands ? 'command' : 'discussion';
}

function isExpectedNonFatalCommandExit(command: string, exitCode: number | null): boolean {
  if (exitCode !== 1) {
    return false;
  }
  const normalized = command.toLowerCase();
  // ripgrep returns exit 1 when no matches are found (not a runtime failure).
  if (/\brg(\.exe)?\b/.test(normalized)) {
    return true;
  }
  return false;
}

function formatCodexModelLabel(id: string): string {
  return id
    .split('-')
    .map((part) => (part.toLowerCase() === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

// CodexCliCandidate type and detection functions are in CodexCliDetector.ts
import {
  type CodexCliCandidate,
  findWorkingCodexCliCandidates as detectWorkingCodexCli,
  pickPreferredCodexCliCandidate as pickPreferredCandidate,
  probeCodexCliVersion as probeVersion,
  quoteForShell as quoteShell,
} from '../process/CodexCliDetector';

const CODEX_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsPlanApproval: false,
  supportsCompact: false,
  supportsFork: true,
  supportsImages: true,
  supportsGitPush: true,
  supportsTranslation: true,
  supportsPromptEnhancer: false,
  supportsCodexConsult: false,
  supportsPermissionModeSelector: true,
  supportsLiveTextStreaming: false,
  supportsConversationDiskReplay: true,
  supportsCostUsd: false,
};

/**
 * Codex-specific webview/runtime bridge.
 * Intentionally smaller than Claude MessageHandler for Stage 2 MVP.
 */
export class CodexMessageHandler {
  private log: (msg: string) => void = () => {};
  private turnIndex = 0;
  private turnRecords: TurnRecord[] = [];
  private lastMessageId = '';
  private currentTurnStartedAt = 0;
  private currentTurnCommands: string[] = [];
  private currentTurnHadAgentMessage = false;
  private messageCounter = 0;
  private secrets: vscode.SecretStorage | null = null;
  private autoSetupCodexCliInProgress = false;
  private webviewPostQueue: Promise<void> = Promise.resolve();
  private messageTranslator: MessageTranslator | null = null;
  private bugReportService: BugReportService | null = null;
  private chatSearchService: import('../session/ChatSearchService').ChatSearchService | null = null;
  private extensionVersion = '0.0.0';
  private logDir = '';
  /** Dedup: last userMessage text posted to webview, with timestamp. */
  private lastPostedUserMsg: { text: string; time: number } | null = null;
  /** One-time handoff context staged by provider switch. Injected on first user turn only. */
  private pendingHandoffPrompt: string | null = null;
  /** User-scheduled message queued for future dispatch. */
  private scheduledPrompt: { text: string; images?: WebviewImageData[] } | null = null;
  private scheduledPromptAtMs: number | null = null;
  private scheduledPromptTimer: ReturnType<typeof setTimeout> | null = null;
  /** Memory sampler for the dashboard memory tab (shared instance, set after construction) */
  private memorySampler: import('../process/ProcessMemorySampler').ProcessMemorySampler | null = null;
  /** Workstream map manager (shared instance, set after construction) */
  private workstreamManager: import('../workstream/WorkstreamManager').WorkstreamManager | null = null;
  /** Session metadata store used by workstream classification. */
  private sessionStore: import('../session/SessionStore').SessionStore | null = null;
  /** Returns session IDs for all currently open tabs. */
  private openTabSessionIdsGetter: (() => string[]) | null = null;
  private memoryStreamTimer: ReturnType<typeof setInterval> | null = null;
  private memorySampleInFlight = false;
  /** Secret Protection service (shared instance, set after construction) */
  private secretProtectionService: import('../secret-protection/SecretProtectionService').SecretProtectionService | null = null;
  /** Shared worktree controller (set after construction by TabManager). */
  private worktreeController: import('../worktree/WorktreeController').WorktreeController | null = null;

  setSecretProtectionService(service: import('../secret-protection/SecretProtectionService').SecretProtectionService): void {
    this.secretProtectionService = service;
  }

  setMemorySampler(sampler: import('../process/ProcessMemorySampler').ProcessMemorySampler): void {
    this.memorySampler = sampler;
  }

  /** Provide the shared WorkstreamManager (used by the workstream map feature). */
  setWorkstreamManager(manager: import('../workstream/WorkstreamManager').WorkstreamManager): void {
    this.workstreamManager = manager;
  }

  /** Provide the shared worktree controller (used by the worktree dashboard). */
  setWorktreeController(controller: import('../worktree/WorktreeController').WorktreeController): void {
    this.worktreeController = controller;
  }

  /** Build + post the joined worktree/sessions list to this tab's webview. */
  private async handleGetWorktreeList(): Promise<void> {
    if (!this.worktreeController) { return; }
    try {
      const list = await this.worktreeController.buildList();
      this.webview.postMessage(list);
    } catch (e) {
      this.log(`[Worktree] list failed: ${e instanceof Error ? e.message : String(e)}`);
      this.webview.postMessage({ type: 'worktreeList', worktrees: [], isGitRepo: false });
    }
  }

  private async handleCreateWorktree(msg: {
    name: string;
    baseBranch?: string;
    startSession: boolean;
  }): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.create({
      name: msg.name,
      baseBranch: msg.baseBranch,
      startSession: msg.startSession,
    });
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleCreateWorktreeSession(worktreePath: string): Promise<void> {
    if (!this.worktreeController) { return; }
    await this.worktreeController.createSession(worktreePath);
    await this.handleGetWorktreeList();
  }

  private async handleRemoveWorktree(worktreePath: string, force: boolean): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.remove(worktreePath, force);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleListBranches(): Promise<void> {
    if (!this.worktreeController) { return; }
    this.webview.postMessage(await this.worktreeController.listBranches());
  }

  private async handleGetMergePreview(sourcePath: string, targetBranch?: string): Promise<void> {
    if (!this.worktreeController) { return; }
    this.webview.postMessage(await this.worktreeController.previewMerge(sourcePath, targetBranch));
  }

  private async handleCommitWorktree(worktreePath: string, message: string, targetBranch?: string): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.commitSource(worktreePath, message);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
    // Committing changed the source branch; refresh the wizard's preview.
    if (result.success) {
      this.webview.postMessage(await this.worktreeController.previewMerge(worktreePath, targetBranch));
    }
  }

  private async handlePerformMerge(req: {
    sourcePath: string;
    targetBranch: string;
    strategy: 'merge' | 'squash' | 'ff';
    commitMessage?: string;
    allowMainSwitch: boolean;
    removeAfter: boolean;
    pushAfter: boolean;
  }): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.performMerge(req);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleAbortMerge(targetPath: string, squash: boolean): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.abortMerge(targetPath, squash);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleCompleteMerge(
    targetPath: string,
    opts: { squash: boolean; message?: string; preSha?: string },
  ): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.completeMerge(targetPath, opts);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleUndoMerge(
    targetPath: string,
    opts: { mode: 'revert' | 'discard'; strategy: 'merge' | 'squash' | 'ff'; newSha: string; preSha?: string },
  ): Promise<void> {
    if (!this.worktreeController) { return; }
    const result = await this.worktreeController.undoMerge(targetPath, opts);
    this.webview.postMessage(result);
    await this.handleGetWorktreeList();
  }

  private async handleOpenConflictFiles(targetPath: string, files: string[]): Promise<void> {
    if (!this.worktreeController) { return; }
    await this.worktreeController.openConflictFiles(targetPath, files);
  }

  /** Provide the SessionStore for accessing session metadata. */
  setSessionStore(store: import('../session/SessionStore').SessionStore): void {
    this.sessionStore = store;
  }

  /** Provide a getter for open tab session IDs (used to scope workstream classification). */
  setOpenTabSessionIdsGetter(getter: () => string[]): void {
    this.openTabSessionIdsGetter = getter;
  }

  /** Set extension metadata for bug reports */
  setExtensionMeta(version: string, logDir: string): void {
    this.extensionVersion = version;
    this.logDir = logDir;
  }

  /** Provide SecretStorage for API key management */
  setSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  /** Wire the message translator for translation feature */
  setMessageTranslator(translator: MessageTranslator): void {
    this.messageTranslator = translator;
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

  private async getApiKey(): Promise<string | undefined> {
    return this.secrets?.get('claudeMirror.anthropicApiKey') ?? undefined;
  }

  constructor(
    private readonly tabId: string,
    private readonly webview: WebviewBridge,
    private readonly session: CodexSessionController,
    private readonly demux: CodexExecDemux,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService,
    private readonly projectAnalyticsStore?: ProjectAnalyticsStore
  ) {}

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Stage one-time handoff context to be injected into the next user turn. */
  setPendingHandoffPrompt(prompt: string): void {
    const trimmed = prompt.trim();
    this.pendingHandoffPrompt = trimmed || null;
    this.log(`[Handoff] staged deferred context (Codex): chars=${trimmed.length}`);
  }

  /** Clear staged one-time handoff context (called on fresh/restarted sessions). */
  clearPendingHandoffPrompt(): void {
    this.pendingHandoffPrompt = null;
  }

  /**
   * Reset deferred/session-bound UI state when the host starts/stops/restarts a
   * Codex session outside the normal webview command flow.
   */
  resetTransientStateForHostLifecycle(
    reason: string,
    options?: { notifyWebview?: boolean; clearHandoff?: boolean },
  ): void {
    const notifyWebview = options?.notifyWebview ?? true;
    const clearHandoff = options?.clearHandoff ?? true;
    this.log(`[Lifecycle][Codex] Resetting deferred state (${reason})`);
    this.clearScheduledPromptState(notifyWebview);
    if (clearHandoff) {
      this.clearPendingHandoffPrompt();
    }
  }

  dispose(): void {
    this.resetTransientStateForHostLifecycle('handler dispose', {
      notifyWebview: false,
    });
    this.stopMemoryStream();
  }

  /** Start or stop the per-tab memory streaming interval (dashboard memory tab). */
  private handleMemoryStreamRequest(enabled: boolean, intervalMs?: number): void {
    if (!enabled) {
      this.stopMemoryStream();
      return;
    }
    if (!this.memorySampler) {
      this.webview.postMessage({
        type: 'memoryStreamError',
        error: 'Memory sampler is not available in this build.',
      });
      return;
    }
    const clamped = Math.min(10000, Math.max(1000, intervalMs ?? 2500));
    this.stopMemoryStream();
    void this.runMemorySample();
    this.memoryStreamTimer = setInterval(() => { void this.runMemorySample(); }, clamped);
    this.log(`[Memory] streaming started (interval=${clamped}ms)`);
  }

  private stopMemoryStream(): void {
    if (this.memoryStreamTimer !== null) {
      clearInterval(this.memoryStreamTimer);
      this.memoryStreamTimer = null;
      this.log('[Memory] streaming stopped');
    }
  }

  private async runMemorySample(): Promise<void> {
    if (!this.memorySampler || this.memorySampleInFlight) return;
    this.memorySampleInFlight = true;
    try {
      const snap = await this.memorySampler.sample();
      this.webview.postMessage({
        type: 'memorySnapshot',
        timestamp: snap.timestamp,
        systemTotalBytes: snap.systemTotalBytes,
        systemFreeBytes: snap.systemFreeBytes,
        extensionHost: snap.extensionHost,
        vscodeProcesses: snap.vscodeProcesses,
        cliProcesses: snap.cliProcesses,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[Memory] sample failed: ${message}`);
      this.webview.postMessage({ type: 'memoryStreamError', error: message });
    } finally {
      this.memorySampleInFlight = false;
    }
  }

  /**
   * Serialize Codex live UI messages to avoid end-of-turn ordering races in the
   * webview (agent_message + turn.completed can arrive back-to-back).
   */
  private postToWebview(msg: ExtensionToWebviewMessage): void {
    this.webviewPostQueue = this.webviewPostQueue
      .catch(() => undefined)
      .then(() => {
        try {
          this.webview.postMessage(msg);
        } catch (err) {
          this.log(`Failed to post Codex webview message (${msg.type}): ${this.errMsg(err)}`);
        }
      });
  }

  /** Post a userMessage with dedup (same pattern as MessageHandler). */
  private postUserMessage(
    content: ContentBlock[],
    isOptimistic = false,
    dlpMetadata?: DlpMessageMetadata,
  ): void {
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text || '')
      .join('');
    if (!isOptimistic && this.lastPostedUserMsg && this.lastPostedUserMsg.text === text) {
      this.log(`Suppressed CLI echo duplicate: "${text.slice(0, 60)}..."`);
      return;
    }
    if (isOptimistic) {
      this.lastPostedUserMsg = { text, time: Date.now() };
    }
    this.postToWebview({ type: 'userMessage', content, ...dlpMetadata });
  }

  private dlpMetadataFromDecision(decision: DlpDecision): DlpMessageMetadata {
    return {
      secretsDetected: decision.findings.length > 0,
      redactionApplied: decision.action === 'redact'
        || decision.action === 'summarize_locally'
        || decision.audit.redactionCount > 0,
    };
  }

  /**
   * Build the first-turn payload with deferred handoff context.
   * Returns whether this payload should consume the staged context on successful send.
   */
  private buildDeferredHandoffPayload(userText: string, opts?: { imageCount?: number }): { text: string; consumeOnSuccess: boolean } {
    const staged = this.pendingHandoffPrompt;
    if (!staged) {
      return { text: userText, consumeOnSuccess: false };
    }

    const trimmedUser = userText.trim();
    const userPayload =
      trimmedUser ||
      ((opts?.imageCount ?? 0) > 0
        ? '[User attached image(s) without additional text.]'
        : '[User sent an empty message.]');

    const text = [
      'Context migrated from a previous provider session. Treat it as prior conversation history for this chat.',
      staged,
      'New user message:',
      userPayload,
    ].join('\n\n');

    this.log(
      `[Handoff] prepared deferred context injection (Codex): contextChars=${staged.length} userChars=${trimmedUser.length} images=${opts?.imageCount ?? 0}`,
    );
    return { text, consumeOnSuccess: true };
  }

  private formatScheduledTime(ms: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  private postScheduledMessageState(summary?: string): void {
    this.postToWebview({
      type: 'scheduledMessageState',
      scheduled: !!this.scheduledPrompt,
      text: this.scheduledPrompt?.text?.slice(0, 80),
      scheduledAtMs: this.scheduledPromptAtMs ?? undefined,
      summary,
    });
  }

  private clearScheduledPromptTimer(): void {
    if (this.scheduledPromptTimer) {
      clearTimeout(this.scheduledPromptTimer);
      this.scheduledPromptTimer = null;
    }
  }

  private clearScheduledPromptState(notifyWebview: boolean): void {
    this.clearScheduledPromptTimer();
    this.scheduledPrompt = null;
    this.scheduledPromptAtMs = null;
    if (notifyWebview) {
      this.postScheduledMessageState();
    }
  }

  private schedulePromptDispatch(delayMs?: number): void {
    if (!this.scheduledPrompt || this.scheduledPromptAtMs == null) {
      return;
    }
    this.clearScheduledPromptTimer();
    const computedDelay = delayMs != null
      ? Math.max(0, delayMs)
      : Math.max(0, this.scheduledPromptAtMs - Date.now());
    this.scheduledPromptTimer = setTimeout(() => {
      this.scheduledPromptTimer = null;
      this.tryDispatchScheduledPrompt();
    }, computedDelay);
  }

  private buildPromptContent(text: string, images?: WebviewImageData[]): ContentBlock[] {
    const content: ContentBlock[] = [];
    if (text) {
      content.push({ type: 'text', text });
    }
    for (const img of images ?? []) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }
    return content;
  }

  private describeImageCaptures(images: WebviewImageData[], promptText: string): string {
    const mediaTypes = [...new Set(images.map((img) => img.mediaType))].join(',') || 'unknown';
    const totalBase64Bytes = images.reduce((sum, img) => sum + img.base64.length, 0);
    return [
      `image_count=${images.length}`,
      `media_types=${mediaTypes}`,
      `base64_chars=${totalBase64Bytes}`,
      `prompt_bytes=${Buffer.byteLength(promptText, 'utf8')}`,
    ].join('; ');
  }

  private async resolveBrowserCaptureDecision(
    images: WebviewImageData[] | undefined,
    composedText: string,
  ): Promise<boolean> {
    if (!images?.length || !this.secretProtectionService?.isEnabled()) {
      return true;
    }
    const broker = this.secretProtectionService.getBroker();
    if (!broker) {
      return true;
    }

    const decision = await broker.scanBrowserCapture(
      this.describeImageCaptures(images, composedText),
    );
    switch (decision.action) {
      case 'require_approval': {
        this.log(`[SecretProtection] Browser capture requires approval: ${decision.reason}`);
        const choice = await vscode.window.showWarningMessage(
          `Secret Protection: Image capture requires approval before sending to the model.`,
          { modal: true, detail: decision.approvalRequest?.description ?? decision.reason },
          'Send Anyway',
          'Remove Image',
        );
        if (choice === 'Send Anyway') {
          this.log(`[SecretProtection] User approved browser capture`);
          return true;
        }
        this.log(`[SecretProtection] User declined browser capture`);
        return false;
      }
      case 'block':
        this.log(`[SecretProtection] Browser capture ${decision.action}: ${decision.reason}`);
        this.postToWebview({
          type: 'error',
          message: `Secret protection blocked this image capture: ${decision.reason}`,
        });
        return false;
      case 'summarize_locally':
        if (!decision.safeSummary) {
          this.log(`[SecretProtection] Browser capture blocked (summarize_locally, no safe summary): ${decision.reason}`);
          this.postToWebview({
            type: 'error',
            message: `Secret protection blocked this image capture: ${decision.reason}`,
          });
          return false;
        }
        return true;
      case 'warn':
        this.log(`[SecretProtection] Browser capture warning: ${decision.reason}`);
        return true;
      default:
        return true;
    }
  }

  private async dispatchPrompt(text: string, images?: WebviewImageData[], opts?: { steer?: boolean }): Promise<void> {
    const normalizedImages = images && images.length > 0 ? images : undefined;

    // Build final payload (including handoff context) BEFORE scanning
    const deferred = this.buildDeferredHandoffPayload(text, { imageCount: normalizedImages?.length ?? 0 });

    if (!(await this.resolveBrowserCaptureDecision(normalizedImages, deferred.text))) {
      return;
    }

    // DLP: scan the FINAL composed payload (including handoff context)
    // All side effects (achievement, history, UI) happen AFTER DLP approves.
    let dlpRedacted = false;
    let dlpMetadata: DlpMessageMetadata | undefined;
    if (this.secretProtectionService?.isEnabled() && this.secretProtectionService.getSettings().scanPrompts) {
      const broker = this.secretProtectionService.getBroker();
      if (broker) {
        const decision = await broker.scanPromptSubmission(deferred.text);
        dlpMetadata = this.dlpMetadataFromDecision(decision);
        switch (decision.action) {
          case 'block':
          case 'require_approval':
            this.log(`[SecretProtection] Prompt ${decision.action}: ${decision.reason}`);
            this.postToWebview({
              type: 'error',
              message: `Secret protection blocked this prompt: ${decision.reason}`,
            });
            return;
          case 'redact':
            if (decision.redactedContent) { deferred.text = decision.redactedContent; }
            dlpRedacted = true;
            break;
          case 'summarize_locally':
            if (decision.safeSummary) {
              deferred.text = decision.safeSummary;
            } else {
              this.log(`[SecretProtection] Prompt blocked (summarize_locally, no safe summary): ${decision.reason}`);
              this.postToWebview({
                type: 'error',
                message: `Secret protection blocked this prompt: ${decision.reason}`,
              });
              return;
            }
            dlpRedacted = true;
            break;
          case 'warn':
            this.log(`[SecretProtection] Prompt warning: ${decision.reason}`);
            break;
        }
      }
    }

    // Side effects only after DLP approved
    if (text.trim()) {
      this.achievementService.onUserPrompt(this.tabId, text);
      if (!dlpRedacted) {
        void this.promptHistoryStore.addPrompt(text);
      }
    }
    const content = this.buildPromptContent(text, normalizedImages);
    this.postUserMessage(content, true, dlpMetadata);
    this.postToWebview({ type: 'processBusy', busy: true });

    try {
      if (normalizedImages) {
        await this.session.sendWithImages(deferred.text, normalizedImages, { steer: !!opts?.steer });
      } else {
        await this.session.sendText(deferred.text, { steer: !!opts?.steer });
      }
      if (deferred.consumeOnSuccess) {
        this.pendingHandoffPrompt = null;
      }
    } catch (err) {
      this.postToWebview({ type: 'processBusy', busy: this.session.isTurnRunning() });
      throw err;
    }
  }

  private tryDispatchScheduledPrompt(): void {
    if (!this.scheduledPrompt || this.scheduledPromptAtMs == null) {
      return;
    }
    if (!this.session.isSessionActive()) {
      this.log('[ScheduledMessage][Codex] Session not active at fire time; clearing scheduled prompt');
      this.clearScheduledPromptState(true);
      this.postToWebview({
        type: 'error',
        message: 'Scheduled message cancelled: session is not running.',
      });
      return;
    }
    if (this.session.isTurnRunning() && this.session.isBusyState()) {
      this.log('[ScheduledMessage][Codex] Turn busy at fire time; retrying in 15s');
      this.schedulePromptDispatch(15_000);
      return;
    }

    const queued = this.scheduledPrompt;
    void this.dispatchPrompt(queued.text, queued.images)
      .then(() => {
        this.clearScheduledPromptState(true);
      })
      .catch((err) => {
        const message = this.errMsg(err);
        this.log(`[ScheduledMessage][Codex] Scheduled prompt dispatch failed: ${message}`);
        this.postToWebview({
          type: 'error',
          message: `Failed to send scheduled message: ${message}`,
        });
        this.schedulePromptDispatch(15_000);
      });
  }

  private scheduleMessage(text: string, scheduledAtMs: number, images?: WebviewImageData[]): void {
    const normalizedImages = images && images.length > 0 ? images : undefined;
    const hasPayload = text.trim().length > 0 || !!normalizedImages;
    if (!hasPayload) {
      return;
    }

    const wasScheduled = !!this.scheduledPrompt;
    this.scheduledPrompt = { text, images: normalizedImages };
    this.scheduledPromptAtMs = scheduledAtMs;
    this.schedulePromptDispatch();

    const scheduledLabel = this.formatScheduledTime(scheduledAtMs);
    const summary = wasScheduled
      ? `Scheduled message updated. Will send at ${scheduledLabel}.`
      : `Message scheduled for ${scheduledLabel}.`;
    this.postScheduledMessageState(summary);
    this.log(`[ScheduledMessage][Codex] Prompt scheduled for ${scheduledLabel} (updated=${wasScheduled})`);
  }

  initialize(): void {
    this.bindWebviewMessages();
    this.bindDemuxEvents();
    this.watchConfigChanges();
  }

  flushTurnRecords(): TurnRecord[] {
    const records = this.turnRecords;
    this.turnRecords = [];
    return records;
  }

  private bindWebviewMessages(): void {
    this.webview.onMessage((msg: WebviewToExtensionMessage) => {
      this.log(`Codex webview -> extension: ${msg.type}`);

      switch (msg.type) {
        case 'ready':
          this.sendInitialSettings();
          if (this.session.isSessionActive()) {
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.session.getSessionId() || 'pending',
              model: this.getConfiguredCodexModelLabel(),
              provider: 'codex',
            });
          }
          break;

        case 'secretProtectionGetStatus': {
          void this.sendSecretProtectionStatus();
          break;
        }
        case 'secretProtectionSetSetting': {
          void this.handleSecretProtectionSetSetting(msg.key, msg.value);
          break;
        }
        case 'secretProtectionGetAuditEvents': {
          void this.handleSecretProtectionGetAuditEvents(msg.filter, msg.limit);
          break;
        }
        case 'secretProtectionGetComplianceReport': {
          void this.handleSecretProtectionGetComplianceReport(msg.filter);
          break;
        }

        case 'requestMemoryStream': {
          this.handleMemoryStreamRequest(msg.enabled, msg.intervalMs);
          break;
        }

        case 'setApiKey': {
          if (!this.secrets) {
            this.log('setApiKey: no secrets available');
            break;
          }
          void setStoredApiKey(this.secrets, msg.apiKey).then(() => {
            this.log(`API key ${msg.apiKey.trim() ? 'saved' : 'cleared'}`);
            void this.sendApiKeySetting();
          });
          break;
        }

        case 'startSession':
          this.clearScheduledPromptState(true);
          this.clearPendingHandoffPrompt();
          void this.session.startSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to start Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'resumeSession':
          this.clearScheduledPromptState(true);
          this.clearPendingHandoffPrompt();
          void this.session.startSession({ resume: msg.sessionId }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to resume Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'stopSession':
          this.clearScheduledPromptState(true);
          this.clearPendingHandoffPrompt();
          this.session.stopSession();
          break;

        case 'clearSession':
          this.clearScheduledPromptState(true);
          this.clearPendingHandoffPrompt();
          void this.session.clearSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to clear Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'sendMessage':
          this.log(`Codex sendMessage requested: len=${msg.text.length} preview="${msg.text.slice(0, 80).replace(/\s+/g, ' ')}"`);
          if (this.session.isTurnRunning() && this.session.isBusyState() && !msg.steer) {
            this.postToWebview({
              type: 'error',
              message: 'Codex is already running a turn. Click Steer to interrupt it, or Stop to cancel it.',
            });
            break;
          }
          void this.dispatchPrompt(msg.text, undefined, { steer: !!msg.steer }).catch((err) => {
            const message = this.errMsg(err);
            this.log(`Codex sendText failed: ${message}`);
            this.postToWebview({ type: 'error', message: `Failed to send Codex message: ${message}` });
          });
          break;

        case 'sendMessageWithImages': {
          this.log(`Codex sendMessageWithImages requested: images=${msg.images.length} textLen=${msg.text.length}`);
          if (this.session.isTurnRunning() && this.session.isBusyState() && !msg.steer) {
            this.postToWebview({
              type: 'error',
              message: 'Codex is already running a turn. Click Steer to interrupt it, or Stop to cancel it.',
            });
            break;
          }
          void this.dispatchPrompt(msg.text, msg.images, { steer: !!msg.steer }).catch((err) => {
            const message = this.errMsg(err);
            this.log(`Codex sendWithImages failed: ${message}`);
            this.postToWebview({ type: 'error', message: `Failed to send Codex message with images: ${message}` });
          });
          break;
        }

        case 'scheduleMessage':
          this.scheduleMessage(msg.text, msg.scheduledAtMs, msg.images);
          break;

        case 'cancelScheduledMessage':
          this.log('[ScheduledMessage][Codex] User cancelled scheduled message');
          this.clearScheduledPromptState(true);
          break;

        case 'cancelRequest':
          this.achievementService.onCancel(this.tabId);
          this.postToWebview({ type: 'processBusy', busy: false });
          this.session.cancelRequest();
          break;

        case 'setProvider':
          this.log(`Setting provider to: "${msg.provider}" (Codex handler)`);
          void vscode.workspace.getConfiguration('claudeMirror').update('provider', msg.provider, true)
            .then(() => {
              const saved = vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
              this.log(`Provider setting saved (Codex handler): "${saved}" (requested "${msg.provider}")`);
              this.webview.postMessage({ type: 'providerSetting', provider: saved });
            }, (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to save provider setting "${msg.provider}" (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to save provider setting: ${message}` });
            });
          break;

        case 'openSmartSearch':
          this.log(`Open Smart Search requested (Codex handler): provider=${msg.provider} model=${msg.model}`);
          void vscode.commands.executeCommand('claudeMirror.smartSearch.open', {
            provider: msg.provider,
            model: msg.model,
          }).then(
            () => undefined,
            (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to open Smart Search tab (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to open Smart Search: ${message}` });
            }
          );
          break;

        case 'openSessionFromSearch':
          this.log(`Open session from search (Codex handler): id=${msg.sessionId} provider=${msg.provider}`);
          void vscode.commands.executeCommand(
            'claudeMirror.resumeSession',
            msg.sessionId,
            msg.provider,
          ).then(
            () => undefined,
            (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to open session ${msg.sessionId} (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to open session: ${message}` });
            }
          );
          break;

        case 'openProviderTab':
          this.log(`Open provider tab requested: "${msg.provider}" (Codex handler)`);
          void vscode.workspace.getConfiguration('claudeMirror').update('provider', msg.provider, true)
            .then(() => {
              const saved = vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
              this.log(`Provider setting saved before opening tab (Codex handler): "${saved}" (requested "${msg.provider}")`);
              this.webview.postMessage({ type: 'providerSetting', provider: saved });
              void vscode.commands.executeCommand('claudeMirror.startSession').then(
                () => this.log(`Requested new provider tab via command (Codex handler): provider="${msg.provider}"`),
                (err: unknown) => {
                  const message = err instanceof Error ? err.message : String(err);
                  this.log(`Failed to open provider tab "${msg.provider}" (Codex handler): ${message}`);
                  this.webview.postMessage({ type: 'error', message: `Failed to open ${msg.provider} tab: ${message}` });
                }
              );
            }, (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to save provider setting before opening tab "${msg.provider}" (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to open ${msg.provider} tab: ${message}` });
            });
          break;

        case 'switchProviderWithContext':
          this.log(`Switch provider with context requested: "${msg.targetProvider}" (Codex handler)`);
          void vscode.commands.executeCommand('claudeMirror.switchProviderWithContext', {
            sourceTabId: this.tabId,
            targetProvider: msg.targetProvider,
            keepSourceOpen: msg.keepSourceOpen ?? true,
          }).then(
            () => undefined,
            (err: unknown) => {
              const message = this.errMsg(err);
              this.log(`Failed switchProviderWithContext (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Provider handoff failed: ${message}` });
            },
          );
          break;

        case 'setModel':
          void vscode.workspace.getConfiguration('claudeMirror').update('codex.model', msg.model, true);
          this.webview.postMessage({ type: 'modelSetting', model: msg.model });
          break;

        case 'setCodexReasoningEffort':
          this.log(`Setting Codex reasoning effort to: "${msg.effort || '(default)'}"`);
          void vscode.workspace.getConfiguration('claudeMirror').update('codex.reasoningEffort', msg.effort, true);
          this.webview.postMessage({ type: 'codexReasoningEffortSetting', effort: msg.effort });
          break;

        case 'setCodexServiceTier':
          this.log(`Setting Codex service tier to: "${msg.serviceTier || '(default)'}"`);
          void vscode.workspace.getConfiguration('claudeMirror').update('codex.serviceTier', msg.serviceTier, true);
          this.webview.postMessage({ type: 'codexServiceTierSetting', serviceTier: msg.serviceTier });
          break;

        case 'setTypingTheme':
          void vscode.workspace.getConfiguration('claudeMirror').update('typingTheme', msg.theme, true);
          break;

        case 'setGoalState':
          this.log(`Goal state update (Codex): active=${msg.active}`);
          break;

        case 'setTabLayout':
          this.log(`Setting tab layout to: "${msg.layout}" (Codex handler)`);
          void vscode.workspace
            .getConfiguration('claudeMirror.tabs')
            .update('layout', msg.layout, vscode.ConfigurationTarget.Global);
          break;

        case 'focusTab':
          void vscode.commands.executeCommand('claudeMirror.tabs.focus', msg.tabId);
          break;

        case 'closeTab':
          void vscode.commands.executeCommand('claudeMirror.tabs.close', msg.tabId);
          break;

        case 'reorderTabs':
          void vscode.commands.executeCommand('claudeMirror.tabs.reorder', msg.tabIds);
          break;

        case 'requestTabList':
          void vscode.commands.executeCommand('claudeMirror.tabs.refreshList');
          break;

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

        case 'setPermissionMode':
          void vscode.workspace.getConfiguration('claudeMirror').update('permissionMode', msg.mode, true)
            .then(() => {
              const saved = vscode.workspace
                .getConfiguration('claudeMirror')
                .get<'full-access' | 'supervised'>('permissionMode', 'full-access');
              this.log(`Permission mode saved (Codex handler): "${saved}" (requested "${msg.mode}")`);
              this.webview.postMessage({ type: 'permissionModeSetting', mode: saved });
            }, (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log(`Failed to save permission mode "${msg.mode}" (Codex handler): ${message}`);
              this.webview.postMessage({ type: 'error', message: `Failed to save permission mode: ${message}` });
            });
          break;

        case 'showHistory':
          void vscode.commands.executeCommand('claudeMirror.showHistory');
          break;

        case 'openFile':
          void this.handleOpenFile(msg.filePath);
          break;

        case 'openUrl':
          this.handleOpenUrl(msg.url);
          break;

        case 'copyToClipboard':
          void vscode.env.clipboard.writeText(msg.text).then(() => {
            this.log(`Copied text to clipboard (Codex handler): ${msg.text.length} chars`);
          }, (err: unknown) => {
            this.log(`Failed to copy text to clipboard (Codex handler): ${this.errMsg(err)}`);
            this.webview.postMessage({ type: 'error', message: 'Failed to copy text to clipboard.' });
          });
          break;

        case 'openSettings':
          if (msg.query === 'claudeMirror.codex.cliPath') {
            void this.handleCodexCliPathHelpAndOpenSettings(msg.query);
            break;
          }
          void vscode.commands.executeCommand('workbench.action.openSettings', msg.query);
          break;

        case 'openCodexLogin':
          this.session.openCodexLoginTerminal();
          break;

        case 'pickCodexCliPath':
          void this.handlePickCodexCliPath();
          break;

        case 'autoDetectCodexCliPath':
          void this.handleAutoDetectCodexCliPath();
          break;

        case 'autoSetupCodexCli':
          void this.handleAutoSetupCodexCli();
          break;

        case 'getProjectAnalytics':
          this.handleGetProjectAnalytics();
          break;

        case 'getPromptHistory':
          this.log(`Fetching prompt history (Codex): scope=${msg.scope}`);
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

        case 'gitPush':
          this.handleGitPush();
          break;

        case 'gitPushConfig':
          this.log(`Git push config request (Codex): "${msg.instruction.slice(0, 80)}..."`);
          {
            const configPrompt = `Please help me configure git push for this VS Code extension project. The settings are VS Code settings under "claudeMirror.gitPush.*": enabled (boolean), scriptPath (string, relative to workspace), commitMessageTemplate (string, supports {sessionName} placeholder). ${msg.instruction}`;
            this.webview.postMessage({ type: 'processBusy', busy: true });
            void this.session.sendText(configPrompt).catch((err) => {
              const message = this.errMsg(err);
              this.postToWebview({ type: 'processBusy', busy: this.session.isTurnRunning() });
              this.postToWebview({ type: 'error', message: `Failed to send Codex message: ${message}` });
            });
          }
          break;

        case 'getGitPushSettings':
          this.sendGitPushSettings();
          break;

        case 'getWorktreeList':
          void this.handleGetWorktreeList();
          break;

        case 'createWorktree':
          void this.handleCreateWorktree(msg);
          break;

        case 'createWorktreeSession':
          void this.handleCreateWorktreeSession(msg.worktreePath);
          break;

        case 'removeWorktree':
          void this.handleRemoveWorktree(msg.worktreePath, !!msg.force);
          break;

        case 'openWorktreeFolder':
          void this.worktreeController?.openFolder(msg.worktreePath);
          break;

        case 'focusWorktreeSession':
          this.worktreeController?.focusSession(msg.tabId);
          break;

        case 'listBranches':
          void this.handleListBranches();
          break;

        case 'getMergePreview':
          void this.handleGetMergePreview(msg.sourcePath, msg.targetBranch);
          break;

        case 'commitWorktree':
          void this.handleCommitWorktree(msg.worktreePath, msg.message, msg.targetBranch);
          break;

        case 'performMerge':
          void this.handlePerformMerge(msg);
          break;

        case 'abortMerge':
          void this.handleAbortMerge(msg.targetPath, msg.squash);
          break;

        case 'completeMerge':
          void this.handleCompleteMerge(msg.targetPath, {
            squash: msg.squash,
            message: msg.message,
            preSha: msg.preSha,
          });
          break;

        case 'undoMerge':
          void this.handleUndoMerge(msg.targetPath, {
            mode: msg.mode,
            strategy: msg.strategy,
            newSha: msg.newSha,
            preSha: msg.preSha,
          });
          break;

        case 'openConflictFiles':
          void this.handleOpenConflictFiles(msg.targetPath, msg.files);
          break;

        case 'setCustomSnippet':
          vscode.workspace
            .getConfiguration('claudeMirror')
            .update('customSnippet.text', msg.text, true);
          this.webview.postMessage({ type: 'customSnippetSettings', text: msg.text });
          break;

        case 'getCustomSnippet':
          this.sendCustomSnippetSettings();
          break;

        case 'forkFromMessage':
          this.log(
            `Codex fork from message: sessionId=${msg.sessionId}, index=${msg.forkMessageIndex}, historyLen=${msg.messages?.length ?? 0}`
          );
          void vscode.commands.executeCommand(
            'claudeMirror.forkFromMessage',
            msg.sessionId,
            msg.forkMessageIndex,
            msg.promptText,
            msg.messages || []
          );
          break;

        case 'startBtwSession':
          this.log(`Starting Codex btw session with prompt: ${msg.promptText.slice(0, 60)}...`);
          this.session.startBtwSession?.(msg.promptText);
          break;

        case 'sendBtwMessage':
          this.log(`Sending Codex btw message: ${msg.text.slice(0, 60)}...`);
          this.session.sendBtwMessage?.(msg.text);
          break;

        case 'closeBtwSession':
          this.log('Closing Codex btw session.');
          this.session.closeBtwSession?.();
          break;

        case 'compact':
        case 'forkSession':
        case 'planApprovalResponse':
        case 'enhancePrompt':
          this.webview.postMessage({
            type: 'error',
            message: `${msg.type} is not supported in Codex MVP yet.`,
          });
          break;

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

        case 'editAndResend':
          this.clearScheduledPromptState(true);
          void (async () => {
            let textToSend = msg.text;
            if (this.secretProtectionService?.isEnabled() && this.secretProtectionService.getSettings().scanPrompts) {
              const broker = this.secretProtectionService.getBroker();
              if (broker) {
                const decision = await broker.scanPromptSubmission(msg.text);
                switch (decision.action) {
                  case 'block':
                  case 'require_approval':
                    this.log(`[SecretProtection] Edit-and-resend ${decision.action}: ${decision.reason}`);
                    this.webview.postMessage({
                      type: 'error',
                      message: `Secret protection blocked this prompt: ${decision.reason}`,
                    });
                    return;
                  case 'redact':
                    if (decision.redactedContent) { textToSend = decision.redactedContent; }
                    break;
                  case 'summarize_locally':
                    if (decision.safeSummary) {
                      textToSend = decision.safeSummary;
                    } else {
                      this.log(`[SecretProtection] Edit-and-resend blocked (no safe summary): ${decision.reason}`);
                      this.webview.postMessage({
                        type: 'error',
                        message: `Secret protection blocked this prompt: ${decision.reason}`,
                      });
                      return;
                    }
                    break;
                  case 'warn':
                    this.log(`[SecretProtection] Edit-and-resend warning: ${decision.reason}`);
                    break;
                }
              }
            }
            if (textToSend.trim()) {
              void this.promptHistoryStore.addPrompt(textToSend);
            }
            try {
              await this.session.clearSession();
              await this.session.sendText(textToSend);
            } catch (err) {
              this.webview.postMessage({ type: 'error', message: `Edit-and-resend failed: ${this.errMsg(err)}` });
            }
          })();
          break;

        case 'openFeedback':
          vscode.commands.executeCommand('claudeMirror.sendFeedback');
          break;

        case 'feedbackAction': {
          const action = msg.action;
          this.log(`Codex feedback action: ${action}`);
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

        case 'openPlanDocs':
          vscode.commands.executeCommand('claudeMirror.openPlanDocs');
          break;

        // ----- Bug Report (Codex) -----
        case 'bugReportInit': {
          this.log('[BugReport] Codex init requested');
          void (async () => {
            const apiKey = await this.getApiKey();
            this.bugReportService = new BugReportService(
              this.webview,
              this.log,
              this.extensionVersion,
              this.logDir,
              apiKey,
            );
            if (this.secretProtectionService) {
              this.bugReportService.setSecretProtectionService(this.secretProtectionService);
            }
            this.bugReportService.startAutoCollection(msg.context);
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
            this.bugReportService.getPreview();
          }
          break;
        case 'bugReportClose':
          if (this.bugReportService) {
            this.bugReportService.dispose();
            this.bugReportService = null;
          }
          break;

        case 'chatSearchProject':
          this.handleChatSearchProject(msg.query, msg.requestId);
          break;

        case 'chatSearchResumeSession':
          this.handleChatSearchResumeSession(msg.sessionId);
          break;

        // ----- Workstream Map -----
        case 'workstreamMapOpen':
          this.log('[WorkstreamMap][Codex] Map opened');
          if (this.workstreamManager) {
            const projectId = this.getWorkstreamProjectId();
            void this.workstreamManager.markMapOpened(projectId);
          }
          break;

        case 'workstreamMapRequestData': {
          this.log(`[WorkstreamMap][Codex] Data requested (workstreamManager=${!!this.workstreamManager})`);
          if (!this.workstreamManager) {
            this.log('[WorkstreamMap][Codex] workstreamManager is null - no data to send');
            break;
          }

          const projectId = this.getWorkstreamProjectId();
          const mapData = this.workstreamManager.getProjectMapState(projectId);
          if (mapData) {
            this.webview.postMessage({ type: 'workstreamMapData', data: mapData });
            const pm = this.workstreamManager.getPortfolioManager();
            if (pm) {
              this.log(`[WorkstreamPortfolio][Codex] Backfill publish for projectId="${projectId}", projectLabel="${mapData.projectLabel}"`);
              void pm.publishProjectSummary(projectId, mapData)
                .then(() => this.log('[WorkstreamPortfolio][Codex] Backfill publish succeeded'))
                .catch(err => this.log(`[WorkstreamPortfolio][Codex] Backfill publish failed: ${err}`));
            }
          }

          void this.workstreamManager.buildResumeState(projectId).then(resumeState => {
            if (resumeState) {
              this.webview.postMessage({ type: 'workstreamMapResumeState', resumeState });
            }
          });
          break;
        }

        case 'workstreamMapReclassify': {
          this.log(`[WorkstreamMap][Codex] Reclassify requested (force=${msg.force ?? false}) workstreamManager=${!!this.workstreamManager} analyticsStore=${!!this.projectAnalyticsStore}`);
          if (!this.workstreamManager) {
            this.webview.postMessage({ type: 'workstreamMapError', message: 'Workstream manager not available. Try reloading VS Code.' });
            break;
          }
          if (!this.projectAnalyticsStore) {
            this.webview.postMessage({ type: 'workstreamMapError', message: 'Analytics store not available.' });
            break;
          }

          const projectId = this.getWorkstreamProjectId();
          const allSummaries = this.projectAnalyticsStore.getSummaries();
          const openTabIds = new Set(this.openTabSessionIdsGetter?.() ?? []);
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
          const summaries = allSummaries.filter(s => {
            if (openTabIds.has(s.sessionId)) { return true; }
            const ts = s.endedAt ?? s.startedAt;
            return !!ts && new Date(ts).getTime() > threeDaysAgo;
          });
          this.log(`[WorkstreamMap][Codex] Scoped ${allSummaries.length} total summaries -> ${summaries.length} (openTabs=${openTabIds.size}, recentCutoff=3d)`);

          const metadataMap = new Map<string, import('../session/SessionStore').SessionMetadata>();
          if (this.sessionStore) {
            for (const session of this.sessionStore.getSessions()) {
              metadataMap.set(session.sessionId, session);
            }
          }

          this.webview.postMessage({ type: 'workstreamMapClassifying', progress: 0, phase: 'Starting classification...' });
          this.workstreamManager.onProgress((progress, phase) => {
            this.webview.postMessage({ type: 'workstreamMapClassifying', progress, phase });
          });
          void this.workstreamManager.classifyProject(projectId, summaries, metadataMap, { force: msg.force })
            .then(state => {
              this.log(`[WorkstreamMap][Codex] Classification complete: ${state.workstreams.length} workstreams, ${state.stations.length} stations`);
              this.webview.postMessage({ type: 'workstreamMapData', data: state });
            })
            .catch(err => {
              this.log(`[WorkstreamMap][Codex] Classification failed: ${err instanceof Error ? err.message : String(err)}`);
              this.webview.postMessage({ type: 'workstreamMapError', message: err instanceof Error ? err.message : String(err) });
            });
          break;
        }

        case 'workstreamMapApplyEdit': {
          this.log(`[WorkstreamMap][Codex] Apply edit: ${msg.edit.type}`);
          if (!this.workstreamManager) { break; }
          const projectId = this.getWorkstreamProjectId();
          void this.workstreamManager.applyUserEdit(projectId, msg.edit).then(state => {
            if (state) {
              this.webview.postMessage({ type: 'workstreamMapData', data: state });
            }
          });
          break;
        }

        case 'workstreamMapNaturalLanguageEdit': {
          this.log(`[WorkstreamMap][Codex] NL edit: "${msg.text.slice(0, 60)}..."`);
          if (!this.workstreamManager) { break; }
          const projectId = this.getWorkstreamProjectId();
          void this.workstreamManager.applyNaturalLanguageEdit(msg.text, msg.context, projectId)
            .then(result => {
              if (result) {
                this.webview.postMessage({ type: 'workstreamMapData', data: result.state });
              }
            })
            .catch(err => {
              this.log(`[WorkstreamMap][Codex] NL edit failed: ${err instanceof Error ? err.message : String(err)}`);
              this.webview.postMessage({ type: 'workstreamMapError', message: err instanceof Error ? err.message : String(err) });
            });
          break;
        }

        case 'workstreamMapOpenSession':
          this.log(`[WorkstreamMap][Codex] Open session: ${msg.sessionId}`);
          void vscode.commands.executeCommand('claudeMirror.resumeSession', msg.sessionId);
          break;

        case 'workstreamMapDismissResumeView':
          this.log('[WorkstreamMap][Codex] Resume view dismissed');
          break;

        case 'workstreamMapSaveSnapshot': {
          this.log('[WorkstreamMap][Codex] Save snapshot requested');
          if (!this.workstreamManager) { break; }
          const projectId = this.getWorkstreamProjectId();
          void this.workstreamManager.markMapOpened(projectId);
          break;
        }

        case 'workstreamMapImportExternalFolder': {
          void this.handleWorkstreamExternalFolderImport(msg.folderPath).catch(err => {
            const message = err instanceof Error ? err.message : String(err);
            this.log(`[WorkstreamMap][Codex] External folder import failed: ${message}`);
            this.webview.postMessage({ type: 'workstreamMapError', message });
          });
          break;
        }

        // ----- Workstream Portfolio -----
        case 'workstreamPortfolioRequestData': {
          this.log('[WorkstreamPortfolio][Codex] Data requested');
          const pm = this.workstreamManager?.getPortfolioManager();
          if (!pm) {
            this.log('[WorkstreamPortfolio][Codex] Portfolio manager not available');
            break;
          }
          void pm.getPortfolioState().then(portfolioState => {
            const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            this.log(`[WorkstreamPortfolio][Codex] Sending ${portfolioState.projects.length} projects. Names: [${portfolioState.projects.map(p => p.projectName).join(', ')}]. currentWorkspacePath="${currentWorkspacePath}"`);
            this.webview.postMessage({ type: 'workstreamPortfolioData', data: portfolioState, currentWorkspacePath });
          }).catch(err => {
            this.log(`[WorkstreamPortfolio][Codex] Failed to get portfolio: ${err instanceof Error ? err.message : String(err)}`);
          });
          break;
        }

        case 'workstreamPortfolioOpenProject': {
          const projectPath = msg.projectPath;
          this.log(`[WorkstreamPortfolio][Codex] Open project: ${projectPath}`);
          const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (currentWorkspace && this.sameWorkspacePath(projectPath, currentWorkspace)) {
            this.webview.postMessage({ type: 'workstreamPortfolioNavigateToProject' });
          } else {
            void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
          }
          break;
        }

        default:
          // Keep Codex handler permissive; ignore unrelated UI messages in Stage 2.
          break;
      }
    });
  }

  private bindDemuxEvents(): void {
    this.demux.on('threadStarted', (data: { threadId: string }) => {
      this.log(`Codex thread.started: ${data.threadId}`);
      this.postToWebview({
        type: 'sessionStarted',
        sessionId: data.threadId,
        model: this.getConfiguredCodexModelLabel(),
        provider: 'codex',
      });
    });

    this.demux.on('turnStarted', () => {
      this.currentTurnStartedAt = Date.now();
      this.currentTurnCommands = [];
      this.currentTurnHadAgentMessage = false;
      this.log('Codex turn.started');
      this.postToWebview({ type: 'processBusy', busy: true });
    });

    this.demux.on('agentMessage', (data: { id: string; text: string }) => {
      this.currentTurnHadAgentMessage = true;
      // Codex item ids (e.g. item_1) can repeat across turns, so do not use them
      // as UI message ids or replies will overwrite earlier messages in the store.
      const messageId = this.nextMessageId();
      this.lastMessageId = messageId;
      const model = this.getConfiguredCodexModelLabel();
      const rawMessageId = data.id || '(none)';
      this.log(`Codex agent_message: rawId=${rawMessageId} uiId=${messageId} len=${data.text.length}`);
      this.postToWebview({ type: 'messageStart', messageId, model });
      // Codex exec emits complete agent messages (not text deltas). Synthesize a single
      // streamingText block so the existing webview finalize path persists the message.
      this.postToWebview({
        type: 'streamingText',
        messageId,
        blockIndex: 0,
        text: data.text,
      });
      this.postToWebview({
        type: 'assistantMessage',
        messageId,
        content: [{ type: 'text', text: data.text } as ContentBlock],
        model,
      });
      this.postToWebview({ type: 'messageStop' });
      if (data.text.trim()) {
        this.achievementService.onAssistantText(this.tabId, data.text);
      }
    });

    this.demux.on('commandExecutionStart', (data: { command: string }) => {
      this.log(`Codex command start: ${data.command}`);
    });

    this.demux.on('commandExecutionComplete', (data: { command: string; exitCode: number | null; aggregatedOutput: string }) => {
      this.log(`Codex command done: exit=${data.exitCode} cmd=${data.command}`);
      const command = data.command.trim();
      if (command) {
        this.currentTurnCommands.push(command);
      }
      if (isExpectedNonFatalCommandExit(command || data.command, data.exitCode)) {
        this.log(`Codex command non-fatal exit ignored: exit=${data.exitCode} cmd=${command || data.command}`);
      } else if (data.exitCode !== null && data.exitCode !== 0) {
        this.postToWebview({
          type: 'error',
          message: `Command failed (exit ${data.exitCode}): ${command || data.command}`,
        });
      }
      void data.aggregatedOutput;
    });

    this.demux.on('turnCompleted', (data: { usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } }) => {
      const durationMs = this.currentTurnStartedAt ? Math.max(0, Date.now() - this.currentTurnStartedAt) : 0;
      const hasCommands = this.currentTurnCommands.length > 0;
      const category = codexTurnCategory(hasCommands);
      const toolNames = hasCommands ? ['Bash'] : [];
      if (!this.currentTurnHadAgentMessage) {
        this.log(`Codex turn.completed without agent_message (tokens out=${data.usage.outputTokens})`);
        this.postToWebview({
          type: 'error',
          message: 'Codex completed the turn but no assistant message was received. Check Codex logs/JSON events.',
        });
      }
      const turn: TurnRecord = {
        turnIndex: this.turnIndex++,
        toolNames,
        toolCount: toolNames.length,
        durationMs,
        costUsd: 0,
        totalCostUsd: 0,
        isError: false,
        category,
        timestamp: Date.now(),
        messageId: this.lastMessageId,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
        cacheReadTokens: data.usage.cachedInputTokens,
        cacheCreationTokens: 0,
        bashCommands: [...this.currentTurnCommands],
      };

      this.turnRecords.push(turn);
      this.postToWebview({
        type: 'costUpdate',
        costUsd: 0,
        totalCostUsd: 0,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
      });
      this.postToWebview({ type: 'turnComplete', turn });
      this.postToWebview({ type: 'processBusy', busy: false });
      this.currentTurnCommands = [];
      this.currentTurnStartedAt = 0;
      this.currentTurnHadAgentMessage = false;
    });

    this.demux.on('error', (data: { message: string }) => {
      this.log(`Codex demux error: ${data.message}`);
      this.postToWebview({ type: 'error', message: data.message });
      this.postToWebview({ type: 'processBusy', busy: false });
    });

    this.demux.on('reasoning', (data: { text: string }) => {
      if (data.text) {
        this.log(`Codex reasoning (hidden): "${data.text.slice(0, 80)}"`);
      }
    });

    this.demux.on('unknownItem', (data: { phase: string; item: { type?: string } }) => {
      this.log(`Codex unknown item (${data.phase}): ${data.item?.type || 'unknown'}`);
    });
  }

  private watchConfigChanges(): void {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeMirror.chatFontSize') || e.affectsConfiguration('claudeMirror.chatFontFamily')) {
        this.sendTextSettings();
      }
      if (e.affectsConfiguration('claudeMirror.typingTheme')) {
        this.sendTypingThemeSetting();
      }
      if (e.affectsConfiguration('claudeMirror.provider')) {
        this.log('Configuration changed: claudeMirror.provider (Codex handler)');
        this.sendProviderSetting();
      }
      if (e.affectsConfiguration('claudeMirror.permissionMode')) {
        this.sendPermissionModeSetting();
      }
      if (e.affectsConfiguration('claudeMirror.gitPush')) {
        this.sendGitPushSettings();
      }
      if (e.affectsConfiguration('claudeMirror.customSnippet')) {
        this.sendCustomSnippetSettings();
      }
      if (e.affectsConfiguration('claudeMirror.codex.model')) {
        this.sendCodexModelSetting();
      }
      if (e.affectsConfiguration('claudeMirror.codex.reasoningEffort')) {
        this.sendCodexReasoningEffortSetting();
      }
      if (e.affectsConfiguration('claudeMirror.codex.serviceTier')) {
        this.sendCodexServiceTierSetting();
      }
      if (e.affectsConfiguration('claudeMirror.tabs.layout')) {
        this.sendTabLayoutSetting();
      }
      if (e.affectsConfiguration('claudeMirror.secretProtection')) {
        void this.sendSecretProtectionStatus();
      }
    });
  }

  private sendInitialSettings(): void {
    this.sendTextSettings();
    this.sendTypingThemeSetting();
    this.sendProviderSetting();
    this.sendProviderCapabilities();
    this.sendPermissionModeSetting();
    this.sendGitPushSettings();
    this.sendCustomSnippetSettings();
    this.sendCodexModelSetting();
    this.sendCodexModelOptions();
    this.sendCodexReasoningEffortSetting();
    this.sendCodexServiceTierSetting();
    this.sendTabLayoutSetting();
    this.postScheduledMessageState();
    void this.sendSecretProtectionStatus();
    void this.sendApiKeySetting();
  }

  private sendTabLayoutSetting(): void {
    const layout = vscode.workspace
      .getConfiguration('claudeMirror.tabs')
      .get<'horizontal' | 'vertical'>('layout', 'horizontal');
    this.log(`Sending tab layout setting (Codex handler): layout="${layout}"`);
    this.webview.postMessage({ type: 'tabLayoutSetting', layout });
  }

  private sendTextSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    this.webview.postMessage({
      type: 'textSettings',
      fontSize: config.get<number>('chatFontSize', 14),
      fontFamily: config.get<string>('chatFontFamily', ''),
    });
  }

  private sendTypingThemeSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    this.webview.postMessage({
      type: 'typingThemeSetting',
      theme: config.get<TypingTheme>('typingTheme', 'zen'),
    });
  }

  private sendProviderSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const provider = config.get<ProviderId>('provider', 'claude');
    this.log(`Sending provider setting (Codex handler): "${provider}"`);
    this.webview.postMessage({
      type: 'providerSetting',
      provider,
    });
  }

  private sendProviderCapabilities(): void {
    this.webview.postMessage({
      type: 'providerCapabilities',
      capabilities: CODEX_PROVIDER_CAPABILITIES,
    });
  }

  private sendPermissionModeSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const mode = config.get<'full-access' | 'supervised'>('permissionMode', 'full-access');
    this.webview.postMessage({
      type: 'permissionModeSetting',
      mode,
    });
  }

  private sendGitPushSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    this.webview.postMessage({
      type: 'gitPushSettings',
      enabled: config.get<boolean>('gitPush.enabled', true),
      scriptPath: config.get<string>('gitPush.scriptPath', 'scripts/git-push.ps1'),
      commitMessageTemplate: config.get<string>('gitPush.commitMessageTemplate', '{sessionName}'),
    });
  }

  private sendCustomSnippetSettings(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const text = config.get<string>('customSnippet.text', '');
    this.log(`Sending custom snippet settings: length=${text.length}`);
    this.webview.postMessage({ type: 'customSnippetSettings', text });
  }

  private async sendSecretProtectionStatus(): Promise<void> {
    const service = this.secretProtectionService;
    if (!service) {
      const settings = vscode.workspace.getConfiguration('claudeMirror.secretProtection');
      this.webview.postMessage({
        type: 'secretProtectionStatus',
        enabled: false,
        settings: {
          enabled: settings.get<boolean>('enabled', false),
          mode: settings.get<any>('mode', 'balanced'),
          blockProtectedPaths: settings.get<boolean>('blockProtectedPaths', true),
          scanPrompts: settings.get<boolean>('scanPrompts', true),
          scanTerminalOutput: settings.get<boolean>('scanTerminalOutput', true),
          scanGitPublication: settings.get<boolean>('scanGitPublication', true),
          scanMcp: settings.get<boolean>('scanMcp', true),
          requireBrowserCaptureApproval: settings.get<boolean>('requireBrowserCaptureApproval', true),
          exceptionMaxMinutes: settings.get<number>('exceptionMaxMinutes', 30),
          auditRetentionDays: settings.get<number>('auditRetentionDays', 90),
          enableEntropyScanner: settings.get<boolean>('enableEntropyScanner', false),
        },
        auditCount: 0,
        lastEvent: null,
      } as any);
      return;
    }

    try {
      const events = await service.readAuditEvents(undefined, 1);
      const report = await service.getComplianceReport();
      this.webview.postMessage({
        type: 'secretProtectionStatus',
        enabled: service.isEnabled(),
        settings: service.getSettings(),
        auditCount: report.stats.totalEvents,
        lastEvent: events[0] ?? null,
      });
    } catch (err) {
      this.webview.postMessage({
        type: 'secretProtectionError',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSecretProtectionSetSetting(key: string, value: unknown): Promise<void> {
    const allowed = new Set([
      'enabled',
      'mode',
      'blockProtectedPaths',
      'scanPrompts',
      'scanTerminalOutput',
      'scanGitPublication',
      'scanMcp',
      'requireBrowserCaptureApproval',
      'exceptionMaxMinutes',
      'auditRetentionDays',
      'enableEntropyScanner',
    ]);
    if (!allowed.has(key)) {
      this.webview.postMessage({ type: 'secretProtectionError', error: `Unknown Secret Protection setting: ${key}` });
      return;
    }
    try {
      if (this.secretProtectionService) {
        await this.secretProtectionService.updateSetting(key as any, value as any);
      } else {
        await vscode.workspace
          .getConfiguration('claudeMirror.secretProtection')
          .update(key, value, vscode.ConfigurationTarget.Global);
      }
      await this.sendSecretProtectionStatus();
    } catch (err) {
      this.webview.postMessage({
        type: 'secretProtectionError',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSecretProtectionGetAuditEvents(
    filter?: import('../../shared/audit/AuditStore').AuditEventFilter,
    limit?: number,
  ): Promise<void> {
    if (!this.secretProtectionService) {
      this.webview.postMessage({ type: 'secretProtectionAuditEvents', events: [] });
      return;
    }
    try {
      const events = await this.secretProtectionService.readAuditEvents(filter, limit ?? 100);
      this.webview.postMessage({ type: 'secretProtectionAuditEvents', events });
    } catch (err) {
      this.webview.postMessage({
        type: 'secretProtectionError',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSecretProtectionGetComplianceReport(
    filter?: import('../../shared/audit/AuditStore').AuditEventFilter,
  ): Promise<void> {
    if (!this.secretProtectionService) {
      this.webview.postMessage({
        type: 'secretProtectionError',
        error: 'Secret Protection service is not initialized.',
      });
      return;
    }
    try {
      const report = await this.secretProtectionService.getComplianceReport(filter);
      this.webview.postMessage({ type: 'secretProtectionComplianceReport', report });
    } catch (err) {
      this.webview.postMessage({
        type: 'secretProtectionError',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendCodexModelSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    this.webview.postMessage({
      type: 'modelSetting',
      model: config.get<string>('codex.model', ''),
    });
  }

  private sendCodexModelOptions(): void {
    this.webview.postMessage({
      type: 'codexModelOptions',
      options: this.readCodexModelOptions(),
    });
  }

  private sendCodexReasoningEffortSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const effort = config.get<CodexReasoningEffort>('codex.reasoningEffort', '');
    this.webview.postMessage({
      type: 'codexReasoningEffortSetting',
      effort,
    });
  }

  private sendCodexServiceTierSetting(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const serviceTier = config.get<CodexServiceTier>('codex.serviceTier', '');
    this.webview.postMessage({
      type: 'codexServiceTierSetting',
      serviceTier,
    });
  }

  private readCodexModelOptions(): CodexModelOption[] {
    try {
      const modelsCachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
      if (!fs.existsSync(modelsCachePath)) {
        this.log(`Codex models cache not found: ${modelsCachePath}`);
        return [];
      }

      const parsed = JSON.parse(fs.readFileSync(modelsCachePath, 'utf8')) as {
        models?: Array<Record<string, unknown>>;
      };
      const models = Array.isArray(parsed?.models) ? parsed.models : [];
      const seen = new Set<string>();

      const options = models
        .filter((model) => {
          const slug = typeof model.slug === 'string' ? model.slug : '';
          const displayName = typeof model.display_name === 'string' ? model.display_name : '';
          const haystack = `${slug} ${displayName}`.toLowerCase();
          const isVisible = model.visibility === undefined || model.visibility === 'list';
          return isVisible && (haystack.includes('gpt') || haystack.includes('codex'));
        })
        .sort((a, b) => {
          const pa = typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER;
          const pb = typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          const sa = typeof a.slug === 'string' ? a.slug : '';
          const sb = typeof b.slug === 'string' ? b.slug : '';
          return sa.localeCompare(sb);
        })
        .map((model) => {
          const slug = typeof model.slug === 'string' ? model.slug.trim() : '';
          if (!slug || seen.has(slug)) return null;
          seen.add(slug);
          const supportedReasoningEfforts = Array.isArray(model.supported_reasoning_levels)
            ? model.supported_reasoning_levels
                .map((entry) => {
                  if (!entry || typeof entry !== 'object') return null;
                  const effort = (entry as { effort?: unknown }).effort;
                  return typeof effort === 'string' ? (effort as CodexReasoningEffort) : null;
                })
                .filter((effort): effort is CodexReasoningEffort => !!effort)
            : undefined;
          return {
            label: formatCodexModelLabel(slug),
            value: slug,
            supportedReasoningEfforts: supportedReasoningEfforts?.length ? supportedReasoningEfforts : undefined,
          } as CodexModelOption;
        })
        .filter((opt): opt is CodexModelOption => !!opt);

      this.log(`Loaded ${options.length} Codex model options from models_cache.json`);
      return options;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to read Codex model options: ${message}`);
      return [];
    }
  }

  private handleGetProjectAnalytics(): void {
    if (!this.projectAnalyticsStore) {
      this.webview.postMessage({ type: 'projectAnalyticsData', sessions: [] });
      return;
    }
    void this.projectAnalyticsStore
      .getSummariesAfterPendingWrites()
      .then((sessions) => {
        this.webview.postMessage({ type: 'projectAnalyticsData', sessions });
      })
      .catch(() => {
        this.webview.postMessage({ type: 'projectAnalyticsData', sessions: [] });
      });
  }

  private getWorkstreamProjectId(): string {
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return wsFolder ?? 'default';
  }

  private async promptForExternalWorkFolderPath(requestedPath?: string): Promise<string | undefined> {
    const initial = requestedPath?.trim();
    if (initial) {
      return this.normalizeUserEnteredPath(initial);
    }

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const value = await vscode.window.showInputBox({
      prompt: 'Enter a folder path to import as an external workstream',
      placeHolder: workspacePath ? path.join(workspacePath, 'docs') : 'C:\\path\\to\\external-work-folder',
      ignoreFocusOut: true,
      validateInput: (input) => {
        const normalized = this.normalizeUserEnteredPath(input);
        if (!normalized) { return 'Folder path is required'; }
        if (!fs.existsSync(normalized)) { return 'Folder does not exist'; }
        try {
          if (!fs.statSync(normalized).isDirectory()) { return 'Path must be a folder'; }
        } catch {
          return 'Unable to read folder';
        }
        return undefined;
      },
    });

    return value ? this.normalizeUserEnteredPath(value) : undefined;
  }

  private normalizeUserEnteredPath(value: string): string {
    let normalized = value.trim();
    if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
      normalized = normalized.slice(1, -1);
    }
    if (normalized === '~') {
      normalized = process.env.USERPROFILE || process.env.HOME || normalized;
    } else if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
      const home = process.env.USERPROFILE || process.env.HOME;
      if (home) {
        normalized = path.join(home, normalized.slice(2));
      }
    }
    return path.resolve(normalized);
  }

  private async handleWorkstreamExternalFolderImport(requestedPath?: string): Promise<void> {
    this.log(`[WorkstreamMap][Codex] External folder import requested path="${requestedPath ?? ''}" workstreamManager=${!!this.workstreamManager}`);
    if (!this.workstreamManager) {
      this.webview.postMessage({ type: 'workstreamMapError', message: 'Workstream manager not available. Try reloading VS Code.' });
      return;
    }

    const folderPath = await this.promptForExternalWorkFolderPath(requestedPath);
    if (!folderPath) {
      this.log('[WorkstreamMap][Codex] External folder import canceled');
      return;
    }

    const projectId = this.getWorkstreamProjectId();
    this.webview.postMessage({ type: 'workstreamMapClassifying', progress: 0, phase: 'Starting external folder import...' });
    this.workstreamManager.onProgress((progress, phase) => {
      this.webview.postMessage({ type: 'workstreamMapClassifying', progress, phase });
    });

    const state = await this.workstreamManager.ingestExternalFolder(projectId, folderPath);
    this.webview.postMessage({ type: 'workstreamMapData', data: state });
    const pm = this.workstreamManager.getPortfolioManager();
    if (pm) {
      const portfolioState = await pm.getPortfolioState();
      const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      this.webview.postMessage({ type: 'workstreamPortfolioData', data: portfolioState, currentWorkspacePath });
    }
    void vscode.window.showInformationMessage(`Imported external work folder: ${path.basename(folderPath)}`);
  }

  private sameWorkspacePath(a: string, b: string): boolean {
    return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
  }

  private parseOpenFileTarget(rawPath: string): { filePath: string; line?: number; col?: number } | null {
    let value = rawPath.trim();
    if (!value) return null;

    if (/^file:\/\//i.test(value)) {
      try {
        value = vscode.Uri.parse(value).fsPath;
      } catch {
        // Keep original value if URI parsing fails.
      }
    }

    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      try {
        value = decodeURIComponent(value);
      } catch {
        // Keep original value if decoding fails.
      }
    }

    const stripPairs: Array<[string, string]> = [
      ['`', '`'],
      ['"', '"'],
      ["'", "'"],
      ['<', '>'],
      ['(', ')'],
      ['[', ']'],
    ];
    let changed = true;
    while (changed) {
      changed = false;
      const trimmed = value.trim();
      for (const [left, right] of stripPairs) {
        if (trimmed.startsWith(left) && trimmed.endsWith(right) && trimmed.length >= left.length + right.length) {
          value = trimmed.slice(left.length, trimmed.length - right.length);
          changed = true;
          break;
        }
      }
    }

    value = value.trim().replace(/^[,:;]+(?=[A-Za-z0-9_./\\-])/, '');
    value = value.replace(/[.,;!?]+$/, '').trim();
    if (!value) return null;

    let line: number | undefined;
    let col: number | undefined;

    const hashLineMatch = value.match(/#L(\d+)(?:C(\d+))?(?:-L\d+(?:C\d+)?)?$/i);
    if (hashLineMatch) {
      line = parseInt(hashLineMatch[1], 10);
      col = hashLineMatch[2] ? parseInt(hashLineMatch[2], 10) : undefined;
      value = value.slice(0, hashLineMatch.index).trim();
    }

    const lineColMatch = value.match(/:(\d+)(?::(\d+))?$/);
    if (lineColMatch) {
      line = parseInt(lineColMatch[1], 10);
      col = lineColMatch[2] ? parseInt(lineColMatch[2], 10) : col;
      value = value.slice(0, lineColMatch.index).trim();
    }

    value = value.replace(/^:+/, '').trim();
    if (!value) return null;

    return { filePath: value, line, col };
  }

  private async resolveOpenFilePath(filePath: string): Promise<string> {
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/');
    if (isAbsolute && fs.existsSync(filePath)) {
      return filePath;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return filePath;
    }

    const directCandidates = [path.resolve(workspaceRoot, filePath)];
    if (/\.(xcodeproj|xcworkspace)$/i.test(workspaceRoot)) {
      directCandidates.push(path.resolve(workspaceRoot, '..', filePath));
    }
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const basename = path.basename(filePath);
    const normalizedSuffix = filePath.replace(/\\/g, '/').toLowerCase();
    const searchBases = new Set<string>([workspaceRoot]);
    if (/\.(xcodeproj|xcworkspace)$/i.test(workspaceRoot)) {
      searchBases.add(path.resolve(workspaceRoot, '..'));
    }

    for (const base of Array.from(searchBases)) {
      try {
        const found = await vscode.workspace.findFiles(
          new vscode.RelativePattern(base, `**/${basename}`),
          '**/{.git,node_modules,dist,build,DerivedData}/**',
          25
        );
        if (found.length > 0) {
          const suffixMatch = found.find((uri) =>
            uri.fsPath.replace(/\\/g, '/').toLowerCase().endsWith(normalizedSuffix)
          );
          return (suffixMatch ?? found[0]).fsPath;
        }
      } catch (err) {
        this.log(`File lookup fallback failed under "${base}": ${this.errMsg(err)}`);
      }
    }

    return directCandidates[0];
  }

  private async handleOpenFile(rawPath: string): Promise<void> {
    const parsed = this.parseOpenFileTarget(rawPath);
    if (!parsed) {
      this.log(`Codex openFile parse failed: "${rawPath}"`);
      return;
    }

    const resolvedPath = await this.resolveOpenFilePath(parsed.filePath);
    const uri = vscode.Uri.file(resolvedPath);
    const showOptions: vscode.TextDocumentShowOptions = {};
    if (parsed.line !== undefined) {
      const line = Math.max(1, parsed.line);
      const col = Math.max(1, parsed.col ?? 1);
      const pos = new vscode.Position(line - 1, col - 1);
      showOptions.selection = new vscode.Range(pos, pos);
    }

    const layout = vscode.workspace.getConfiguration('claudeMirror.tabs').get<string>('layout', 'horizontal');
    if (layout === 'vertical') {
      showOptions.viewColumn = vscode.ViewColumn.Beside;
      showOptions.preserveFocus = true;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, showOptions);
      this.log(`Opened file (Codex handler): ${resolvedPath}${parsed.line ? `:${parsed.line}` : ''}`);
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri,
        layout === 'vertical' ? vscode.ViewColumn.Beside : undefined);
      this.log(`Opened file (Codex non-text fallback): ${resolvedPath}`);
    }
  }

  private handleOpenUrl(url: string): void {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return;
    }
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private async handlePickCodexCliPath(): Promise<void> {
    const filters =
      process.platform === 'win32'
        ? { Executables: ['exe', 'cmd', 'bat', 'ps1'], All: ['*'] }
        : undefined;
    const defaultUri = this.getLikelyCodexCliDirectoryUri();

    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select Codex CLI',
      title: 'Select codex CLI executable',
      filters,
      defaultUri,
    });

    const uri = picked?.[0];
    if (!uri) {
      return;
    }

    const selectedPath = uri.fsPath;
    await vscode.workspace.getConfiguration('claudeMirror').update('codex.cliPath', selectedPath, true);
    void vscode.window.showInformationMessage(
      `Saved Codex CLI path: ${selectedPath}. Retry your message, and if needed run "codex login".`
    );
  }

  private async handleCodexCliPathHelpAndOpenSettings(query: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'What to put in "Codex CLI Path": use "codex" only if it works in a new terminal. Otherwise use the full path to codex.exe/codex.cmd. You can also use Auto-setup to install and configure it for you.',
      'Auto-setup (Install + Configure)',
      'Auto-detect Now',
      'Browse for File',
      'Open Setting'
    );

    if (choice === 'Auto-setup (Install + Configure)') {
      await this.handleAutoSetupCodexCli();
      return;
    }
    if (choice === 'Auto-detect Now') {
      await this.handleAutoDetectCodexCliPath();
      return;
    }
    if (choice === 'Browse for File') {
      await this.handlePickCodexCliPath();
      return;
    }
    if (choice === 'Open Setting') {
      await vscode.commands.executeCommand('workbench.action.openSettings', query);
      return;
    }
    await vscode.commands.executeCommand('workbench.action.openSettings', query);
  }

  private async handleAutoDetectCodexCliPath(): Promise<void> {
    const candidates = await detectWorkingCodexCli();
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        'Could not find a working Codex CLI. Try Auto-setup (install + configure), or use Browse for codex executable.'
      );
      return;
    }

    let selected = pickPreferredCandidate(candidates);
    if (candidates.length > 1) {
      const picked = await vscode.window.showQuickPick(
        candidates.map((c) => ({
          label: path.basename(c.path),
          description: c.path,
          detail: `${c.source}${c.version ? ` | ${c.version}` : ''}`,
        })),
        {
          placeHolder: 'Select the Codex CLI executable to use in ClaUi',
          title: 'Multiple Codex CLI candidates found',
        }
      );
      if (!picked?.description) {
        return;
      }
      const chosen = candidates.find((c) => c.path === picked.description);
      if (chosen) {
        selected = chosen;
      }
    }

    await vscode.workspace.getConfiguration('claudeMirror').update('codex.cliPath', selected.path, true);
    void vscode.window.showInformationMessage(
      `Codex CLI path set to: ${selected.path}${selected.version ? ` (${selected.version})` : ''}. Retry your message, and if needed run "codex login".`
    );
  }

  private async handleAutoSetupCodexCli(): Promise<void> {
    if (this.autoSetupCodexCliInProgress) {
      void vscode.window.showInformationMessage('Codex auto-setup is already running.');
      return;
    }
    this.autoSetupCodexCliInProgress = true;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ClaUi: Auto-setup Codex CLI',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Looking for an existing Codex CLI...' });
          let candidates = await detectWorkingCodexCli();

          if (candidates.length === 0) {
            progress.report({ message: 'No Codex CLI found. Checking npm...' });
            const npmCheck = await this.execShellCommand('npm --version', 10000);
            if (!npmCheck.ok) {
              throw new Error(
                `npm was not found. Install Node.js/npm first, then retry. (${this.compactExecError(npmCheck)})`
              );
            }

            progress.report({ message: 'Installing Codex CLI with npm (this may take a minute)...' });
            const install = await this.execShellCommand('npm install -g @openai/codex', 8 * 60_000);
            if (!install.ok) {
              throw new Error(
                `Automatic install failed: ${this.compactExecError(install)}. You can use "Open Install Guide" and install manually.`
              );
            }

            progress.report({ message: 'Detecting installed Codex CLI...' });
            candidates = await detectWorkingCodexCli({ includeNpmPrefixFallback: true });
          }

          if (candidates.length === 0) {
            throw new Error(
              'Codex CLI installation/detection completed but no working executable was found. Use "Browse for codex executable" or paste the full path into claudeMirror.codex.cliPath.'
            );
          }

          const selected = pickPreferredCandidate(candidates);
          await vscode.workspace.getConfiguration('claudeMirror').update('codex.cliPath', selected.path, true);

          // Clear the setup error banner on success.
          this.webview.postMessage({ type: 'error', message: '' });

          progress.report({ message: 'Opening login terminal...' });
          this.session.openCodexLoginTerminal();

          void vscode.window.showInformationMessage(
            `Codex CLI is ready${selected.version ? ` (${selected.version})` : ''}. Set path: ${selected.path}. A login terminal was opened.`
          );
        }
      );
    } catch (err) {
      const message = this.errMsg(err);
      this.webview.postMessage({ type: 'error', message: `Codex CLI not found. Auto-setup failed: ${message}` });
      void vscode.window.showErrorMessage(
        `Codex auto-setup failed: ${message}`,
        'Open Install Guide',
        'Browse for File'
      ).then((choice) => {
        if (choice === 'Open Install Guide') {
          this.handleOpenUrl('https://github.com/openai/codex');
        } else if (choice === 'Browse for File') {
          void this.handlePickCodexCliPath();
        }
      });
    } finally {
      this.autoSetupCodexCliInProgress = false;
    }
  }

  private execShellCommand(command: string, timeoutMs = 5000): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      exec(
        command,
        {
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const rawCode = (err as { code?: unknown } | null)?.code;
          resolve({
            ok: !err,
            code: typeof rawCode === 'number' ? rawCode : (err ? null : 0),
            stdout: (stdout || '').trim(),
            stderr: (stderr || '').trim() || (err ? err.message : ''),
          });
        }
      );
    });
  }

  private compactExecError(result: { code: number | null; stderr: string; stdout: string }): string {
    const source = (result.stderr || result.stdout || '').trim();
    const firstLine = source.split(/\r?\n/).find((s) => s.trim())?.trim() || 'unknown error';
    return `exit=${result.code ?? 'unknown'} | ${firstLine}`;
  }

  private getLikelyCodexCliDirectoryUri(): vscode.Uri | undefined {
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      const appDataNpm = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '';
      const localPrograms = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '';
      const programFiles = process.env.ProgramFiles || '';
      const userProfile = process.env.USERPROFILE || os.homedir();
      candidates.push(appDataNpm, localPrograms, programFiles, userProfile);
    } else {
      candidates.push('/usr/local/bin', '/opt/homebrew/bin', os.homedir());
    }

    const existing = candidates.find((dir) => !!dir && fs.existsSync(dir));
    return existing ? vscode.Uri.file(existing) : undefined;
  }

  private async handleGitPush(): Promise<void> {
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

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.webview.postMessage({
        type: 'gitPushResult',
        success: false,
        output: 'No workspace folder open.',
      });
      return;
    }

    const scriptPath = config.get<string>('gitPush.scriptPath', 'scripts/git-push.ps1');
    const template = config.get<string>('gitPush.commitMessageTemplate', '{sessionName}');
    const commitMessage = template.replace('{sessionName}', 'Codex session');
    const fullScriptPath = path.resolve(workspaceRoot, scriptPath);

    // DLP: scan tracked changes + untracked sensitive files before pushing
    if (this.secretProtectionService?.isEnabled() && this.secretProtectionService.getSettings().scanGitPublication) {
      const broker = this.secretProtectionService.getBroker();
      if (broker) {
        try {
          const execGit = (cmd: string): Promise<string> => new Promise((resolve, reject) => {
            exec(cmd, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 }, (err, stdout) => {
              if (err) reject(err); else resolve(stdout);
            });
          });

          const [diff, statusOutput] = await Promise.all([
            execGit('git diff HEAD'),
            execGit('git status --porcelain -uall'),
          ]);

          // Build synthetic diff for untracked files with content
          const untrackedLines = statusOutput.split('\n').filter(l => l.startsWith('?? '));
          let untrackedDiff = '';
          const fsModule = require('fs') as typeof import('fs');
          const pathModule = require('path') as typeof import('path');
          for (const line of untrackedLines) {
            const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
            untrackedDiff += `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n`;
            try {
              const absPath = pathModule.join(workspaceRoot, filePath);
              const stat = fsModule.statSync(absPath);
              if (stat.isFile() && stat.size < 256 * 1024) {
                const fileContent = fsModule.readFileSync(absPath, 'utf8');
                const contentLines = fileContent.split('\n').slice(0, 200);
                untrackedDiff += `@@ -0,0 +1,${contentLines.length} @@\n` + contentLines.map((l: string) => '+' + l).join('\n') + '\n';
              }
            } catch {
              // Can't read file content -- path-only detection still works
            }
          }

          const fullDiff = diff + (untrackedDiff ? '\n' + untrackedDiff : '');
          if (fullDiff.trim()) {
            const decision = await broker.scanGitPublication(fullDiff, commitMessage);
            if (decision.action === 'block' || decision.action === 'require_approval') {
              this.log(`[SecretProtection] Git push blocked (Codex): ${decision.reason}`);
              this.webview.postMessage({
                type: 'gitPushResult',
                success: false,
                output: `Secret protection blocked this push: ${decision.reason}`,
              });
              return;
            }
          }
        } catch (dlpErr) {
          this.log(`[SecretProtection] Git diff scan error (fail-closed, Codex): ${dlpErr}`);
          this.webview.postMessage({
            type: 'gitPushResult',
            success: false,
            output: 'Secret protection scan failed (fail-closed). Please try again.',
          });
          return;
        }
      }
    }

    this.log(`Git push (Codex): running "${fullScriptPath}" with message "${commitMessage}"`);
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fullScriptPath, '-Message', commitMessage],
      { cwd: workspaceRoot, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          this.log(`Git push failed (Codex): ${error.message}`);
          this.webview.postMessage({
            type: 'gitPushResult',
            success: false,
            output: stderr || error.message,
          });
          return;
        }

        this.log('Git push succeeded (Codex)');
        this.webview.postMessage({
          type: 'gitPushResult',
          success: true,
          output: stdout,
        });
      }
    );
  }

  private nextMessageId(): string {
    this.messageCounter += 1;
    return `codex-msg-${Date.now()}-${this.messageCounter}`;
  }

  private getConfiguredCodexModelLabel(): string {
    return this.session.getCurrentModel() || 'Codex (default)';
  }

  private async handleChatSearchProject(query: string, requestId: number): Promise<void> {
    if (!this.chatSearchService) {
      const { ChatSearchService } = require('../session/ChatSearchService');
      this.chatSearchService = new ChatSearchService(this.log);
    }

    const result = await this.chatSearchService!.searchProject(query, requestId);
    if (result) {
      this.webview.postMessage({
        type: 'chatSearchProjectResults',
        requestId,
        results: result.results,
        totalMatches: result.totalMatches,
      });
    }
  }

  private handleChatSearchResumeSession(sessionId: string): void {
    this.log(`[ChatSearch] Resuming session: ${sessionId}`);
    vscode.commands.executeCommand('claudeMirror.resumeSession', sessionId);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
