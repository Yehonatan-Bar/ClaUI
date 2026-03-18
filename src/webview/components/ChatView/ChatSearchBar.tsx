import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const DEBOUNCE_MS = 300;

/** Format a timestamp as relative time */
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

/**
 * Compact search bar for searching chat messages.
 * Supports two scopes: current session (client-side) and project (extension-side).
 */
export const ChatSearchBar: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localQuery, setLocalQuery] = useState('');

  const {
    chatSearchScope,
    chatSearchMatchIds,
    chatSearchCurrentIndex,
    chatSearchProjectResults,
    chatSearchProjectLoading,
    setChatSearchQuery,
    setChatSearchScope,
    setChatSearchCurrentIndex,
    setChatSearchOpen,
    chatSearchProjectRequestId,
  } = useAppStore();

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setChatSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setChatSearchOpen]);

  // Handle input changes
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setLocalQuery(query);

    if (chatSearchScope === 'session') {
      // Session search: immediate (no debounce needed)
      setChatSearchQuery(query);
    } else {
      // Project search: debounced
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setChatSearchQuery(query);
        if (query.length >= 2) {
          const nextRequestId = chatSearchProjectRequestId + 1;
          useAppStore.setState({
            chatSearchProjectRequestId: nextRequestId,
            chatSearchProjectLoading: true,
          });
          postToExtension({
            type: 'chatSearchProject',
            query,
            requestId: nextRequestId,
          });
        } else {
          useAppStore.setState({
            chatSearchProjectResults: [],
            chatSearchProjectLoading: false,
          });
        }
      }, DEBOUNCE_MS);
    }
  }, [chatSearchScope, setChatSearchQuery, chatSearchProjectRequestId]);

  // Navigate to previous match (session mode)
  const goToPrev = useCallback(() => {
    if (chatSearchMatchIds.length === 0) return;
    const newIndex = chatSearchCurrentIndex <= 0
      ? chatSearchMatchIds.length - 1
      : chatSearchCurrentIndex - 1;
    setChatSearchCurrentIndex(newIndex);
    scrollToMatch(chatSearchMatchIds[newIndex]);
  }, [chatSearchMatchIds, chatSearchCurrentIndex, setChatSearchCurrentIndex]);

  // Navigate to next match (session mode)
  const goToNext = useCallback(() => {
    if (chatSearchMatchIds.length === 0) return;
    const newIndex = chatSearchCurrentIndex >= chatSearchMatchIds.length - 1
      ? 0
      : chatSearchCurrentIndex + 1;
    setChatSearchCurrentIndex(newIndex);
    scrollToMatch(chatSearchMatchIds[newIndex]);
  }, [chatSearchMatchIds, chatSearchCurrentIndex, setChatSearchCurrentIndex]);

  // Scroll a matching message into view
  const scrollToMatch = (messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Handle Enter key: navigate matches in session mode
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (chatSearchScope === 'session') {
        if (e.shiftKey) goToPrev();
        else goToNext();
      }
    }
  }, [chatSearchScope, goToNext, goToPrev]);

  // Switch scope
  const handleScopeChange = useCallback((scope: 'session' | 'project') => {
    setChatSearchScope(scope);
    if (scope === 'project' && localQuery.length >= 2) {
      // Trigger project search immediately on scope switch
      const nextRequestId = chatSearchProjectRequestId + 1;
      useAppStore.setState({
        chatSearchProjectRequestId: nextRequestId,
        chatSearchProjectLoading: true,
      });
      postToExtension({
        type: 'chatSearchProject',
        query: localQuery,
        requestId: nextRequestId,
      });
    }
    inputRef.current?.focus();
  }, [setChatSearchScope, localQuery, chatSearchProjectRequestId]);

  // Resume a session from project results
  const handleResumeSession = useCallback((sessionId: string) => {
    postToExtension({ type: 'chatSearchResumeSession', sessionId });
    setChatSearchOpen(false);
  }, [setChatSearchOpen]);

  // Highlight matching text in snippet
  const highlightSnippet = (snippet: string, query: string) => {
    if (!query || query.length < 2) return snippet;
    const parts: React.ReactNode[] = [];
    const lowerSnippet = snippet.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;

    let idx = lowerSnippet.indexOf(lowerQuery);
    while (idx !== -1) {
      if (idx > lastIndex) {
        parts.push(snippet.slice(lastIndex, idx));
      }
      parts.push(
        <span key={idx} className="chat-search-highlight">
          {snippet.slice(idx, idx + query.length)}
        </span>
      );
      lastIndex = idx + query.length;
      idx = lowerSnippet.indexOf(lowerQuery, lastIndex);
    }
    if (lastIndex < snippet.length) {
      parts.push(snippet.slice(lastIndex));
    }
    return parts.length > 0 ? parts : snippet;
  };

  return (
    <div className="chat-search-bar-container">
      <div className="chat-search-bar">
        {/* Search icon */}
        <span className="chat-search-icon" aria-hidden="true">
          {/* Simple magnifying glass using CSS */}
        </span>

        {/* Input */}
        <input
          ref={inputRef}
          className="chat-search-input"
          type="text"
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={chatSearchScope === 'session' ? 'Search in session...' : 'Search all sessions...'}
          spellCheck={false}
          autoComplete="off"
        />

        {/* Scope toggle */}
        <div className="chat-search-scope-toggle">
          <button
            className={`chat-search-scope-btn ${chatSearchScope === 'session' ? 'active' : ''}`}
            onClick={() => handleScopeChange('session')}
            data-tooltip="Search current session"
          >
            Session
          </button>
          <button
            className={`chat-search-scope-btn ${chatSearchScope === 'project' ? 'active' : ''}`}
            onClick={() => handleScopeChange('project')}
            data-tooltip="Search all project sessions"
          >
            Project
          </button>
        </div>

        {/* Match count / status */}
        {chatSearchScope === 'session' ? (
          <span className="chat-search-match-count">
            {chatSearchMatchIds.length > 0
              ? `${chatSearchCurrentIndex + 1} / ${chatSearchMatchIds.length}`
              : localQuery ? 'No matches' : ''
            }
          </span>
        ) : (
          <span className="chat-search-match-count">
            {chatSearchProjectLoading
              ? 'Searching...'
              : chatSearchProjectResults.length > 0
                ? `${chatSearchProjectResults.length} results`
                : localQuery.length >= 2 ? 'No results' : ''
            }
          </span>
        )}

        {/* Navigation arrows (session mode only) */}
        {chatSearchScope === 'session' && (
          <>
            <button
              className="chat-search-nav-btn"
              onClick={goToPrev}
              disabled={chatSearchMatchIds.length === 0}
              data-tooltip="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              &#x2191;
            </button>
            <button
              className="chat-search-nav-btn"
              onClick={goToNext}
              disabled={chatSearchMatchIds.length === 0}
              data-tooltip="Next match (Enter)"
              aria-label="Next match"
            >
              &#x2193;
            </button>
          </>
        )}

        {/* Close button */}
        <button
          className="chat-search-close-btn"
          onClick={() => setChatSearchOpen(false)}
          data-tooltip="Close (Esc)"
          aria-label="Close search"
        >
          x
        </button>
      </div>

      {/* Project results dropdown */}
      {chatSearchScope === 'project' && chatSearchProjectResults.length > 0 && (
        <div className="chat-search-project-dropdown">
          {chatSearchProjectResults.map((result, i) => (
            <div
              key={`${result.sessionId}-${i}`}
              className="chat-search-project-item"
              onClick={() => handleResumeSession(result.sessionId)}
            >
              <div className="chat-search-project-item-header">
                <span className={`chat-search-role-badge chat-search-role-${result.matchRole}`}>
                  {result.matchRole === 'user' ? 'User' : 'Assistant'}
                </span>
                <span className="chat-search-project-item-label" title={result.sessionLabel}>
                  {result.sessionLabel}
                </span>
                <span className="chat-search-project-item-time">
                  {formatRelativeTime(result.mtime)}
                </span>
              </div>
              <div className="chat-search-project-item-snippet">
                {highlightSnippet(result.matchSnippet, localQuery)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
