import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodexExecDemux } from '../process/CodexExecDemux';
import type { PromptHistoryStore } from '../session/PromptHistoryStore';
import type { ProjectAnalyticsStore } from '../session/ProjectAnalyticsStore';
import type { AchievementService } from '../achievements/AchievementService';
import type { WebviewBridge } from './MessageHandler';
import type { ContentBlock } from '../types/stream-json';
import { setStoredApiKey, maskApiKey } from '../process/envUtils';
import type {
  CodexReasoningEffort,
  CodexModelOption,
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

const CODEX_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsPlanApproval: false,
  supportsCompact: false,
  supportsFork: false,
  supportsImages: false,
  supportsGitPush: false,
  supportsTranslation: false,
  supportsPromptEnhancer: false,
  supportsCodexConsult: false,
  supportsPermissionModeSelector: false,
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

  /** Provide SecretStorage for API key management */
  setSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
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
          this.webview.postMessage({
            type: 'userMessage',
            content: [{ type: 'text', text: msg.text } as ContentBlock],
          });
          this.webview.postMessage({ type: 'processBusy', busy: true });
          void this.session.sendText(msg.text).catch((err) => {
            this.log(`Codex sendText failed: ${this.errMsg(err)}`);
            this.webview.postMessage({ type: 'processBusy', busy: false });
            this.webview.postMessage({ type: 'error', message: `Failed to send Codex message: ${this.errMsg(err)}` });
          });
          break;

        case 'cancelRequest':
          this.achievementService.onCancel(this.tabId);
          this.webview.postMessage({ type: 'processBusy', busy: false });
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
          void vscode.commands.executeCommand('workbench.action.openSettings', msg.query);
          break;

        case 'openCodexLogin':
          this.session.openCodexLoginTerminal();
          break;

        case 'getProjectAnalytics':
          this.handleGetProjectAnalytics();
          break;

        case 'compact':
        case 'forkSession':
        case 'forkFromMessage':
        case 'planApprovalResponse':
        case 'setPermissionMode':
        case 'sendMessageWithImages':
        case 'translateMessage':
        case 'enhancePrompt':
        case 'gitPush':
        case 'gitPushConfig':
          this.webview.postMessage({
            type: 'error',
            message: `${msg.type} is not supported in Codex MVP yet.`,
          });
          break;

        case 'editAndResend':
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
      this.webview.postMessage({
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
      this.webview.postMessage({ type: 'processBusy', busy: true });
    });

    this.demux.on('agentMessage', (data: { id: string; text: string }) => {
      this.currentTurnHadAgentMessage = true;
      const messageId = data.id || this.nextMessageId();
      this.lastMessageId = messageId;
      const model = this.getConfiguredCodexModelLabel();
      this.log(`Codex agent_message: id=${messageId} len=${data.text.length}`);
      this.webview.postMessage({ type: 'messageStart', messageId, model });
      // Codex exec emits complete agent messages (not text deltas). Synthesize a single
      // streamingText block so the existing webview finalize path persists the message.
      this.webview.postMessage({
        type: 'streamingText',
        messageId,
        blockIndex: 0,
        text: data.text,
      });
      this.webview.postMessage({
        type: 'assistantMessage',
        messageId,
        content: [{ type: 'text', text: data.text } as ContentBlock],
        model,
      });
      this.webview.postMessage({ type: 'messageStop' });
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
        this.webview.postMessage({
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
        this.webview.postMessage({
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
      this.webview.postMessage({
        type: 'costUpdate',
        costUsd: 0,
        totalCostUsd: 0,
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
      });
      this.webview.postMessage({ type: 'turnComplete', turn });
      this.webview.postMessage({ type: 'processBusy', busy: false });
      this.currentTurnCommands = [];
      this.currentTurnStartedAt = 0;
      this.currentTurnHadAgentMessage = false;
    });

    this.demux.on('error', (data: { message: string }) => {
      this.log(`Codex demux error: ${data.message}`);
      this.webview.postMessage({ type: 'error', message: data.message });
      this.webview.postMessage({ type: 'processBusy', busy: false });
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
