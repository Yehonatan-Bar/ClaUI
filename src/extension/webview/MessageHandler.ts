import * as vscode from 'vscode';
import type { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import type { ControlProtocol } from '../process/ControlProtocol';
import type { StreamDemux } from '../process/StreamDemux';
import type { SessionNamer } from '../session/SessionNamer';
import type {
  ExtensionToWebviewMessage,
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
}

/**
 * Bridges communication between the webview UI and the Claude process.
 * Translates webview postMessages into CLI commands and
 * StreamDemux events into webview messages.
 */
/** Tool names that require user approval when the CLI pauses after calling them */
const APPROVAL_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];

export class MessageHandler {
  private log: (msg: string) => void = () => {};
  private firstMessageSent = false;
  private sessionNamer: SessionNamer | null = null;
  private titleCallback: ((title: string) => void) | null = null;

  /** Tool names seen in the current assistant message (cleared on messageStart) */
  private currentMessageToolNames: string[] = [];
  /** Set when the CLI pauses waiting for plan/question approval */
  private pendingApprovalTool: string | null = null;

  constructor(
    private readonly webview: WebviewBridge,
    private readonly processManager: ClaudeProcessManager,
    private readonly control: ControlProtocol,
    private readonly demux: StreamDemux
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

  /** Wire up all event listeners */
  initialize(): void {
    this.bindWebviewMessages();
    this.bindDemuxEvents();
    this.watchConfigChanges();
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
          this.control.sendText(msg.text);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          break;

        case 'sendMessageWithImages':
          this.log(`Sending message with ${msg.images.length} images`);
          this.control.sendWithImages(msg.text, msg.images);
          this.webview.postMessage({ type: 'processBusy', busy: true });
          this.triggerSessionNaming(msg.text);
          break;

        case 'cancelRequest':
          this.control.cancel();
          break;

        case 'compact':
          this.control.compact(msg.instructions);
          break;

        case 'startSession':
          this.firstMessageSent = false;
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
          this.webview.postMessage({
            type: 'sessionEnded',
            reason: 'stopped',
          });
          break;

        case 'resumeSession':
          this.firstMessageSent = false;
          this.processManager
            .start({ resume: msg.sessionId })
            .catch((err) => {
              this.webview.postMessage({
                type: 'error',
                message: `Failed to resume session: ${err.message}`,
              });
            });
          break;

        case 'forkSession':
          this.firstMessageSent = false;
          this.processManager
            .start({ resume: msg.sessionId, fork: true })
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

        case 'clearSession':
          this.firstMessageSent = false;
          this.log('clearSession - stopping current process and starting fresh');
          this.processManager.stop();
          this.processManager
            .start({ cwd: msg.workspacePath })
            .then(() => {
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
          if (msg.action === 'approve') {
            this.control.sendText('Yes, proceed with the plan.');
          } else if (msg.action === 'reject') {
            this.control.sendText('No, I reject this plan. Please revise it.');
          } else if (msg.action === 'feedback') {
            this.control.sendText(msg.feedback || 'Please revise the plan.');
          }
          this.clearApprovalTracking();
          this.webview.postMessage({ type: 'processBusy', busy: true });
          break;

        case 'ready':
          this.log('Webview ready');
          // Send text display settings
          this.sendTextSettings();
          // Send model setting
          this.sendModelSetting();
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
        this.webview.postMessage({
          type: 'toolUseInput',
          messageId: data.messageId,
          blockIndex: data.blockIndex,
          partialJson: data.partialJson,
        });
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
            name => APPROVAL_TOOLS.includes(name)
          );
          if (approvalTool) {
            this.log(`Plan approval required: tool=${approvalTool}`);
            this.pendingApprovalTool = approvalTool;
            this.webview.postMessage({
              type: 'planApprovalRequired',
              toolName: approvalTool,
            });
          }
        }
      }
    );

    this.demux.on(
      'assistantMessage',
      (event: AssistantMessage) => {
        const blockTypes = event.message.content.map(b => b.type).join(', ');
        this.log(`-> webview: assistantMessage id=${event.message.id} blocks=[${blockTypes}]`);
        this.webview.postMessage({
          type: 'assistantMessage',
          messageId: event.message.id,
          content: event.message.content,
          model: event.message.model,
        });
        // Don't set busy=false here - intermediate assistant events arrive mid-stream.
        // Busy is cleared on 'result' event only.
      }
    );

    this.demux.on(
      'messageStart',
      (data: { messageId: string; model: string }) => {
        this.log(`-> webview: messageStart id=${data.messageId}`);
        this.currentMessageToolNames = [];
        this.pendingApprovalTool = null;
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
        this.clearApprovalTracking();
        if (event.subtype === 'success') {
          const success = event as ResultSuccess;
          this.webview.postMessage({
            type: 'costUpdate',
            costUsd: success.cost_usd,
            totalCostUsd: success.total_cost_usd,
            inputTokens: success.usage.input_tokens,
            outputTokens: success.usage.output_tokens,
          });
        } else {
          const error = event as ResultError;
          this.webview.postMessage({
            type: 'error',
            message: error.error,
          });
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
