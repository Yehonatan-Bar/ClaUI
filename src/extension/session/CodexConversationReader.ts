import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ContentBlock } from '../types/stream-json';
import type { SerializedChatMessage } from '../types/webview-messages';

type JsonRecord = Record<string, unknown>;

/**
 * Reads Codex local conversation history from JSONL files under ~/.codex/sessions.
 * Parsing is intentionally permissive because the local format may evolve.
 */
export class CodexConversationReader {
  private readonly codexSessionsDir: string;

  constructor(private readonly log: (msg: string) => void = () => {}) {
    this.codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  }

  readSession(threadId: string, workspacePath?: string): SerializedChatMessage[] {
    const jsonlPath = this.findSessionFile(threadId, workspacePath);
    if (!jsonlPath) {
      this.log(`[CodexConversationReader] No JSONL file found for thread ${threadId}`);
      return [];
    }

    this.log(`[CodexConversationReader] Reading ${jsonlPath}`);

    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      return this.parseMessages(lines);
    } catch (err) {
      this.log(`[CodexConversationReader] Error reading file: ${err}`);
      return [];
    }
  }

  private parseMessages(lines: string[]): SerializedChatMessage[] {
    const messages: SerializedChatMessage[] = [];
    const messagesByKey = new Map<string, SerializedChatMessage>();
    let sequence = 0;

    for (const line of lines) {
      let entry: JsonRecord;
      try {
        entry = JSON.parse(line) as JsonRecord;
      } catch {
        continue;
      }

      const entryType = typeof entry.type === 'string' ? entry.type : '';
      if (entryType !== 'response_item') {
        continue;
      }

      const payload = this.extractResponsePayload(entry);
      if (!payload) {
        continue;
      }

      const payloadType = typeof payload.type === 'string' ? payload.type : '';
      if (payloadType !== 'message') {
        continue;
      }

      const role = this.extractRole(payload);
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const content = this.extractMessageBlocks(payload, role);
      if (content.length === 0) {
        continue;
      }

      const messageId = this.extractMessageId(payload);
      const mergeKey = messageId ? `${role}:${messageId}` : `${role}:seq:${sequence++}`;
      const existing = messagesByKey.get(mergeKey);

      if (existing) {
        existing.content.push(...content);
        continue;
      }

      const msg: SerializedChatMessage = {
        id: messageId || `codex-history-${role}-${messages.length}`,
        role,
        content,
        timestamp: this.extractTimestamp(entry, payload, messages.length),
      };

      const model = this.extractModel(payload);
      if (model) {
        msg.model = model;
      }

      messages.push(msg);
      messagesByKey.set(mergeKey, msg);
    }

    this.log(`[CodexConversationReader] Parsed ${messages.length} messages`);
    return messages;
  }

  private extractResponsePayload(entry: JsonRecord): JsonRecord | null {
    const candidates = [
      entry.payload,
      entry.item,
      entry.response_item,
      entry.message,
    ];

    for (const candidate of candidates) {
      if (this.isRecord(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private extractRole(payload: JsonRecord): 'user' | 'assistant' | null {
    const directRole = payload.role;
    if (directRole === 'user' || directRole === 'assistant') {
      return directRole;
    }

    const nestedMessage = this.isRecord(payload.message) ? payload.message : null;
    const nestedRole = nestedMessage?.role;
    if (nestedRole === 'user' || nestedRole === 'assistant') {
      return nestedRole;
    }

    return null;
  }

  private extractMessageId(payload: JsonRecord): string | null {
    const directId = payload.id;
    if (typeof directId === 'string' && directId) {
      return directId;
    }

    const nestedMessage = this.isRecord(payload.message) ? payload.message : null;
    const nestedId = nestedMessage?.id;
    if (typeof nestedId === 'string' && nestedId) {
      return nestedId;
    }

    return null;
  }

  private extractModel(payload: JsonRecord): string | undefined {
    const directModel = payload.model;
    if (typeof directModel === 'string' && directModel) {
      return directModel;
    }

    const nestedMessage = this.isRecord(payload.message) ? payload.message : null;
    const nestedModel = nestedMessage?.model;
    return typeof nestedModel === 'string' && nestedModel ? nestedModel : undefined;
  }

  private extractMessageBlocks(payload: JsonRecord, role: 'user' | 'assistant'): ContentBlock[] {
    const candidates: unknown[] = [
      payload.content,
      this.isRecord(payload.message) ? payload.message.content : undefined,
      payload.parts,
      payload.input,
      payload.output,
      payload.text,
    ];

    for (const candidate of candidates) {
      const blocks = this.toTextBlocks(candidate, role);
      if (blocks.length > 0) {
        return blocks;
      }
    }

    return [];
  }

  private toTextBlocks(value: unknown, role: 'user' | 'assistant'): ContentBlock[] {
    if (typeof value === 'string') {
      return value.trim() ? [{ type: 'text', text: value } as ContentBlock] : [];
    }

    if (Array.isArray(value)) {
      const blocks: ContentBlock[] = [];
      for (const item of value) {
        blocks.push(...this.toTextBlocks(item, role));
      }
      return blocks;
    }

    if (!this.isRecord(value)) {
      return [];
    }

    const itemType = typeof value.type === 'string' ? value.type : '';

    const directText = this.readTextField(value.text);
    if (directText && this.isVisibleTextItem(itemType, role)) {
      return [{ type: 'text', text: directText } as ContentBlock];
    }

    if (directText && !itemType) {
      return [{ type: 'text', text: directText } as ContentBlock];
    }

    const contentText = this.readTextField(value.content);
    if (contentText && this.isVisibleTextItem(itemType, role)) {
      return [{ type: 'text', text: contentText } as ContentBlock];
    }

    if (Array.isArray(value.content)) {
      return this.toTextBlocks(value.content, role);
    }

    if (this.isRecord(value.text)) {
      const nestedValue = this.readTextField((value.text as JsonRecord).value);
      if (nestedValue) {
        return [{ type: 'text', text: nestedValue } as ContentBlock];
      }
    }

    return [];
  }

  private isVisibleTextItem(itemType: string, role: 'user' | 'assistant'): boolean {
    if (!itemType) {
      return true;
    }

    if (itemType === 'text' || itemType === 'message') {
      return true;
    }

    if (role === 'user' && itemType === 'input_text') {
      return true;
    }

    if (role === 'assistant' && itemType === 'output_text') {
      return true;
    }

    return false;
  }

  private readTextField(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim() ? value : null;
    }
    if (this.isRecord(value) && typeof value.value === 'string') {
      return value.value.trim() ? value.value : null;
    }
    return null;
  }

  private extractTimestamp(entry: JsonRecord, payload: JsonRecord, index: number): number {
    const candidates: unknown[] = [
      payload.created_at,
      payload.timestamp,
      entry.timestamp,
      entry.created_at,
    ];

    for (const candidate of candidates) {
      const ts = this.parseTimestamp(candidate);
      if (ts !== null) {
        return ts;
      }
    }

    return Date.now() - 1000000 + index * 100;
  }

  private parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1e12 ? value : value * 1000;
    }

    if (typeof value === 'string' && value) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && value.trim() !== '') {
        return numeric > 1e12 ? numeric : numeric * 1000;
      }
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private findSessionFile(threadId: string, workspacePath?: string): string | null {
    if (!fs.existsSync(this.codexSessionsDir)) {
      return null;
    }

    const candidates = this.collectCandidateFiles(this.codexSessionsDir, threadId);
    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (workspacePath) {
      for (const candidate of candidates) {
        if (this.fileMatchesWorkspace(candidate.filePath, workspacePath)) {
          return candidate.filePath;
        }
      }
    }

    return candidates[0].filePath;
  }

  private collectCandidateFiles(dir: string, threadId: string): Array<{ filePath: string; mtimeMs: number }> {
    const candidates: Array<{ filePath: string; mtimeMs: number }> = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return candidates;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        candidates.push(...this.collectCandidateFiles(fullPath, threadId));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.jsonl') || !entry.name.includes(threadId)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        candidates.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore unreadable candidate
      }
    }

    return candidates;
  }

  private fileMatchesWorkspace(filePath: string, workspacePath: string): boolean {
    const expected = this.normalizePathForCompare(workspacePath);
    if (!expected) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let entry: JsonRecord;
        try {
          entry = JSON.parse(line) as JsonRecord;
        } catch {
          continue;
        }

        if (entry.type !== 'session_meta') {
          continue;
        }

        const cwd = this.extractCwd(entry);
        if (!cwd) {
          return false;
        }
        return this.normalizePathForCompare(cwd) === expected;
      }
    } catch {
      return false;
    }

    return false;
  }

  private extractCwd(entry: JsonRecord): string | null {
    const candidates: unknown[] = [
      entry.cwd,
      this.isRecord(entry.payload) ? entry.payload.cwd : undefined,
      this.isRecord(entry.session_meta) ? entry.session_meta.cwd : undefined,
      this.isRecord(entry.meta) ? entry.meta.cwd : undefined,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate) {
        return candidate;
      }
    }

    return null;
  }

  private normalizePathForCompare(p: string): string {
    return path.normalize(p).replace(/[\\/]+/g, path.sep).toLowerCase();
  }

  private isRecord(value: unknown): value is JsonRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}
