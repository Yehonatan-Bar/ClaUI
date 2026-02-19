import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ContentBlock } from '../types/stream-json';
import type { SerializedChatMessage } from '../types/webview-messages';

/**
 * Reads conversation history from Claude Code's local session storage.
 * Sessions are stored as JSONL files in ~/.claude/projects/<project-hash>/<session-id>.jsonl
 *
 * Each JSONL entry with type 'assistant' contains a single content block (partial message).
 * Multiple entries share the same message ID and must be merged to reconstruct the full message.
 */
export class ConversationReader {
  private readonly claudeDir: string;

  constructor(private readonly log: (msg: string) => void = () => {}) {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Read conversation messages for a given session ID.
   * Returns messages formatted for the webview.
   */
  readSession(sessionId: string, workspacePath?: string): SerializedChatMessage[] {
    const jsonlPath = this.findSessionFile(sessionId, workspacePath);
    if (!jsonlPath) {
      this.log(`[ConversationReader] No JSONL file found for session ${sessionId}`);
      return [];
    }

    this.log(`[ConversationReader] Reading ${jsonlPath}`);

    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      return this.parseMessages(lines);
    } catch (err) {
      this.log(`[ConversationReader] Error reading file: ${err}`);
      return [];
    }
  }

  /**
   * Parse JSONL lines into a sequence of chat messages.
   * Merges partial assistant entries by message ID.
   */
  private parseMessages(lines: string[]): SerializedChatMessage[] {
    const messages: SerializedChatMessage[] = [];

    // Track assistant blocks by message ID for merging
    const assistantBlocks = new Map<string, {
      blocks: ContentBlock[];
      model?: string;
      timestamp?: string;
    }>();
    // Track the order in which assistant message IDs appear
    const assistantOrder: string[] = [];

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const type = entry.type as string;

      if (type === 'user') {
        // Flush any pending assistant messages before this user message
        this.flushAssistantMessages(assistantBlocks, assistantOrder, messages);

        const msg = entry.message as { role: string; content: string | ContentBlock[] } | undefined;
        if (!msg || msg.role !== 'user') continue;

        // Normalize content
        const rawContent = msg.content;
        const normalizedContent: ContentBlock[] = typeof rawContent === 'string'
          ? [{ type: 'text', text: rawContent }]
          : Array.isArray(rawContent) ? rawContent : [{ type: 'text', text: String(rawContent) }];

        // Filter out tool_result blocks (API-internal, not user input)
        const userVisible = normalizedContent.filter(b => b.type !== 'tool_result');
        if (userVisible.length === 0) continue;

        messages.push({
          id: `history-user-${messages.length}`,
          role: 'user',
          content: userVisible,
          timestamp: Date.now() - 1000000 + messages.length * 100,
        });
      } else if (type === 'assistant') {
        const msg = entry.message as {
          id?: string;
          role: string;
          content: ContentBlock[];
          model?: string;
        } | undefined;
        if (!msg || msg.role !== 'assistant') continue;

        const msgId = msg.id || `unknown-${Date.now()}`;
        const blocks = Array.isArray(msg.content) ? msg.content : [];

        if (!assistantBlocks.has(msgId)) {
          assistantBlocks.set(msgId, { blocks: [], model: msg.model });
          assistantOrder.push(msgId);
        }

        const existing = assistantBlocks.get(msgId)!;
        // Append new blocks (each partial entry typically has one new block)
        for (const block of blocks) {
          existing.blocks.push(block);
        }
        if (msg.model) {
          existing.model = msg.model;
        }
      }
    }

    // Flush remaining assistant messages
    this.flushAssistantMessages(assistantBlocks, assistantOrder, messages);

    this.log(`[ConversationReader] Parsed ${messages.length} messages`);
    return messages;
  }

  /**
   * Convert accumulated assistant blocks into finalized messages.
   */
  private flushAssistantMessages(
    assistantBlocks: Map<string, { blocks: ContentBlock[]; model?: string }>,
    assistantOrder: string[],
    messages: SerializedChatMessage[]
  ): void {
    for (const msgId of assistantOrder) {
      const data = assistantBlocks.get(msgId);
      if (!data || data.blocks.length === 0) continue;

      // Filter out thinking blocks (not displayed in UI)
      const visibleBlocks = data.blocks.filter(b =>
        b.type === 'text' || b.type === 'tool_use'
      );

      if (visibleBlocks.length === 0) continue;

      messages.push({
        id: msgId,
        role: 'assistant',
        content: visibleBlocks,
        model: data.model,
        timestamp: Date.now() - 1000000 + messages.length * 100,
      });
    }

    assistantBlocks.clear();
    assistantOrder.length = 0;
  }

  /**
   * Find the JSONL file for a session ID.
   * Tries the expected project directory first, then scans all projects.
   */
  private findSessionFile(sessionId: string, workspacePath?: string): string | null {
    const projectsDir = path.join(this.claudeDir, 'projects');
    if (!fs.existsSync(projectsDir)) {
      return null;
    }

    const fileName = `${sessionId}.jsonl`;

    // If workspace path is provided, try the expected project directory
    if (workspacePath) {
      // Claude's directory naming: replace :, \, / with -
      const dirName = workspacePath.replace(/[:\\/]/g, '-');
      const expectedPath = path.join(projectsDir, dirName, fileName);
      if (fs.existsSync(expectedPath)) {
        return expectedPath;
      }

      // Try with toggled drive letter case (Windows inconsistency)
      const ch = dirName.charAt(0);
      const altDirName = (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + dirName.slice(1);
      const altPath = path.join(projectsDir, altDirName, fileName);
      if (fs.existsSync(altPath)) {
        return altPath;
      }
    }

    // Fallback: scan all project directories
    try {
      const dirs = fs.readdirSync(projectsDir);
      for (const dir of dirs) {
        const candidatePath = path.join(projectsDir, dir, fileName);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    } catch {
      // Directory listing failed
    }

    return null;
  }
}
