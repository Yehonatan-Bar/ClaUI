import type { CodexReviewerSession } from './CodexReviewerSession';
import type { ReviewVerdictClassifier } from './ReviewVerdictClassifier';
import type { ReviewLoopConfig, ReviewLoopDeveloper, ReviewLoopEvent, ReviewLoopPhase } from './reviewLoopTypes';
import { buildFixPrompt, buildHandoverPrompt, buildReviewerPrompt, extractHandover } from './reviewLoopPrompts';

/** Thrown internally to unwind the loop when the user stops it. Not a real error. */
class ReviewLoopStopSignal extends Error {
  constructor() {
    super('review-loop-stopped');
    this.name = 'ReviewLoopStopSignal';
  }
}

export interface ReviewLoopDeps {
  developer: ReviewLoopDeveloper;
  reviewer: CodexReviewerSession;
  classifier: ReviewVerdictClassifier;
  config: ReviewLoopConfig;
  /** Workspace (or worktree) root the reviewer reads, read-only. */
  cwd: string | undefined;
  /** Streams transcript events to the webview panel. */
  emit: (event: ReviewLoopEvent) => void;
  log: (msg: string) => void;
}

/**
 * Drives the automatic Claude<->Codex review loop:
 *   developer writes a handover -> Codex reviews the code -> verdict ->
 *   if changes requested, developer fixes + re-handover -> repeat until
 *   approved or the round cap is hit.
 */
export class ReviewLoopOrchestrator {
  private running = false;
  private stopped = false;
  private round = 0;

  constructor(private readonly deps: ReviewLoopDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.stopped = false;
    this.round = 0;
    this.deps.log('[ReviewLoop] started');
    try {
      await this.run();
    } catch (err) {
      if (err instanceof ReviewLoopStopSignal || this.stopped) {
        // A stop was requested; any in-flight turn rejection is expected. The
        // 'stopped' status was already emitted by stop().
        this.deps.log('[ReviewLoop] stopped');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.log(`[ReviewLoop] error: ${message}`);
        this.emitStatus('error', message);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Stop the loop. Always cancels the (separate) Codex reviewer process.
   * `hardCancelDeveloper` controls whether an in-flight developer turn is also
   * interrupted: true for the Stop button, false when the user sent a message
   * (the developer adapter then only detaches, never cancels the live process).
   */
  stop(reason = 'Stopped by user.', hardCancelDeveloper = true): void {
    if (!this.running || this.stopped) {
      return;
    }
    this.stopped = true;
    this.deps.log('[ReviewLoop] stop requested');
    try {
      this.deps.reviewer.cancel();
    } catch {
      // best-effort
    }
    try {
      this.deps.classifier.cancel();
    } catch {
      // best-effort
    }
    try {
      this.deps.developer.abortTurn(hardCancelDeveloper);
    } catch {
      // best-effort
    }
    this.emitStatus('stopped', reason);
  }

  private async run(): Promise<void> {
    const { config } = this.deps;

    // Round 1: the development is already done; ask only for the handover.
    this.round = 1;
    let handover = await this.captureHandover(buildHandoverPrompt());

    // Review / classify / fix loop.
    for (;;) {
      this.throwIfStopped();
      this.emitStatus('reviewing');
      const review = await this.deps.reviewer.review(handover, {
        cwd: this.deps.cwd,
        model: config.reviewerModel,
        reasoningEffort: config.reviewerReasoningEffort || undefined,
        serviceTier: config.reviewerServiceTier || undefined,
        timeoutMs: config.turnTimeoutMs,
      });
      this.throwIfStopped();
      this.deps.emit({ kind: 'review', round: this.round, text: review });

      this.throwIfStopped();
      this.emitStatus('classifying');
      const verdict = await this.deps.classifier.classify(review, {
        model: config.classifierModel,
      });
      // Re-check after the (cancellable) classifier await so a Stop during
      // 'classifying' never emits a verdict or a terminal status after 'stopped'.
      this.throwIfStopped();
      this.deps.emit({ kind: 'verdict', round: this.round, approved: verdict.approved, reason: verdict.reason });

      if (verdict.approved) {
        this.emitStatus('approved', `Approved after ${this.round} round(s).`);
        return;
      }

      if (this.round >= config.maxRounds) {
        this.emitStatus('max-rounds', `Reached the ${config.maxRounds}-round limit without approval. Review the open feedback above.`);
        return;
      }

      // Fix round: forward the feedback to the developer and capture a fresh handover.
      this.throwIfStopped();
      this.round += 1;
      handover = await this.captureHandover(buildFixPrompt(review), review);
    }
  }

  /** Run a developer turn, emit the produced handover, and retry once if it is empty. */
  private async captureHandover(prompt: string, priorReview?: string): Promise<string> {
    this.emitStatus(priorReview ? 'awaiting-fix' : 'awaiting-handover');
    const firstText = await this.deps.developer.captureTurn(prompt, this.deps.config.turnTimeoutMs);
    let handover = extractHandover(firstText);

    if (!handover) {
      this.throwIfStopped();
      this.deps.log('[ReviewLoop] no marked handover; retrying once.');
      this.deps.emit({
        kind: 'info',
        round: this.round,
        text: 'No handover between the markers was found; asking the developer to re-emit it.',
      });
      const retryText = await this.deps.developer.captureTurn(
        'Your previous reply did not contain the handover wrapped between the markers. ' + prompt,
        this.deps.config.turnTimeoutMs,
      );
      handover = extractHandover(retryText);
    }

    if (!handover) {
      throw new Error('The developer did not produce a handover between the required markers.');
    }

    this.throwIfStopped();
    // Show the ACTUAL message sent to the reviewer (reviewer role + verdict format
    // + the handover), not just the bare developer document, so the panel reflects
    // exactly what Codex receives.
    this.deps.emit({ kind: 'handover', round: this.round, text: buildReviewerPrompt(handover) });
    return handover;
  }

  private emitStatus(phase: ReviewLoopPhase, detail?: string): void {
    this.deps.emit({
      kind: 'status',
      phase,
      round: this.round,
      maxRounds: this.deps.config.maxRounds,
      detail,
    });
  }

  private throwIfStopped(): void {
    if (this.stopped) {
      throw new ReviewLoopStopSignal();
    }
  }
}
