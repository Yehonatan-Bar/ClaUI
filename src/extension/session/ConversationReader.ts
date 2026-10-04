import * as fs from 'fs';
import type { ContentBlock } from '../types/stream-json';
import type { SerializedChatMessage } from '../types/webview-messages';
import { findSessionJsonlPath } from './sessionPathResolver';

/**
 * Reads conversation history from Claude Code's local session storage.
 * Sessions are stored as JSONL files in <Claude config dir>/projects/<project-hash>/<session-id>.jsonl
 *
 * Each JSONL entry with type 'assistant' contains a single content block (partial message).
 * Multiple entries share the same message ID and must be merged to reconstruct the full message.
 */
export class ConversationReader {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  /**
   * Read conversation messages for a given session ID.
   * Returns messages formatted for the webview.
   */
  readSession(sessionId: string, workspacePath?: string, claudeConfigDir?: string): SerializedChatMessage[] {
    const jsonlPath = findSessionJsonlPath(sessionId, workspacePath, claudeConfigDir);
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
      timestamp?: number;
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

        // CLI marks synthetic content (skill body, sub-agent dispatch, system
        // reminders) with isMeta=true. These are NOT user input; render them
        // as part of Claude's output flow so they never appear as "YOU".
        const isMeta = entry.isMeta === true;
        const entryTimestamp = this.resolveTimestamp(this.parseEntryTimestamp(entry), messages);
        if (isMeta) {
          messages.push({
            id: `history-synthetic-${messages.length}`,
            role: 'assistant',
            content: userVisible,
            timestamp: entryTimestamp,
            synthetic: true,
          });
          continue;
        }

        messages.push({
          id: `history-user-${messages.length}`,
          role: 'user',
          content: userVisible,
          timestamp: entryTimestamp,
          source: 'input',
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
        // Entries are chronological, so the last one marks when the message finished
        // (the live path stamps a message when it finalizes, not when it starts).
        existing.timestamp = this.parseEntryTimestamp(entry) ?? existing.timestamp;
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
    assistantBlocks: Map<string, { blocks: ContentBlock[]; model?: string; timestamp?: number }>,
    assistantOrder: string[],
    messages: SerializedChatMessage[]
  ): void {
    for (const msgId of assistantOrder) {
      const data = assistantBlocks.get(msgId);
      if (!data || data.blocks.length === 0) continue;

      // Detect thinking effort from the presence of thinking blocks
      const hasThinking = data.blocks.some(b => b.type === 'thinking');
      const thinkingEffort = hasThinking ? 'high' : undefined;

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
        timestamp: this.resolveTimestamp(data.timestamp, messages),
        thinkingEffort,
      });
    }

    assistantBlocks.clear();
    assistantOrder.length = 0;
  }

  /**
   * Epoch ms from the entry's own ISO `timestamp` field, or undefined when it is
   * missing or unparseable. The CLI stamps every user/assistant line when it is
   * written, so this is the real send time, independent of when the session is
   * reloaded (resume after hibernation, VS Code restart, etc.).
   */
  private parseEntryTimestamp(entry: Record<string, unknown>): number | undefined {
    if (typeof entry.timestamp !== 'string') {
      return undefined;
    }
    const parsed = Date.parse(entry.timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Use the entry's real timestamp when it has one. Otherwise inherit the previous
   * message's time (+1ms keeps the order strict); with no previous message there is
   * nothing better than the current time.
   */
  private resolveTimestamp(entryTimestamp: number | undefined, messages: SerializedChatMessage[]): number {
    if (entryTimestamp !== undefined) {
      return entryTimestamp;
    }
    const previous = messages[messages.length - 1];
    return previous ? previous.timestamp + 1 : Date.now();
  }

}
