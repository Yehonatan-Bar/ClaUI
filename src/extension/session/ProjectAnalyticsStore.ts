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
  /** Serialize workspaceState writes to avoid read-modify-write races across tabs */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly workspaceState: vscode.Memento) {}

  private sanitize(raw: unknown): SessionSummary[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    // Filter out corrupt entries and normalize legacy summaries (missing provider => Claude)
    const sessions: SessionSummary[] = [];
    for (const s of raw) {
      if (!s || typeof s !== 'object') {
        continue;
      }
      const candidate = s as Partial<SessionSummary>;
      if (typeof candidate.sessionId !== 'string' || typeof candidate.endedAt !== 'string') {
        continue;
      }
      sessions.push({
        ...(candidate as SessionSummary),
        provider: candidate.provider === 'codex' ? 'codex' : 'claude',
      });
    }
    return sessions.sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
    );
  }

  private enqueueWrite(op: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(op, op);
    return this.writeQueue;
  }

  /** Get all stored session summaries, sorted by endedAt descending */
  getSummaries(): SessionSummary[] {
    const raw = this.workspaceState.get<unknown>(STORAGE_KEY, []);
    return this.sanitize(raw);
  }

  /**
   * Wait for queued writes, then read a stable snapshot.
   * Useful for UI requests that happen immediately after a save trigger.
   */
  async getSummariesAfterPendingWrites(): Promise<SessionSummary[]> {
    await this.writeQueue.catch(() => undefined);
    return this.getSummaries();
  }

  /** Save or update a session summary */
  async saveSummary(summary: SessionSummary): Promise<void> {
    await this.enqueueWrite(async () => {
      const sessions = this.getSummaries();
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
    });
  }

  /** Remove a single session by ID */
  async removeSummary(sessionId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const sessions = this.getSummaries();
      const filtered = sessions.filter(s => s.sessionId !== sessionId);
      await this.workspaceState.update(STORAGE_KEY, filtered);
    });
  }

  /** Clear all stored session summaries */
  async clearAll(): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.workspaceState.update(STORAGE_KEY, []);
    });
  }
}
