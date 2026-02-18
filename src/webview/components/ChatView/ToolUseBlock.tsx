import React, { useState } from 'react';
import { renderTextWithFileLinks } from './filePathLinks';

/** Tool names that represent plan approval / question flows */
const PLAN_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];

/** Friendly display labels for plan tools */
const PLAN_TOOL_LABELS: Record<string, string> = {
  ExitPlanMode: 'Plan',
  AskUserQuestion: 'Question',
};

interface ToolUseBlockProps {
  toolName: string;
  input?: Record<string, unknown>;
  partialInput?: string;
  isStreaming: boolean;
}

/**
 * Renders a tool_use content block showing the tool name and its input.
 * Handles both completed (with parsed input) and streaming (with partial JSON) states.
 * Plan tools (ExitPlanMode, AskUserQuestion) get special styling and display.
 */
export const ToolUseBlock: React.FC<ToolUseBlockProps> = ({
  toolName,
  input,
  partialInput,
  isStreaming,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isPlanTool = PLAN_TOOLS.includes(toolName);

  // For plan tools, try to extract readable plan text instead of raw JSON
  let displayContent: string;
  if (isPlanTool) {
    displayContent = extractPlanText(input, partialInput);
  } else {
    displayContent = input
      ? JSON.stringify(input, null, 2)
      : partialInput || '';
  }

  const displayName = PLAN_TOOL_LABELS[toolName] || toolName;
  const blockClass = `tool-use-block${isPlanTool ? ' plan-tool' : ''}`;

  return (
    <div className={blockClass}>
      <div
        className="tool-use-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
      >
        <span className={`tool-collapse-indicator${isCollapsed ? '' : ' expanded'}`} />
        <span className="tool-use-name">{displayName}</span>
        {isStreaming && (
          <span style={{ opacity: 0.5, fontSize: 11 }}>
            {isPlanTool ? 'preparing...' : 'running...'}
          </span>
        )}
      </div>
      {!isCollapsed && displayContent && (
        <div className="tool-use-body">
          {renderTextWithFileLinks(displayContent)}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
};

/**
 * Extract human-readable plan text from tool input.
 * ExitPlanMode input shape: { plan: string }
 * AskUserQuestion input shape: { question: string } or similar
 */
function extractPlanText(
  input?: Record<string, unknown>,
  partialInput?: string
): string {
  // Try parsed input first
  if (input) {
    const planField = input.plan || input.question || input.message;
    if (typeof planField === 'string') return planField;
    return JSON.stringify(input, null, 2);
  }

  // Try parsing partial JSON for streaming state
  if (partialInput) {
    try {
      const parsed = JSON.parse(partialInput);
      const planField = parsed.plan || parsed.question || parsed.message;
      if (typeof planField === 'string') return planField;
    } catch {
      // Partial JSON not yet complete - show raw
    }
    return partialInput;
  }

  return '';
}
