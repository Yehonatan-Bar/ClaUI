import React, { useState } from 'react';

interface ToolUseBlockProps {
  toolName: string;
  input?: Record<string, unknown>;
  partialInput?: string;
  isStreaming: boolean;
}

/**
 * Renders a tool_use content block showing the tool name and its input.
 * Handles both completed (with parsed input) and streaming (with partial JSON) states.
 */
export const ToolUseBlock: React.FC<ToolUseBlockProps> = ({
  toolName,
  input,
  partialInput,
  isStreaming,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const displayContent = input
    ? JSON.stringify(input, null, 2)
    : partialInput || '';

  return (
    <div className="tool-use-block">
      <div
        className="tool-use-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
      >
        <span style={{ opacity: 0.6 }}>{isCollapsed ? '+' : '-'}</span>
        <span className="tool-use-name">{toolName}</span>
        {isStreaming && (
          <span style={{ opacity: 0.5, fontSize: 11 }}>running...</span>
        )}
      </div>
      {!isCollapsed && displayContent && (
        <div className="tool-use-body">
          {displayContent}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
};
