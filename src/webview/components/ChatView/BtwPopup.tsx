import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';

interface BtwPopupProps {
  contextMessageId: string | null;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

/**
 * Centered modal overlay with textarea for typing a "btw" side thought.
 * Shows how many messages will be included as context, with Cancel and Submit buttons.
 */
export const BtwPopup: React.FC<BtwPopupProps> = ({ contextMessageId, onSubmit, onClose }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messages = useAppStore((s) => s.messages);
  const sessionId = useAppStore((s) => s.sessionId);

  // Count context messages
  const contextCount = React.useMemo(() => {
    if (!contextMessageId) return messages.length;
    const idx = messages.findIndex((m) => m.id === contextMessageId);
    return idx >= 0 ? idx + 1 : messages.length;
  }, [contextMessageId, messages]);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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

  // Ctrl+Enter to submit
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (text.trim() && sessionId) {
          onSubmit(text.trim());
        }
      }
    },
    [text, sessionId, onSubmit]
  );

  const handleSubmit = useCallback(() => {
    if (text.trim() && sessionId) {
      onSubmit(text.trim());
    }
  }, [text, sessionId, onSubmit]);

  const canSubmit = text.trim().length > 0 && !!sessionId;

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
          onKeyDown={handleKeyDown}
        />

        <div className="btw-popup-actions">
          <button className="btw-popup-btn btw-popup-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btw-popup-btn btw-popup-btn-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            Open in New Tab
          </button>
        </div>
      </div>
    </div>
  );
};
