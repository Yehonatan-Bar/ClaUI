import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { detectRtl } from '../../hooks/useRtlDetection';

interface StreamingTextProps {
  text: string;
}

/**
 * Renders text content that is actively streaming from the assistant.
 * Shows a blinking cursor at the end to indicate in-progress content.
 */
export const StreamingText: React.FC<StreamingTextProps> = ({ text }) => {
  const typingTheme = useAppStore((s) => s.typingTheme);
  const [visibleLength, setVisibleLength] = useState(text.length);

  useEffect(() => {
    if (typingTheme !== 'terminal-hacker') {
      setVisibleLength(text.length);
      return;
    }

    if (text.length < visibleLength) {
      setVisibleLength(text.length);
      return;
    }

    if (text.length === visibleLength) {
      return;
    }

    const remaining = text.length - visibleLength;
    const step = remaining > 60 ? 4 : remaining > 20 ? 2 : 1;
    const timer = window.setTimeout(() => {
      setVisibleLength((len) => Math.min(len + step, text.length));
    }, 14);

    return () => window.clearTimeout(timer);
  }, [text, typingTheme, visibleLength]);

  const displayText = useMemo(
    () => (typingTheme === 'terminal-hacker' ? text.slice(0, visibleLength) : text),
    [text, typingTheme, visibleLength]
  );

  /** Split text around "ultrathink" so we can render it with glow styling */
  const renderedContent = useMemo(() => {
    const parts = displayText.split(/\b(ultrathink)\b/gi);
    if (parts.length === 1) return displayText;
    return parts.map((part, i) =>
      /^ultrathink$/i.test(part)
        ? <span key={i} className={`ultrathink-glow ut-glow-v${Math.floor(Math.random() * 6) + 1}`}>{part}</span>
        : part
    );
  }, [displayText]);

  const effectiveDir = detectRtl(text) ? 'rtl' : 'auto';

  return (
    <div
      className={`text-content streaming-text streaming-text-${typingTheme}`}
      dir={effectiveDir}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {renderedContent}
      <span className="streaming-cursor" />
    </div>
  );
};
