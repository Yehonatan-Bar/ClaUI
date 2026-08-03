import { randomUUID } from 'crypto';
import * as readline from 'readline';

/**
 * Claude-CLI stream-json protocol emitter.
 *
 * The bridge process impersonates the claude CLI towards ClaUi: it emits the
 * same `system/init`, `stream_event`, `assistant` and `result` messages the
 * real CLI produces with `--output-format stream-json --include-partial-messages`,
 * so the whole webview pipeline (streaming text, thinking blocks, tool chips)
 * works unchanged against non-Claude backends.
 */
export class StreamEmitter {
  private msg: {
    id: string;
    blocks: { type: 'thinking' | 'text'; content: string }[];
    openIndex: number;
  } | null = null;

  constructor(
    public readonly sessionId: string,
    public readonly model: string,
  ) {}

  out(obj: unknown): void {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  private streamEvent(event: unknown): void {
    this.out({
      type: 'stream_event',
      event,
      session_id: this.sessionId,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
  }

  /** ClaUi expects an init event first, exactly like the real CLI. */
  init(cwd: string, permissionMode: string): void {
    this.out({
      type: 'system',
      subtype: 'init',
      cwd,
      session_id: this.sessionId,
      tools: [],
      mcp_servers: [],
      model: this.model,
      permissionMode: permissionMode || 'default',
      slash_commands: [],
      apiKeySource: 'none',
      output_style: 'default',
      agents: [],
      uuid: randomUUID(),
    });
  }

  private ensureMessage(): void {
    if (this.msg) return;
    this.msg = { id: `msg_bridge_${randomUUID().slice(0, 12)}`, blocks: [], openIndex: -1 };
    this.streamEvent({
      type: 'message_start',
      message: {
        id: this.msg.id,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private closeOpenBlock(): void {
    if (this.msg && this.msg.openIndex >= 0) {
      this.streamEvent({ type: 'content_block_stop', index: this.msg.openIndex });
      this.msg.openIndex = -1;
    }
  }

  /** Append streamed output. kind 'thinking' renders as a thinking block. */
  append(kind: 'thinking' | 'text', data: string): void {
    if (!data) return;
    this.ensureMessage();
    const m = this.msg!;
    const last = m.blocks[m.blocks.length - 1];
    if (!last || last.type !== kind || m.openIndex < 0) {
      this.closeOpenBlock();
      m.blocks.push({ type: kind, content: '' });
      m.openIndex = m.blocks.length - 1;
      this.streamEvent({
        type: 'content_block_start',
        index: m.openIndex,
        content_block:
          kind === 'thinking'
            ? { type: 'thinking', thinking: '', signature: '' }
            : { type: 'text', text: '' },
      });
    }
    m.blocks[m.blocks.length - 1].content += data;
    this.streamEvent({
      type: 'content_block_delta',
      index: m.openIndex,
      delta:
        kind === 'thinking'
          ? { type: 'thinking_delta', thinking: data }
          : { type: 'text_delta', text: data },
    });
  }

  /** Emit a standalone assistant message carrying a tool_use block (closes any
   *  streamed message first with stop_reason tool_use, like the real CLI). */
  toolUse(toolCallId: string, name: string, input: Record<string, unknown>): void {
    this.finishMessage('tool_use');
    this.out({
      type: 'assistant',
      message: {
        id: `msg_bridge_${randomUUID().slice(0, 12)}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [{ type: 'tool_use', id: toolCallId, name, input }],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      session_id: this.sessionId,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
  }

  /** Tool results flow back as user-role tool_result messages. */
  toolResult(toolCallId: string, content: string, isError = false): void {
    this.out({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCallId,
            content: [{ type: 'text', text: content }],
            is_error: isError,
          },
        ],
      },
      session_id: this.sessionId,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
  }

  /** Close the current streamed message and emit its full assistant echo. */
  finishMessage(stopReason: string): void {
    if (!this.msg) return;
    this.closeOpenBlock();
    this.streamEvent({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    this.streamEvent({ type: 'message_stop' });
    const content = this.msg.blocks.map((b) =>
      b.type === 'thinking'
        ? { type: 'thinking', thinking: b.content, signature: '' }
        : { type: 'text', text: b.content },
    );
    this.out({
      type: 'assistant',
      message: {
        id: this.msg.id,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: content.length ? content : [{ type: 'text', text: '' }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      session_id: this.sessionId,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
    this.msg = null;
  }

  result(opts: { text: string; startedAt: number; stopReason?: string }): void {
    this.finishMessage('end_turn');
    this.out({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: opts.text,
      session_id: this.sessionId,
      duration_ms: Date.now() - opts.startedAt,
      duration_api_ms: Date.now() - opts.startedAt,
      num_turns: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0,
      uuid: randomUUID(),
      stop_reason: opts.stopReason || 'end_turn',
    });
  }

  error(message: string, startedAt: number): void {
    this.finishMessage('end_turn');
    this.out({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: message,
      session_id: this.sessionId,
      duration_ms: Date.now() - startedAt,
      duration_api_ms: 0,
      num_turns: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0,
      uuid: randomUUID(),
    });
  }
}

export interface StdinHandlers {
  onPrompt: (text: string) => void;
  onInterrupt: () => void;
  onClose: () => void;
}

function extractText(message: unknown): string {
  const m = message as { content?: unknown } | undefined;
  const c = m?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => (b && (b as { type?: string }).type === 'text' ? (b as { text?: string }).text || '' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Wire ClaUi's stream-json stdin: user prompts + control requests. */
export function attachStdin(handlers: StdinHandlers): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let m: { type?: string; message?: unknown; request_id?: unknown; request?: { subtype?: string } };
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.type === 'user') {
      const prompt = extractText(m.message);
      if (prompt) handlers.onPrompt(prompt);
    } else if (m.type === 'control_request') {
      if (m.request?.subtype === 'interrupt') {
        handlers.onInterrupt();
      }
      // Acknowledge every control request so the CLI-side await resolves.
      process.stdout.write(
        JSON.stringify({
          type: 'control_response',
          response: { subtype: 'success', request_id: m.request_id },
        }) + '\n',
      );
    }
  });
  rl.on('close', handlers.onClose);
}
