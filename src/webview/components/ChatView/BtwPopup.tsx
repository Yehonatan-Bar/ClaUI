import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { StreamingText } from './StreamingText';
import type { ContentBlock } from '../../../extension/types/stream-json';

interface BtwPopupProps {
  contextMessageId: string | null;
  mode: 'compose' | 'chat';
  onSubmitNewTab: (text: string) => void;
  onStartBtwSession: (text: string) => void;
  onClose: () => void;
}

/**
 * Floating BTW panel with two modes:
 * - compose: centered modal with textarea for typing a side thought
 * - chat: floating overlay showing the btw conversation from a background session
 */
export const BtwPopup: React.FC<BtwPopupProps> = ({
  contextMessageId,
  mode,
  onSubmitNewTab,
  onStartBtwSession,
  onClose,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const messages = useAppStore((s) => s.messages);
  const sessionId = useAppStore((s) => s.sessionId);

  // BTW background session state
  const btwSession = useAppStore((s) => s.btwSession);

  // Count context messages (for compose mode)
  const contextCount = React.useMemo(() => {
    if (!contextMessageId) return messages.length;
    const idx = messages.findIndex((m) => m.id === contextMessageId);
    return idx >= 0 ? idx + 1 : messages.length;
  }, [contextMessageId, messages]);

  // Auto-scroll chat messages to bottom
  useEffect(() => {
    if (mode === 'chat' && chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [mode, btwSession?.messages, btwSession?.streamingBlocks]);

  // Auto-focus the right textarea
  useEffect(() => {
    if (mode === 'compose') {
      textareaRef.current?.focus();
    } else {
      chatInputRef.current?.focus();
    }
  }, [mode]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Ctrl+Enter to submit (compose mode)
  const handleComposeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (text.trim() && sessionId) {
          onStartBtwSession(text.trim());
          setText('');
        }
      }
    },
    [text, sessionId, onStartBtwSession]
  );

  // Enter to send in chat mode (Shift+Enter for newline)
  const handleChatKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (text.trim() && !btwSession?.isBusy) {
          postToExtension({ type: 'sendBtwMessage', text: text.trim() });
          setText('');
        }
      }
    },
    [text, btwSession?.isBusy]
  );

  const handleNewTabSubmit = useCallback(() => {
    if (text.trim() && sessionId) {
      onSubmitNewTab(text.trim());
    }
  }, [text, sessionId, onSubmitNewTab]);

  const handleStartBtwSession = useCallback(() => {
    if (text.trim() && sessionId) {
      onStartBtwSession(text.trim());
      setText('');
    }
  }, [text, sessionId, onStartBtwSession]);

  const handleChatSend = useCallback(() => {
    if (text.trim() && !btwSession?.isBusy) {
      postToExtension({ type: 'sendBtwMessage', text: text.trim() });
      setText('');
    }
  }, [text, btwSession?.isBusy]);

  const canSubmit = text.trim().length > 0 && !!sessionId;
  const isBtwBusy = btwSession?.isBusy ?? false;

  // Extract text from content blocks
  const getTextFromContent = (content: ContentBlock[]) => {
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
  };

  // ========== CHAT MODE ==========
  if (mode === 'chat') {
    const btwMessages = btwSession?.messages ?? [];
    const streamingBlocks = btwSession?.streamingBlocks ?? [];
    const isStreaming = !!btwSession?.streamingMessageId && streamingBlocks.length > 0;

    return (
      <div className="btw-chat-overlay">
        <div className="btw-chat-panel">
          <div className="btw-chat-header">
            <span className="btw-chat-title">btw...</span>
            <button className="btw-popup-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708z" />
              </svg>
            </button>
          </div>

          <div className="btw-chat-messages" ref={chatMessagesRef}>
            {btwMessages.length === 0 && !isStreaming && (
              <div className="btw-chat-empty">
                {isBtwBusy ? 'Starting session...' : 'Waiting for response...'}
              </div>
            )}
            {btwMessages.map((msg) => (
              <div key={msg.id} className={`btw-chat-msg btw-chat-msg-${msg.role}`}>
                <div className="btw-chat-msg-role">{msg.role === 'user' ? 'You' : 'Claude'}</div>
                <div className="btw-chat-msg-text">{getTextFromContent(msg.content)}</div>
              </div>
            ))}
            {isStreaming && (
              <div className="btw-chat-msg btw-chat-msg-assistant">
                <div className="btw-chat-msg-role">Claude</div>
                <div className="btw-chat-msg-text">
                  {streamingBlocks
                    .filter((b) => b.type === 'text')
                    .map((b) => (
                      <StreamingText key={b.blockIndex} text={b.text} />
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="btw-chat-input-area">
            <textarea
              ref={chatInputRef}
              className="btw-chat-input"
              placeholder={isBtwBusy ? 'Waiting for response...' : 'Continue the conversation...'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleChatKeyDown}
              disabled={isBtwBusy}
              rows={1}
            />
            <button
              className="btw-chat-send-btn"
              onClick={handleChatSend}
              disabled={!text.trim() || isBtwBusy}
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 1.5l14 6.5-14 6.5V9l8-1-8-1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========== COMPOSE MODE ==========
  return (
    <div className="btw-popup-overlay" onMouseDown={onClose}>
      <div className="btw-popup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btw-popup-header">
          <span className="btw-popup-title">btw...</span>
          <button className="btw-popup-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708z" />
            </svg>
          </button>
        </div>

        <div className="btw-popup-context-info">
          Context: {contextCount} message{contextCount !== 1 ? 's' : ''}
        </div>

        <textarea
          ref={textareaRef}
          className="btw-popup-textarea"
          placeholder="What's on your mind?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleComposeKeyDown}
        />

        <div className="btw-popup-actions">
          <button className="btw-popup-btn btw-popup-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btw-popup-btn btw-popup-btn-secondary"
            onClick={handleNewTabSubmit}
            disabled={!canSubmit}
          >
            New Tab
          </button>
          <button
            className="btw-popup-btn btw-popup-btn-submit"
            onClick={handleStartBtwSession}
            disabled={!canSubmit}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
