import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl } from '../../hooks/useRtlDetection';
import type { WebviewImageData } from '../../../extension/types/webview-messages';

/**
 * Chat input area with auto-growing textarea.
 * Default: Enter = newline, Ctrl+Enter = send.
 * RTL direction is auto-detected based on content.
 * ArrowUp/Down navigates prompt history when cursor is at start/end.
 * "+" button opens VS Code file picker to paste file paths.
 * Explorer context action can also send paths into this input.
 * Ctrl+V pastes images from clipboard as base64 attachments.
 */
export const InputArea: React.FC = () => {
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<WebviewImageData[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isBusy, isConnected, pendingFilePaths, setPendingFilePaths, promptHistory, addToPromptHistory } = useAppStore();

  // History navigation: -1 = not browsing, 0..N = index into promptHistory (0 = oldest)
  const historyIndexRef = useRef(-1);
  // Save the draft text when user starts navigating history
  const draftRef = useRef('');

  // Seed prompt history from existing user messages on mount (covers messages
  // sent before this feature was deployed or before a reload)
  const messages = useAppStore((s) => s.messages);
  useEffect(() => {
    const state = useAppStore.getState();
    if (state.promptHistory.length > 0) return; // Already seeded
    const userTexts: string[] = [];
    for (const msg of state.messages) {
      if (msg.role !== 'user') continue;
      const textParts = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text);
      const joined = textParts.join('\n').trim();
      if (joined) userTexts.push(joined);
    }
    for (const t of userTexts) {
      state.addToPromptHistory(t);
    }
  }, [messages.length]);

  // Auto-detect RTL for the input text
  const direction = text ? (detectRtl(text) ? 'rtl' : 'ltr') : 'auto';

  /** Send the current message to Claude (allowed even while busy, to interrupt) */
  const sendMessage = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && pendingImages.length === 0) || !isConnected) return;

    if (trimmed) {
      addToPromptHistory(trimmed);
    }
    historyIndexRef.current = -1;
    draftRef.current = '';

    if (pendingImages.length > 0) {
      postToExtension({ type: 'sendMessageWithImages', text: trimmed, images: pendingImages });
      setPendingImages([]);
    } else {
      postToExtension({ type: 'sendMessage', text: trimmed });
    }
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, pendingImages, isConnected, addToPromptHistory]);

  /** Cancel the in-flight request */
  const cancelRequest = useCallback(() => {
    postToExtension({ type: 'cancelRequest' });
  }, []);

  /** Resize textarea to fit its content */
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  /** Handle keyboard events - Ctrl+Enter sends, Enter adds newline, Esc cancels, ArrowUp/Down navigates history */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === 'Escape' && isBusy) {
        e.preventDefault();
        cancelRequest();
      } else if (e.key === 'ArrowUp') {
        const el = textareaRef.current;
        if (!el) return;
        // Navigate history when cursor is on the first line (no newline before cursor)
        const textBeforeCursor = el.value.substring(0, el.selectionStart);
        const cursorOnFirstLine = !textBeforeCursor.includes('\n');
        if (cursorOnFirstLine) {
          const history = useAppStore.getState().promptHistory;
          if (history.length === 0) return;

          e.preventDefault();

          if (historyIndexRef.current === -1) {
            // Starting to browse: save current draft
            draftRef.current = text;
            historyIndexRef.current = history.length - 1;
          } else if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
          } else {
            // Already at oldest - do nothing
            return;
          }

          const historyText = history[historyIndexRef.current];
          setText(historyText);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = 0;
              textareaRef.current.selectionEnd = 0;
            }
            resizeTextarea();
          });
        }
      } else if (e.key === 'ArrowDown') {
        const el = textareaRef.current;
        if (!el) return;
        // Navigate history when cursor is on the last line (no newline after cursor)
        const textAfterCursor = el.value.substring(el.selectionEnd);
        const cursorOnLastLine = !textAfterCursor.includes('\n');
        if (cursorOnLastLine) {
          if (historyIndexRef.current === -1) return; // Not browsing history

          e.preventDefault();
          const history = useAppStore.getState().promptHistory;

          if (historyIndexRef.current < history.length - 1) {
            historyIndexRef.current++;
            const historyText = history[historyIndexRef.current];
            setText(historyText);
          } else {
            // Back to draft
            historyIndexRef.current = -1;
            setText(draftRef.current);
          }
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (textarea) {
              textarea.selectionStart = textarea.value.length;
              textarea.selectionEnd = textarea.value.length;
            }
            resizeTextarea();
          });
        }
      }
    },
    [sendMessage, isBusy, cancelRequest, text, resizeTextarea]
  );

  /** Auto-resize textarea to fit content, reset history browsing on manual edits */
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      // Any manual typing exits history browsing mode
      historyIndexRef.current = -1;
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    },
    []
  );

  /** Handle paste events - extract images from clipboard */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    // Prevent default only when we have images (let text paste through normally)
    e.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // dataUrl format: "data:image/png;base64,iVBOR..."
        const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) return;

        const mediaType = match[1] as WebviewImageData['mediaType'];
        const base64 = match[2];

        setPendingImages((prev) => [...prev, { base64, mediaType }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  /** Remove a pending image by index */
  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Open the VS Code file picker via extension host */
  const handleBrowseFiles = useCallback(() => {
    postToExtension({ type: 'pickFiles' });
  }, []);

  /** Clear all messages and restart the session */
  const handleClearSession = useCallback(() => {
    const { reset } = useAppStore.getState();
    reset();
    postToExtension({ type: 'clearSession' });
  }, []);

  // Consume file paths inserted by picker or Explorer context command
  useEffect(() => {
    if (!pendingFilePaths || pendingFilePaths.length === 0) return;

    const pathText = pendingFilePaths.join('\n');
    setText((prev) => {
      if (!prev) return pathText;
      return prev + (prev.endsWith('\n') ? '' : '\n') + pathText;
    });
    setPendingFilePaths(null);

    // Auto-resize textarea after inserting paths
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        el.focus();
      }
    });
  }, [pendingFilePaths, setPendingFilePaths]);

  // Focus textarea when component mounts
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="input-area">
      {/* Image thumbnails preview */}
      {pendingImages.length > 0 && (
        <div className="pending-images">
          {pendingImages.map((img, i) => (
            <div key={i} className="pending-image-thumb">
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={`Pasted image ${i + 1}`}
              />
              <button
                className="pending-image-remove"
                onClick={() => removePendingImage(i)}
                title="Remove image"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-wrapper">
        <button
          className="clear-session-button"
          onClick={handleClearSession}
          disabled={!isConnected}
          title="Clear session and start fresh"
        >
          Clear
        </button>
        <button
          className="browse-button"
          onClick={handleBrowseFiles}
          disabled={!isConnected}
          title="Browse files to paste their paths"
        >
          +
        </button>
        <textarea
          ref={textareaRef}
          className="input-textarea"
          dir={direction}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isBusy
              ? 'Type to interrupt... (Ctrl+Enter to send)'
              : 'Type a message... (Ctrl+Enter to send)'
          }
          disabled={!isConnected}
          rows={1}
        />
        <div className="input-buttons">
          {isBusy && (
            <button
              className="cancel-button"
              onClick={cancelRequest}
              title="Cancel current response (Esc)"
            >
              Cancel
            </button>
          )}
          <button
            className="send-button"
            onClick={sendMessage}
            disabled={(!text.trim() && pendingImages.length === 0) || !isConnected}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
