import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { CodexExecDemux } from '../process/CodexExecDemux';
import { FileChangeTracker } from './FileChangeTracker';
import type { AgentEventPayload, MPAgentBusyPolicy, MPFileChange, MPFileChangeReportSource } from './MultiParticipantProtocol';

const STEER_CANCEL_TIMEOUT_MS = 8000;

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
  private firstTokenSent = false;
  private disposed = false;

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

  dispose(): void {
    this.disposed = true;
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
      this.claudeDemux!.handleEvent(event);
    });

    this.claudeProcess.on('exit', () => {
      this.log('[HeadlessRunner] Claude process exited');
      this.claudeReady = false;
      if (this.activeDeliveryId) {
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'failed', error: 'Claude process exited unexpectedly' });
        this.activeDeliveryId = null;
      }
      this.emit('processStopped');
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
    this.emit('processStarted');
    this.log('[HeadlessRunner] Claude process started');
  }

  private wireClaudeDemuxEvents(): void {
    if (!this.claudeDemux) return;

    this.claudeDemux.on('init', () => {
      this.log('[HeadlessRunner] Claude init received');
    });

    this.claudeDemux.on('textDelta', (data: { text: string }) => {
      if (!this.activeDeliveryId) return;
      if (!this.firstTokenSent) {
        this.firstTokenSent = true;
        this.emitAgentEvent(this.activeDeliveryId, { kind: 'firstToken' });
      }
      this.responseText += data.text;
      this.emitAgentEvent(this.activeDeliveryId, { kind: 'textDelta', text: data.text });
    });

    this.claudeDemux.on('result', () => {
      if (!this.activeDeliveryId) return;
      this.fileTracker.finishTurn();
      this.emitAgentEvent(this.activeDeliveryId, { kind: 'completed', fullText: this.responseText });
      this.activeDeliveryId = null;
    });
  }

  private async deliverClaude(deliveryId: string, prompt: string): Promise<void> {
    if (!this.claudeProcess || !this.claudeReady) {
      this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Claude process not ready' });
      return;
    }

    // If busy with another delivery, reject (Claude supports sequential, not parallel)
    if (this.activeDeliveryId) {
      this.emitAgentEvent(deliveryId, { kind: 'rejected', error: 'Claude is busy with another delivery' });
      return;
    }

    this.activeDeliveryId = deliveryId;
    this.responseText = '';
    this.firstTokenSent = false;
    this.fileTracker.startTurn(deliveryId);

    this.emitAgentEvent(deliveryId, { kind: 'accepted' });
    this.emitAgentEvent(deliveryId, { kind: 'started' });

    this.claudeProcess.sendUserMessage(prompt);
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
