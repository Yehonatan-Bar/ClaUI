import { truncateString } from './payloadCompactor';

/**
 * Converts chat content blocks (the shapes ClaUi posts to its webview:
 * text / thinking / tool_use / tool_result / image) into compact text for
 * remote callers. Defensive about runtime shapes: CLI data does not always
 * match its TypeScript interfaces (see CLAUDE.md "CLI Data Format Gotchas").
 */

export interface ContentBlockLike {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

export interface FormatOptions {
  includeTools: boolean;
  includeThinking: boolean;
  /** Max characters for a single tool input / result rendering. */
  toolDetailChars: number;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  includeTools: true,
  includeThinking: false,
  toolDetailChars: 600,
};

/** Normalize a message `content` field (string | block[] | unknown) to a block array. */
export function normalizeContent(content: unknown): ContentBlockLike[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.filter((b): b is ContentBlockLike => !!b && typeof b === 'object');
  }
  return [];
}

/** Concatenated text blocks only (no tools, no thinking). */
export function extractText(content: unknown): string {
  return normalizeContent(content)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n\n')
    .trim();
}

export function summarizeValue(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return truncateString(value, maxChars);
  }
  try {
    return truncateString(JSON.stringify(value), maxChars);
  } catch {
    return '[unserializable]';
  }
}

/** Text for a tool_result content (string or nested blocks). */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  const blocks = normalizeContent(content);
  if (blocks.length === 0) {
    return summarizeValue(content, 10_000);
  }
  return blocks
    .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : b.type === 'image' ? '[image]' : summarizeValue(b, 2000)))
    .join('\n');
}

export function formatBlocksAsText(
  content: unknown,
  options: Partial<FormatOptions> = {},
  toolResults?: Map<string, { content: unknown; isError: boolean }>,
): string {
  const opts = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const parts: string[] = [];
  for (const block of normalizeContent(content)) {
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text.trim()) {
          parts.push(block.text);
        }
        break;
      case 'thinking':
        if (opts.includeThinking && typeof block.thinking === 'string' && block.thinking.trim()) {
          parts.push(`[thinking] ${truncateString(block.thinking, opts.toolDetailChars * 4)}`);
        }
        break;
      case 'tool_use': {
        if (!opts.includeTools) {
          break;
        }
        parts.push(`[tool: ${block.name ?? 'unknown'}] ${summarizeValue(block.input, opts.toolDetailChars)}`);
        const result = typeof block.id === 'string' ? toolResults?.get(block.id) : undefined;
        if (result) {
          const label = result.isError ? '[tool error]' : '[tool result]';
          parts.push(`${label} ${truncateString(toolResultText(result.content), opts.toolDetailChars)}`);
        }
        break;
      }
      case 'tool_result':
        if (opts.includeTools) {
          const label = block.is_error ? '[tool error]' : '[tool result]';
          parts.push(`${label} ${truncateString(toolResultText(block.content), opts.toolDetailChars)}`);
        }
        break;
      case 'image':
        parts.push('[image]');
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n').trim();
}

/** Tool calls in a block list: name, id and a bounded input summary. */
export function listToolUses(content: unknown, maxChars = 300): Array<{ id?: string; name: string; input: string }> {
  return normalizeContent(content)
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: typeof b.id === 'string' ? b.id : undefined, name: String(b.name ?? 'unknown'), input: summarizeValue(b.input, maxChars) }));
}
