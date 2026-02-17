import React from 'react';
import { useRtlDetection } from '../../hooks/useRtlDetection';

interface StreamingTextProps {
  text: string;
}

/**
 * Renders text content that is actively streaming from the assistant.
 * Shows a blinking cursor at the end to indicate in-progress content.
 */
export const StreamingText: React.FC<StreamingTextProps> = ({ text }) => {
  const { direction } = useRtlDetection(text);

  return (
    <div
      className="text-content"
      dir={direction}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {text}
      <span className="streaming-cursor" />
    </div>
  );
};
