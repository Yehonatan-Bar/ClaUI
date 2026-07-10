import type { ReviewLoopEvent, ReviewLoopPhase } from '../types/webview-messages';

// Re-export the wire types so review-loop modules import from one place.
export type { ReviewLoopEvent, ReviewLoopPhase };

/** Runtime configuration for the automatic review loop (from claudeMirror.reviewLoop.*). */
export interface ReviewLoopConfig {
  /** Maximum review rounds before stopping and returning the open feedback to the user. */
  maxRounds: number;
  /** Codex model id for the reviewer ('' = fall back to codex.model, then Codex default). */
  reviewerModel: string;
  /** Reviewer reasoning effort, e.g. 'xhigh', 'max', or 'ultra' ('' = fall back to codex.reasoningEffort). */
  reviewerReasoningEffort: string;
  /** Reviewer service tier, 'fast' or '' (= fall back to codex.serviceTier). */
  reviewerServiceTier: string;
  /** Claude model id for the lightweight verdict classifier. */
  classifierModel: string;
  /** Per-turn timeout (ms) for both the developer turn and the reviewer turn. */
  turnTimeoutMs: number;
}

export const DEFAULT_REVIEW_LOOP_CONFIG: ReviewLoopConfig = {
  maxRounds: 5,
  reviewerModel: 'gpt-5.5',
  reviewerReasoningEffort: 'xhigh',
  reviewerServiceTier: 'fast',
  classifierModel: 'claude-haiku-4-5-20251001',
  turnTimeoutMs: 3_600_000,
};

/**
 * The live developer session, abstracted so the orchestrator does not depend on
 * SessionTab directly. SessionTab supplies an adapter backed by captureNextTurn().
 */
export interface ReviewLoopDeveloper {
  /** Inject a prompt into the live session and resolve with the final assistant text of that turn. */
  captureTurn(prompt: string, timeoutMs: number): Promise<string>;
  /**
   * Abort an in-flight captured developer turn. `hard=true` also interrupts the
   * live CLI turn (Stop button); `hard=false` only detaches the capture (used when
   * the user sends a manual message, so we never cancel-then-write the same process).
   * Must be a no-op when no developer turn is in flight.
   */
  abortTurn(hard: boolean): void;
}

/** Binary verdict produced by the classifier. */
export interface ReviewVerdict {
  approved: boolean;
  reason: string;
}
