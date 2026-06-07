/**
 * Shared types for git worktree support.
 *
 * A worktree is an isolated checkout of the same repository on its own branch.
 * ClaUi creates and manages worktrees so several sessions can edit code in
 * parallel without fighting over the same files. The dashboard joins the git
 * worktree list against the live tab list to show which sessions run on each.
 */

/** A single git worktree as reported by `git worktree list --porcelain`. */
export interface WorktreeInfo {
  /** Absolute filesystem path of the worktree checkout. */
  path: string;
  /** Branch checked out in this worktree (e.g. "worktree-feature-x"), or null if detached. */
  branch: string | null;
  /** Short or full HEAD commit sha, or null if unborn. */
  headSha: string | null;
  /** True for the primary worktree (the original repo checkout / workspace root). */
  isMain: boolean;
  /** True if the worktree is locked (`git worktree lock`). */
  isLocked: boolean;
  /** True if git considers the worktree prunable (its directory is gone). */
  isPrunable: boolean;
  /** True if HEAD is detached (no branch). */
  isDetached: boolean;
  /** Set when this worktree has a paused (conflicted) merge that must be resolved or aborted. */
  mergeInProgress?: MergeInProgress;
}

/** A paused merge sitting in a worktree, awaiting resolution or abort. */
export interface MergeInProgress {
  /** A normal `git merge` writes MERGE_HEAD; a squash merge does not. */
  kind: 'merge' | 'squash';
  /** Files with unresolved conflict markers (`git ls-files -u`). */
  conflictedFiles: string[];
}

/** How the source branch is integrated into the target. Rebase is intentionally excluded. */
export type MergeStrategy = 'merge' | 'squash' | 'ff';

/**
 * Read-only analysis of "merge <source> into <target>", computed without
 * touching the working tree, to drive the merge wizard before the user commits.
 */
export interface MergePreview {
  success: boolean;
  /** Friendly message when success is false (not a git repo, bad branch, etc.). */
  message?: string;
  sourceBranch: string;
  sourcePath: string;
  targetBranch: string;
  /** Short HEAD sha of the target branch. */
  targetSha: string | null;
  /** Local branches offered in the target dropdown. */
  branches: string[];
  /** Commits on source not yet in target (count). */
  ahead: number;
  /** Commits on target not yet in source (count); >0 disables fast-forward. */
  behind: number;
  /** Subjects of the commits that would be merged (`%h\t%s`), newest first. */
  commits: { sha: string; subject: string }[];
  /** True when the source worktree has uncommitted/untracked changes (won't be merged). */
  sourceDirty: boolean;
  /** Conflict prediction via `git merge-tree`; 'unknown' when git < 2.38. */
  conflict: 'clean' | 'conflict' | 'unknown';
  /** Files predicted to conflict (when conflict === 'conflict'). */
  conflictFiles: string[];
  /** Nothing to merge: source is already contained in target. */
  alreadyMerged: boolean;
  /** True when the main checkout would need switching to the target to run the merge. */
  needsMainSwitch: boolean;
  /** Set when the merge cannot proceed at all (detached target, unrelated histories, in-progress git state). */
  blockedReason?: string;
}

/** Outcome of a merge / complete / abort / undo operation. */
export interface MergeResult {
  /** What the user was doing, so the webview can route the result. */
  action: 'merge' | 'complete' | 'abort' | 'undo';
  /** clean = finished; conflict = paused awaiting resolution; error = failed. */
  phase: 'clean' | 'conflict' | 'error';
  success: boolean;
  message: string;
  targetBranch?: string;
  targetPath?: string;
  /** New commit created on the target (merge/squash commit), short sha. */
  newSha?: string;
  /** Target sha captured before the merge, for undo. */
  preSha?: string;
  /** Strategy used, so undo/abort know whether MERGE_HEAD exists. */
  strategy?: MergeStrategy;
  /** Files still in conflict (phase === 'conflict'). */
  conflictFiles?: string[];
  /** True when the merge commit is provably unpushed, enabling the guarded discard option. */
  canDiscard?: boolean;
  /** True when the source worktree was removed as part of "remove after merge". */
  removed?: boolean;
  /** Push outcome note when "push after merge" was requested. */
  pushNote?: string;
}

/** Inputs for a merge operation, assembled by the wizard. */
export interface MergeOptions {
  /** Filesystem path of the source worktree (its branch is the merge source). */
  sourcePath: string;
  /** Branch to merge into. */
  targetBranch: string;
  /** How to integrate the source into the target. */
  strategy: MergeStrategy;
  /** Commit message for a squash merge (ignored for other strategies). */
  commitMessage?: string;
  /** User approved switching the main checkout to the target when it isn't checked out anywhere. */
  allowMainSwitch: boolean;
}

/** A live ClaUi session (tab) that is running inside a given worktree. */
export interface WorktreeSessionRef {
  /** Tab id (e.g. "tab-3"). */
  tabId: string;
  /** Human-friendly tab number. */
  tabNumber: number;
  /** Display name shown on the tab. */
  displayName: string;
  /** Provider running in the tab ("claude", "codex", "remote"). */
  provider: string;
  /** The tab's slot color (used for the dot in the dashboard). */
  slotColor: string;
  /** Whether the session is currently processing a request. */
  isBusy: boolean;
}

/** A worktree plus the sessions currently running inside it. */
export interface WorktreeWithSessions extends WorktreeInfo {
  sessions: WorktreeSessionRef[];
}

/** Result of a create/remove mutation, posted back to the webview. */
export interface WorktreeActionResult {
  success: boolean;
  message: string;
  /** The created/affected worktree path, when applicable. */
  worktreePath?: string;
  /** True when a remove failed because the worktree is dirty and needs force. */
  requiresForce?: boolean;
}
