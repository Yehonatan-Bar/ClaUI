import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { ParticipantAutocomplete } from './ParticipantAutocomplete';
import { ActivityIndicators } from './ActivityIndicators';
import { postToExtension } from '../../hooks/useClaudeStream';

export const MPInputArea: React.FC = () => {
  const connectionStatus = useAppStore((s) => s.mpConnectionStatus);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const sendTypingIndicator = useCallback((state: 'typing' | 'idle') => {
    if (state === 'typing' && isTypingRef.current) return;
    if (state === 'idle' && !isTypingRef.current) return;
    isTypingRef.current = state === 'typing';
    postToExtension({ type: 'mpTypingIndicator', state });
  }, []);

  const resetTypingTimer = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sendTypingIndicator('idle');
    }, 5000);
  }, [sendTypingIndicator]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    sendTypingIndicator('typing');
    resetTypingTimer();
  }, [sendTypingIndicator, resetTypingTimer]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    postToExtension({ type: 'mpSendMessage', rawBody: trimmed });
    setText('');
    sendTypingIndicator('idle');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    textareaRef.current?.focus();
  }, [text, sendTypingIndicator]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleAutocompleteAccept = useCallback((value: string) => {
    setText(value);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  const isDisconnected = connectionStatus !== 'connected';

  return (
    <div className="mp-input-area">
      <ActivityIndicators />
      <div className="mp-input-row">
        <div className="mp-input-wrapper">
          <ParticipantAutocomplete
            inputValue={text}
            onAccept={handleAutocompleteAccept}
            anchorRef={textareaRef as React.RefObject<HTMLElement | null>}
          />
          <textarea
            ref={textareaRef}
            className="mp-input-textarea"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isDisconnected ? 'Disconnected...' : 'Type a message... (prefix with name to address)'}
            disabled={isDisconnected}
            rows={1}
          />
        </div>
        <button
          className="mp-send-btn"
          onClick={handleSend}
          disabled={isDisconnected || !text.trim()}
          data-tooltip="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
};
