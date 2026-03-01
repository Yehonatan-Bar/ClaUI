import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl, isLikelyEnglish } from '../../hooks/useRtlDetection';
import { GitPushPanel } from './GitPushPanel';
import { FileMentionPopup } from './FileMentionPopup';
import { useFileMention } from '../../hooks/useFileMention';
import type { WebviewImageData } from '../../../extension/types/webview-messages';

/**
 * Manages an undo/redo stack for a textarea controlled by React state.
 * React controlled components break the browser's native undo because React
 * resets the textarea value on every render. This class keeps its own stack
 * of (text, cursorPosition) snapshots so Ctrl+Z / Ctrl+Y work as expected.
 */
class UndoManager {
  private stack: Array<{ text: string; cursor: number }> = [{ text: '', cursor: 0 }];
  private index = 0;
  private static readonly MAX_STACK = 200;

  /** Record a new state. Discards any redo entries beyond current index. */
  push(text: string, cursor: number) {
    // Skip if identical to current state (avoids duplicate entries)
    const current = this.stack[this.index];
    if (current && current.text === text) return;

    // Discard redo history
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push({ text, cursor });

    // Cap stack size
    if (this.stack.length > UndoManager.MAX_STACK) {
      this.stack.shift();
    }
    this.index = this.stack.length - 1;
  }

  /** Move back one step. Returns the previous state or null if at bottom. */
  undo(): { text: string; cursor: number } | null {
    if (this.index <= 0) return null;
    this.index--;
    return this.stack[this.index];
  }

  /** Move forward one step. Returns the next state or null if at top. */
  redo(): { text: string; cursor: number } | null {
    if (this.index >= this.stack.length - 1) return null;
    this.index++;
    return this.stack[this.index];
  }

  /** Reset the entire stack (e.g. after sending a message). */
  reset() {
    this.stack = [{ text: '', cursor: 0 }];
    this.index = 0;
  }
}

/**
 * Chat input area with auto-growing textarea.
 * Default: Enter = newline, Ctrl+Enter = send.
 * RTL direction is auto-detected based on content.
 * ArrowUp/Down navigates prompt history when cursor is at start/end.
 * "+" button opens VS Code file picker to paste file paths.
 * Explorer context action can also send paths into this input.
 * Ctrl+V pastes images from clipboard as base64 attachments.
 *
 * When a plan approval bar is active (pendingApproval is set), typed messages
 * are routed as plan feedback instead of a new conversation message. This
 * ensures the CLI receives the text in the approval context.
 */
