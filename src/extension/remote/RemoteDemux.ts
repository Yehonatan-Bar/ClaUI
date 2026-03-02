/**
 * Translates Happy Coder envelopes into ClaUi's internal event vocabulary.
 * Follows the same EventEmitter pattern as CodexExecDemux.
 *
 * Emitted events:
 *   sessionStarted  { sessionId, model }
 *   turnStarted     { model? }
 *   streamingText   { text }
 *   agentMessage    { id, text }
 *   userMessage     { text }
 *   toolCallStart   { toolId, toolName, input? }
 *   toolCallEnd     { toolId, toolName, output?, isError? }
 *   turnCompleted   { usage: { inputTokens, outputTokens, cachedInputTokens, costUsd } }
 *   serviceEvent    { service, action, detail? }
 *   subagentStart   { name }
 *   subagentStop    { name }
 *   fileEvent       { action, path, content? }
 *   sessionEnded    { reason? }
 *   error           { message }
 */

import { EventEmitter } from 'events';
import type { HappyEnvelope } from './HappyTypes';

export class RemoteDemux extends EventEmitter {
  private currentSubagent: string | null = null;
  private turnTextBuffer = '';

  handleEnvelope(envelope: HappyEnvelope): void {
    const { ev, role, subagent } = envelope;

    // Track subagent transitions
    if (subagent && subagent !== this.currentSubagent) {
      if (this.currentSubagent) {
        this.emit('subagentStop', { name: this.currentSubagent });
      }
      this.currentSubagent = subagent;
      this.emit('subagentStart', { name: subagent });
    } else if (!subagent && this.currentSubagent) {
      this.emit('subagentStop', { name: this.currentSubagent });
      this.currentSubagent = null;
    }

    switch (ev.type) {
      case 'start':
        this.emit('sessionStarted', { sessionId: ev.sessionId, model: ev.model ?? '' });
        return;

      case 'stop':
        if (this.currentSubagent) {
          this.emit('subagentStop', { name: this.currentSubagent });
          this.currentSubagent = null;
        }
        this.emit('sessionEnded', { reason: ev.reason });
        return;

      case 'turn-start':
        this.turnTextBuffer = '';
        this.emit('turnStarted', { model: ev.model });
        return;

      case 'turn-end':
        // Flush accumulated text as an agent message
        if (this.turnTextBuffer.length > 0) {
          this.emit('agentMessage', {
            id: `msg-${envelope.turn}-${envelope.id}`,
            text: this.turnTextBuffer,
          });
          this.turnTextBuffer = '';
        }
        this.emit('turnCompleted', {
          usage: {
            inputTokens: ev.usage?.input_tokens ?? 0,
            outputTokens: ev.usage?.output_tokens ?? 0,
            cachedInputTokens: ev.usage?.cached_input_tokens ?? 0,
            costUsd: ev.usage?.cost_usd ?? 0,
          },
        });
        return;

      case 'text':
        if (role === 'user') {
          this.emit('userMessage', { text: ev.text });
        } else {
          this.turnTextBuffer += ev.text;
          this.emit('streamingText', { text: ev.text });
        }
        return;

      case 'tool-call-start':
        this.emit('toolCallStart', {
          toolId: ev.toolId,
          toolName: ev.toolName,
          input: ev.input,
        });
        return;

      case 'tool-call-end':
        this.emit('toolCallEnd', {
          toolId: ev.toolId,
          toolName: ev.toolName,
          output: ev.output,
          isError: ev.isError ?? false,
        });
        return;

      case 'service':
        this.emit('serviceEvent', {
          service: ev.service,
          action: ev.action,
          detail: ev.detail,
        });
        return;

      case 'file':
        this.emit('fileEvent', {
          action: ev.action,
          path: ev.path,
          content: ev.content,
        });
        return;

      default:
        // Unknown event type - log but don't crash
        this.emit('error', { message: `Unknown Happy event type: ${(ev as { type: string }).type}` });
    }
  }

  /** Reset state between sessions */
  reset(): void {
    this.currentSubagent = null;
    this.turnTextBuffer = '';
  }
}
