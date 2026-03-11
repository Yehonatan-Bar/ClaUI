import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { MessageBubble } from './MessageBubble';
import { StreamingText } from './StreamingText';
import { ToolUseBlock } from './ToolUseBlock';
import { BtwContextMenu } from './BtwContextMenu';
import { BtwPopup } from './BtwPopup';

/**
 * Scrollable list of chat messages with auto-scroll behavior.
 * Displays completed messages and current streaming content.
 */
interface MessageListProps {
  onScrollFractionChange?: (fraction: number) => void;
}

export const MessageList: React.FC<MessageListProps> = ({ onScrollFractionChange }) => {
  const { messages, streamingMessageId, streamingBlocks, isBusy, truncateFromMessage, addUserMessage, markSessionPromptSent, currentThinkingEffort, btwPopup, setBtwPopup, clearBtwSession } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; messageId: string | null; hasSelection: boolean } | null>(null);

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

  /** Right-click handler: show the BTW context menu at click coordinates */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const state = useAppStore.getState();
    if (state.messages.length === 0) return; // no context to BTW about

    e.preventDefault();
    const messageEl = (e.target as HTMLElement).closest('[data-message-id]');
    const messageId = messageEl?.getAttribute('data-message-id') ?? null;
    const selection = window.getSelection();
    const hasSelection = !!selection && selection.toString().trim().length > 0;
    setContextMenu({ x: e.clientX, y: e.clientY, messageId, hasSelection });
  }, []);

  /** Context menu "btw" click: open the popup */
  const handleBtwClick = useCallback(() => {
    if (!contextMenu) return;
    setBtwPopup({ contextMessageId: contextMenu.messageId, mode: 'compose' });
    setContextMenu(null);
  }, [contextMenu, setBtwPopup]);

  /** BTW start background session: fork from current session and send first message */
  const handleStartBtwSession = useCallback((btwText: string) => {
    postToExtension({ type: 'startBtwSession', promptText: btwText });
    // Switch popup to chat mode - the overlay reads from btwSession state
    setBtwPopup({
      contextMessageId: useAppStore.getState().btwPopup?.contextMessageId ?? null,
      mode: 'chat',
    });
  }, [setBtwPopup]);

  /** BTW close: dispose the background session and clear btw state */
  const handleBtwClose = useCallback(() => {
    postToExtension({ type: 'closeBtwSession' });
    clearBtwSession();
  }, [clearBtwSession]);

  /** BTW submit: reuse fork infrastructure to open a new tab with context */
  const handleBtwSubmit = useCallback((btwText: string) => {
    const state = useAppStore.getState();
    const sessionId = state.sessionId;
    if (!sessionId) return;

    const allMessages = state.messages;
    const popup = state.btwPopup;
    let messagesForContext: typeof allMessages;
    let forkIndex: number;

    if (popup?.contextMessageId) {
      const idx = allMessages.findIndex((m) => m.id === popup.contextMessageId);
      messagesForContext = idx >= 0 ? allMessages.slice(0, idx + 1) : [...allMessages];
      forkIndex = idx >= 0 ? idx + 1 : allMessages.length;
    } else {
      messagesForContext = [...allMessages];
      forkIndex = allMessages.length;
    }

    postToExtension({
      type: 'forkFromMessage',
      sessionId,
      forkMessageIndex: forkIndex,
      promptText: btwText,
      messages: messagesForContext,
    });
    setBtwPopup(null);
  }, [setBtwPopup]);

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
      onContextMenu={handleContextMenu}
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
          <div className="message-role">
            Assistant
            <span className="message-timestamp">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {currentThinkingEffort && (
              <span className={`thinking-effort-badge thinking-effort-${currentThinkingEffort} thinking-effort-live`}>
                {currentThinkingEffort}
              </span>
            )}
          </div>
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
          data-tooltip="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 11.5L2.5 6l1-1L8 9.5 12.5 5l1 1z" />
          </svg>
        </button>
      )}

      {contextMenu && (
        <BtwContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          onBtwClick={handleBtwClick}
          onClose={() => setContextMenu(null)}
        />
      )}

      {btwPopup && (
        <BtwPopup
          contextMessageId={btwPopup.contextMessageId}
          mode={btwPopup.mode}
          onSubmitNewTab={handleBtwSubmit}
          onStartBtwSession={handleStartBtwSession}
          onClose={handleBtwClose}
        />
      )}
    </div>
  );
};
