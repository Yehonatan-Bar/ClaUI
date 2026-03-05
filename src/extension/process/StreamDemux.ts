import { EventEmitter } from 'events';
import type {
  CliOutputEvent,
  SystemInitEvent,
  StreamEvent,
  AssistantMessage,
  UserMessage,
  ResultSuccess,
  ResultError,
  ContentBlockStart,
  ContentBlockDelta,
  ContentBlockStop,
  MessageStart,
  MessageDelta,
  MessageStop,
} from '../types/stream-json';

/**
 * Demultiplexes raw CLI output events into typed, higher-level events
 * that UI consumers (webview, terminal) can subscribe to.
 *
 * Events emitted:
 *  - 'init'             (SystemInitEvent)
 *  - 'assistantMessage' (AssistantMessage)
 *  - 'userMessage'      (UserMessage)
 *  - 'result'           (ResultSuccess | ResultError)
 *  - 'textDelta'        ({ messageId, blockIndex, text })
 *  - 'toolUseStart'     ({ messageId, blockIndex, toolName, toolId })
 *  - 'toolUseDelta'     ({ messageId, blockIndex, partialJson })
 *  - 'blockStop'        ({ blockIndex })
 *  - 'messageDelta'     ({ stopReason })
 *  - 'messageStart'     ({ messageId, model, thinkingEffort? })
 *  - 'messageStop'      ()
 *  - 'thinkingDetected'  ({ effort })
 */
export class StreamDemux extends EventEmitter {
  private currentMessageId: string | null = null;
  private currentThinkingEffort: string | null = null;
  /** Set of block indices that are thinking blocks (silently consumed) */
  private thinkingBlockIndices = new Set<number>();

  /** Feed a parsed CLI output event into the demuxer */
  handleEvent(event: CliOutputEvent): void {
    switch (event.type) {
      case 'system':
        this.handleSystemEvent(event);
        break;
      case 'stream_event':
        this.handleStreamEvent(event);
        break;
      case 'assistant':
        this.handleAssistantMessage(event);
        break;
      case 'user':
        this.handleUserMessage(event);
        break;
      case 'result':
        this.handleResult(event);
        break;
    }
  }

  private handleSystemEvent(event: SystemInitEvent): void {
    // Only emit 'init' for actual init events, not hook_started/hook_response
    if (event.subtype === 'init') {
      // Capture thinking effort from system init if available
      if (event.thinking_effort) {
        this.currentThinkingEffort = event.thinking_effort;
      }
      this.emit('init', event);
    }
    // All system events (including hooks) are emitted generically
    this.emit('system', event);
  }

  private handleStreamEvent(streamEvent: StreamEvent): void {
    const payload = streamEvent.event;

    switch (payload.type) {
      case 'message_start':
        this.handleMessageStart(payload as MessageStart);
        break;
      case 'content_block_start':
        this.handleContentBlockStart(payload as ContentBlockStart);
        break;
      case 'content_block_delta':
        this.handleContentBlockDelta(payload as ContentBlockDelta);
        break;
      case 'content_block_stop':
        this.handleContentBlockStop(payload as ContentBlockStop);
        break;
      case 'message_delta':
        this.handleMessageDelta(payload as MessageDelta);
        break;
      case 'message_stop':
        this.handleMessageStop();
        break;
    }
  }

  private handleMessageStart(event: MessageStart): void {
    this.currentMessageId = event.message.id;
    this.currentThinkingEffort = null;
    this.thinkingBlockIndices.clear();
    const usage = event.message.usage;
    // Total context = input_tokens + cache_creation + cache_read
    // input_tokens alone is only the non-cached portion (often 1-5)
    const totalInputTokens = (usage?.input_tokens ?? 0)
      + (usage?.cache_creation_input_tokens ?? 0)
      + (usage?.cache_read_input_tokens ?? 0);
    this.emit('messageStart', {
      messageId: event.message.id,
      model: event.message.model,
      inputTokens: totalInputTokens || undefined,
    });
  }

  private handleContentBlockStart(event: ContentBlockStart): void {
    const block = event.content_block;

    if (block.type === 'thinking') {
      // Track this block index as thinking so deltas are silently consumed
      this.thinkingBlockIndices.add(event.index);
      if (!this.currentThinkingEffort) {
        // First thinking block in this message - detect effort from budget token
        // The CLI may include a budget hint; for now, mark as detected and
        // let the init event or system-level config provide the effort label
        this.currentThinkingEffort = 'high'; // default when thinking is present
        this.emit('thinkingDetected', { effort: this.currentThinkingEffort });
      }
      return;
    }

    if (block.type === 'tool_use') {
      this.emit('toolUseStart', {
        messageId: this.currentMessageId,
        blockIndex: event.index,
        toolName: block.name || 'unknown',
        toolId: block.id || '',
      });
    }
    // Text blocks start empty; deltas will fill in the text
  }

  private handleContentBlockDelta(event: ContentBlockDelta): void {
    // Silently consume thinking deltas (don't display thinking content)
    if (this.thinkingBlockIndices.has(event.index) || event.delta.type === 'thinking_delta') {
      return;
    }

    const delta = event.delta;

    if (delta.type === 'text_delta' && delta.text) {
      this.emit('textDelta', {
        messageId: this.currentMessageId,
        blockIndex: event.index,
        text: delta.text,
      });
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      this.emit('toolUseDelta', {
        messageId: this.currentMessageId,
        blockIndex: event.index,
        partialJson: delta.partial_json,
      });
    }
  }

  private handleContentBlockStop(event: ContentBlockStop): void {
    this.emit('blockStop', { blockIndex: event.index });
  }

  private handleMessageDelta(event: MessageDelta): void {
    this.emit('messageDelta', {
      stopReason: event.delta.stop_reason,
    });
  }

  private handleMessageStop(): void {
    this.currentMessageId = null;
    this.emit('messageStop');
  }

  /** Get the thinking effort detected for the current/last message */
  getThinkingEffort(): string | null {
    return this.currentThinkingEffort;
  }

  private handleAssistantMessage(event: AssistantMessage): void {
    this.emit('assistantMessage', event);
  }

  private handleUserMessage(event: UserMessage): void {
    this.emit('userMessage', event);
  }

  private handleResult(event: ResultSuccess | ResultError): void {
    this.emit('result', event);
  }
}
