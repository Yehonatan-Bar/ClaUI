import type { ClaudeProcessManager } from './ClaudeProcessManager';

/**
 * Higher-level wrapper for sending control commands to the Claude CLI process.
 * Provides typed methods for common operations beyond simple user messages.
 */
export class ControlProtocol {
  constructor(private readonly processManager: ClaudeProcessManager) {}

  /** Request context compaction with optional custom instructions */
  compact(instructions?: string): void {
    this.processManager.sendCompact(instructions);
  }

  /** Cancel the current in-flight request */
  cancel(): void {
    this.processManager.sendCancel();
  }

  /** Send a user message as plain text */
  sendText(text: string): void {
    this.processManager.sendUserMessage(text);
  }

  /** Send a user message with image content blocks */
  sendWithImages(
    text: string,
    images: Array<{ base64: string; mediaType: string }>
  ): void {
    const contentBlocks: Array<Record<string, unknown>> = [];

    // Add text block
    if (text) {
      contentBlocks.push({ type: 'text', text });
    }

    // Add image blocks
    for (const img of images) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }

    this.processManager.send({
      type: 'user',
      message: { role: 'user', content: contentBlocks as never },
    });
  }
}