export const InputArea: React.FC = () => {
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<WebviewImageData[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const undoMgr = useMemo(() => new UndoManager(), []);
  const {
    provider,
    selectedProvider,
    isBusy,
    isConnected,
    providerCapabilities,
    pendingFilePaths,
    setPendingFilePaths,
    promptHistory,
    addToPromptHistory,
    pendingApproval,
    setPendingApproval,
    gitPushResult,
    setGitPushResult,
    gitPushConfigPanelOpen,
    setGitPushConfigPanelOpen,
    markSessionPromptSent,
    isEnhancing,
    autoEnhanceEnabled,
    enhancerModel,
    enhancerPopoverOpen,
    enhanceComparisonData,
    setIsEnhancing,
    setAutoEnhanceEnabled,
    setEnhancerModel,
    setEnhancerPopoverOpen,
    setEnhanceComparisonData,
    isTranslatingPrompt,
    promptTranslateEnabled,
    autoTranslateEnabled,
    sendSettingsPopoverOpen,
    setIsTranslatingPrompt,
    setPromptTranslateEnabled,
    setAutoTranslateEnabled,
    setSendSettingsPopoverOpen,
  } = useAppStore();
  const fileMention = useFileMention(textareaRef);

  // History navigation: -1 = not browsing, 0..N = index into promptHistory (0 = oldest)
  const historyIndexRef = useRef(-1);
  // Save the draft text when user starts navigating history
  const draftRef = useRef('');

  // Ref: tracks when auto-enhance intercepted a send
  const autoSendAfterEnhanceRef = useRef(false);
  // Ref: captures original text before enhancement for comparison view
  const originalTextBeforeEnhanceRef = useRef('');
  // Ref: client-side safety timeout to reset isEnhancing if result never arrives
  const enhanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Elapsed seconds counter for enhance progress indication
  const [enhanceElapsed, setEnhanceElapsed] = useState(0);
  const enhanceElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track prompt length for dynamic progress message
  const enhancePromptLenRef = useRef(0);

  // Ref: tracks when auto-translate should auto-send after translation completes
  const autoSendAfterTranslateRef = useRef(false);
  // Ref: client-side safety timeout to reset isTranslatingPrompt if result never arrives
  const translateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const effectiveProvider = provider ?? selectedProvider;

  const logUiDebug = useCallback((event: string, payload?: Record<string, unknown>) => {
    postToExtension({
      type: 'uiDebugLog',
      source: 'InputArea',
      event,
      payload,
      ts: Date.now(),
    });
  }, []);

  /** Start elapsed time counter for enhance progress */
  const startEnhanceTimer = useCallback(() => {
    setEnhanceElapsed(0);
    if (enhanceElapsedRef.current) clearInterval(enhanceElapsedRef.current);
    enhanceElapsedRef.current = setInterval(() => {
      setEnhanceElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  /** Stop elapsed time counter */
  const stopEnhanceTimer = useCallback(() => {
    if (enhanceElapsedRef.current) {
      clearInterval(enhanceElapsedRef.current);
      enhanceElapsedRef.current = null;
    }
    setEnhanceElapsed(0);
  }, []);

  /** Trigger prompt enhancement via the extension host */
  const handleEnhancePrompt = useCallback(() => {
    const trimmed = text.trim();
    if (!providerCapabilities.supportsPromptEnhancer || !trimmed || isEnhancing || !isConnected) return;
    originalTextBeforeEnhanceRef.current = trimmed;
    enhancePromptLenRef.current = trimmed.length;
    setIsEnhancing(true);
    startEnhanceTimer();
    // Safety timeout: reset isEnhancing if result never arrives (65s > backend 60s timeout)
    if (enhanceTimeoutRef.current) clearTimeout(enhanceTimeoutRef.current);
    enhanceTimeoutRef.current = setTimeout(() => {
      setIsEnhancing(false);
      stopEnhanceTimer();
      enhanceTimeoutRef.current = null;
    }, 65_000);
    postToExtension({ type: 'enhancePrompt', text: trimmed } as any);
  }, [text, isEnhancing, isConnected, setIsEnhancing, providerCapabilities.supportsPromptEnhancer, startEnhanceTimer, stopEnhanceTimer]);

  /** Toggle the enhancer settings popover */
  const handleToggleEnhancerPopover = useCallback(() => {
    setEnhancerPopoverOpen(!enhancerPopoverOpen);
  }, [enhancerPopoverOpen, setEnhancerPopoverOpen]);

  /** Toggle auto-enhance mode */
  const handleAutoEnhanceToggle = useCallback(() => {
    const newVal = !autoEnhanceEnabled;
    setAutoEnhanceEnabled(newVal);
    postToExtension({ type: 'setAutoEnhance', enabled: newVal } as any);
  }, [autoEnhanceEnabled, setAutoEnhanceEnabled]);

  /** Change enhancer model */
  const handleEnhancerModelChange = useCallback((model: string) => {
    setEnhancerModel(model);
    postToExtension({ type: 'setEnhancerModel', model } as any);
  }, [setEnhancerModel]);

  /** Use the enhanced text from the comparison panel */
  const handleUseEnhanced = useCallback(() => {
    if (!enhanceComparisonData) return;
    const enhanced = enhanceComparisonData.enhancedText;
    setText(enhanced);
    undoMgr.push(enhanced, enhanced.length);
    setEnhanceComparisonData(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        el.focus();
        el.selectionStart = enhanced.length;
        el.selectionEnd = enhanced.length;
      }
    });
  }, [enhanceComparisonData, undoMgr, setEnhanceComparisonData]);

  /** Dismiss comparison panel and keep the original text */
  const handleUseOriginal = useCallback(() => {
    if (!enhanceComparisonData) return;
    const original = enhanceComparisonData.originalText;
    setText(original);
    undoMgr.push(original, original.length);
    setEnhanceComparisonData(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [enhanceComparisonData, undoMgr, setEnhanceComparisonData]);

  /** Toggle the send settings popover */
  const handleToggleSendSettings = useCallback(() => {
    setSendSettingsPopoverOpen(!sendSettingsPopoverOpen);
  }, [sendSettingsPopoverOpen, setSendSettingsPopoverOpen]);

  /** Toggle prompt translation */
  const handleTranslateToggle = useCallback(() => {
    const newVal = !promptTranslateEnabled;
    setPromptTranslateEnabled(newVal);
    postToExtension({ type: 'setPromptTranslationEnabled', enabled: newVal } as any);
    // If turning off translation, also turn off auto-translate
    if (!newVal && autoTranslateEnabled) {
      setAutoTranslateEnabled(false);
      postToExtension({ type: 'setAutoTranslate', enabled: false } as any);
    }
  }, [promptTranslateEnabled, autoTranslateEnabled, setPromptTranslateEnabled, setAutoTranslateEnabled]);

  /** Toggle auto-translate */
  const handleAutoTranslateToggle = useCallback(() => {
    const newVal = !autoTranslateEnabled;
    setAutoTranslateEnabled(newVal);
    postToExtension({ type: 'setAutoTranslate', enabled: newVal } as any);
  }, [autoTranslateEnabled, setAutoTranslateEnabled]);

  /** Send the current message to Claude (allowed even while busy, to interrupt).
   *  When a plan approval bar is active, the text is sent as plan feedback
   *  so the CLI interprets it in the approval context. */
  const sendMessage = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && pendingImages.length === 0) || !isConnected) return;

    // Auto-enhance: intercept send, enhance first, then auto-send
    if (providerCapabilities.supportsPromptEnhancer && autoEnhanceEnabled && trimmed && !isEnhancing && pendingImages.length === 0 && !pendingApproval) {
      setIsEnhancing(true);
      autoSendAfterEnhanceRef.current = true;
      originalTextBeforeEnhanceRef.current = trimmed;
      enhancePromptLenRef.current = trimmed.length;
      startEnhanceTimer();
      // Safety timeout: reset isEnhancing if result never arrives (65s > backend 60s timeout)
      if (enhanceTimeoutRef.current) clearTimeout(enhanceTimeoutRef.current);
      enhanceTimeoutRef.current = setTimeout(() => {
        setIsEnhancing(false);
        stopEnhanceTimer();
        autoSendAfterEnhanceRef.current = false;
        enhanceTimeoutRef.current = null;
      }, 65_000);
      postToExtension({ type: 'enhancePrompt', text: trimmed } as any);
      return;
    }

    // Translate: intercept send, translate first, then auto-send or show in input
    // Skip translation if the text is already in English (Latin script)
    if (promptTranslateEnabled && trimmed && !isTranslatingPrompt && !isLikelyEnglish(trimmed) && pendingImages.length === 0 && !pendingApproval) {
      setIsTranslatingPrompt(true);
      autoSendAfterTranslateRef.current = autoTranslateEnabled;
      // Safety timeout: reset isTranslatingPrompt if result never arrives (65s > backend 60s timeout)
      if (translateTimeoutRef.current) clearTimeout(translateTimeoutRef.current);
      translateTimeoutRef.current = setTimeout(() => {
        setIsTranslatingPrompt(false);
        autoSendAfterTranslateRef.current = false;
        translateTimeoutRef.current = null;
      }, 65_000);
      postToExtension({ type: 'translatePrompt', text: trimmed } as any);
      return;
    }

    if (trimmed) {
      addToPromptHistory(trimmed);
    }
    historyIndexRef.current = -1;
    draftRef.current = '';

    // If AskUserQuestion approval is pending, route text as answer
    if (pendingApproval && pendingApproval.toolName === 'AskUserQuestion' && trimmed && pendingImages.length === 0) {
      markSessionPromptSent();
      postToExtension({
        type: 'planApprovalResponse',
        action: 'questionAnswer',
        feedback: trimmed,
        selectedOptions: [trimmed],
        toolName: pendingApproval.toolName,
      });
      setPendingApproval(null);
    } else if (pendingApproval && trimmed && pendingImages.length === 0) {
      // ExitPlanMode: the CLI already auto-approved and the model is implementing.
      // Don't route as feedback (it would be silently dropped). Instead, clear the
      // approval bar and send as a regular message to redirect the model.
      setPendingApproval(null);
      markSessionPromptSent();
      postToExtension({ type: 'sendMessage', text: trimmed });
    } else if (pendingImages.length > 0) {
      markSessionPromptSent();
      postToExtension({ type: 'sendMessageWithImages', text: trimmed, images: pendingImages });
      setPendingImages([]);
    } else {
      markSessionPromptSent();
      postToExtension({ type: 'sendMessage', text: trimmed });
    }
    setText('');
    undoMgr.reset();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, pendingImages, isConnected, addToPromptHistory, pendingApproval, setPendingApproval, undoMgr, markSessionPromptSent, autoEnhanceEnabled, isEnhancing, setIsEnhancing, providerCapabilities.supportsPromptEnhancer, promptTranslateEnabled, autoTranslateEnabled, isTranslatingPrompt, setIsTranslatingPrompt]);

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

  /** Handle keyboard events - Ctrl+Enter sends, Enter adds newline, Esc cancels, Ctrl+Z/Y undo/redo, ArrowUp/Down navigates history */
  /** Helper to apply a file mention insertion result to textarea state */
  const applyMentionInsert = useCallback((inserted: { text: string; cursor: number }) => {
    setText(inserted.text);
    undoMgr.push(inserted.text, inserted.cursor);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = inserted.cursor;
        textareaRef.current.selectionEnd = inserted.cursor;
      }
      resizeTextarea();
    });
  }, [undoMgr, resizeTextarea]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const keyLower = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((e.ctrlKey || e.metaKey) && (keyLower === 'c' || keyLower === 'v' || keyLower === 'x')) {
        logUiDebug('clipboardShortcutKeydown', {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          defaultPrevented: e.defaultPrevented,
          provider: effectiveProvider,
          supportsImages: providerCapabilities.supportsImages,
          selectionStart: textareaRef.current?.selectionStart ?? null,
          selectionEnd: textareaRef.current?.selectionEnd ?? null,
        });
      }

      // File mention popup intercepts navigation keys when open
      if (fileMention.isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          fileMention.moveSelection(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          fileMention.moveSelection(-1);
          return;
        }
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const inserted = fileMention.confirmSelection();
          if (inserted) applyMentionInsert(inserted);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const inserted = fileMention.confirmSelection();
          if (inserted) applyMentionInsert(inserted);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          fileMention.dismiss();
          return;
        }
      }

      // Undo: Ctrl+Z (without Shift)
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        const prev = undoMgr.undo();
        if (prev) {
          setText(prev.text);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
              el.selectionStart = prev.cursor;
              el.selectionEnd = prev.cursor;
            }
            resizeTextarea();
          });
        }
        return;
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (
        ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)
      ) {
        e.preventDefault();
        const next = undoMgr.redo();
        if (next) {
          setText(next.text);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
              el.selectionStart = next.cursor;
              el.selectionEnd = next.cursor;
            }
            resizeTextarea();
          });
        }
        return;
      }
      // Ctrl+Shift+E: enhance prompt
      if (e.key === 'e' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        if (providerCapabilities.supportsPromptEnhancer) {
          handleEnhancePrompt();
        }
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === 'Escape' && enhanceComparisonData) {
        e.preventDefault();
        handleUseOriginal();
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
          undoMgr.push(historyText, 0);
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
            undoMgr.push(historyText, historyText.length);
          } else {
            // Back to draft
            historyIndexRef.current = -1;
            setText(draftRef.current);
            undoMgr.push(draftRef.current, draftRef.current.length);
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
    [sendMessage, isBusy, cancelRequest, text, resizeTextarea, undoMgr, fileMention, applyMentionInsert, handleEnhancePrompt, enhanceComparisonData, handleUseOriginal, providerCapabilities.supportsPromptEnhancer, providerCapabilities.supportsImages, logUiDebug, effectiveProvider]
  );

  /** Auto-resize textarea to fit content, reset history browsing on manual edits */
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setText(newValue);
      undoMgr.push(newValue, e.target.selectionStart);
      // Any manual typing exits history browsing mode
      historyIndexRef.current = -1;
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
      // Notify file mention hook for @ trigger detection
      fileMention.handleTextChange(newValue, e.target.selectionStart);
    },
    [undoMgr, fileMention]
  );

  /** Handle right-click to paste clipboard content (VS Code webview blocks native context menu) */
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (!el) return;
    logUiDebug('contextMenuPasteAttempt', {
      provider: effectiveProvider,
      supportsImages: providerCapabilities.supportsImages,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
    });

    navigator.clipboard.readText().then((clipboardText) => {
      logUiDebug('contextMenuClipboardReadText', {
        provider: effectiveProvider,
        textLen: clipboardText?.length ?? 0,
        hasText: !!clipboardText,
      });
      if (!clipboardText) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newText = before + clipboardText + after;
      const newCursorPos = start + clipboardText.length;
      setText(newText);
      undoMgr.push(newText, newCursorPos);

      // Place cursor after pasted text
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
        }
        resizeTextarea();
      });
    }).catch(() => {
      logUiDebug('contextMenuClipboardReadTextFailed', { provider: effectiveProvider });
      // Clipboard API not available or permission denied - silently ignore
    });
  }, [text, resizeTextarea, undoMgr, logUiDebug, effectiveProvider, providerCapabilities.supportsImages]);

  /** Handle paste events - extract images from clipboard */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) {
      logUiDebug('pasteEventNoClipboardItems', {
        provider: effectiveProvider,
        supportsImages: providerCapabilities.supportsImages,
      });
      return;
    }

    const imageItems: DataTransferItem[] = [];
    const itemSummaries: Array<{ kind: string; type: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      itemSummaries.push({ kind: item.kind, type: item.type });
      if (item.type.startsWith('image/')) {
        imageItems.push(item);
      }
    }

    logUiDebug('pasteEvent', {
      provider: effectiveProvider,
      supportsImages: providerCapabilities.supportsImages,
      itemCount: items.length,
      imageItemCount: imageItems.length,
      items: itemSummaries,
    });

    if (imageItems.length === 0) return;

    if (!providerCapabilities.supportsImages) {
      logUiDebug('pasteImageBlockedUnsupportedProvider', {
        provider: effectiveProvider,
        imageItemCount: imageItems.length,
        items: itemSummaries,
      });
      return;
    }

    // Prevent default only when we have images (let text paste through normally)
    e.preventDefault();
    logUiDebug('pasteImageIntercepted', {
      provider: effectiveProvider,
      imageItemCount: imageItems.length,
    });

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        logUiDebug('pasteImageItemNoFile', { provider: effectiveProvider, mime: item.type });
        continue;
      }

      logUiDebug('pasteImageFileReadStart', {
        provider: effectiveProvider,
        mime: file.type || item.type,
        size: file.size,
      });

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // dataUrl format: "data:image/png;base64,iVBOR..."
        const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
          logUiDebug('pasteImageDataUrlParseFailed', {
            provider: effectiveProvider,
            resultType: typeof reader.result,
            preview: typeof dataUrl === 'string' ? dataUrl.slice(0, 40) : '',
          });
          return;
        }

        const mediaType = match[1] as WebviewImageData['mediaType'];
        const base64 = match[2];

        logUiDebug('pasteImageQueued', {
          provider: effectiveProvider,
          mediaType,
          base64Len: base64.length,
        });
        setPendingImages((prev) => [...prev, { base64, mediaType }]);
      };
      reader.onerror = () => {
        logUiDebug('pasteImageFileReadError', {
          provider: effectiveProvider,
          mime: file.type || item.type,
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    }
  }, [providerCapabilities.supportsImages, logUiDebug, effectiveProvider]);

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
      const newText = !prev ? pathText : prev + (prev.endsWith('\n') ? '' : '\n') + pathText;
      undoMgr.push(newText, newText.length);
      return newText;
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
  }, [pendingFilePaths, setPendingFilePaths, undoMgr]);

  // Listen for prompt selection from history panel
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail;
      setText(prompt);
      undoMgr.push(prompt, prompt.length);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
          el.focus();
        }
      });
    };
    window.addEventListener('prompt-history-select', handler);
    return () => window.removeEventListener('prompt-history-select', handler);
  }, [undoMgr]);

  // Listen for fork-set-input events (from App.tsx fork completion logic)
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail;
      setText(prompt);
      undoMgr.push(prompt, prompt.length);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
          el.focus();
          el.selectionStart = 0;
          el.selectionEnd = el.value.length;
        }
      });
    };
    window.addEventListener('fork-set-input', handler);
    return () => window.removeEventListener('fork-set-input', handler);
  }, [undoMgr]);

  // Listen for prompt enhancement results
  useEffect(() => {
    const handler = (e: Event) => {
      const enhanced = (e as CustomEvent<string>).detail;

      // Clear safety timeout and elapsed timer since result arrived
      stopEnhanceTimer();
      if (enhanceTimeoutRef.current) {
        clearTimeout(enhanceTimeoutRef.current);
        enhanceTimeoutRef.current = null;
      }

      // If auto-enhance triggered this, check if we also need to translate
      if (autoSendAfterEnhanceRef.current) {
        autoSendAfterEnhanceRef.current = false;
        const store = useAppStore.getState();

        // Chain: enhance -> translate -> send (when both are enabled)
        // Skip translation if the enhanced text is already in English
        if (store.promptTranslateEnabled && !isLikelyEnglish(enhanced)) {
          setText(enhanced);
          store.setIsTranslatingPrompt(true);
          autoSendAfterTranslateRef.current = store.autoTranslateEnabled;
          if (translateTimeoutRef.current) clearTimeout(translateTimeoutRef.current);
          translateTimeoutRef.current = setTimeout(() => {
            store.setIsTranslatingPrompt(false);
            autoSendAfterTranslateRef.current = false;
            translateTimeoutRef.current = null;
          }, 65_000);
          postToExtension({ type: 'translatePrompt', text: enhanced } as any);
          return;
        }

        setTimeout(() => {
          store.addToPromptHistory(enhanced);
          store.markSessionPromptSent();
          postToExtension({ type: 'sendMessage', text: enhanced });
          setText('');
          undoMgr.reset();
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
        }, 0);
        return;
      }

      // Manual enhance: show comparison panel
      const original = originalTextBeforeEnhanceRef.current;
      setEnhanceComparisonData({ originalText: original, enhancedText: enhanced });
    };
    window.addEventListener('prompt-enhanced', handler);
    return () => window.removeEventListener('prompt-enhanced', handler);
  }, [undoMgr, setEnhanceComparisonData]);

  // Listen for prompt enhancement failures
  useEffect(() => {
    const handler = () => {
      // Clear safety timeout and elapsed timer since result arrived (even if failure)
      stopEnhanceTimer();
      if (enhanceTimeoutRef.current) {
        clearTimeout(enhanceTimeoutRef.current);
        enhanceTimeoutRef.current = null;
      }

      // Auto-send was pending but enhancement failed -- send original text
      if (autoSendAfterEnhanceRef.current) {
        autoSendAfterEnhanceRef.current = false;
        sendMessage();
        return;
      }

      // Manual enhance failed: briefly flash the enhance button red
      const btn = document.querySelector('.enhance-button');
      if (btn) {
        btn.classList.add('enhance-error');
        setTimeout(() => btn.classList.remove('enhance-error'), 2000);
      }
    };
    window.addEventListener('prompt-enhance-failed', handler);
    return () => window.removeEventListener('prompt-enhance-failed', handler);
  }, [sendMessage]);

  // Close enhancer popover on outside click
  useEffect(() => {
    if (!enhancerPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.enhance-button-group')) {
        setEnhancerPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [enhancerPopoverOpen, setEnhancerPopoverOpen]);

  // Listen for prompt translation results
  useEffect(() => {
    const handler = (e: Event) => {
      const translated = (e as CustomEvent<string>).detail;

      // Clear safety timeout since result arrived
      if (translateTimeoutRef.current) {
        clearTimeout(translateTimeoutRef.current);
        translateTimeoutRef.current = null;
      }

      // If auto-send, send translated text directly
      if (autoSendAfterTranslateRef.current) {
        autoSendAfterTranslateRef.current = false;
        setTimeout(() => {
          const store = useAppStore.getState();
          store.addToPromptHistory(translated);
          store.markSessionPromptSent();
          postToExtension({ type: 'sendMessage', text: translated });
          setText('');
          undoMgr.reset();
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
        }, 0);
        return;
      }

      // Manual translate: place translated text in the input box for review
      setText(translated);
      undoMgr.push(translated, translated.length);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
          el.focus();
        }
      });
    };
    window.addEventListener('prompt-translated', handler);
    return () => window.removeEventListener('prompt-translated', handler);
  }, [undoMgr]);

  // Listen for prompt translation failures
  useEffect(() => {
    const handler = () => {
      // Clear safety timeout since result arrived (even if failure)
      if (translateTimeoutRef.current) {
        clearTimeout(translateTimeoutRef.current);
        translateTimeoutRef.current = null;
      }

      // Auto-send was pending but translation failed -- send original text
      if (autoSendAfterTranslateRef.current) {
        autoSendAfterTranslateRef.current = false;
        sendMessage();
      }
    };
    window.addEventListener('prompt-translate-failed', handler);
    return () => window.removeEventListener('prompt-translate-failed', handler);
  }, [sendMessage]);

  // Close send settings popover on outside click
  useEffect(() => {
    if (!sendSettingsPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.send-button-group')) {
        setSendSettingsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sendSettingsPopoverOpen, setSendSettingsPopoverOpen]);

  // Auto-dismiss git push result toast after 5 seconds
  useEffect(() => {
    if (gitPushResult) {
      const timer = setTimeout(() => setGitPushResult(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [gitPushResult, setGitPushResult]);

  // Request git push settings on mount
  useEffect(() => {
    postToExtension({ type: 'getGitPushSettings' });
  }, []);

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
                data-tooltip="Remove image"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Git push result toast */}
      {gitPushResult && (
        <div className={`git-push-toast ${gitPushResult.success ? 'success' : 'error'}`}>
          <span>{gitPushResult.success ? 'Git push successful' : gitPushResult.output}</span>
          <button className="git-push-toast-dismiss" onClick={() => setGitPushResult(null)} data-tooltip="Dismiss">x</button>
        </div>
      )}

      {/* Git push config panel */}
      {gitPushConfigPanelOpen && (
        <GitPushPanel onClose={() => setGitPushConfigPanelOpen(false)} />
      )}

      {/* Prompt enhancement comparison panel */}
      {providerCapabilities.supportsPromptEnhancer && enhanceComparisonData && (
        <div className="enhance-comparison-panel">
          <div className="enhance-comparison-header">
            <span className="enhance-comparison-title">Prompt Comparison</span>
            <button
              className="enhance-comparison-close"
              onClick={handleUseOriginal}
              data-tooltip="Dismiss and keep original"
            >
              x
            </button>
          </div>
          <div className="enhance-comparison-body">
            <div className="enhance-comparison-section">
              <div className="enhance-comparison-label">Original</div>
              <div
                className="enhance-comparison-text"
                dir={detectRtl(enhanceComparisonData.originalText) ? 'rtl' : 'ltr'}
              >
                {enhanceComparisonData.originalText}
              </div>
            </div>
            <div className="enhance-comparison-section">
              <div className="enhance-comparison-label">Enhanced</div>
              <div
                className="enhance-comparison-text enhanced"
                dir={detectRtl(enhanceComparisonData.enhancedText) ? 'rtl' : 'ltr'}
              >
                {enhanceComparisonData.enhancedText}
              </div>
            </div>
          </div>
          <div className="enhance-comparison-actions">
            <button
              className="enhance-comparison-btn original"
              onClick={handleUseOriginal}
            >
              Use Original
            </button>
            <button
              className="enhance-comparison-btn enhanced"
              onClick={handleUseEnhanced}
            >
              Use Enhanced
            </button>
          </div>
        </div>
      )}

      <div className="input-wrapper">
        {fileMention.isOpen && (
          <FileMentionPopup
            results={fileMention.results}
            selectedIndex={fileMention.selectedIndex}
            onSelect={(path) => {
              const inserted = fileMention.selectPath(path);
              if (inserted) {
                applyMentionInsert(inserted);
                textareaRef.current?.focus();
              }
            }}
            isLoading={fileMention.isLoading}
          />
        )}
        <button
          className="clear-session-button"
          onClick={handleClearSession}
          disabled={!isConnected}
          data-tooltip="Clear session and start fresh"
        >
          Clear
        </button>
        <button
          className="browse-button"
          onClick={handleBrowseFiles}
          disabled={!isConnected}
          data-tooltip="Browse files to paste their paths"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <div className={`textarea-container${isEnhancing ? ' enhancing' : ''}${isTranslatingPrompt ? ' translating' : ''}`}>
          <textarea
            ref={textareaRef}
            className="input-textarea"
            dir={direction}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onContextMenu={handleContextMenu}
            placeholder={
              pendingApproval
                ? (pendingApproval.toolName === 'AskUserQuestion'
                  ? 'Type your answer... (Ctrl+Enter to send)'
                  : 'Type feedback or approve/reject above... (Ctrl+Enter to send)')
                : isBusy
                  ? 'Type to interrupt... (Ctrl+Enter to send)'
                  : 'Type a message... (Ctrl+Enter to send)'
            }
            disabled={!isConnected}
            rows={1}
          />
          {isEnhancing && (
            <div className="enhance-overlay">
              <span className="enhance-overlay-text">
                {enhancePromptLenRef.current > 1000
                  ? `Enhancing long prompt... ${enhanceElapsed}s`
                  : enhanceElapsed > 5
                    ? `Enhancing... ${enhanceElapsed}s`
                    : 'Enhancing...'}
              </span>
            </div>
          )}
          {isTranslatingPrompt && (
            <div className="enhance-overlay">
              <span className="enhance-overlay-text">Translating...</span>
            </div>
          )}
        </div>
        <div className="input-buttons">
          {providerCapabilities.supportsPromptEnhancer && (
            <div className="enhance-button-group">
              <button
                className={`enhance-button${isEnhancing ? ' enhancing' : ''}${autoEnhanceEnabled ? ' auto-active' : ''}`}
                onClick={handleEnhancePrompt}
                disabled={!text.trim() || isEnhancing || !isConnected}
                data-tooltip={autoEnhanceEnabled ? 'Auto-enhance is ON (Ctrl+Shift+E)' : 'Enhance prompt (Ctrl+Shift+E)'}
              >
                {isEnhancing ? '\u21BB' : '\u2728'}
              </button>
              <button
                className="enhance-gear-button"
                onClick={handleToggleEnhancerPopover}
                data-tooltip="Enhancer settings"
              >
                {'\u2699'}
              </button>
              {enhancerPopoverOpen && (
                <div className="enhance-popover">
                  <div className="enhance-popover-row">
                    <span className="enhance-popover-label">Auto-enhance</span>
                    <button
                      className={`enhance-toggle-btn ${autoEnhanceEnabled ? 'on' : 'off'}`}
                      onClick={handleAutoEnhanceToggle}
                      data-tooltip={autoEnhanceEnabled ? 'Disable auto-enhance' : 'Enable auto-enhance'}
                    >
                      <span className="enhance-toggle-knob" />
                    </button>
                  </div>
                  <div className="enhance-popover-row">
                    <span className="enhance-popover-label">Model</span>
                    <select
                      className="enhance-model-select"
                      value={enhancerModel}
                      onChange={(e) => handleEnhancerModelChange(e.target.value)}
                    >
                      <option value="claude-haiku-4-5-20251001">Haiku</option>
                      <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                      <option value="claude-sonnet-4-5-20250929">Sonnet 4.5</option>
                      <option value="claude-opus-4-6">Opus 4.6</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
          {isBusy && (
            <button
              className="cancel-button"
              onClick={cancelRequest}
              data-tooltip="Cancel current response (Esc)"
            >
              Cancel
            </button>
          )}
          <div className="send-button-group">
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={(!text.trim() && pendingImages.length === 0) || !isConnected || isEnhancing || isTranslatingPrompt || !!enhanceComparisonData}
              data-tooltip={promptTranslateEnabled && !autoTranslateEnabled ? 'Translate to English (Ctrl+Enter)' : 'Send message (Ctrl+Enter)'}
            >
              {promptTranslateEnabled && !autoTranslateEnabled ? 'Translate' : 'Send'}
            </button>
            <button
              className="send-gear-button"
              onClick={handleToggleSendSettings}
              data-tooltip="Send settings"
            >
              {'\u2699'}
            </button>
            {sendSettingsPopoverOpen && (
              <div className="send-settings-popover">
                <div className="enhance-popover-row">
                  <span className="enhance-popover-label">Translate to English</span>
                  <button
                    className={`enhance-toggle-btn ${promptTranslateEnabled ? 'on' : 'off'}`}
                    onClick={handleTranslateToggle}
                    data-tooltip={promptTranslateEnabled ? 'Disable translation' : 'Enable translation'}
                  >
                    <span className="enhance-toggle-knob" />
                  </button>
                </div>
                <div className="enhance-popover-row">
                  <span className="enhance-popover-label">Auto-send translated</span>
                  <button
                    className={`enhance-toggle-btn ${autoTranslateEnabled ? 'on' : 'off'}`}
                    onClick={handleAutoTranslateToggle}
                    disabled={!promptTranslateEnabled}
                    data-tooltip={!promptTranslateEnabled ? 'Enable translation first' : autoTranslateEnabled ? 'Disable auto-send' : 'Enable auto-send'}
                  >
                    <span className="enhance-toggle-knob" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
