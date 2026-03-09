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
  CodexModelOption,
  ExtensionToWebviewMessage,
  ProviderCapabilities,
  ProviderId,
  TurnRecord,
  TurnCategory,
  TypingTheme,
  WebviewToExtensionMessage,
} from '../types/webview-messages';

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
  private extensionVersion = '0.0.0';
  private logDir = '';
  /** Dedup: last userMessage text posted to webview, with timestamp. */
  private lastPostedUserMsg: { text: string; time: number } | null = null;
  /** One-time handoff context staged by provider switch. Injected on first user turn only. */
  private pendingHandoffPrompt: string | null = null;

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
  private postUserMessage(content: ContentBlock[], isOptimistic = false): void {
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
    this.postToWebview({ type: 'userMessage', content });
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
          this.clearPendingHandoffPrompt();
          void this.session.startSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to start Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'resumeSession':
          this.clearPendingHandoffPrompt();
          void this.session.startSession({ resume: msg.sessionId }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to resume Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'stopSession':
          this.clearPendingHandoffPrompt();
          this.session.stopSession();
          break;

        case 'clearSession':
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
          this.achievementService.onUserPrompt(this.tabId, msg.text);
          void this.promptHistoryStore.addPrompt(msg.text);
          this.postUserMessage([{ type: 'text', text: msg.text } as ContentBlock], true);
          this.postToWebview({ type: 'processBusy', busy: true });
          {
            const deferred = this.buildDeferredHandoffPayload(msg.text);
            void this.session.sendText(deferred.text, { steer: !!msg.steer })
              .then(() => {
                if (deferred.consumeOnSuccess) {
                  this.pendingHandoffPrompt = null;
                }
              })
              .catch((err) => {
                const message = this.errMsg(err);
                this.log(`Codex sendText failed: ${message}`);
                this.postToWebview({ type: 'processBusy', busy: this.session.isTurnRunning() });
                this.postToWebview({ type: 'error', message: `Failed to send Codex message: ${message}` });
              });
          }
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
          if (msg.text.trim()) {
            this.achievementService.onUserPrompt(this.tabId, msg.text);
            void this.promptHistoryStore.addPrompt(msg.text);
          }
          const content: ContentBlock[] = [];
          if (msg.text) {
            content.push({ type: 'text', text: msg.text });
          }
          for (const img of msg.images) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data: img.base64,
              },
            });
          }
          this.postUserMessage(content, true);
          this.postToWebview({ type: 'processBusy', busy: true });
          {
            const deferred = this.buildDeferredHandoffPayload(msg.text, { imageCount: msg.images.length });
            void this.session.sendWithImages(deferred.text, msg.images, { steer: !!msg.steer })
              .then(() => {
                if (deferred.consumeOnSuccess) {
                  this.pendingHandoffPrompt = null;
                }
              })
              .catch((err) => {
                const message = this.errMsg(err);
                this.log(`Codex sendWithImages failed: ${message}`);
                this.postToWebview({ type: 'processBusy', busy: this.session.isTurnRunning() });
                this.postToWebview({ type: 'error', message: `Failed to send Codex message with images: ${message}` });
              });
          }
          break;
        }

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

        case 'setTypingTheme':
          void vscode.workspace.getConfiguration('claudeMirror').update('typingTheme', msg.theme, true);
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
          if (msg.text.trim()) {
            void this.promptHistoryStore.addPrompt(msg.text);
          }
          void this.session
            .clearSession()
            .then(() => this.session.sendText(msg.text))
            .catch((err) => {
              this.webview.postMessage({ type: 'error', message: `Edit-and-resend failed: ${this.errMsg(err)}` });
            });
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
            this.bugReportService.getPreview();
          }
          break;
        case 'bugReportClose':
          if (this.bugReportService) {
            this.bugReportService.dispose();
            this.bugReportService = null;
          }
          break;

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
      if (e.affectsConfiguration('claudeMirror.codex.model')) {
        this.sendCodexModelSetting();
      }
      if (e.affectsConfiguration('claudeMirror.codex.reasoningEffort')) {
        this.sendCodexReasoningEffortSetting();
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
    this.sendCodexModelSetting();
    this.sendCodexModelOptions();
    this.sendCodexReasoningEffortSetting();
    void this.sendApiKeySetting();
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
    const openOptions: vscode.TextDocumentShowOptions = {};
    if (parsed.line !== undefined) {
      const line = Math.max(1, parsed.line);
      const col = Math.max(1, parsed.col ?? 1);
      const pos = new vscode.Position(line - 1, col - 1);
      openOptions.selection = new vscode.Range(pos, pos);
    }
    void vscode.commands.executeCommand('vscode.open', uri, openOptions).then(
      () => this.log(`Opened file (Codex handler): ${resolvedPath}${parsed.line ? `:${parsed.line}` : ''}`),
      (err) => this.log(`Failed to open file (Codex handler): ${this.errMsg(err)}`)
    );
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

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
