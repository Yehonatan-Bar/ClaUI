import type { RemoteEvent } from '../../../remote-control-shared/protocol';
import type { EventLog } from './EventLog';

/**
 * Detects when a chat turn in one tab is over, from the tab's event stream.
 *
 * Arm it BEFORE dispatching the action that starts the turn (it subscribes
 * immediately), then await `promise`. Resolution rules:
 *  - turnComplete, or processBusy:false after the turn started  -> completed
 *    (after a short settle window so the final assistantMessage lands)
 *  - planApprovalRequired (or a pending approval at settle time) -> awaiting_approval
 *  - cancelRequest action during the wait                       -> cancelled
 *  - usage-limit queueing                                       -> queued_usage_limit
 *  - sessionEnded                                               -> session_ended
 *  - error without the turn ever starting                       -> error
 *  - nothing started within startGraceMs and tab idle            -> idle
 *  - overall timeout                                            -> timeout
 */

export type TurnStatus =
  | 'completed'
  | 'awaiting_approval'
  | 'cancelled'
  | 'queued_usage_limit'
  | 'session_ended'
  | 'error'
  | 'idle'
  | 'timeout';

export interface TurnOutcome {
  status: TurnStatus;
  /** Seq of the event that resolved the wait (or the log's last seq). */
  endSeq: number;
  error?: string;
}

export interface TurnWaitOptions {
  tabId: string;
  timeoutMs: number;
  /** Treat the turn as already running (e.g. wait_for_idle on a busy tab). */
  initiallyBusy: boolean;
  /** Resolve 'idle' when no busy signal arrives within this window and the tab is idle. */
  startGraceMs?: number;
  /** Delay after the end signal, letting trailing messages arrive. */
  settleMs?: number;
  isBusy: () => boolean;
  hasPendingApproval: () => boolean;
  signal?: AbortSignal;
}

export interface ArmedTurnWaiter {
  promise: Promise<TurnOutcome>;
  cancel: () => void;
}

export function armTurnWaiter(log: EventLog, opts: TurnWaitOptions): ArmedTurnWaiter {
  const settleMs = opts.settleMs ?? 700;
  const startGraceMs = opts.startGraceMs ?? 20_000;

  let resolveOuter: (outcome: TurnOutcome) => void = () => undefined;
  const promise = new Promise<TurnOutcome>((resolve) => {
    resolveOuter = resolve;
  });

  let finished = false;
  let started = opts.initiallyBusy;
  let lastError: string | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSettle = (): void => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const finish = (status: TurnStatus, endSeq = log.lastSeq): void => {
    if (finished) return;
    finished = true;
    clearSettle();
    if (errorTimer) clearTimeout(errorTimer);
    clearTimeout(timeoutTimer);
    clearTimeout(graceTimer);
    unsubscribe();
    opts.signal?.removeEventListener('abort', onAbort);
    resolveOuter({ status, endSeq, error: lastError });
  };

  /** Finish after settleMs unless another signal arrives first. */
  const settleThen = (status: TurnStatus, seq: number, delay = settleMs): void => {
    clearSettle();
    settleTimer = setTimeout(() => {
      if (status === 'completed' && opts.hasPendingApproval()) {
        finish('awaiting_approval', seq);
        return;
      }
      finish(status, seq);
    }, delay);
  };

  const onEvent = (event: RemoteEvent): void => {
    if (finished || event.tabId !== opts.tabId) {
      return;
    }
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.direction === 'in') {
      if (event.type === 'cancelRequest') {
        settleThen('cancelled', event.seq, 300);
      }
      return;
    }
    if (event.direction !== 'out') {
      return;
    }
    switch (event.type) {
      case 'processBusy':
        if (data.busy === true) {
          started = true;
          clearSettle();
          if (errorTimer) {
            clearTimeout(errorTimer);
            errorTimer = null;
          }
        } else if (started) {
          settleThen('completed', event.seq);
        }
        break;
      case 'messageDeferred':
        started = true;
        break;
      case 'turnComplete':
        started = true;
        settleThen('completed', event.seq, Math.min(settleMs, 400));
        break;
      case 'planApprovalRequired':
        settleThen('awaiting_approval', event.seq, 300);
        break;
      case 'sessionEnded':
        settleThen('session_ended', event.seq, 200);
        break;
      case 'usageQueuedPromptState':
        if (data.queued === true) {
          finish('queued_usage_limit', event.seq);
        }
        break;
      case 'error':
        lastError = typeof data.message === 'string' ? data.message : 'Unknown error';
        if (!started && !errorTimer) {
          errorTimer = setTimeout(() => {
            if (!started && !opts.isBusy()) {
              finish('error', event.seq);
            }
          }, 1500);
        }
        break;
      default:
        break;
    }
  };

  const unsubscribe = log.subscribe(onEvent);
  const timeoutTimer = setTimeout(() => finish('timeout'), Math.max(1, opts.timeoutMs));
  const graceTimer = setTimeout(() => {
    if (!started && !opts.isBusy()) {
      finish(opts.hasPendingApproval() ? 'awaiting_approval' : lastError ? 'error' : 'idle');
    }
  }, Math.min(startGraceMs, Math.max(1, opts.timeoutMs)));
  const onAbort = (): void => finish('timeout');
  opts.signal?.addEventListener('abort', onAbort);
  if (opts.signal?.aborted) {
    onAbort();
  }

  return { promise, cancel: () => finish('timeout') };
}
