import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { CodexExecDemux } from '../process/CodexExecDemux';
import { FileChangeTracker } from './FileChangeTracker';
import type { AgentEventPayload, MPAgentBusyPolicy, MPFileChange, MPFileChangeReportSource } from './MultiParticipantProtocol';
import type { AssistantMessage, ResultSuccess, ResultError } from '../types/stream-json';

const STEER_CANCEL_TIMEOUT_MS = 8000;

// Auto-restart for the persistent Claude process when it dies during a long
// idle (token refresh, OS reaping, sleep). Bounded so a CLI that genuinely
// can't start (e.g. expired auth) doesn't spin forever.
const CLAUDE_RESTART_MAX_ATTEMPTS = 10;
const CLAUDE_RESTART_BASE_MS = 2000;
const CLAUDE_RESTART_MAX_MS = 30000;

export interface HeadlessAgentRunnerEvents {
  agentEvent: [deliveryId: string, event: AgentEventPayload];
  fileChanges: [deliveryId: string, changes: MPFileChange[], source: MPFileChangeReportSource];
  processStarted: [];
  processStopped: [];
}

/**
 * Drives a local Claude or Codex agent without a visible webview.
 * Accepts prompt deliveries and reports agent lifecycle events.
 */
export class HeadlessAgentRunner extends EventEmitter {
  private provider: 'claude' | 'codex';
  private context: vscode.ExtensionContext;
  private log: (msg: string) => void;

  // Claude-specific
  private claudeProcess: ClaudeProcessManager | null = null;
  private claudeDemux: StreamDemux | null = null;
  private claudeReady = false;

  // Codex-specific
  private codexProcess: CodexExecProcessManager | null = null;
  private codexDemux: CodexExecDemux | null = null;
  private codexThreadId: string | null = null;

  // File change tracking
  private fileTracker: FileChangeTracker;

