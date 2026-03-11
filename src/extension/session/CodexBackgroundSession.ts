import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { CodexExecDemux } from '../process/CodexExecDemux';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';
import type { ContentBlock } from '../types/stream-json';

/**
 * Headless Codex side-session used by the BTW overlay.
 *
 * Unlike Claude's persistent pipe-mode process, Codex runs one process per turn.
 * This class keeps the thread id between turns and emits Claude-like demux events
 * (`messageStart`, `textDelta`, `assistantMessage`, `messageStop`, `result`) so
 * the webview can reuse the same BTW UI state.
 */
export class CodexBackgroundSession extends EventEmitter {
  private readonly processManager: CodexExecProcessManager;
  private readonly demux: CodexExecDemux;
  private readonly log: (msg: string) => void;
  private disposed = false;
  private threadId: string | null = null;
  private turnInFlight = false;
  private currentMessageId: string | null = null;
  private messageSeq = 0;
  private modelLabel = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    logger?: (msg: string) => void,
  ) {
    super();
    this.log = logger ?? (() => {});
    this.processManager = new CodexExecProcessManager(context);
    this.processManager.setLogger((msg) => this.log(`[BtwCodexPM] ${msg}`));
    this.demux = new CodexExecDemux();
    this.wireEvents();
  }

  private wireEvents(): void {
    this.processManager.on('event', (event: CodexExecJsonEvent) => {
      const eventType = typeof event.type === 'string' ? event.type : 'unknown';
      this.log(`[BtwCodex] event: type=${eventType}`);
      this.demux.handleEvent(event);
    });

    this.processManager.on('raw', (text: string) => {
      this.log(`[BtwCodex] raw: ${text.substring(0, 300)}`);
    });

    this.processManager.on('stderr', (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      this.log(`[BtwCodex] stderr: ${trimmed.substring(0, 500)}`);
    });

    this.processManager.on('error', (err: Error) => {
      if (this.disposed) {
        return;
      }
      this.log(`[BtwCodex] process error: ${err.message}`);
      this.emit('error', err);
      this.emit('messageStop');
      this.finishTurn();
    });

    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      if (this.disposed) {
        return;
      }
      this.log(`[BtwCodex] process exited: code=${info.code} signal=${info.signal}`);
      if (!this.turnInFlight) {
        return;
      }

      if (!this.processManager.cancelledByUser && info.code !== null && info.code !== 0) {
        this.emit('error', new Error(`Codex BTW process exited with code ${info.code}.`));
      }

      this.emit('messageStop');
      this.finishTurn();
    });

    this.demux.on('threadStarted', (data: { threadId: string }) => {
      this.threadId = data.threadId || this.threadId;
      this.log(`[BtwCodex] thread.started: ${this.threadId ?? '(none)'}`);
    });

    this.demux.on('turnStarted', () => {
      const messageId = this.nextMessageId();
      this.currentMessageId = messageId;
      this.log(`[BtwCodex] turn.started -> messageStart(${messageId})`);
      this.emit('messageStart', { messageId });
    });

    this.demux.on('agentMessage', (data: { id: string; text: string }) => {
      const text = data.text || '';
      let messageId = this.currentMessageId;
      if (!messageId) {
        messageId = this.nextMessageId();
        this.currentMessageId = messageId;
        this.emit('messageStart', { messageId });
      }

      this.emit('textDelta', { blockIndex: 0, text });
      const content: ContentBlock[] = [{ type: 'text', text }];
      this.emit('assistantMessage', {
        message: {
          id: messageId,
          content,
          model: this.modelLabel || undefined,
        },
      });
    });

    this.demux.on('turnCompleted', () => {
      this.emit('messageStop');
      this.finishTurn();
    });

    this.demux.on('error', (data: { message: string }) => {
      if (!this.disposed) {
        this.emit('error', new Error(data.message || 'Codex BTW turn failed.'));
      }
      this.emit('messageStop');
      this.finishTurn();
    });
  }

  async start(promptText: string, options?: { cwd?: string; model?: string }): Promise<void> {
    await this.runTurn(promptText, options);
  }

  async sendMessage(text: string, options?: { cwd?: string; model?: string }): Promise<void> {
    await this.runTurn(text, options);
  }

  private async runTurn(promptText: string, options?: { cwd?: string; model?: string }): Promise<void> {
    if (this.disposed) {
      throw new Error('Codex BTW session is disposed.');
    }
    if (this.turnInFlight || this.processManager.isTurnRunning) {
      throw new Error('Codex BTW session is already running a turn.');
    }

    const model = (options?.model || '').trim();
    if (model) {
      this.modelLabel = model;
    }

    this.turnInFlight = true;
    this.currentMessageId = null;
    try {
      await this.processManager.runTurn({
        prompt: promptText,
        threadId: this.threadId || undefined,
        cwd: options?.cwd,
        model: model || undefined,
      });
    } catch (err) {
      this.turnInFlight = false;
      this.currentMessageId = null;
      throw err;
    }
  }

  private finishTurn(): void {
    if (!this.turnInFlight) {
      return;
    }
    this.turnInFlight = false;
    this.currentMessageId = null;
    this.emit('result');
  }

  private nextMessageId(): string {
    this.messageSeq += 1;
    return `btw-codex-${Date.now()}-${this.messageSeq}`;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.log('[BtwCodex] Disposing.');
    this.processManager.stop();
    this.emit('ended');
    this.removeAllListeners();
  }

  get isRunning(): boolean {
    return this.turnInFlight || this.processManager.isTurnRunning;
  }

  get sessionId(): string | null {
    return this.threadId;
  }
}
