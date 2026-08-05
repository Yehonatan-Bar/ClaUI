/**
 * Pure eligibility planner for tab hibernation. No vscode imports so the
 * logic is unit-testable under `node --test` (see tests/hibernation/).
 *
 * Two levels:
 *  - 'light': stop the CLI process tree (frees its RAM/CPU and MCP children)
 *    but keep the webview panel. Waking is transparent: focus, banner click,
 *    or a typed message respawns with --resume + skipReplay.
 *  - 'deep': additionally replace the webview content with a static
 *    placeholder (React app + chat DOM torn down). The tab STAYS in the tab
 *    bar; focusing it rebuilds the app and resumes with full history reload.
 */

export interface HibernationConfig {
  enabled: boolean;
  /** Idle hours before light hibernation. */
  idleHours: number;
  /** Idle hours before deep hibernation. 0 disables deep hibernation.
   *  Effective threshold is never below idleHours. */
  deepIdleHours: number;
}

export interface HibernationCandidate {
  tabId: string;
  /** 'claude' = SessionTab (incl. Happy/bridge), 'codex' = CodexSessionTab,
   *  'other' = multi-participant or unknown (never hibernated). */
  kind: 'claude' | 'codex' | 'other';
  /** A resumable session id is known (entry or live tab). */
  hasSessionId: boolean;
  /** A CLI process is currently running for this tab. */
  processRunning: boolean;
  isBusy: boolean;
  /** Panel is visible in some editor group (active tabs are always visible). */
  isVisible: boolean;
  /** Already asleep: light-hibernated or in boot-time lazy-resume state
   *  (CLI intentionally not spawned). Only blocks another 'light' action. */
  isSleeping: boolean;
  /** Already deep-hibernated (placeholder webview). Blocks another 'deep'. */
  isDeepSleeping: boolean;
  /** Review loop, merge assistant, btw session or turn capture is active. */
  hasBackgroundWork: boolean;
  /** Smart Search tabs may light-hibernate but never deep-hibernate:
   *  they re-spawn fresh (no resumable transcript worth preserving). */
  isSearchTab: boolean;
  /** Epoch ms of the last user-visible activity (focus / busy change). */
  lastActivityAtMs: number;
}

export interface HibernationAction {
  tabId: string;
  action: 'light' | 'deep';
}

const HOUR_MS = 3_600_000;

/** Decide which tabs to hibernate now. Deep wins over light for the same tab. */
export function planHibernation(
  nowMs: number,
  config: HibernationConfig,
  candidates: HibernationCandidate[],
): HibernationAction[] {
  if (!config.enabled) {
    return [];
  }
  const lightMs = Math.max(0.05, config.idleHours) * HOUR_MS;
  const deepMs =
    config.deepIdleHours > 0
      ? Math.max(config.deepIdleHours, config.idleHours) * HOUR_MS
      : Number.POSITIVE_INFINITY;

  const actions: HibernationAction[] = [];
  for (const candidate of candidates) {
    if (candidate.kind === 'other') {
      continue;
    }
    if (candidate.isBusy || candidate.isVisible || candidate.hasBackgroundWork) {
      continue;
    }
    if (!candidate.hasSessionId) {
      continue;
    }
    const idleMs = nowMs - candidate.lastActivityAtMs;
    // Deep hibernation is claude-kind only: it swaps the webview HTML for a
    // placeholder, which only SessionTab implements. Search tabs are excluded
    // (they re-spawn fresh; nothing resumable to preserve).
    if (
      idleMs >= deepMs &&
      candidate.kind === 'claude' &&
      !candidate.isSearchTab &&
      !candidate.isDeepSleeping
    ) {
      actions.push({ tabId: candidate.tabId, action: 'deep' });
      continue;
    }
    if (
      candidate.kind === 'claude' &&
      candidate.processRunning &&
      !candidate.isSleeping &&
      idleMs >= lightMs
    ) {
      actions.push({ tabId: candidate.tabId, action: 'light' });
    }
  }
  return actions;
}
