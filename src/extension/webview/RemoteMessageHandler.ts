/**
 * Remote-session-specific webview/runtime bridge.
 * Follows the same pattern as CodexMessageHandler but maps RemoteDemux events
 * to ExtensionToWebviewMessage types.
 */

import * as vscode from 'vscode';
import type { RemoteDemux } from '../remote/RemoteDemux';
import type { PromptHistoryStore } from '../session/PromptHistoryStore';
import type { ProjectAnalyticsStore } from '../session/ProjectAnalyticsStore';
import type { AchievementService } from '../achievements/AchievementService';
import type { WebviewBridge } from './MessageHandler';
import type { ContentBlock } from '../types/stream-json';
import { setStoredApiKey, maskApiKey } from '../process/envUtils';
import { MessageTranslator } from '../session/MessageTranslator';
import { BugReportService } from '../feedback/BugReportService';
import type {
  ExtensionToWebviewMessage,
  ProviderCapabilities,
  ProviderId,
  TurnRecord,
  TurnCategory,
  TypingTheme,
  WebviewToExtensionMessage,
} from '../types/webview-messages';

export interface RemoteSessionController {
  startSession(options?: { resume?: string; cwd?: string }): Promise<void>;
  stopSession(): void;
  clearSession(options?: { cwd?: string }): Promise<void>;
  sendText(text: string): Promise<void>;
  sendWithImages(text: string, images: Array<{ base64: string; mediaType: string }>): Promise<void>;
  cancelRequest(): void;
  isSessionActive(): boolean;
  getSessionId(): string | null;
  getCurrentModel(): string;
}

function remoteTurnCategory(toolNames: string[]): TurnCategory {
  if (toolNames.length === 0) { return 'discussion'; }
  const hasWrite = toolNames.some(n => /^(Write|Edit|NotebookEdit)$/i.test(n));
  const hasCmd = toolNames.some(n => /^Bash$/i.test(n));
  const hasRead = toolNames.some(n => /^(Read|Grep|Glob|WebSearch|WebFetch)$/i.test(n));
  if (hasWrite) { return 'code-write'; }
  if (hasCmd) { return 'command'; }
  if (hasRead) { return 'research'; }
  return 'success';
}

const REMOTE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsPlanApproval: false,
  supportsCompact: false,
  supportsFork: false,
  supportsImages: false,
  supportsGitPush: false,
  supportsTranslation: true,
  supportsPromptEnhancer: false,
  supportsCodexConsult: false,
  supportsPermissionModeSelector: false,
  supportsLiveTextStreaming: true,
  supportsConversationDiskReplay: false,
  supportsCostUsd: true,
};

export class RemoteMessageHandler {
  private log: (msg: string) => void = () => {};
  private turnIndex = 0;
  private turnRecords: TurnRecord[] = [];
  private lastMessageId = '';
  private currentTurnStartedAt = 0;
  private currentTurnToolNames: string[] = [];
  private currentTurnHadAgentMessage = false;
  private messageCounter = 0;
  private totalCostUsd = 0;
  private secrets: vscode.SecretStorage | null = null;
  private webviewPostQueue: Promise<void> = Promise.resolve();
  private messageTranslator: MessageTranslator | null = null;
  private bugReportService: BugReportService | null = null;
  private extensionVersion = '0.0.0';
  private logDir = '';
  /** Dedup: last userMessage text posted to webview, with timestamp. */
  private lastPostedUserMsg: { text: string; time: number } | null = null;

  setExtensionMeta(version: string, logDir: string): void {
    this.extensionVersion = version;
    this.logDir = logDir;
  }

  setSecrets(secrets: vscode.SecretStorage): void { this.secrets = secrets; }

  setMessageTranslator(translator: MessageTranslator): void { this.messageTranslator = translator; }

  constructor(
    private readonly tabId: string,
    private readonly webview: WebviewBridge,
    private readonly session: RemoteSessionController,
    private readonly demux: RemoteDemux,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService,
    private readonly projectAnalyticsStore?: ProjectAnalyticsStore
  ) {}

  setLogger(logger: (msg: string) => void): void { this.log = logger; }

  private postToWebview(msg: ExtensionToWebviewMessage): void {
    this.webviewPostQueue = this.webviewPostQueue
      .catch(() => undefined)
      .then(() => {
        try {
          this.webview.postMessage(msg);
        } catch (err) {
          this.log(`Failed to post Remote webview message (${msg.type}): ${err}`);
        }
      });
  }

  /** Post a userMessage with dedup (same pattern as MessageHandler). */
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
    this.postToWebview({ type: 'userMessage', content });
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

  // -----------------------------------------------------------------------
  // Webview message dispatch
  // -----------------------------------------------------------------------

