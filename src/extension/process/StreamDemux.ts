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
 *  - 'messageStart'     ({ messageId, model })
 *  - 'messageStop'      ()
 */
export class StreamDemux extends EventEmitter {
  private currentMessageId: string | null = null;

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
    this.emit('messageStart', {
      messageId: event.message.id,
      model: event.message.model,
    });
  }

  private handleContentBlockStart(event: ContentBlockStart): void {
    const block = event.content_block;

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
