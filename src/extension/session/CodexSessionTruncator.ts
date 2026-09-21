import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CodexTruncationResult {
  /** Thread id of the new, isolated rollout copy. */
  newThreadId: string;
  /** Absolute path to the new rollout JSONL file. */
  rolloutPath: string;
  /** Number of JSONL lines written to the new rollout. */
  linesWritten: number;
  /** Number of UI-visible messages kept in the truncated rollout. */
  uiMessagesKept: number;
}

type JsonRecord = Record<string, unknown>;

/**
 * Creates an isolated, truncated copy of a Codex rollout so a fork can resume it
 * with the parent conversation's context WITHOUT mutating the original thread.
 *
 * Codex stores each session as a rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/
 * rollout-<timestamp>-<threadId>.jsonl`. The first line is a `session_meta` record
 * whose `payload.id` equals the thread id (and the filename embeds the same id).
 * Subsequent lines are `response_item` records: `message` (role developer/user/
 * assistant), `reasoning`, `custom_tool_call`, `custom_tool_call_output`, plus
 * bookkeeping lines (`event_msg`, `turn_context`, `world_state`, `compacted`).
 *
 * `codex exec resume <threadId>` locates the rollout by scanning this directory for
 * a file whose name contains the id, so writing a new file under a fresh UUID and
 * pointing the fork at that UUID yields a genuine isolated branch.
 *
 * Unlike Claude transcripts, Codex tool calls are *separate* response items (never
 * nested inside an assistant `message`), so cutting immediately after any assistant
 * `message` is always API-valid: every emitted `custom_tool_call` before it already
 * has its matching `custom_tool_call_output` earlier in the same turn.
 */
export class CodexSessionTruncator {
  private readonly sessionsDir: string;

  constructor(private readonly log: (msg: string) => void = () => {}) {
    this.sessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  }

  truncateSession(
    parentThreadId: string,
    forkMessageIndex: number,
    workspacePath?: string,
  ): CodexTruncationResult | null {
    const rolloutPath = this.findRolloutFile(parentThreadId, workspacePath);
    if (!rolloutPath) {
      this.log(`[CodexSessionTruncator] Rollout not found for thread ${parentThreadId}`);
      return null;
    }

    let content: string;
    try {
      content = fs.readFileSync(rolloutPath, 'utf-8');
    } catch (err) {
      this.log(`[CodexSessionTruncator] Failed to read ${rolloutPath}: ${err}`);
      return null;
    }

    const rawLines = content.split(/\r?\n/).filter((l) => l.trim());
    const parsed: (JsonRecord | null)[] = rawLines.map((l) => {
      try { return JSON.parse(l) as JsonRecord; } catch { return null; }
    });

    // Assign a UI-message index to each line that maps to a chat bubble, mirroring
    // CodexConversationReader: only `message` items with role user/assistant count
    // (developer messages, reasoning, tool calls and bookkeeping lines do not).
    const uiIndexByLine: number[] = new Array(parsed.length).fill(-1);
    let uiIndex = 0;
    for (let i = 0; i < parsed.length; i++) {
      if (this.isUiMessageLine(parsed[i])) {
        uiIndexByLine[i] = uiIndex;
        uiIndex++;
      }
    }

    // Initial cut: exclusive, keep every line before the first UI message at/after
    // the fork point. Forks are always taken from a user message, so this lands on
    // that user line and drops it plus everything after.
    let cut = parsed.length;
    for (let i = 0; i < parsed.length; i++) {
      if (uiIndexByLine[i] >= 0 && uiIndexByLine[i] >= forkMessageIndex) {
        cut = i;
        break;
      }
    }

    // Snap back so the kept prefix ends right after the last assistant `message`.
    cut = this.snapToAssistantMessage(parsed, cut);

    const uiMessagesKept = this.countUiMessages(uiIndexByLine, cut);
    if (cut <= 0 || uiMessagesKept <= 0) {
      this.log('[CodexSessionTruncator] Cut point leaves no conversation content');
      return null;
    }

    return this.writeTruncatedRollout(rawLines, parsed, cut, parentThreadId, rolloutPath, uiMessagesKept);
  }

  /** True for a `response_item` chat message with role user or assistant. */
  private isUiMessageLine(entry: JsonRecord | null): boolean {
    if (!entry || entry.type !== 'response_item') return false;
    const payload = this.asRecord(entry.payload);
    if (!payload || payload.type !== 'message') return false;
    const role = payload.role;
    return role === 'user' || role === 'assistant';
  }