  private bindWebviewMessages(): void {
    this.webview.onMessage((msg: WebviewToExtensionMessage) => {
      this.log(`Remote webview -> extension: ${msg.type}`);

      switch (msg.type) {
        case 'ready':
          this.sendInitialSettings();
          if (this.session.isSessionActive()) {
            this.webview.postMessage({
              type: 'sessionStarted',
              sessionId: this.session.getSessionId() || 'pending',
              model: this.session.getCurrentModel(),
              provider: 'remote',
            });
          }
          break;

        case 'setApiKey': {
          if (!this.secrets) { break; }
          void setStoredApiKey(this.secrets, msg.apiKey).then(() => {
            this.log(`API key ${msg.apiKey.trim() ? 'saved' : 'cleared'}`);
            void this.sendApiKeySetting();
          });
          break;
        }

        case 'startSession':
          void this.session.startSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to start Remote session: ${this.errMsg(err)}` });
          });
          break;

        case 'stopSession':
          this.session.stopSession();
          break;

        case 'clearSession':
          void this.session.clearSession({ cwd: msg.workspacePath }).catch((err) => {
            this.webview.postMessage({ type: 'error', message: `Failed to clear Remote session: ${this.errMsg(err)}` });
          });
          break;

        case 'sendMessage':
          this.log(`Remote sendMessage: len=${msg.text.length}`);
          this.achievementService.onUserPrompt(this.tabId, msg.text);
          void this.promptHistoryStore.addPrompt(msg.text);
          this.postUserMessage([{ type: 'text', text: msg.text } as ContentBlock]);
          this.postToWebview({ type: 'processBusy', busy: true });
          void this.session.sendText(msg.text).catch((err) => {
            this.log(`Remote sendText failed: ${this.errMsg(err)}`);
            this.postToWebview({ type: 'processBusy', busy: false });
            this.postToWebview({ type: 'error', message: `Failed to send Remote message: ${this.errMsg(err)}` });
          });
          break;

        case 'cancelRequest':
          this.session.cancelRequest();
          break;

        case 'setProvider': {
          const config = vscode.workspace.getConfiguration('claudeMirror');
          void config.update('provider', msg.provider, true);
          this.sendProviderSetting();
          break;
        }

        case 'openProviderTab': {
          const config = vscode.workspace.getConfiguration('claudeMirror');
          void config.update('provider', msg.provider, true);
          void vscode.commands.executeCommand('claudeMirror.startSession');
          break;
        }

        case 'showHistory':
          void vscode.commands.executeCommand('claudeMirror.showHistory');
          break;

        case 'openFile':
          void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.filePath));
          break;

        case 'openUrl':
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;

        case 'getPromptHistory': {
          const scope = msg.scope;
          const prompts = scope === 'global'
            ? this.promptHistoryStore.getGlobalHistory()
            : this.promptHistoryStore.getProjectHistory();
          this.webview.postMessage({ type: 'promptHistoryResponse', scope, prompts });
          break;
        }

        case 'translateMessage': {
          if (!this.messageTranslator) {
            this.webview.postMessage({
              type: 'translationResult',
              messageId: msg.messageId,
              translatedText: null,
              success: false,
              error: 'Translation not available',
            });
            break;
          }
          void this.messageTranslator.translate(msg.textContent, msg.language).then((translated) => {
            this.webview.postMessage({
              type: 'translationResult',
              messageId: msg.messageId,
              translatedText: translated,
              success: translated !== null,
              error: translated === null ? 'Translation failed' : undefined,
            });
          });
          break;
        }

        case 'openFeedback':
          void vscode.commands.executeCommand('claudeMirror.sendFeedback');
          break;

        case 'copyToClipboard':
          void vscode.env.clipboard.writeText(msg.text);
          break;

        case 'openSettings':
          void vscode.commands.executeCommand('workbench.action.openSettings', msg.query);
          break;

        // Ignore messages not relevant to Remote provider
        default:
          break;
      }
    });
  }

  // -----------------------------------------------------------------------
  // Demux event bindings
  // -----------------------------------------------------------------------

  private bindDemuxEvents(): void {
    this.demux.on('sessionStarted', (data: { sessionId: string; model: string }) => {
      this.log(`Remote session started: ${data.sessionId}`);
      this.postToWebview({
        type: 'sessionStarted',
        sessionId: data.sessionId,
        model: data.model || this.session.getCurrentModel(),
        provider: 'remote',
      });
    });

    this.demux.on('turnStarted', () => {
      this.currentTurnStartedAt = Date.now();
      this.currentTurnToolNames = [];
      this.currentTurnHadAgentMessage = false;
      this.log('Remote turn started');
      this.postToWebview({ type: 'processBusy', busy: true });
    });

    this.demux.on('streamingText', (data: { text: string }) => {
      if (!this.lastMessageId) {
        // First streaming text in this turn -- emit messageStart
        const messageId = this.nextMessageId();
        this.lastMessageId = messageId;
        this.postToWebview({ type: 'messageStart', messageId, model: this.session.getCurrentModel() });
      }
      this.postToWebview({
        type: 'streamingText',
        messageId: this.lastMessageId,
        blockIndex: 0,
        text: data.text,
      });
    });

    this.demux.on('agentMessage', (data: { id: string; text: string }) => {
      this.currentTurnHadAgentMessage = true;
      const messageId = data.id || this.nextMessageId();
      this.lastMessageId = messageId;
      const model = this.session.getCurrentModel();
      this.log(`Remote agent message: id=${messageId} len=${data.text.length}`);

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

    this.demux.on('userMessage', (data: { text: string }) => {
      this.postUserMessage([{ type: 'text', text: data.text } as ContentBlock]);
    });

    this.demux.on('toolCallStart', (data: { toolId: string; toolName: string; input?: string }) => {
      const messageId = this.lastMessageId || this.nextMessageId();
      this.lastMessageId = messageId;
      this.currentTurnToolNames.push(data.toolName);
      this.log(`Remote tool start: ${data.toolName}`);
      this.postToWebview({
        type: 'toolUseStart',
        messageId,
        blockIndex: this.currentTurnToolNames.length - 1,
        toolName: data.toolName,
        toolId: data.toolId,
      });
      this.postToWebview({
        type: 'toolActivity',
        toolName: data.toolName,
        detail: `${data.toolName}${data.input ? ': ' + data.input.slice(0, 100) : ''}`,
      });
    });

    this.demux.on('toolCallEnd', (data: { toolId: string; toolName: string; output?: string; isError: boolean }) => {
      this.log(`Remote tool end: ${data.toolName} error=${data.isError}`);
      this.postToWebview({
        type: 'toolResult',
        toolId: data.toolId,
        content: data.output || '',
        isError: data.isError,
      });
    });

    this.demux.on('turnCompleted', (data: {
      usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsd: number };
    }) => {
      const durationMs = this.currentTurnStartedAt ? Math.max(0, Date.now() - this.currentTurnStartedAt) : 0;
      const category = remoteTurnCategory(this.currentTurnToolNames);
      this.totalCostUsd += data.usage.costUsd;

      const turn: TurnRecord = {
        turnIndex: this.turnIndex++,
        toolNames: [...this.currentTurnToolNames],
        toolCount: this.currentTurnToolNames.length,
        durationMs,
        costUsd: data.usage.costUsd,
        totalCostUsd: this.totalCostUsd,
        isError: false,
        category,
        timestamp: Date.now(),
        messageId: this.lastMessageId,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
        cacheReadTokens: data.usage.cachedInputTokens,
        cacheCreationTokens: 0,
      };

      this.turnRecords.push(turn);
      this.postToWebview({
        type: 'costUpdate',
        costUsd: data.usage.costUsd,
        totalCostUsd: this.totalCostUsd,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
      });
      this.postToWebview({ type: 'turnComplete', turn });
      this.postToWebview({ type: 'processBusy', busy: false });

      // Reset per-turn state
      this.currentTurnToolNames = [];
      this.currentTurnStartedAt = 0;
      this.currentTurnHadAgentMessage = false;
      this.lastMessageId = '';
    });

    this.demux.on('sessionEnded', (data: { reason?: string }) => {
      this.log(`Remote session ended: ${data.reason ?? 'unknown'}`);
      this.postToWebview({ type: 'processBusy', busy: false });
    });

    this.demux.on('error', (data: { message: string }) => {
      this.log(`Remote demux error: ${data.message}`);
      this.postToWebview({ type: 'error', message: data.message });
      this.postToWebview({ type: 'processBusy', busy: false });
    });

    this.demux.on('serviceEvent', (data: { service: string; action: string; detail?: string }) => {
      this.log(`Remote service event: ${data.service}/${data.action}`);
    });

    this.demux.on('fileEvent', (data: { action: string; path: string }) => {
      this.log(`Remote file event: ${data.action} ${data.path}`);
    });
  }

  // -----------------------------------------------------------------------
  // Config & settings
  // -----------------------------------------------------------------------

  private watchConfigChanges(): void {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeMirror.chatFontSize') || e.affectsConfiguration('claudeMirror.chatFontFamily')) {
        this.sendTextSettings();
      }
      if (e.affectsConfiguration('claudeMirror.typingTheme')) {
        this.sendTypingThemeSetting();
      }
      if (e.affectsConfiguration('claudeMirror.provider')) {
        this.sendProviderSetting();
      }
    });
  }

  private sendInitialSettings(): void {
    this.sendTextSettings();
    this.sendTypingThemeSetting();
    this.sendProviderSetting();
    this.sendProviderCapabilities();
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
    this.webview.postMessage({ type: 'providerSetting', provider });
  }

  private sendProviderCapabilities(): void {
    this.webview.postMessage({
      type: 'providerCapabilities',
      capabilities: REMOTE_PROVIDER_CAPABILITIES,
    });
  }

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

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private nextMessageId(): string {
    return `remote-msg-${++this.messageCounter}`;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