  // Shared
  private activeDeliveryId: string | null = null;
  private responseText = '';
  private assistantTextFallback = '';
  private thinkingTextParts: string[] = [];
  private answerTextParts: string[] = [];
  private firstTokenSent = false;
  private disposed = false;
  private claudeRestartAttempts = 0;
  private claudeRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    provider: 'claude' | 'codex',
    context: vscode.ExtensionContext,
    log?: (msg: string) => void,
  ) {
    super();
    this.provider = provider;
    this.context = context;
    this.log = log || (() => {});

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.fileTracker = new FileChangeTracker(workspaceRoot, 2, this.log);
    this.fileTracker.on('fileChanges', (deliveryId: string, changes: MPFileChange[], source: MPFileChangeReportSource) => {
      this.emit('fileChanges', deliveryId, changes, source);
    });
  }

  async startAgent(): Promise<void> {
    if (this.provider === 'claude') {
      await this.startClaude();
    }
    // Codex doesn't need a persistent process; each turn spawns a new one
  }

  async deliver(deliveryId: string, prompt: string, busyPolicy: MPAgentBusyPolicy | null): Promise<void> {
    this.log(`[HeadlessRunner] deliver: id=${deliveryId} provider=${this.provider} policy=${busyPolicy}`);

    if (this.provider === 'claude') {
      await this.deliverClaude(deliveryId, prompt);
    } else {
      await this.deliverCodex(deliveryId, prompt, busyPolicy);
    }
  }

  cancel(deliveryId: string): void {
    if (this.activeDeliveryId !== deliveryId) return;

    if (this.provider === 'claude') {
      this.claudeProcess?.sendCancel();
    } else {
      this.codexProcess?.cancelTurn();
    }
  }

  get isBusy(): boolean {
    if (this.provider === 'claude') {
      return this.activeDeliveryId !== null;
    }
    return this.codexProcess?.isTurnRunning ?? false;
  }

  getProvider(): 'claude' | 'codex' {
    return this.provider;
  }

  dispose(): void {
    this.disposed = true;
    if (this.claudeRestartTimer) {
      clearTimeout(this.claudeRestartTimer);
      this.claudeRestartTimer = null;
    }
    this.fileTracker.removeAllListeners();
    if (this.provider === 'claude') {
      this.claudeProcess?.stop();
      this.claudeProcess?.removeAllListeners();
      this.claudeDemux?.removeAllListeners();
    } else {
      this.codexProcess?.stop();
      this.codexProcess?.removeAllListeners();
      this.codexDemux?.removeAllListeners();
    }
  }

  // -- Claude --

  private async startClaude(): Promise<void> {
    this.claudeProcess = new ClaudeProcessManager(this.context);
    this.claudeDemux = new StreamDemux();

    this.claudeProcess.setLogger((msg) => this.log(`[Claude] ${msg}`));

    this.claudeProcess.on('event', (event) => {
      // Log every CLI event type for delivery diagnostics
      if (this.activeDeliveryId) {
        const evType = event.type === 'stream_event' ? `stream:${event.event?.type}` : event.type;
        this.log(`[HeadlessRunner] CLI event: ${evType}`);
      }
      this.claudeDemux!.handleEvent(event);
    });

    this.claudeProcess.on('stderr', (text: string) => {
      if (text.trim()) {
        this.log(`[HeadlessRunner] CLI stderr: ${text.trim().slice(0, 200)}`);
      }
    });

    this.claudeProcess.on('raw', (line: string) => {
      this.log(`[HeadlessRunner] CLI raw (non-JSON): ${line.slice(0, 200)}`);
    });

    this.claudeProcess.on('exit', () => {
      this.log('[HeadlessRunner] Claude process exited');
      this.claudeReady = false;
      if (this.activeDeliveryId) {
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'failed', error: 'Claude process exited unexpectedly' });
        this.activeDeliveryId = null;
      }
      this.emit('processStopped');
      // Recover the agent instead of leaving it dead until the tab is reopened.
      this.scheduleClaudeRestart();
    });

    this.claudeProcess.on('error', (err) => {
      this.log(`[HeadlessRunner] Claude process error: ${err.message}`);
      if (this.activeDeliveryId) {
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'failed', error: err.message });
        this.activeDeliveryId = null;
      }
    });

    this.wireClaudeDemuxEvents();
    this.fileTracker.attachToClaudeDemux(this.claudeDemux);

    await this.claudeProcess.start({
      permissionMode: 'full-access',
    });
    this.claudeReady = true;
    this.claudeRestartAttempts = 0;
    this.emit('processStarted');
    this.log('[HeadlessRunner] Claude process started');
  }

  /** Restart the persistent Claude process after an unexpected exit, with backoff. */
  private scheduleClaudeRestart(): void {
    if (this.disposed || this.provider !== 'claude') return;
    if (this.claudeRestartTimer) return;
    if (this.claudeRestartAttempts >= CLAUDE_RESTART_MAX_ATTEMPTS) {
      this.log(`[HeadlessRunner] Claude auto-restart gave up after ${CLAUDE_RESTART_MAX_ATTEMPTS} attempts; agent stays offline until the tab is reopened`);
      return;
    }
    const attempt = this.claudeRestartAttempts++;
    const delay = Math.min(CLAUDE_RESTART_BASE_MS * Math.pow(2, Math.min(attempt, 4)), CLAUDE_RESTART_MAX_MS);
    this.log(`[HeadlessRunner] Scheduling Claude restart in ${delay}ms (attempt ${attempt + 1}/${CLAUDE_RESTART_MAX_ATTEMPTS})`);
    this.claudeRestartTimer = setTimeout(() => {
      this.claudeRestartTimer = null;
      if (this.disposed) return;
      // Detach the dead process/demux before standing up a fresh pair.
      this.claudeProcess?.removeAllListeners();
      this.claudeDemux?.removeAllListeners();
      this.claudeProcess = null;
      this.claudeDemux = null;
      this.startClaude().catch((err) => {
        this.log(`[HeadlessRunner] Claude restart failed: ${err instanceof Error ? err.message : String(err)}`);
        this.scheduleClaudeRestart();
      });
    }, delay);
  }

  private wireClaudeDemuxEvents(): void {
    if (!this.claudeDemux) return;

    this.claudeDemux.on('init', () => {
      this.log('[HeadlessRunner] Claude init received');
    });

    this.claudeDemux.on('messageStart', (data: { messageId: string; model?: string }) => {
      this.log(`[HeadlessRunner] messageStart: id=${data.messageId} model=${data.model || 'unknown'}`);
    });

    this.claudeDemux.on('textDelta', (data: { text: string }) => {
      if (!this.activeDeliveryId) return;
      if (!this.firstTokenSent) {
        this.firstTokenSent = true;
        this.log(`[HeadlessRunner] First text token for delivery ${this.activeDeliveryId}`);
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'firstToken' });
      }
      this.responseText += data.text;
      this.emitAgentEvent(this.activeDeliveryId, { kind: 'textDelta', text: data.text });
    });

    this.claudeDemux.on('toolUseStart', (data: { toolName: string; toolId: string }) => {
      this.log(`[HeadlessRunner] toolUseStart: ${data.toolName} (${data.toolId})`);
    });

    this.claudeDemux.on('messageDelta', (data: { stopReason: string }) => {
      this.log(`[HeadlessRunner] messageDelta: stopReason=${data.stopReason}`);
    });

    // Capture text from finalized assistant messages as fallback for tool-use-only turns
    this.claudeDemux.on('assistantMessage', (event: AssistantMessage) => {
      if (!this.activeDeliveryId) return;
      const blockTypes = event.message.content.map(b => b.type).join(', ');
      this.log(`[HeadlessRunner] assistantMessage: blocks=[${blockTypes}] stopReason=${event.message.stop_reason}`);
      const textParts = event.message.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text!);
      if (textParts.length > 0) {
        const msgText = textParts.join('\n');
        if (this.assistantTextFallback) this.assistantTextFallback += '\n';
        this.assistantTextFallback += msgText;
        // Bucket by stop_reason: messages that end in a tool call are interleaved
        // narration ("thoughts"); the final (non-tool_use) message is the answer.
        if (event.message.stop_reason === 'tool_use') {
          this.thinkingTextParts.push(msgText);
        } else {
          this.answerTextParts.push(msgText);
        }
        this.log(`[HeadlessRunner] assistantMessage text: ${msgText.slice(0, 100)}...`);
      }
    });

    this.claudeDemux.on('result', (event: ResultSuccess | ResultError) => {
      const subtype = event?.subtype || 'unknown';
      if (subtype === 'error') {
        const errEvent = event as ResultError;
        this.log(`[HeadlessRunner] result: ERROR - ${errEvent.error}`);
      } else {
        const successEvent = event as ResultSuccess;
        this.log(`[HeadlessRunner] result: success, cost=$${successEvent.cost_usd?.toFixed(4) || '?'}, duration=${successEvent.duration_ms || '?'}ms`);
      }
      if (!this.activeDeliveryId) {
        this.log('[HeadlessRunner] result received but no active delivery - ignoring');
        return;
      }
      this.fileTracker.finishTurn();
      // Prefer streaming text; fall back to assistant message text (covers tool-use-only turns)
      const fullText = this.responseText || this.assistantTextFallback;
      if (!this.responseText && this.assistantTextFallback) {
        this.log(`[HeadlessRunner] Using assistantMessage fallback (${this.assistantTextFallback.length} chars)`);
      }
      // Separate interleaved narration ("thoughts") from the final answer so the
      // UI can present them distinctly. Only split when both parts exist.
      const answerText = this.answerTextParts.join('\n\n').trim();
      const thinkingText = this.thinkingTextParts.join('\n\n').trim();
      const hasSplit = answerText.length > 0 && thinkingText.length > 0;
      this.log(`[HeadlessRunner] Completing delivery ${this.activeDeliveryId}: streamingText=${this.responseText.length} chars, fallbackText=${this.assistantTextFallback.length} chars, finalText=${fullText.length} chars, split=${hasSplit} (answer=${answerText.length}, thinking=${thinkingText.length})`);
      this.emitAgentEvent(this.activeDeliveryId, {
        kind: 'completed',
        fullText,
        answerText: hasSplit ? answerText : undefined,
        thinkingText: hasSplit ? thinkingText : undefined,
      });
      this.activeDeliveryId = null;
    });
  }

  private async deliverClaude(deliveryId: string, prompt: string): Promise<void> {
    this.log(`[HeadlessRunner] deliverClaude: id=${deliveryId} processReady=${this.claudeReady} busy=${!!this.activeDeliveryId} promptLen=${prompt.length}`);

    if (!this.claudeProcess || !this.claudeReady) {
      this.log(`[HeadlessRunner] REJECT: process=${!!this.claudeProcess} ready=${this.claudeReady}`);
      this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Claude process not ready' });
      return;
    }

    if (this.activeDeliveryId) {
      this.log(`[HeadlessRunner] REJECT: busy with ${this.activeDeliveryId}`);
      this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Claude is busy with another delivery' });
      return;
    }

    this.activeDeliveryId = deliveryId;
    this.responseText = '';
    this.assistantTextFallback = '';
    this.thinkingTextParts = [];
    this.answerTextParts = [];
    this.firstTokenSent = false;
    this.fileTracker.startTurn(deliveryId);

    this.emitAgentEvent(deliveryId, { kind: 'accepted' });
    this.emitAgentEvent(deliveryId, { kind: 'started' });

    this.log(`[HeadlessRunner] Sending prompt to Claude CLI (${prompt.length} chars): ${prompt.slice(0, 150)}...`);
    this.claudeProcess.sendUserMessage(prompt);
    this.log(`[HeadlessRunner] Prompt sent to stdin, waiting for CLI response events...`);
  }

  // -- Codex --

  private async deliverCodex(deliveryId: string, prompt: string, busyPolicy: MPAgentBusyPolicy | null): Promise<void> {
    if (!this.codexProcess) {
      this.codexProcess = new CodexExecProcessManager(this.context);
      this.codexDemux = new CodexExecDemux();
      this.codexProcess.setLogger((msg) => this.log(`[Codex] ${msg}`));
      this.wireCodexEvents();
      this.fileTracker.attachToCodexDemux(this.codexDemux);
    }

    // Handle auto-steer: cancel current turn
    if (this.codexProcess.isTurnRunning && busyPolicy === 'codex-auto-steer') {
      const previousDeliveryId = this.activeDeliveryId;
      this.log(`[HeadlessRunner] Codex auto-steer: canceling active turn for ${previousDeliveryId}`);
      this.codexProcess.cancelTurn();

      // Wait for turn to stop
      const stopped = await this.waitForCodexTurnStop(STEER_CANCEL_TIMEOUT_MS);
      if (!stopped && this.codexProcess.isTurnRunning) {
        this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Could not stop current Codex turn for auto-steer' });
        return;
      }

      // Mark the previous delivery as interrupted
      if (previousDeliveryId) {
        this.emitAgentEvent(previousDeliveryId, { kind: 'interrupted', interruptedByDeliveryId: deliveryId });
      }
    } else if (this.codexProcess.isTurnRunning) {
      this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Codex turn already running' });
      return;
    }

    this.activeDeliveryId = deliveryId;
    this.responseText = '';
    this.assistantTextFallback = '';
    this.thinkingTextParts = [];
    this.answerTextParts = [];
    this.firstTokenSent = false;
    this.fileTracker.startTurn(deliveryId);
    await this.fileTracker.takeSnapshotBefore();

    this.emitAgentEvent(deliveryId, { kind: 'accepted' });

    try {
      await this.codexProcess.runTurn({
        prompt,
        threadId: this.codexThreadId || undefined,
      });
      this.emitAgentEvent(deliveryId, { kind: 'started' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.emitAgentEvent(deliveryId, { kind: 'failed', error: errMsg });
      this.activeDeliveryId = null;
    }
  }

  private wireCodexEvents(): void {
    if (!this.codexProcess || !this.codexDemux) return;

    this.codexProcess.on('event', (event) => {
      this.codexDemux!.handleEvent(event);
    });

    this.codexProcess.on('exit', () => {
      this.log('[HeadlessRunner] Codex process exited');
      this.emit('processStopped');
    });

    this.codexProcess.on('error', (err) => {
      this.log(`[HeadlessRunner] Codex error: ${err.message}`);
      if (this.activeDeliveryId) {
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'failed', error: err.message });
        this.activeDeliveryId = null;
      }
    });

    this.codexDemux.on('threadStarted', (data: { threadId: string }) => {
      this.codexThreadId = data.threadId;
      this.log(`[HeadlessRunner] Codex thread: ${data.threadId}`);
    });

    this.codexDemux.on('agentMessage', (data: { text: string }) => {
      if (!this.activeDeliveryId) return;
      if (!this.firstTokenSent) {
        this.firstTokenSent = true;
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'firstToken' });
      }
      this.responseText += data.text;
      this.emitAgentEvent(this.activeDeliveryId, { kind: 'textDelta', text: data.text });
    });

    this.codexDemux.on('turnCompleted', () => {
      if (!this.activeDeliveryId) return;
      const completedDeliveryId = this.activeDeliveryId;
      this.fileTracker.finishTurn();
      this.fileTracker.diffSnapshot(completedDeliveryId).catch((err) => {
        this.log(`[HeadlessRunner] Snapshot diff error: ${err}`);
      });
      this.emitAgentEvent(completedDeliveryId, { kind: 'completed', fullText: this.responseText });
      this.activeDeliveryId = null;
    });

    this.codexDemux.on('error', (data: { message: string }) => {
      if (!this.activeDeliveryId) return;
      this.emitAgentEvent(this.activeDeliveryId, { kind: 'failed', error: data.message });
      this.activeDeliveryId = null;
    });
  }

  private waitForCodexTurnStop(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.codexProcess?.isTurnRunning) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onExit = () => {
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.codexProcess?.off('exit', onExit);
      };

      this.codexProcess!.once('exit', onExit);
    });
  }

  // -- Shared --

  private emitAgentEvent(deliveryId: string, event: AgentEventPayload): void {
    this.emit('agentEvent', deliveryId, event);
  }
}