  private isAssistantMessageLine(entry: JsonRecord | null): boolean {
    if (!entry || entry.type !== 'response_item') return false;
    const payload = this.asRecord(entry.payload);
    if (!payload || payload.type !== 'message') return false;
    return payload.role === 'assistant';
  }

  /**
   * Walk backward from `cut` to the line immediately after the last assistant
   * `message`, so the truncated rollout ends on a completed assistant turn.
   * Returns 0 when there is no assistant message in the kept region.
   */
  private snapToAssistantMessage(parsed: (JsonRecord | null)[], cut: number): number {
    for (let i = cut - 1; i >= 0; i--) {
      if (this.isAssistantMessageLine(parsed[i])) {
        return i + 1;
      }
    }
    return 0;
  }

  private countUiMessages(uiIndexByLine: number[], cut: number): number {
    let count = 0;
    for (let i = 0; i < cut; i++) {
      if (uiIndexByLine[i] >= 0) count++;
    }
    return count;
  }

  private writeTruncatedRollout(
    rawLines: string[],
    parsed: (JsonRecord | null)[],
    cut: number,
    parentThreadId: string,
    parentRolloutPath: string,
    uiMessagesKept: number,
  ): CodexTruncationResult | null {
    const newThreadId = crypto.randomUUID();

    // Rewrite the thread id everywhere it appears. It is a UUID, so a global string
    // replacement cannot collide with conversation text; this mirrors how Codex
    // itself keys a rollout to its id (verified: resume then loads full context).
    const outputLines: string[] = [];
    for (let i = 0; i < cut; i++) {
      if (!parsed[i]) continue;
      outputLines.push(rawLines[i].split(parentThreadId).join(newThreadId));
    }

    if (outputLines.length === 0) {
      return null;
    }

    const rolloutPath = this.buildRolloutPath(newThreadId);
    try {
      fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
      fs.writeFileSync(rolloutPath, outputLines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      this.log(`[CodexSessionTruncator] Failed to write ${rolloutPath}: ${err}`);
      return null;
    }

    this.log(
      `[CodexSessionTruncator] Wrote ${outputLines.length} lines to ${rolloutPath} ` +
      `(forked from ${parentThreadId}, kept ${uiMessagesKept} messages)`,
    );

    return {
      newThreadId,
      rolloutPath,
      linesWritten: outputLines.length,
      uiMessagesKept,
    };
  }

  /** Compose a rollout path under today's date folder using Codex's naming scheme. */
  private buildRolloutPath(threadId: string): string {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    // Codex timestamps in filenames use `YYYY-MM-DDTHH-MM-SS`.
    const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = `rollout-${stamp}-${threadId}.jsonl`;
    return path.join(this.sessionsDir, yyyy, mm, dd, fileName);
  }

  /**
   * Locate the rollout JSONL for a thread id. Scans `~/.codex/sessions` for a file
   * whose name embeds the id; when several match, prefers one whose `session_meta`
   * cwd matches the workspace, else the most recently modified.
   */
  private findRolloutFile(threadId: string, workspacePath?: string): string | null {
    if (!fs.existsSync(this.sessionsDir)) return null;

    const candidates = this.collectCandidates(this.sessionsDir, threadId);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (workspacePath) {
      const expected = this.normalizePath(workspacePath);
      for (const candidate of candidates) {
        const cwd = this.readRolloutCwd(candidate.filePath);
        if (cwd && this.normalizePath(cwd) === expected) {
          return candidate.filePath;
        }
      }
    }

    return candidates[0].filePath;
  }

  private collectCandidates(dir: string, threadId: string): Array<{ filePath: string; mtimeMs: number }> {
    const out: Array<{ filePath: string; mtimeMs: number }> = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...this.collectCandidates(fullPath, threadId));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.jsonl') || !entry.name.includes(threadId)) continue;
      try {
        out.push({ filePath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      } catch {
        // ignore unreadable candidate
      }
    }
    return out;
  }

  private readRolloutCwd(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let entry: JsonRecord;
        try { entry = JSON.parse(line) as JsonRecord; } catch { continue; }
        if (entry.type !== 'session_meta') continue;
        const payload = this.asRecord(entry.payload);
        const cwd = payload?.cwd ?? entry.cwd;
        return typeof cwd === 'string' && cwd ? cwd : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private normalizePath(p: string): string {
    return path.normalize(p).replace(/[\\/]+/g, path.sep).toLowerCase();
  }

  private asRecord(value: unknown): JsonRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
  }
}
