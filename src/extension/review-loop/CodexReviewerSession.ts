import * as vscode from 'vscode';
import { CodexExecProcessManager } from '../process/CodexExecProcessManager';
import { CodexExecDemux } from '../process/CodexExecDemux';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';
import { REVIEWER_SYSTEM_PROMPT, buildReviewerPrompt } from './reviewLoopPrompts';

interface PendingReview {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Headless Codex reviewer for the review loop. Runs `codex exec` per turn while
 * keeping the thread id between turns, so the reviewer accumulates context across
 * rounds. Always read-only over the workspace; never modifies files.
 *
 * Mirrors the CodexBackgroundSession wiring but exposes a single promise-based
 * review() call instead of EventEmitter streaming.
 */
export class CodexReviewerSession {
  private readonly processManager: CodexExecProcessManager;
  private readonly demux: CodexExecDemux;
  private readonly log: (msg: string) => void;
  private threadId: string | null = null;
  private accumulated = '';
  private pending: PendingReview | null = null;
  private disposed = false;

  constructor(context: vscode.ExtensionContext, logger?: (msg: string) => void) {
    this.log = logger ?? (() => {});
    this.processManager = new CodexExecProcessManager(context);
    this.processManager.setLogger((msg) => this.log(`[ReviewerPM] ${msg}`));
    this.demux = new CodexExecDemux();
    this.wire();
  }

  private wire(): void {
    this.processManager.on('event', (event: CodexExecJsonEvent) => {
      this.demux.handleEvent(event);
    });

    this.processManager.on('stderr', (text: string) => {
      const trimmed = text.trim();
      if (trimmed) {
        this.log(`[Reviewer] stderr: ${trimmed.slice(0, 300)}`);
      }
    });

    this.processManager.on('error', (err: Error) => {
      this.failPending(err);
    });

    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      if (!this.pending) {
        return;
      }
      if (!this.processManager.cancelledByUser && info.code !== null && info.code !== 0) {
        this.failPending(new Error(`Codex reviewer exited with code ${info.code}.`));
        return;
      }
      // Clean exit but turn.completed never arrived: resolve with what we have.
      this.settle(this.accumulated);
    });

    this.demux.on('threadStarted', (data: { threadId: string }) => {
      this.threadId = data.threadId || this.threadId;
      this.log(`[Reviewer] thread: ${this.threadId ?? '(none)'}`);
    });

    this.demux.on('agentMessage', (data: { text: string }) => {
      const text = data.text || '';
      if (text) {
        this.accumulated += (this.accumulated ? '\n' : '') + text;
      }
    });

    this.demux.on('turnCompleted', () => {
      this.settle(this.accumulated);
    });

    this.demux.on('error', (data: { message: string }) => {
      this.failPending(new Error(data.message || 'Codex reviewer turn failed.'));
    });
  }

  /**
   * Run one review turn against the workspace and resolve with the reviewer's text.
   * Read-only sandbox; the reviewer rubric is injected as the Codex instructions.
   */
  async review(
    handover: string,
    opts: { cwd?: string; model?: string; reasoningEffort?: string; serviceTier?: string; timeoutMs: number },
  ): Promise<string> {
    if (this.disposed) {
      throw new Error('Reviewer session is disposed.');
    }
    if (this.pending || this.processManager.isTurnRunning) {
      throw new Error('A reviewer turn is already running.');
    }
    this.accumulated = '';
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.log('[Reviewer] turn timed out; stopping process.');
        try {
          this.processManager.stop();
        } catch {
          // best-effort
        }
        this.failPending(new Error('Codex reviewer timed out.'));
      }, opts.timeoutMs);
      this.pending = { resolve, reject, timer };
      this.processManager
        .runTurn({
          prompt: buildReviewerPrompt(handover),
          threadId: this.threadId ?? undefined,
          cwd: opts.cwd,
          model: opts.model || undefined,
          reasoningEffort: opts.reasoningEffort,
          serviceTier: opts.serviceTier,
          forceReadOnlySandbox: true,
          appendSystemPrompt: REVIEWER_SYSTEM_PROMPT,
        })
        .catch((err) => this.failPending(err instanceof Error ? err : new Error(String(err))));
    });
  }

  /** Cancel any in-flight review turn (used when the loop is stopped). */
  cancel(): void {
    try {
      this.processManager.cancelTurn();
    } catch {
      // best-effort
    }
    this.failPending(new Error('Review cancelled.'));
  }

  private settle(text: string): void {
    if (!this.pending) {
      return;
    }
    clearTimeout(this.pending.timer);
    const done = this.pending.resolve;
    this.pending = null;
    done(text.trim());
  }

  private failPending(err: Error): void {
    if (!this.pending) {
      return;
    }
    clearTimeout(this.pending.timer);
    const fail = this.pending.reject;
    this.pending = null;
    fail(err);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failPending(new Error('Reviewer session is disposed.'));
    try {
      this.processManager.stop();
    } catch {
      // best-effort
    }
    this.processManager.removeAllListeners();
    this.demux.removeAllListeners();
  }
}
