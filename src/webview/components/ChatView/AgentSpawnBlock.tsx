import React, { useMemo, useState } from 'react';
import { renderTextWithFileLinks } from './filePathLinks';
import { AgentHierarchyBlock } from './AgentHierarchyBlock';

/** Agent tool names that should render as agent spawn cards */
export const AGENT_TOOLS = new Set(['Agent', 'Task', 'dispatch_agent']);

/** Color mapping by agent type */
const AGENT_TYPE_COLORS: Record<string, string> = {
  Explore: '#ff9800',
  Plan: '#2196f3',
  'general-purpose': '#9c27b0',
};

/** CSS class suffix by agent type */
const AGENT_TYPE_CLASS: Record<string, string> = {
  Explore: 'agent-explore',
  Plan: 'agent-plan',
  'general-purpose': 'agent-general',
};

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface AgentSpawnBlockProps {
  toolName: string;
  input?: Record<string, unknown>;
  partialInput?: string;
  isStreaming: boolean;
  toolResult?: { content?: string | ContentBlock[]; isError?: boolean };
}

/**
 * Renders a specialized card for Agent/Task tool_use blocks.
 * Shows agent type badge, description, status indicator, and collapsible prompt/result.
 */
export const AgentSpawnBlock: React.FC<AgentSpawnBlockProps> = ({
  toolName,
  input,
  partialInput,
  isStreaming,
  toolResult,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);

  const agentInfo = useMemo(
    () => extractAgentInfo(input, partialInput),
    [input, partialInput]
  );

  const subagentType = agentInfo.subagentType || 'general-purpose';
  const typeClass = AGENT_TYPE_CLASS[subagentType] || 'agent-general';
  const description = agentInfo.description || toolName;
  const isBackground = agentInfo.runInBackground === true;

  // Determine status
  const status: 'running' | 'completed' | 'error' = isStreaming
    ? 'running'
    : toolResult?.isError
      ? 'error'
      : toolResult
        ? 'completed'
        : 'running';

  // Parse nested agents from result text
  const nestedAgents = useMemo(
    () => (toolResult && !toolResult.isError ? parseNestedAgents(toolResult.content) : []),
    [toolResult]
  );

  // Extract result summary text
  const resultSummary = useMemo(() => {
    if (!toolResult?.content) return '';
    if (typeof toolResult.content === 'string') return toolResult.content;
    return toolResult.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('\n');
  }, [toolResult]);

  const statusText = status === 'running' ? 'spawning...' : status === 'error' ? 'error' : 'done';

  return (
    <div className={`tool-use-block agent-tool ${typeClass}`}>
      <div
        className="tool-use-header agent-tool-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
        data-tooltip="Click to expand/collapse"
      >
        <span className={`tool-collapse-indicator${isCollapsed ? '' : ' expanded'}`} />
        <span className={`agent-status-dot ${status}`} />
        <span className={`agent-type-badge ${typeClass}`}>{subagentType}</span>
        <span className="agent-description">{description}</span>
        {isBackground && <span className="agent-background-chip">BG</span>}
        <span className={`agent-status-label ${status}`}>{statusText}</span>
      </div>

      {!isCollapsed && (
        <div className="tool-use-body agent-tool-body">
          {/* Prompt section */}
          {agentInfo.prompt && (
            <div className="agent-prompt-section">
              <div className="agent-section-label">Prompt</div>
              <div className="agent-prompt-text">
                {renderTextWithFileLinks(
                  agentInfo.prompt.length > 500
                    ? agentInfo.prompt.slice(0, 500) + '...'
                    : agentInfo.prompt
                )}
              </div>
            </div>
          )}

          {/* Nested agents hierarchy */}
          {nestedAgents.length > 0 && (
            <AgentHierarchyBlock children={nestedAgents} />
          )}

          {/* Result summary */}
          {resultSummary && (
            <div className="agent-result-section">
              <div className="agent-section-label">
                {toolResult?.isError ? 'Error' : 'Result'}
              </div>
              <div className="agent-result-text">
                {renderTextWithFileLinks(
                  resultSummary.length > 800
                    ? resultSummary.slice(0, 800) + '...'
                    : resultSummary
                )}
              </div>
            </div>
          )}

          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
};

/** Extract agent info from parsed input or partial JSON during streaming */
function extractAgentInfo(
  input?: Record<string, unknown>,
  partialInput?: string
): {
  description: string;
  prompt: string;
  subagentType: string;
  runInBackground: boolean;
} {
  const defaults = { description: '', prompt: '', subagentType: 'general-purpose', runInBackground: false };

  if (input) {
    return {
      description: (input.description as string) || '',
      prompt: (input.prompt as string) || '',
      subagentType: (input.subagent_type as string) || 'general-purpose',
      runInBackground: input.run_in_background === true,
    };
  }

  if (partialInput) {
    try {
      const parsed = JSON.parse(partialInput);
      return {
        description: parsed.description || '',
        prompt: parsed.prompt || '',
        subagentType: parsed.subagent_type || 'general-purpose',
        runInBackground: parsed.run_in_background === true,
      };
    } catch {
      // Try regex extraction from partial JSON
      const descMatch = partialInput.match(/"description"\s*:\s*"([^"]+)"/);
      const typeMatch = partialInput.match(/"subagent_type"\s*:\s*"([^"]+)"/);
      const bgMatch = partialInput.match(/"run_in_background"\s*:\s*(true)/);
      return {
        description: descMatch?.[1] || '',
        prompt: '',
        subagentType: typeMatch?.[1] || 'general-purpose',
        runInBackground: !!bgMatch,
      };
    }
  }

  return defaults;
}

export interface NestedAgentInfo {
  description: string;
  subagentType: string;
  status: 'running' | 'completed' | 'error';
}

/** Parse tool_result text for evidence of sub-agent spawning */
function parseNestedAgents(content?: string | ContentBlock[]): NestedAgentInfo[] {
  if (!content) return [];

  const text = typeof content === 'string'
    ? content
    : content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');

  const agents: NestedAgentInfo[] = [];

  // Pattern: "Agent tool to launch" or "launched ... agent" or similar markers
  // Look for agent invocation patterns in result text
  const agentPatterns = [
    // "Explore agent" or "Plan agent" descriptions
    /(?:launched|spawned|using|used)\s+(?:the\s+)?(?:an?\s+)?(\w+)\s+agent[:\s]+["']?([^"'\n]+)/gi,
    // "Agent(subagent_type=Explore, description=...)"
    /Agent\s*\(.*?subagent_type\s*=\s*["']?(\w+)["']?.*?description\s*=\s*["']([^"']+)/gi,
    // agentId references with descriptions
    /\[(\w+)\]\s*["']([^"'\n]+)["']\s*(?:completed|done|finished|error)/gi,
  ];

  for (const pattern of agentPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const type = match[1];
      const desc = match[2]?.trim();
      if (desc && agents.length < 10) {
        const normalizedType = ['Explore', 'Plan'].includes(type) ? type : 'general-purpose';
        agents.push({
          description: desc,
          subagentType: normalizedType,
          status: /error|fail/i.test(match[0]) ? 'error' : 'completed',
        });
      }
    }
  }

  return agents;
}
