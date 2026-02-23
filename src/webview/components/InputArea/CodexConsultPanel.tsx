import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const CodexConsultPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [question, setQuestion] = useState('');
  const { isConnected, isBusy } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = question.trim();
    if (!trimmed || !isConnected || isBusy) return;
    postToExtension({ type: 'codexConsult', question: trimmed });
    setQuestion('');
    onClose();
  }, [question, isConnected, isBusy, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, onClose]);

  return (
    <div className="codex-consult-panel">
      <div className="codex-consult-header">
        <span className="codex-consult-title">Consult Codex Expert</span>
        <button className="codex-consult-close" onClick={onClose} title="Close">
          x
        </button>
      </div>
      <div className="codex-consult-desc">
        Ask a question. Claude will enrich it with system context and consult the GPT expert.
      </div>
      <div className="codex-consult-input">
        <textarea
          ref={textareaRef}
          className="codex-consult-textarea"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. What's the best approach for error handling in this API?"
          rows={3}
          disabled={!isConnected || isBusy}
        />
        <button
          className="codex-consult-send-btn"
          onClick={handleSend}
          disabled={!question.trim() || !isConnected || isBusy}
          title="Send consultation (Ctrl+Enter)"
        >
          Consult
        </button>
      </div>
    </div>
  );
};
