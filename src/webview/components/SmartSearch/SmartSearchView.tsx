import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { MessageList } from '../ChatView/MessageList';
import { getClaudeModelLabel } from '../../utils/claudeModelDisplay';
import { SearchEmptyState } from './SearchEmptyState';

/**
 * Smart Search view: alternative to ChatView for tabs spawned with
 * tabKind='search'. The session is a real Claude/Codex agent with a
 * baked-in system prompt; this UI just provides a focused header and a
 * minimal input area without plan-mode / file mentions / ultrathink etc.
 *
 * Result cards rendered inside agent messages contain the
 * [[OPEN_SESSION:<id>:<provider>]] token, which MarkdownContent
 * transforms into a clickable button. Click handling for those buttons
 * lives in MarkdownContent.tsx.
 */
export const SmartSearchView: React.FC = () => {
  const messages = useAppStore((s) => s.messages);
  const streamingMessageId = useAppStore((s) => s.streamingMessageId);
  const isBusy = useAppStore((s) => s.isBusy);
  const isConnected = useAppStore((s) => s.isConnected);
  const provider = useAppStore((s) => s.provider);
  const model = useAppStore((s) => s.model);

  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasMessages = messages.length > 0 || streamingMessageId !== null;

  // Auto-resize textarea up to a reasonable cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  // Focus the textarea once the session is connected so the user can type
  // immediately.
  useEffect(() => {
    if (isConnected) {
      textareaRef.current?.focus();
    }
  }, [isConnected]);

  const sendCurrent = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !isConnected || isBusy) {
      return;
    }
    postToExtension({ type: 'sendMessage', text: trimmed });
    setText('');
  }, [text, isConnected, isBusy]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter sends, Enter alone inserts a newline (matches the user's
    // configured chat behavior — we keep it simple here).
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendCurrent();
    }
  };

  const providerLabel = provider === 'codex' ? 'Codex' : 'Claude';
  const modelLabel = useMemo(() => {
    if (provider === 'codex') {
      return model && model !== 'Codex (default)' ? model : 'Codex';
    }
    return getClaudeModelLabel(model) || 'Claude';
  }, [model, provider]);

  return (
    <div className="smart-search-root">
      <div className="smart-search-header">
        <div className="smart-search-title-row">
          <span className="smart-search-title">Smart Search</span>
          <span className="smart-search-meta">
            {providerLabel} <span style={{ opacity: 0.5 }}>/</span> {modelLabel}
          </span>
        </div>
        <div className="smart-search-subtitle">
          Ask the agent to find a past session by topic, time, or content.
        </div>
      </div>
      <div className="smart-search-body">
        {!hasMessages ? (
          <SearchEmptyState onPickExample={(ex) => setText(ex)} />
        ) : (
          <MessageList />
        )}
      </div>
      <div className="smart-search-input">
        <textarea
          ref={textareaRef}
          className="smart-search-textarea"
          value={text}
          placeholder={
            isConnected
              ? 'Refine search... (Ctrl+Enter to send)'
              : 'Connecting search agent...'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          rows={2}
        />
        <button
          type="button"
          className="smart-search-send-btn"
          onClick={sendCurrent}
          disabled={!isConnected || isBusy || text.trim().length === 0}
          data-tooltip="Send search query (Ctrl+Enter)"
        >
          {isBusy ? 'Working...' : 'Send'}
        </button>
      </div>
    </div>
  );
};
