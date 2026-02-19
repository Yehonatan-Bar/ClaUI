import React from 'react';

interface StreamingTextProps {
  text: string;
}

/**
 * Renders text content that is actively streaming from the assistant.
 * Shows a blinking cursor at the end to indicate in-progress content.
 */
export const StreamingText: React.FC<StreamingTextProps> = ({ text }) => {
  return (
    <div
      className="text-content"
      dir="auto"
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {text}
      <span className="streaming-cursor" />
    </div>
  );
};
