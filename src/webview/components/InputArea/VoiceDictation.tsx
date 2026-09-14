import React, { useCallback, useEffect, useRef, useState } from 'react';
import { postToExtension } from '../../hooks/useClaudeStream';
import { applyDictation, collapse, type DictationAnchor } from '../../utils/voiceInsert';

/**
 * Voice dictation for the composer.
 *
 * The extension host runs recognition (see extension/voice) and streams
 * utterance-level results here. The composer text stays the source of truth:
 * an interim result lives in one caret-anchored range, a final result closes
 * it, and any manual edit collapses the range to the caret. Nothing is ever
 * re-rendered from a stored transcript, so deleted text never comes back.
 */

export interface VoiceDictationApi {
  listening: boolean;
  connecting: boolean;
  interim: string;
  error: string | null;
  /** Latest microphone level 0..1 (ref, updated ~10/s without re-rendering). */
  levelRef: React.MutableRefObject<number>;
  toggle: () => void;
  stop: () => void;
  /** Call from the textarea's onChange so dictation continues from the user's caret. */
  onUserEdit: (caret: number) => void;
}

interface Options {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** Current composer text (state). */
  text: string;
  setText: (value: string) => void;
  /** Record a final result in the composer undo stack. */
  pushUndo: (text: string, caret: number) => void;
  resizeTextarea: () => void;
  enabled: boolean;
}

export function useVoiceDictation(opts: Options): VoiceDictationApi {
  const { textareaRef, text, setText, pushUndo, resizeTextarea, enabled } = opts;
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);
  const anchorRef = useRef<DictationAnchor>(collapse(0));
  const textRef = useRef(text);
  textRef.current = text;
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearConnectTimer = () => {
    if (connectTimer.current) { clearTimeout(connectTimer.current); connectTimer.current = null; }
  };

  const caretOf = useCallback((): number => {
    const el = textareaRef.current;
    const len = textRef.current.length;
    if (!el) return len;
    const c = el.selectionStart;
    return typeof c === 'number' && c >= 0 && c <= len ? c : len;
  }, [textareaRef]);

  const applyResult = useCallback((spoken: string, isFinal: boolean) => {
    const result = applyDictation(textRef.current, caretOf(), anchorRef.current, spoken, isFinal);
    anchorRef.current = result.anchor;
    if (result.text !== textRef.current) {
      textRef.current = result.text;
      setText(result.text);
      if (isFinal) pushUndo(result.text, result.caret);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.selectionStart = result.caret;
          el.selectionEnd = result.caret;
        }
        resizeTextarea();
      });
    }
  }, [caretOf, setText, pushUndo, resizeTextarea, textareaRef]);

  const beginLocal = useCallback(() => {
    const el = textareaRef.current;
    try { el?.focus({ preventScroll: true }); } catch { /* ignore */ }
    anchorRef.current = collapse(caretOf());
    setInterim('');
    setError(null);
  }, [caretOf, textareaRef]);

  const stop = useCallback(() => {
    clearConnectTimer();
    setListening(false);
    setConnecting(false);
    setInterim('');
    // An interim still on screen stays as text; the final that follows replaces it (grace window in the host).
    postToExtension({ type: 'voiceStop' });
  }, []);

  const toggle = useCallback(() => {
    if (!enabled) return;
    if (listeningRef.current || connectTimer.current) { stop(); return; }
    beginLocal();
    setConnecting(true);
    setListening(true);
    postToExtension({ type: 'voiceStart' });
    // If the host never answers (no browser, server down), do not stay stuck.
    connectTimer.current = setTimeout(() => {
      connectTimer.current = null;
      setConnecting(false);
      setListening(false);
      setError('Voice server did not respond');
    }, 15000);
  }, [enabled, beginLocal, stop]);

  const onUserEdit = useCallback((caret: number) => {
    anchorRef.current = collapse(caret);
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'voiceState': {
          if (msg.listening) {
            clearConnectTimer();
            if (!listeningRef.current) beginLocal();
            setListening(true);
            setConnecting(!!msg.connecting);
          } else {
            clearConnectTimer();
            setListening(false);
            setConnecting(false);
            setInterim('');
          }
          if (msg.error) setError(String(msg.error));
          else if (msg.listening) setError(null);
          return;
        }
        case 'voiceTranscript': {
          const isFinal = msg.kind === 'final';
          applyResult(String(msg.text || ''), isFinal);
          setInterim(isFinal ? '' : String(msg.text || ''));
          return;
        }
        case 'voiceLevel':
          levelRef.current = Number(msg.level) || 0;
          return;
        case 'voiceToggle':
          toggle();
          return;
        default:
          return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyResult, beginLocal, toggle]);

  useEffect(() => () => clearConnectTimer(), []);

  return { listening, connecting, interim, error, levelRef, toggle, stop, onUserEdit };
}

/* ---------------- UI ---------------- */

const MIC_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export const VoiceMicButton: React.FC<{ api: VoiceDictationApi; disabled?: boolean }> = ({ api, disabled }) => {
  const active = api.listening || api.connecting;
  return (
    <button
      type="button"
      className={`voice-mic-button${active ? ' active' : ''}`}
      onClick={api.toggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? 'Stop voice dictation' : 'Start voice dictation'}
      data-tooltip={active ? 'Stop dictation (Ctrl+Alt+M)' : 'Dictate (Ctrl+Alt+M)'}
    >
      {MIC_ICON}
    </button>
  );
};

export const VoiceHud: React.FC<{ api: VoiceDictationApi }> = ({ api }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = api.listening || api.connecting || !!api.error;

  useEffect(() => {
    if (!api.listening) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    const id = setInterval(() => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const amp = 3 + api.levelRef.current * 11;
      for (let x = 0; x < w; x++) {
        const y = h / 2 + Math.sin((x + t) / 8) * amp * (0.4 + 0.6 * Math.sin((x + t) / 18));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (!reduced) t += 6;
    }, 50);
    return () => clearInterval(id);
  }, [api.listening, api.levelRef]);

  if (!visible) return null;
  const label = api.error ? api.error : api.connecting ? 'Connecting…' : 'Listening… speak';
  return (
    <div className={`voice-hud${api.error ? ' error' : ''}`} role="status" aria-live="polite">
      <span className="voice-dot" />
      <span className="voice-label">{label}</span>
      <span className="voice-live" dir="auto">{api.interim}</span>
      {api.listening && <canvas ref={canvasRef} className="voice-wave" width={140} height={24} />}
      <button type="button" className="voice-stop" onClick={api.stop}>Stop</button>
    </div>
  );
};
