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
  sendText(text: string): Promise<void>;
  sendWithImages(text: string, images: Array<{ base64: string; mediaType: string }>): Promise<void>;
  cancelRequest(): void;
  openCodexLoginTerminal(): void;
  isSessionActive(): boolean;
  getSessionId(): string | null;
  getCurrentModel(): string;
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

interface CodexCliCandidate {
  path: string;
  source: 'path' | 'official-extension-bundled' | 'npm-prefix' | 'common-location';
  version?: string;
}

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
          void this.session.startSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to start Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'resumeSession':
          void this.session.startSession({ resume: msg.sessionId }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to resume Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'stopSession':
          this.session.stopSession();
          break;

        case 'clearSession':
          void this.session.clearSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to clear Codex session: ${this.errMsg(err)}` });
          });
          break;

        case 'sendMessage':
          this.log(`Codex sendMessage requested: len=${msg.text.length} preview="${msg.text.slice(0, 80).replace(/\s+/g, ' ')}"`);
          this.achievementService.onUserPrompt(this.tabId, msg.text);
          void this.promptHistoryStore.addPrompt(msg.text);
          this.postToWebview({
            type: 'userMessage',
            content: [{ type: 'text', text: msg.text } as ContentBlock],
          });
          this.postToWebview({ type: 'processBusy', busy: true });
          void this.session.sendText(msg.text).catch((err) => {
            this.log(`Codex sendText failed: ${this.errMsg(err)}`);
            this.postToWebview({ type: 'processBusy', busy: false });
            this.postToWebview({ type: 'error', message: `Failed to send Codex message: ${this.errMsg(err)}` });
          });
          break;

        case 'sendMessageWithImages': {
          this.log(`Codex sendMessageWithImages requested: images=${msg.images.length} textLen=${msg.text.length}`);
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
          this.postToWebview({ type: 'userMessage', content });
          this.postToWebview({ type: 'processBusy', busy: true });
          void this.session.sendWithImages(msg.text, msg.images).catch((err) => {
            this.log(`Codex sendWithImages failed: ${this.errMsg(err)}`);
            this.postToWebview({ type: 'processBusy', busy: false });
            this.postToWebview({ type: 'error', message: `Failed to send Codex message with images: ${this.errMsg(err)}` });
          });
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
          this.handleOpenFile(msg.filePath);
          break;

        case 'openUrl':
          this.handleOpenUrl(msg.url);
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
              this.webview.postMessage({ type: 'processBusy', busy: false });
              this.webview.postMessage({ type: 'error', message: `Failed to send Codex message: ${this.errMsg(err)}` });
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
      const messageId = data.id || this.nextMessageId();
      this.lastMessageId = messageId;
      const model = this.getConfiguredCodexModelLabel();
      this.log(`Codex agent_message: id=${messageId} len=${data.text.length}`);
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

  private handleOpenFile(rawPath: string): void {
    let filePath = rawPath;
    let line: number | undefined;
    let col: number | undefined;

    const lineColMatch = filePath.match(/:(\d+)(?::(\d+))?$/);
    if (lineColMatch) {
      line = parseInt(lineColMatch[1], 10);
      col = lineColMatch[2] ? parseInt(lineColMatch[2], 10) : undefined;
      filePath = filePath.slice(0, lineColMatch.index);
    }

    const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/');
    if (!isAbsolute) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        filePath = require('path').resolve(workspaceRoot, filePath);
      }
    }

    const uri = vscode.Uri.file(filePath);
    const openOptions: vscode.TextDocumentShowOptions = {};
    if (line !== undefined) {
      const pos = new vscode.Position(line - 1, (col ?? 1) - 1);
      openOptions.selection = new vscode.Range(pos, pos);
    }
    void vscode.commands.executeCommand('vscode.open', uri, openOptions);
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
    const candidates = await this.findWorkingCodexCliCandidates();
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        'Could not find a working Codex CLI. Try Auto-setup (install + configure), or use Browse for codex executable.'
      );
      return;
    }

    let selected = this.pickPreferredCodexCliCandidate(candidates);
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
          let candidates = await this.findWorkingCodexCliCandidates();

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
            candidates = await this.findWorkingCodexCliCandidates({ includeNpmPrefixFallback: true });
          }

          if (candidates.length === 0) {
            throw new Error(
              'Codex CLI installation/detection completed but no working executable was found. Use "Browse for codex executable" or paste the full path into claudeMirror.codex.cliPath.'
            );
          }

          const selected = this.pickPreferredCodexCliCandidate(candidates);
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

  private async findWorkingCodexCliCandidates(
    options?: { includeNpmPrefixFallback?: boolean }
  ): Promise<CodexCliCandidate[]> {
    const rawCandidates = await this.findCodexCliCandidates(options);
    const verified: CodexCliCandidate[] = [];
    for (const candidate of rawCandidates) {
      const version = await this.probeCodexCliVersion(candidate.path);
      if (!version) {
        continue;
      }
      verified.push({ ...candidate, version });
    }
    // De-dupe by path while preserving order.
    return verified.filter((c, idx, arr) => arr.findIndex((x) => x.path.toLowerCase() === c.path.toLowerCase()) === idx);
  }

  private async findCodexCliCandidates(
    options?: { includeNpmPrefixFallback?: boolean }
  ): Promise<CodexCliCandidate[]> {
    const candidates: CodexCliCandidate[] = [];
    const seen = new Set<string>();
    const add = (pathValue: string, source: CodexCliCandidate['source']) => {
      const normalized = pathValue.trim();
      if (!normalized) return;
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ path: normalized, source });
    };

    // Prefer PATH shorthand if available (keeps config simpler).
    if (await this.probeCodexCliVersion('codex')) {
      add('codex', 'path');
    }

    const pathCommand = process.platform === 'win32' ? 'where.exe codex' : 'command -v codex || which codex';
    const pathResult = await this.execShellCommand(pathCommand, 5000);
    if (pathResult.stdout) {
      for (const line of pathResult.stdout.split(/\r?\n/)) {
        add(line, 'path');
      }
    }

    for (const bundled of this.findBundledEditorCodexCliCandidates()) {
      add(bundled, 'official-extension-bundled');
    }

    for (const common of this.findCommonCodexCliLocations()) {
      add(common, 'common-location');
    }

    if (options?.includeNpmPrefixFallback) {
      for (const npmCandidate of await this.findNpmPrefixCodexCandidates()) {
        add(npmCandidate, 'npm-prefix');
      }
    }

    return candidates;
  }

  private findBundledEditorCodexCliCandidates(): string[] {
    const home = os.homedir();
    const roots = [
      path.join(home, '.vscode', 'extensions'),
      path.join(home, '.vscode-insiders', 'extensions'),
      path.join(home, '.cursor', 'extensions'),
      path.join(home, '.windsurf', 'extensions'),
    ];
    const matches: string[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        if (!(name.startsWith('openai.chatgpt-') || name.startsWith('openai.codex-') || name.includes('openai'))) {
          continue;
        }
        const base = path.join(root, entry.name, 'bin');
        if (!fs.existsSync(base)) continue;
        try {
          const platformDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
          for (const pdir of platformDirs) {
            const binDir = path.join(base, pdir.name);
            const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
            for (const candidateName of names) {
              const full = path.join(binDir, candidateName);
              if (fs.existsSync(full)) {
                matches.push(full);
              }
            }
          }
        } catch {
          // ignore broken extension dir
        }
      }
    }
    return matches;
  }

  private findCommonCodexCliLocations(): string[] {
    const locations: string[] = [];
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || '';
      const userProfile = process.env.USERPROFILE || os.homedir();
      const localApp = process.env.LOCALAPPDATA || '';
      locations.push(
        path.join(appData, 'npm', 'codex.cmd'),
        path.join(appData, 'npm', 'codex'),
        path.join(appData, 'npm', 'codex.exe'),
        path.join(userProfile, '.npm-global', 'bin', 'codex.cmd'),
        path.join(userProfile, '.npm-global', 'bin', 'codex.exe'),
        path.join(localApp, 'Programs', 'Codex', 'codex.exe'),
        path.join(localApp, 'Programs', 'OpenAI Codex', 'codex.exe')
      );
    } else {
      locations.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', path.join(os.homedir(), '.local', 'bin', 'codex'));
    }
    return locations.filter((p) => !!p && fs.existsSync(p));
  }

  private async findNpmPrefixCodexCandidates(): Promise<string[]> {
    const result = await this.execShellCommand('npm config get prefix', 10000);
    const prefix = result.stdout?.split(/\r?\n/)[0]?.trim();
    if (!result.ok || !prefix) {
      return [];
    }

    const candidates =
      process.platform === 'win32'
        ? [path.join(prefix, 'codex.cmd'), path.join(prefix, 'codex.exe'), path.join(prefix, 'codex')]
        : [path.join(prefix, 'bin', 'codex'), path.join(prefix, 'codex')];
    return candidates.filter((p) => fs.existsSync(p));
  }

  private async probeCodexCliVersion(cliPath: string): Promise<string | null> {
    const quoted = this.quoteForShell(cliPath);
    const result = await this.execShellCommand(`${quoted} --version`, 10000);
    if (!result.ok) {
      return null;
    }
    const line = result.stdout.split(/\r?\n/).find((s) => s.trim())?.trim();
    return line || 'codex-cli';
  }

  private pickPreferredCodexCliCandidate(candidates: CodexCliCandidate[]): CodexCliCandidate {
    const score = (c: CodexCliCandidate): number => {
      const p = c.path.toLowerCase();
      let s = 0;
      if (p === 'codex') s += 200;
      if (p.endsWith('codex.cmd')) s += 120;
      if (p.includes('\\appdata\\roaming\\npm\\')) s += 100;
      if (c.source === 'path') s += 50;
      if (c.source === 'official-extension-bundled') s += 10;
      // Prefer non-alpha versions when possible
      if (c.version && !/alpha|beta|rc/i.test(c.version)) s += 20;
      return s;
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0];
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

  private quoteForShell(value: string): string {
    const trimmed = (value || '').trim();
    if (!trimmed) {
      return 'codex';
    }
    if (!/[\\/\s"]/u.test(trimmed)) {
      return trimmed;
    }
    if (process.platform === 'win32') {
      return `"${trimmed.replace(/"/g, '\\"')}"`;
    }
    return `'${trimmed.replace(/'/g, `'\\''`)}'`;
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
    return this.session.getCurrentModel() || 'codex';
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
