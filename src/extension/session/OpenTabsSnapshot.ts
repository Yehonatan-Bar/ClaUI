import * as vscode from 'vscode';
import type { ProviderId } from '../types/webview-messages';

export interface OpenTabSnapshotEntry {
  tabNumber: number;
  provider: ProviderId;
  sessionId: string;
  customName?: string;
  cliPathOverride?: string;
  workspacePath?: string;
  savedAt: string;
  /** Folder this tab belongs to (TabGroupStore id). Undefined = top-level. */
  groupId?: string;
  /** Sibling order within its parent (group or top-level). */
  orderInGroup?: number;
  /** Tab kind: 'chat' is the default; 'search' is a Smart Search tab. */
  tabKind?: 'chat' | 'search';
  /** Absolute worktree path this tab's session runs in. Undefined = primary/main worktree. */
  worktreePath?: string;
  /** Claude account profile id for this tab. Undefined = Default profile (~/.claude). */
  claudeAccountProfileId?: string;
  /** Model selected for a Smart Search tab (used to re-spawn the agent on restore). */
  searchModel?: string;
  /** Per-tab picker selection (e.g. a `bridge:*` model) so a bridge tab restores
   *  its backend/model on reload — bridge values are never persisted to config. */
  selectedModel?: string;
  /** ISO timestamp — when the tab was last focused (used to pick most-recent tabs on truncation). */
  lastFocusedAt?: string;
  /** ISO timestamp — last user-visible activity (focus or busy-state change).
   *  Drives the hibernation idle clock; falls back to lastFocusedAt when absent. */
  lastActivityAt?: string;
  /** Explicit visual position (0-based), assigned on shutdown for stable restore order. */
  tabOrder?: number;
  /** Deep hibernation: true when this tab's webview content was torn down and
   *  replaced by a static placeholder (CLI stopped too) to free resources. The
   *  tab STAYS in the tab bar. On restore, such an entry is recreated as a live
   *  sleeping placeholder tab (see TAB_HIBERNATION.md), not a normal tab. */
  hibernated?: boolean;
  /** ISO timestamp — when deep hibernation happened. */
  hibernatedAt?: string;
}

export interface OpenTabsSnapshot {
  version: 1;
  entries: OpenTabSnapshotEntry[];
  activeSessionId?: string;
}

const STORAGE_KEY = 'claudeMirror.openTabsSnapshot';
const RESTORE_IN_PROGRESS_KEY = 'claudeMirror.restoreInProgress';

/**
 * Persists the set of open ClaUi tabs (sessionId + provider + metadata) in
 * workspaceState so they can be restored when VS Code reopens the workspace.
 *
 * Scope is workspaceState (per VS Code window) so snapshots do not leak
 * between projects.
 */
export class OpenTabsSnapshotStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  get(): OpenTabsSnapshot {
    const raw = this.workspaceState.get<OpenTabsSnapshot>(STORAGE_KEY);
    if (raw && raw.version === 1 && Array.isArray(raw.entries)) {
      return raw;
    }
    return { version: 1, entries: [] };
  }

  async set(snapshot: OpenTabsSnapshot): Promise<void> {
    await this.workspaceState.update(STORAGE_KEY, snapshot);
  }

  async clear(): Promise<void> {
    await this.workspaceState.update(STORAGE_KEY, undefined);
  }

  // Crash-loop breaker: a sticky flag set before restore starts and cleared
  // after restore finishes. If activation finds it still true, the previous
  // run died mid-restore and auto-restore should be skipped to avoid looping
  // through the same crash on every launch.
  isRestoreInProgress(): boolean {
    return this.workspaceState.get<boolean>(RESTORE_IN_PROGRESS_KEY, false);
  }

  async setRestoreInProgress(value: boolean): Promise<void> {
    await this.workspaceState.update(RESTORE_IN_PROGRESS_KEY, value ? true : undefined);
  }
}
