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
