import { EventEmitter } from 'events';
import type {
  CodexAgentMessageItem,
  CodexCommandExecutionItem,
  CodexExecJsonEvent,
  CodexItemCompletedEvent,
  CodexItemStartedEvent,
  CodexTurnCompletedEvent,
} from '../types/codex-exec-json';

/**
 * Demultiplexes `codex exec --json` JSONL events into a stable internal event set.
 */
export class CodexExecDemux extends EventEmitter {
  handleEvent(event: CodexExecJsonEvent): void {
    switch (event.type) {
      case 'thread.started':
        this.emit('threadStarted', { threadId: event.thread_id });
        return;
      case 'turn.started':
        this.emit('turnStarted');
        return;
      case 'turn.completed':
        this.handleTurnCompleted(event as CodexTurnCompletedEvent);
        return;
      case 'item.started':
        this.handleItemStarted(event as CodexItemStartedEvent);
        return;
      case 'item.completed':
        this.handleItemCompleted(event as CodexItemCompletedEvent);
        return;
      default:
        this.emit('raw', event);
    }
  }

  private handleTurnCompleted(event: CodexTurnCompletedEvent): void {
    this.emit('turnCompleted', {
      usage: {
        inputTokens: event.usage?.input_tokens ?? 0,
        cachedInputTokens: event.usage?.cached_input_tokens ?? 0,
        outputTokens: event.usage?.output_tokens ?? 0,
      },
      raw: event,
    });
  }

  private handleItemStarted(event: CodexItemStartedEvent): void {
    const item = event.item;
    if (item.type === 'command_execution') {
      const cmd = item as CodexCommandExecutionItem;
      this.emit('commandExecutionStart', {
        id: cmd.id || '',
        command: cmd.command || '',
        aggregatedOutput: cmd.aggregated_output || '',
        exitCode: cmd.exit_code ?? null,
        status: cmd.status || 'in_progress',
      });
      return;
    }

    this.emit('unknownItem', { phase: 'started', item });
  }

  private handleItemCompleted(event: CodexItemCompletedEvent): void {
    const item = event.item;

    if (item.type === 'agent_message') {
      const msg = item as CodexAgentMessageItem;
      this.emit('agentMessage', {
        id: msg.id || '',
        text: typeof msg.text === 'string' ? msg.text : '',
      });
      return;
    }

    if (item.type === 'command_execution') {
      const cmd = item as CodexCommandExecutionItem;
      this.emit('commandExecutionComplete', {
        id: cmd.id || '',
        command: cmd.command || '',
        aggregatedOutput: cmd.aggregated_output || '',
        exitCode: cmd.exit_code ?? null,
        status: cmd.status || 'completed',
      });
      return;
    }

    if (item.type === 'reasoning') {
      this.emit('reasoning', {
        id: item.id || '',
        text: typeof item.text === 'string' ? item.text : '',
      });
      return;
    }

    if (item.type === 'error') {
      const message =
        typeof item.message === 'string'
          ? item.message
          : typeof item.text === 'string'
            ? item.text
            : 'Codex item error';
      this.emit('error', { message, item });
      return;
    }

    this.emit('unknownItem', { phase: 'completed', item });
  }
}
