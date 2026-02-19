import * as vscode from 'vscode';

/** Metadata persisted for each conversation session */
export interface SessionMetadata {
  sessionId: string;
  name: string;
  model: string;
  startedAt: string;   // ISO date string
  lastActiveAt: string; // ISO date string
  firstPrompt?: string; // First line of the user's first message
}

const STORAGE_KEY = 'claudeMirror.sessionHistory';
const MAX_SESSIONS = 100;

/**
 * Persists session metadata in VS Code globalState.
 * Sessions are capped at MAX_SESSIONS, sorted by lastActiveAt descending.
 */
export class SessionStore {
  constructor(private readonly globalState: vscode.Memento) {}

  /** Get all stored sessions, sorted by lastActiveAt descending */
  getSessions(): SessionMetadata[] {
    const sessions = this.globalState.get<SessionMetadata[]>(STORAGE_KEY, []);
    return sessions.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
  }

  /** Get a single session by ID, or undefined if not found */
  getSession(sessionId: string): SessionMetadata | undefined {
    const sessions = this.globalState.get<SessionMetadata[]>(STORAGE_KEY, []);
    return sessions.find(s => s.sessionId === sessionId);
  }

  /** Save or update a session's metadata */
  async saveSession(metadata: SessionMetadata): Promise<void> {
    const sessions = this.globalState.get<SessionMetadata[]>(STORAGE_KEY, []);
    const existingIndex = sessions.findIndex(s => s.sessionId === metadata.sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex] = metadata;
    } else {
      sessions.push(metadata);
    }

    // Sort by lastActiveAt descending and cap at MAX_SESSIONS
    sessions.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }

    await this.globalState.update(STORAGE_KEY, sessions);
  }

  /** Remove a single session by ID */
  async removeSession(sessionId: string): Promise<void> {
    const sessions = this.globalState.get<SessionMetadata[]>(STORAGE_KEY, []);
    const filtered = sessions.filter(s => s.sessionId !== sessionId);
    await this.globalState.update(STORAGE_KEY, filtered);
  }

  /** Clear all stored sessions */
  async clearAll(): Promise<void> {
    await this.globalState.update(STORAGE_KEY, []);
  }
}
