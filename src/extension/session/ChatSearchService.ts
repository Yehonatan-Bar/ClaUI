import * as fs from 'fs';
import { SessionDiscovery } from './SessionDiscovery';
import type { ChatSearchProjectResult } from '../types/webview-messages';

const MAX_RESULTS = 50;
const MAX_SNIPPET_LENGTH = 120;

/**
 * Extension-side service for searching across project session JSONL files.
 * Uses raw string matching (no full JSON parsing) for performance.
 */
export class ChatSearchService {
  private currentRequestId = 0;
  private readonly discovery: SessionDiscovery;

  constructor(private readonly log: (msg: string) => void) {
    this.discovery = new SessionDiscovery();
  }

  /**
   * Search all sessions for the given workspace.
   * Returns null if the search was cancelled by a newer request.
   */
  async searchProject(
    query: string,
    requestId: number,
    workspacePath: string
  ): Promise<{ results: ChatSearchProjectResult[]; totalMatches: number } | null> {
    this.currentRequestId = requestId;

    if (!query || query.length < 2) {
      return { results: [], totalMatches: 0 };
    }

    const sessions = await this.discovery.discoverForWorkspace(workspacePath);
    this.log(`[ChatSearch] Searching ${sessions.length} sessions for "${query}" (req ${requestId})`);

    const queryLower = query.toLowerCase();
    const results: ChatSearchProjectResult[] = [];
    let totalMatches = 0;

    for (const session of sessions) {
      // Check for cancellation between files
      if (this.currentRequestId !== requestId) {
        this.log(`[ChatSearch] Cancelled request ${requestId} (superseded by ${this.currentRequestId})`);
        return null;
      }

      try {
        const content = fs.readFileSync(session.filePath, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          // Fast raw string check - skip lines that don't contain the query
          if (!line.toLowerCase().includes(queryLower)) continue;

          totalMatches++;

          // Only parse matching lines to extract context
          if (results.length < MAX_RESULTS) {
            try {
              const entry = JSON.parse(line);
              const result = this.extractResult(entry, session, queryLower);
              if (result) {
                results.push(result);
              }
            } catch {
              // Malformed JSON line - skip
            }
          }
        }
      } catch {
        // File read error - skip this session
      }

      // Early exit if we have enough results
      if (results.length >= MAX_RESULTS) break;
    }

    this.log(`[ChatSearch] Found ${results.length} results (${totalMatches} total matches) for req ${requestId}`);
    return { results, totalMatches };
  }

  /**
   * Extract a search result from a parsed JSONL entry.
   */
  private extractResult(
    entry: Record<string, unknown>,
    session: { sessionId: string; firstPrompt: string; mtime: number },
    queryLower: string
  ): ChatSearchProjectResult | null {
    const type = entry.type as string;

    if (type === 'user') {
      const msg = entry.message as { role: string; content: string | Array<{ type: string; text?: string }> } | undefined;
      if (!msg || msg.role !== 'user') return null;

      const text = this.extractText(msg.content);
      if (!text || !text.toLowerCase().includes(queryLower)) return null;

      return {
        sessionId: session.sessionId,
        sessionLabel: session.firstPrompt || `Session ${session.sessionId.slice(0, 8)}...`,
        mtime: session.mtime,
        matchSnippet: this.buildSnippet(text, queryLower),
        matchRole: 'user',
      };
    }

    if (type === 'assistant') {
      const msg = entry.message as { role: string; content: Array<{ type: string; text?: string }> } | undefined;
      if (!msg || msg.role !== 'assistant') return null;

      const text = this.extractText(msg.content);
      if (!text || !text.toLowerCase().includes(queryLower)) return null;

      return {
        sessionId: session.sessionId,
        sessionLabel: session.firstPrompt || `Session ${session.sessionId.slice(0, 8)}...`,
        mtime: session.mtime,
        matchSnippet: this.buildSnippet(text, queryLower),
        matchRole: 'assistant',
      };
    }

    return null;
  }

  /**
   * Extract plain text from message content (string or ContentBlock array).
   */
  private extractText(content: string | Array<{ type: string; text?: string }>): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join(' ');
  }

  /**
   * Build a snippet around the match, showing context.
   */
  private buildSnippet(text: string, queryLower: string): string {
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    const idx = cleanText.toLowerCase().indexOf(queryLower);
    if (idx < 0) return cleanText.slice(0, MAX_SNIPPET_LENGTH);

    // Show context around the match
    const contextBefore = 30;
    const start = Math.max(0, idx - contextBefore);
    const end = Math.min(cleanText.length, start + MAX_SNIPPET_LENGTH);
    let snippet = cleanText.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < cleanText.length) snippet = snippet + '...';

    return snippet;
  }
}
