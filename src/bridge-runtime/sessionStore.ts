import * as fs from 'fs';
import * as path from 'path';

/**
 * Durable per-tab bridge session state, keyed by the ClaUi session UUID.
 *
 * ClaUi resumes tabs with `--resume <uuid>`; the bridge maps that UUID to its
 * backend-native continuation handle (grok ACP session id, antigravity
 * conversation id, or the stored OpenAI-compatible chat history) so a tab
 * keeps its context across process restarts and window reloads.
 */
export interface BridgeSessionState {
  backend: string;
  model: string;
  /** grok: ACP session id to session/load on resume. */
  grokSessionId?: string;
  /** antigravity: conversation id passed back via --conversation. */
  agyConversationId?: string;
  /** openai: which configured provider profile this session is bound to. */
  openaiProviderId?: string;
  /** openai: full chat history (the server is stateless). */
  history?: { role: 'user' | 'assistant'; content: string }[];
  updatedAt?: string;
}

export class SessionStore {
  constructor(private readonly dir: string) {}

  private fileFor(sessionId: string): string {
    // Session ids come from ClaUi as UUIDs; keep a strict basename guard anyway.
    const safe = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  read(sessionId: string): BridgeSessionState | null {
    try {
      const raw = fs.readFileSync(this.fileFor(sessionId), 'utf8');
      const parsed = JSON.parse(raw) as BridgeSessionState;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  write(sessionId: string, patch: Partial<BridgeSessionState>): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const prev = this.read(sessionId) || ({} as BridgeSessionState);
      const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      const file = this.fileFor(sessionId);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, file);
    } catch {
      /* session persistence is best-effort; a failed write only loses resume */
    }
  }

  appendHistory(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const prev = this.read(sessionId);
    const history = prev?.history ? [...prev.history] : [];
    history.push({ role, content });
    // Bound the stored transcript so a long-lived tab cannot grow unbounded.
    const MAX_TURNS = 200;
    this.write(sessionId, {
      history: history.length > MAX_TURNS ? history.slice(-MAX_TURNS) : history,
    });
  }
}
