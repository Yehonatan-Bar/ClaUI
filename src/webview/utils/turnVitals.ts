import type { ContentBlock } from '../../extension/types/stream-json';
import type { TurnCategory, TurnRecord } from '../../extension/types/webview-messages';

export interface MessageLike {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[] | unknown;
  timestamp: number;
}

const CODE_WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
const COMMAND_TOOLS = new Set(['Bash', 'Terminal']);

function normalizeBlocks(content: ContentBlock[] | unknown): ContentBlock[] {
  if (Array.isArray(content)) {
    return content as ContentBlock[];
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (content && typeof content === 'object') {
    const maybeBlock = content as { type?: unknown };
    if (typeof maybeBlock.type === 'string') {
      return [content as ContentBlock];
    }
  }
  return [{ type: 'text', text: String(content ?? '') }];
}

export function categorizeTurn(toolNames: string[], isError: boolean): TurnCategory {
  if (isError) return 'error';
  if (toolNames.length === 0) return 'discussion';
  const baseNames = toolNames.map((name) => (name.includes('__') ? name.split('__').pop() || name : name));
  if (baseNames.some((name) => CODE_WRITE_TOOLS.has(name))) return 'code-write';
  if (baseNames.some((name) => COMMAND_TOOLS.has(name))) return 'command';
  if (baseNames.some((name) => RESEARCH_TOOLS.has(name))) return 'research';
  return 'success';
}

export function deriveTurnFromAssistantMessage(message: MessageLike, turnIndex: number): TurnRecord | null {
  if (message.role !== 'assistant') return null;

  const blocks = normalizeBlocks(message.content);
  const toolNames = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.name || '')
    .filter((name): name is string => !!name);
  const isError = blocks.some((block) => block.type === 'tool_result' && block.is_error === true);

  return {
    turnIndex,
    toolNames,
    toolCount: toolNames.length,
    durationMs: 0,
    costUsd: 0,
    totalCostUsd: 0,
    isError,
    category: categorizeTurn(toolNames, isError),
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    messageId: message.id,
  };
}

export function deriveTurnHistoryFromMessages(messages: MessageLike[], maxTurns = 200): TurnRecord[] {
  const turns: TurnRecord[] = [];
  for (const message of messages) {
    const turn = deriveTurnFromAssistantMessage(message, turns.length);
    if (turn) turns.push(turn);
  }

  const limited = turns.length > maxTurns ? turns.slice(-maxTurns) : turns;
  return limited.map((turn, index) =>
    turn.turnIndex === index ? turn : { ...turn, turnIndex: index }
  );
}
