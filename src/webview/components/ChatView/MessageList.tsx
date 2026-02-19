import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { MessageBubble } from './MessageBubble';
import { StreamingText } from './StreamingText';
import { ToolUseBlock } from './ToolUseBlock';

/**
 * Scrollable list of chat messages with auto-scroll behavior.
 * Displays completed messages and current streaming content.
 */
interface MessageListProps {
  onScrollFractionChange?: (fraction: number) => void;
}

export const MessageList: React.FC<MessageListProps> = ({ onScrollFractionChange }) => {
  const { messages, streamingMessageId, streamingBlocks, isBusy, truncateFromMessage, addUserMessage, markSessionPromptSent } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

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
    const scrolledUp = distanceFromBottom > 100;
    userScrolledUp.current = scrolledUp;
    setShowScrollToBottom(scrolledUp);

    // Report scroll fraction for Session Vitals timeline position marker
    if (onScrollFractionChange && container.scrollHeight > container.clientHeight) {
      const fraction = container.scrollTop / (container.scrollHeight - container.clientHeight);
      onScrollFractionChange(Math.max(0, Math.min(1, fraction)));
    }
  };

  /** Edit a previously sent user message: truncate all messages from that point
   *  onward, add the edited message to the store, and send the updated text to
   *  the extension to start a new session. */
  const handleEditAndResend = useCallback((messageId: string, newText: string) => {
    truncateFromMessage(messageId);
    // Add the edited user message immediately so it's visible in the UI.
    // The CLI may or may not echo it back via a userMessage event; adding it
    // here ensures the user always sees what they sent.
    addUserMessage(newText);
    markSessionPromptSent();
    postToExtension({ type: 'editAndResend', text: newText });
  }, [truncateFromMessage, addUserMessage, markSessionPromptSent]);

  /** Fork conversation from a specific user message: opens a new tab
   *  with history up to (but not including) that message, and its text
   *  pre-filled in the input area. */
  const handleFork = useCallback((messageId: string, messageText: string) => {
    const state = useAppStore.getState();
    const sessionId = state.sessionId;
    if (!sessionId) return;

    const messageIndex = state.messages.findIndex((m) => m.id === messageId);
    if (messageIndex < 0) return;

    // Send conversation history up to (but not including) the fork message
    const messagesBeforeFork = state.messages.slice(0, messageIndex);

    postToExtension({
      type: 'forkFromMessage',
      sessionId,
      forkMessageIndex: messageIndex,
      promptText: messageText,
      messages: messagesBeforeFork,
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    userScrolledUp.current = false;
    setShowScrollToBottom(false);
  }, []);

  return (
    <div
      className="message-list"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isBusy={isBusy}
          onEditAndResend={handleEditAndResend}
          onFork={handleFork}
        />
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

      {showScrollToBottom && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 11.5L2.5 6l1-1L8 9.5 12.5 5l1 1z" />
          </svg>
        </button>
      )}
    </div>
  );
};
