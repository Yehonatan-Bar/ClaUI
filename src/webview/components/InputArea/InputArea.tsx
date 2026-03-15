import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl, isLikelyEnglish } from '../../hooks/useRtlDetection';
import { GitPushPanel } from './GitPushPanel';
import { FileMentionPopup } from './FileMentionPopup';
import { useFileMention } from '../../hooks/useFileMention';
import type { WebviewImageData } from '../../../extension/types/webview-messages';
import { getModelMaxContext } from '../../utils/modelContextLimits';
import { useOutsideClick } from '../../hooks/useOutsideClick';

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
  const [codexSteerArmed, setCodexSteerArmed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const undoMgr = useMemo(() => new UndoManager(), []);
  const [ultrathinkAnim, setUltrathinkAnim] = useState<string | null>(null);
  const ultrathinkLocked = useAppStore((s) => s.ultrathinkLocked);
  const setUltrathinkLocked = useAppStore((s) => s.setUltrathinkLocked);
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
    contextWidgetVisible,
    usageLimit,
    usageQueuedPrompt,
    scheduledMessage,
    scheduleMessageEnabled,
    scheduleMessageAtMs,
    setScheduleMessageEnabled,
    setScheduleMessageAtMs,
    sessionSkills,
    handoffStage,
    handoffTargetProvider,
  } = useAppStore();
  const fileMention = useFileMention(textareaRef);

  // Context bar: poll store every 5s to keep bar current (same pattern as ContextUsageWidget)
  const [, setContextTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setContextTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const { inputTokens: ctxInputTokens } = useAppStore.getState().cost;
  const ctxModel = useAppStore.getState().model;
  const ctxMaxTokens = getModelMaxContext(ctxModel ?? '');
  const ctxPct = ctxMaxTokens > 0 ? Math.min(((ctxInputTokens ?? 0) / ctxMaxTokens) * 100, 100) : 0;
  const [ctxHovered, setCtxHovered] = useState(false);

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

  // Ref: guard against key-repeat / double-fire sending the same message twice.
  // React's setText('') is async, so rapid keydown events can re-enter sendMessage
  // before the state update takes effect.
  const lastSentRef = useRef<{ text: string; time: number } | null>(null);

  // Ref: tracks when auto-translate should auto-send after translation completes
  const autoSendAfterTranslateRef = useRef(false);
  // Ref: client-side safety timeout to reset isTranslatingPrompt if result never arrives
  const translateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enhanceGroupRef = useRef<HTMLDivElement>(null);
  const sendGroupRef = useRef<HTMLDivElement>(null);

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

  // --- Prompt navigation (scroll chat to prev/next user message) ---
  const promptNavIndexRef = useRef<number | null>(null);
  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user'),
    [messages]
  );

  const scrollToUserPrompt = useCallback((index: number) => {
    const msg = userMessages[index];
    if (!msg) return;
    const el = document.querySelector(`[data-message-id="${msg.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [userMessages]);

  const navigatePromptUp = useCallback(() => {
    if (userMessages.length === 0) return;
    if (promptNavIndexRef.current === null) {
      // Start from the last user message
      promptNavIndexRef.current = userMessages.length - 1;
    } else if (promptNavIndexRef.current > 0) {
      promptNavIndexRef.current -= 1;
    } else {
      return; // Already at the top
    }
    scrollToUserPrompt(promptNavIndexRef.current);
  }, [userMessages, scrollToUserPrompt]);

  const navigatePromptDown = useCallback(() => {
    if (userMessages.length === 0) return;
    if (promptNavIndexRef.current === null) return; // No nav started yet
    if (promptNavIndexRef.current < userMessages.length - 1) {
      promptNavIndexRef.current += 1;
      scrollToUserPrompt(promptNavIndexRef.current);
    }
  }, [userMessages, scrollToUserPrompt]);

  // Reset nav index when messages change (new message sent)
  useEffect(() => {
    promptNavIndexRef.current = null;
  }, [userMessages.length]);

  // Auto-detect RTL for the input text
  const direction = text ? (detectRtl(text) ? 'rtl' : 'ltr') : 'auto';
  const effectiveProvider = provider ?? selectedProvider;
  const isUsageLimitMode = usageLimit.active && effectiveProvider === 'claude';
  const isCodexBusy = effectiveProvider === 'codex' && isBusy;
  const inputLockedByHandoff =
    handoffStage !== 'idle' &&
    handoffStage !== 'completed' &&
    handoffStage !== 'failed';

  useEffect(() => {
    if (!isCodexBusy || pendingApproval) {
      setCodexSteerArmed(false);
    }
  }, [isCodexBusy, pendingApproval]);

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

  /** Compute default scheduled time: 1 hour from now, rounded up to next 5 minutes */
  const getDefaultScheduleTime = useCallback(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return d.getTime();
  }, []);

  /** Toggle schedule message mode */
  const handleScheduleToggle = useCallback(() => {
    const newVal = !scheduleMessageEnabled;
    setScheduleMessageEnabled(newVal);
    if (newVal && !scheduleMessageAtMs) {
      setScheduleMessageAtMs(getDefaultScheduleTime());
    }
  }, [scheduleMessageEnabled, scheduleMessageAtMs, setScheduleMessageEnabled, setScheduleMessageAtMs, getDefaultScheduleTime]);

  /** Handle schedule date input change */
  const handleScheduleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const current = scheduleMessageAtMs ? new Date(scheduleMessageAtMs) : new Date();
    const [year, month, day] = e.target.value.split('-').map(Number);
    current.setFullYear(year, month - 1, day);
    setScheduleMessageAtMs(current.getTime());
  }, [scheduleMessageAtMs, setScheduleMessageAtMs]);

  /** Handle schedule time input change */
  const handleScheduleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const current = scheduleMessageAtMs ? new Date(scheduleMessageAtMs) : new Date();
    const [hours, minutes] = e.target.value.split(':').map(Number);
    current.setHours(hours, minutes, 0, 0);
    setScheduleMessageAtMs(current.getTime());
  }, [scheduleMessageAtMs, setScheduleMessageAtMs]);

  /** Send the current message to Claude/Codex (allowed even while busy, to interrupt).
   *  When a plan approval bar is active, the text is sent as plan feedback
   *  so the CLI interprets it in the approval context. */
  const sendMessage = useCallback(() => {
    let trimmed = text.trim();
    if ((!trimmed && pendingImages.length === 0) || !isConnected || inputLockedByHandoff) return;

    // Auto-prepend "ultrathink" when the lock is active
    if (ultrathinkLocked && trimmed && !trimmed.toLowerCase().startsWith('ultrathink')) {
      trimmed = 'ultrathink ' + trimmed;
    }

    // Guard: block identical text sent within 500ms (key-repeat / double-fire).
    // setText('') is async so rapid keydown events re-enter with stale text.
    const now = Date.now();
    if (lastSentRef.current && lastSentRef.current.text === trimmed && now - lastSentRef.current.time < 500) {
      return;
    }
    lastSentRef.current = { text: trimmed, time: now };

    // Scheduled message mode: store on extension side for timed dispatch
    if (scheduleMessageEnabled && scheduleMessageAtMs) {
      const schedNow = Date.now();
      if (scheduleMessageAtMs <= schedNow) {
        // Time is in the past -- disable toggle and fall through to normal send
        setScheduleMessageEnabled(false);
        setScheduleMessageAtMs(null);
      } else {
        if (trimmed) {
          addToPromptHistory(trimmed);
        }
        historyIndexRef.current = -1;
        draftRef.current = '';
        markSessionPromptSent();
        postToExtension({
          type: 'scheduleMessage',
          text: trimmed,
          scheduledAtMs: scheduleMessageAtMs,
          ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
        } as any);
        setText('');
        setPendingImages([]);
        setCodexSteerArmed(false);
        setScheduleMessageEnabled(false);
        setScheduleMessageAtMs(null);
        undoMgr.reset();
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        return;
      }
    }

    // Usage-limit queue mode (Claude only): queue now, send automatically later.
    if (isUsageLimitMode) {
      if (trimmed) {
        addToPromptHistory(trimmed);
      }
      historyIndexRef.current = -1;
      draftRef.current = '';
      markSessionPromptSent();
      postToExtension({
        type: 'queuePromptUntilUsageReset',
        text: trimmed,
        ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
      } as any);
      setText('');
      setPendingImages([]);
      setCodexSteerArmed(false);
      undoMgr.reset();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      return;
    }

    // Auto-enhance: intercept send, enhance first, then auto-send
    if (
      providerCapabilities.supportsPromptEnhancer &&
      autoEnhanceEnabled &&
      trimmed &&
      !isEnhancing &&
      pendingImages.length === 0 &&
      !pendingApproval &&
      !isCodexBusy
    ) {
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
    if (
      promptTranslateEnabled &&
      trimmed &&
      !isTranslatingPrompt &&
      !isLikelyEnglish(trimmed) &&
      pendingImages.length === 0 &&
      !pendingApproval &&
      !isCodexBusy
    ) {
      setIsTranslatingPrompt(true);
      autoSendAfterTranslateRef.current = autoTranslateEnabled;
      // Store original text so it can be shown alongside the translated version in the message bubble
      useAppStore.getState().setPendingOriginalText(trimmed);
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

    let steerRequested = false;
    if (isCodexBusy && !pendingApproval) {
      if (!codexSteerArmed) {
        setCodexSteerArmed(true);
        logUiDebug('codexSteerArmed', {
          textLength: trimmed.length,
          imageCount: pendingImages.length,
        });
        return;
      }
      steerRequested = true;
      setCodexSteerArmed(false);
      logUiDebug('codexSteerConfirmed', {
        textLength: trimmed.length,
        imageCount: pendingImages.length,
      });
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
      postToExtension({ type: 'sendMessageWithImages', text: trimmed, images: pendingImages, steer: steerRequested || undefined });
      setPendingImages([]);
    } else {
      markSessionPromptSent();
      postToExtension({ type: 'sendMessage', text: trimmed, steer: steerRequested || undefined });
    }
    setText('');
    setCodexSteerArmed(false);
    undoMgr.reset();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, pendingImages, isConnected, inputLockedByHandoff, addToPromptHistory, pendingApproval, setPendingApproval, undoMgr, markSessionPromptSent, autoEnhanceEnabled, isEnhancing, setIsEnhancing, providerCapabilities.supportsPromptEnhancer, promptTranslateEnabled, autoTranslateEnabled, isTranslatingPrompt, setIsTranslatingPrompt, isCodexBusy, codexSteerArmed, logUiDebug, ultrathinkLocked, isUsageLimitMode]);

  /** Cancel the in-flight request */
  const cancelRequest = useCallback(() => {
    setCodexSteerArmed(false);
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
      if (codexSteerArmed) {
        setCodexSteerArmed(false);
      }
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
    [undoMgr, fileMention, codexSteerArmed]
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

  /** Inject "ultrathink" keyword with a random animation */
  const handleUltrathink = useCallback(() => {
    if (ultrathinkAnim) return; // Guard against double-click during animation
    const anims = ['rocket', 'brain', 'wizard', 'turbo'];
    const picked = anims[Math.floor(Math.random() * anims.length)];
    setUltrathinkAnim(picked);
    setTimeout(() => {
      setText((prev) => {
        if (prev.toLowerCase().startsWith('ultrathink')) return prev;
        const newText = 'ultrathink ' + prev;
        undoMgr.push(newText, 'ultrathink '.length);
        return newText;
      });
      setUltrathinkAnim(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    }, 1200);
  }, [ultrathinkAnim, undoMgr]);

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
          store.setPendingOriginalText(enhanced);
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

  // Centralized outside-click for enhancer popover
  useOutsideClick('input-enhancer', enhanceGroupRef, enhancerPopoverOpen, () => setEnhancerPopoverOpen(false));

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
      useAppStore.getState().setIsTranslatingPrompt(false);
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

  // Centralized outside-click for send settings popover
  useOutsideClick('input-send-settings', sendGroupRef, sendSettingsPopoverOpen, () => setSendSettingsPopoverOpen(false));

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

  // Refocus textarea when the extension tells us the panel regained focus
  // (browser focus/visibilitychange events don't fire reliably in VS Code webview iframes)
  useEffect(() => {
    const handleFocusInput = () => {
      // Use requestAnimationFrame to ensure the webview iframe has settled focus
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el && !el.disabled) {
          el.focus();
        }
      });
    };

    window.addEventListener('claui-focus-input', handleFocusInput);
    return () => {
      window.removeEventListener('claui-focus-input', handleFocusInput);
    };
  }, []);

  return (
    <div className="input-area">
      {inputLockedByHandoff && (
        <div className="handoff-lock-banner">
          Switching provider{handoffTargetProvider ? ` -> ${handoffTargetProvider}` : ''}... {handoffStage.replace(/_/g, ' ')}
        </div>
      )}
      {/* Context usage bar: thin line at the top of the input area, visible when contextWidgetVisible is on */}
      {contextWidgetVisible && (
        <div
          onMouseEnter={() => setCtxHovered(true)}
          onMouseLeave={() => setCtxHovered(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: 12,
            zIndex: 10,
            cursor: 'default',
          }}
        >
          {/* Visible 2px bar track */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: 2,
              overflow: 'hidden',
              background: 'rgba(255, 255, 255, 0.08)',
              pointerEvents: 'none',
            }}
          >
            {/* Fill with gradient: spans full track width, clipped by fill div bounds */}
            <div
              style={{
                width: `${ctxPct}%`,
                height: '100%',
                backgroundImage: 'linear-gradient(90deg, #3794ff 0%, #41b5ff 35%, #63c97a 62%, #d29922 82%, #f85149 100%)',
                backgroundSize: ctxPct > 0 ? `${(100 / ctxPct) * 100}% 100%` : '100% 100%',
                backgroundRepeat: 'no-repeat',
                transition: 'width 1s ease',
              }}
            />
          </div>
          {/* Tooltip on hover */}
          {ctxHovered && (
            <div
              style={{
                position: 'absolute',
                top: -24,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--vscode-editorWidget-background, #252526)',
                border: '1px solid var(--vscode-editorWidget-border, #454545)',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                lineHeight: '16px',
                color: 'var(--vscode-editorWidget-foreground, #cccccc)',
                whiteSpace: 'nowrap' as const,
                pointerEvents: 'none' as const,
                boxShadow: '0 2px 8px rgba(0,0,0,0.36)',
                zIndex: 10001,
              }}
            >
              {`Context: ${ctxPct.toFixed(1)}%`}
            </div>
          )}
        </div>
      )}
      {/* Image thumbnails preview */}
      {pendingImages.length > 0 && (
        <div className="pending-images">
          {pendingImages.map((img, i) => (
            <div key={i} className="pending-image-thumb">
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={`Pasted image ${i + 1}`}
                onDoubleClick={() => useAppStore.getState().setLightboxImageSrc(`data:${img.mediaType};base64,${img.base64}`)}
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

      {sessionSkills.length > 0 && (
        <div className="skill-pills-row">
          {sessionSkills.map((skill) => (
            <span key={skill} className="skill-pill" data-tooltip={`Skill: ${skill}`}>
              <span className="skill-pill-dot" />
              {skill}
            </span>
          ))}
        </div>
      )}

      {isUsageLimitMode && (
        <div className="usage-limit-helper">
          <div>
            Usage limit reached. You can send now; your prompt will be queued and sent automatically one minute after your limit resets.
          </div>
          {usageQueuedPrompt.queued && (
            <div className="usage-limit-queued-chip">
              {usageQueuedPrompt.summary || (
                usageQueuedPrompt.scheduledSendAtMs
                  ? `Prompt queued for ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(usageQueuedPrompt.scheduledSendAtMs))}.`
                  : 'Prompt queued.'
              )}
            </div>
          )}
        </div>
      )}

      {scheduledMessage.scheduled && (
        <div className="scheduled-message-banner">
          <div className="scheduled-message-chip">
            {scheduledMessage.summary || (
              scheduledMessage.scheduledAtMs
                ? `Message scheduled for ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(scheduledMessage.scheduledAtMs))}.`
                : 'Message scheduled.'
            )}
            <button
              className="scheduled-message-cancel-btn"
              onClick={() => postToExtension({ type: 'cancelScheduledMessage' } as any)}
              data-tooltip="Cancel scheduled message"
            >
              Cancel
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
          disabled={!isConnected || inputLockedByHandoff}
          data-tooltip="Clear session and start fresh"
        >
          Clear
        </button>
        <button
          className="browse-button"
          onClick={handleBrowseFiles}
          disabled={!isConnected || inputLockedByHandoff}
          data-tooltip="Browse files to paste their paths"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <div className="ultrathink-wrapper">
          <button
            className={`ultrathink-button${ultrathinkAnim ? ' animating' : ''}${ultrathinkLocked ? ' locked' : ''}`}
            onClick={handleUltrathink}
            disabled={!isConnected || !!ultrathinkAnim || inputLockedByHandoff}
            data-tooltip={ultrathinkLocked ? "Ultrathink LOCKED - auto-injected every prompt" : "Ultrathink - boost reasoning power"}
          >
            <span className="ut-default-icon">&#x1F9E0;</span>
            {ultrathinkAnim && (
              <div className={`ultrathink-anim ultrathink-anim-${ultrathinkAnim}`}>
                {ultrathinkAnim === 'rocket' && <span className="ut-emoji">&#x1F680;</span>}
                {ultrathinkAnim === 'brain' && <span className="ut-emoji">&#x1F9E0;</span>}
                {ultrathinkAnim === 'wizard' && <span className="ut-emoji">&#x1FA84;</span>}
                {ultrathinkAnim === 'turbo' && <span className="ut-emoji">&#x26A1;</span>}
              </div>
            )}
          </button>
          <button
            className={`ut-lock-toggle${ultrathinkLocked ? ' active' : ''}`}
            onClick={() => {
              const next = !ultrathinkLocked;
              setUltrathinkLocked(next);
              postToExtension({ type: 'setUltrathinkLocked', locked: next } as any);
            }}
            data-tooltip={ultrathinkLocked ? "Unlock ultrathink" : "Lock ultrathink on every prompt"}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {ultrathinkLocked ? (
                <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>
              ) : (
                <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>
              )}
            </svg>
          </button>
        </div>
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
              inputLockedByHandoff
                ? `Switching provider${handoffTargetProvider ? ` -> ${handoffTargetProvider}` : ''}...`
                : pendingApproval
                ? (pendingApproval.toolName === 'AskUserQuestion'
                  ? 'Type your answer... (Ctrl+Enter to send)'
                  : 'Type feedback or approve/reject above... (Ctrl+Enter to send)')
                : isUsageLimitMode
                  ? 'Usage limit reached - queue your prompt now (Ctrl+Enter)'
                : isBusy
                  ? (isCodexBusy
                      ? (codexSteerArmed ? 'Press Ctrl+Enter again to confirm steer...' : 'Type to steer Codex... (Ctrl+Enter to confirm)')
                      : 'Type to interrupt... (Ctrl+Enter to send)')
                  : 'Type a message... (Ctrl+Enter to send)'
            }
            disabled={!isConnected || inputLockedByHandoff}
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
            <div className="enhance-button-group" ref={enhanceGroupRef}>
              <button
                className={`enhance-button${isEnhancing ? ' enhancing' : ''}${autoEnhanceEnabled ? ' auto-active' : ''}`}
                onClick={handleEnhancePrompt}
                disabled={!text.trim() || isEnhancing || !isConnected || inputLockedByHandoff}
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
              data-tooltip={isCodexBusy ? 'Stop current Codex turn (Esc)' : 'Cancel current response (Esc)'}
            >
              {isCodexBusy ? 'Stop' : 'Cancel'}
            </button>
          )}
          <div className="send-column">
          <div className="prompt-nav-buttons">
            <button
              className="prompt-nav-btn"
              onClick={navigatePromptUp}
              disabled={userMessages.length === 0}
              data-tooltip="Previous user prompt"
            >
              {'\u25B2'}
            </button>
            <button
              className="prompt-nav-btn"
              onClick={navigatePromptDown}
              disabled={userMessages.length === 0}
              data-tooltip="Next user prompt"
            >
              {'\u25BC'}
            </button>
          </div>
          <div className="send-button-group" ref={sendGroupRef}>
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={(!text.trim() && pendingImages.length === 0) || !isConnected || isEnhancing || isTranslatingPrompt || !!enhanceComparisonData || inputLockedByHandoff}
              data-tooltip={
                scheduleMessageEnabled
                  ? 'Schedule message for later sending (Ctrl+Enter)'
                  : isCodexBusy
                    ? (codexSteerArmed
                        ? 'Confirm Steer: stop current turn and send this prompt (Ctrl+Enter)'
                        : 'Steer Codex: click once to arm, click again to confirm (Ctrl+Enter)')
                    : isUsageLimitMode
                      ? 'Queue prompt for auto-send one minute after usage reset (Ctrl+Enter)'
                    : (promptTranslateEnabled && !autoTranslateEnabled ? 'Translate to English (Ctrl+Enter)' : 'Send message (Ctrl+Enter)')
              }
            >
              {scheduleMessageEnabled
                ? 'Schedule'
                : isCodexBusy
                  ? (codexSteerArmed ? 'Confirm Steer' : 'Steer')
                  : isUsageLimitMode
                    ? 'Send When Available'
                  : (promptTranslateEnabled && !autoTranslateEnabled ? 'Translate' : 'Send')}
            </button>
            <button
              className="send-gear-button"
              onClick={handleToggleSendSettings}
              disabled={inputLockedByHandoff}
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
                <div className="enhance-popover-row">
                  <span className="enhance-popover-label">Schedule message</span>
                  <button
                    className={`enhance-toggle-btn ${scheduleMessageEnabled ? 'on' : 'off'}`}
                    onClick={handleScheduleToggle}
                    data-tooltip={scheduleMessageEnabled ? 'Disable scheduling' : 'Enable scheduling'}
                  >
                    <span className="enhance-toggle-knob" />
                  </button>
                </div>
                {scheduleMessageEnabled && (
                  <div className="schedule-datetime-row">
                    <input
                      type="date"
                      className="schedule-date-input"
                      value={scheduleMessageAtMs ? new Date(scheduleMessageAtMs).toISOString().slice(0, 10) : ''}
                      onChange={handleScheduleDateChange}
                      min={new Date().toISOString().slice(0, 10)}
                    />
                    <input
                      type="time"
                      className="schedule-time-input"
                      value={scheduleMessageAtMs ? `${String(new Date(scheduleMessageAtMs).getHours()).padStart(2, '0')}:${String(new Date(scheduleMessageAtMs).getMinutes()).padStart(2, '0')}` : ''}
                      onChange={handleScheduleTimeChange}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
