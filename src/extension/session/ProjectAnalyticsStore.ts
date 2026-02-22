import * as vscode from 'vscode';
import type { SessionSummary } from '../types/webview-messages';

const STORAGE_KEY = 'claudeMirror.projectAnalytics';
const MAX_SESSIONS = 200;

/**
 * Persists session analytics summaries in VS Code workspaceState.
 * Automatically scoped to the current workspace (= project).
 * Sessions are capped at MAX_SESSIONS, sorted by endedAt descending.
 */
export class ProjectAnalyticsStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  /** Get all stored session summaries, sorted by endedAt descending */
  getSummaries(): SessionSummary[] {
    const sessions = this.workspaceState.get<SessionSummary[]>(STORAGE_KEY, []);
    return sessions.sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
    );
  }

  /** Save or update a session summary */
  async saveSummary(summary: SessionSummary): Promise<void> {
    const sessions = this.workspaceState.get<SessionSummary[]>(STORAGE_KEY, []);
    const existingIndex = sessions.findIndex(s => s.sessionId === summary.sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex] = summary;
    } else {
      sessions.push(summary);
    }

    // Sort by endedAt descending and cap at MAX_SESSIONS
    sessions.sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
    );
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }

    await this.workspaceState.update(STORAGE_KEY, sessions);
  }

  /** Remove a single session by ID */
  async removeSummary(sessionId: string): Promise<void> {
    const sessions = this.workspaceState.get<SessionSummary[]>(STORAGE_KEY, []);
    const filtered = sessions.filter(s => s.sessionId !== sessionId);
    await this.workspaceState.update(STORAGE_KEY, filtered);
  }

  /** Clear all stored session summaries */
  async clearAll(): Promise<void> {
    await this.workspaceState.update(STORAGE_KEY, []);
  }
}
