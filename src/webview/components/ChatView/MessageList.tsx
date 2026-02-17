import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { MessageBubble } from './MessageBubble';
import { StreamingText } from './StreamingText';
import { ToolUseBlock } from './ToolUseBlock';

/**
 * Scrollable list of chat messages with auto-scroll behavior.
 * Displays completed messages and current streaming content.
 */
export const MessageList: React.FC = () => {
  const { messages, streamingMessageId, streamingBlocks } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  console.log(`%c[MessageList] render`, 'color: lime; font-weight: bold', {
    messageCount: messages.length,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      contentIsArray: Array.isArray(m.content),
      contentType: typeof m.content,
      contentLength: Array.isArray(m.content) ? m.content.length : 'N/A',
      contentBlockTypes: Array.isArray(m.content) ? m.content.map(b => b.type) : m.content,
    })),
    streamingId: streamingMessageId,
    streamingBlockCount: streamingBlocks.length,
  });

  // Auto-scroll to bottom on new content, unless user has scrolled up
  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingBlocks]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    // Consider "scrolled up" if more than 100px from bottom
    userScrolledUp.current = distanceFromBottom > 100;
  };

  return (
    <div
      className="message-list"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Show streaming content for the in-progress message */}
      {streamingMessageId && streamingBlocks.length > 0 && (
        <div className="message message-assistant">
          <div className="message-role">Assistant</div>
          {streamingBlocks.map((block) =>
            block.type === 'text' ? (
              <StreamingText key={block.blockIndex} text={block.text} />
            ) : (
              <ToolUseBlock
                key={block.blockIndex}
                toolName={block.toolName || 'tool'}
                partialInput={block.partialJson}
                isStreaming
              />
            )
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
