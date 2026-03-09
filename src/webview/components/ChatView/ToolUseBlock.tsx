import React, { useMemo, useState } from 'react';
import { renderTextWithFileLinks } from './filePathLinks';
import { AgentSpawnBlock, AGENT_TOOLS } from './AgentSpawnBlock';
import type { AgentSpawnBlockProps } from './AgentSpawnBlock';
import { TeamInlineWidget, TEAM_TOOLS, extractTeamInfo } from './TeamInlineWidget';

/** Tool names that represent plan approval / question flows */
const PLAN_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];
const TODO_TOOL = 'TodoWrite';
const SKILL_TOOL = 'Skill';

/** Friendly display labels for plan tools */
const PLAN_TOOL_LABELS: Record<string, string> = {
  ExitPlanMode: 'Plan',
  AskUserQuestion: 'Question',
};

type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'unknown';

interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

interface TodoStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  percent: number;
}

interface ToolUseBlockProps {
  toolName: string;
  input?: Record<string, unknown>;
  partialInput?: string;
  isStreaming: boolean;
  toolResult?: { content?: string | unknown[]; isError?: boolean };
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
  toolResult,
}) => {
  const isAgentTool = AGENT_TOOLS.has(toolName);
  const isTeamTool = TEAM_TOOLS.has(toolName);
  const isPlanTool = PLAN_TOOLS.includes(toolName);
  const isTodoTool = toolName === TODO_TOOL;
  const isSkillTool = toolName === SKILL_TOOL || toolName.endsWith('__Skill');

  const [isCollapsed, setIsCollapsed] = useState(() => toolName !== TODO_TOOL);
  const todoItems = useMemo(
    () => (isTodoTool ? extractTodos(input, partialInput) : null),
    [isTodoTool, input, partialInput]
  );
  const hasTodoPayload = todoItems !== null;
  const todoStats = useMemo(() => buildTodoStats(todoItems || []), [todoItems]);

  const skillName = useMemo(
    () => (isSkillTool ? extractSkillName(input, partialInput) : null),
    [isSkillTool, input, partialInput]
  );

  // Agent tools: render specialized AgentSpawnBlock
  if (isAgentTool) {
    return (
      <AgentSpawnBlock
        toolName={toolName}
        input={input}
        partialInput={partialInput}
        isStreaming={isStreaming}
        toolResult={toolResult as AgentSpawnBlockProps['toolResult']}
      />
    );
  }

  // Team tools: render TeamInlineWidget
  if (isTeamTool) {
    const { teamName } = extractTeamInfo(input, partialInput);
    return (
      <TeamInlineWidget
        teamName={teamName}
        members={[]}
        taskCount={{ total: 0, completed: 0 }}
      />
    );
  }

  // For plan tools, try to extract readable plan text instead of raw JSON
  let displayContent: string;
  if (isPlanTool) {
    displayContent = extractPlanText(input, partialInput);
  } else if (isTodoTool && !hasTodoPayload) {
    displayContent = input
      ? JSON.stringify(input, null, 2)
      : partialInput || '';
  } else {
    displayContent = input
      ? JSON.stringify(input, null, 2)
      : partialInput || '';
  }

  const displayName = isSkillTool ? 'Skill' : isTodoTool ? 'Todo' : PLAN_TOOL_LABELS[toolName] || toolName;
  const blockClass = `tool-use-block${isPlanTool ? ' plan-tool' : ''}${isTodoTool ? ' todo-tool' : ''}${isSkillTool ? ' skill-tool' : ''}`;

  return (
    <div className={blockClass}>
      <div
        className="tool-use-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
        data-tooltip="Click to expand/collapse"
      >
        <span className={`tool-collapse-indicator${isCollapsed ? '' : ' expanded'}`} />
        <span className="tool-use-name">{displayName}</span>
        {isSkillTool && (
          <span className="skill-name-chip">{skillName || 'Skill'}</span>
        )}
        {isTodoTool && hasTodoPayload && (
          <TodoSummaryChips stats={todoStats} />
        )}
        {isStreaming && (
          <span style={{ opacity: 0.5, fontSize: 11 }}>
            {isPlanTool ? 'preparing...' : isTodoTool ? 'updating...' : isSkillTool ? 'invoking...' : 'running...'}
          </span>
        )}
      </div>
      {!isCollapsed && hasTodoPayload && (
        <div className="tool-use-body">
          <TodoListRenderer todos={todoItems || []} stats={todoStats} />
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}
      {!isCollapsed && !hasTodoPayload && displayContent && (
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

function extractSkillName(
  input?: Record<string, unknown>,
  partialInput?: string
): string | null {
  if (input && typeof input.skill === 'string') return input.skill;
  if (partialInput) {
    try {
      const parsed = JSON.parse(partialInput);
      if (typeof parsed.skill === 'string') return parsed.skill;
    } catch {
      const match = partialInput.match(/"skill"\s*:\s*"([^"]+)"/);
      return match?.[1] ?? null;
    }
  }
  return null;
}

function extractTodos(
  input?: Record<string, unknown>,
  partialInput?: string
): TodoItem[] | null {
  let source: unknown = input;

  if (!isRecord(source) && partialInput) {
    try {
      source = JSON.parse(partialInput);
    } catch {
      return null;
    }
  }

  if (!isRecord(source) || !Array.isArray(source.todos)) {
    return null;
  }

  return source.todos
    .map((todo) => normalizeTodo(todo))
    .filter((todo): todo is TodoItem => Boolean(todo));
}

function normalizeTodo(todo: unknown): TodoItem | null {
  if (!isRecord(todo)) return null;

  const content = asNonEmptyString(todo.content) || asNonEmptyString(todo.title);
  if (!content) return null;

  const status = normalizeTodoStatus(asNonEmptyString(todo.status) || 'pending');
  const activeForm = asNonEmptyString(todo.activeForm);

  return {
    content,
    status,
    ...(activeForm ? { activeForm } : {}),
  };
}

function normalizeTodoStatus(status: string): TodoStatus {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'done' || normalized === 'complete') return 'completed';
  if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'active') return 'in_progress';
  if (normalized === 'pending' || normalized === 'todo' || normalized === 'open') return 'pending';
  return 'unknown';
}

function buildTodoStats(todos: TodoItem[]): TodoStats {
  const total = todos.length;
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
  const pending = Math.max(0, total - completed - inProgress);
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return {
    total,
    completed,
    inProgress,
    pending,
    percent,
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TodoSummaryChips: React.FC<{ stats: TodoStats }> = ({ stats }) => (
  <div className="todo-tool-summary">
    <span className="todo-chip todo-chip-progress">{stats.percent}%</span>
    <span className="todo-chip todo-chip-done">{stats.completed} done</span>
    <span className="todo-chip todo-chip-doing">{stats.inProgress} doing</span>
    <span className="todo-chip todo-chip-queued">{stats.pending} queued</span>
  </div>
);

const TodoListRenderer: React.FC<{
  todos: TodoItem[];
  stats: TodoStats;
}> = ({ todos, stats }) => {
  if (todos.length === 0) {
    return <div className="todo-empty">No todos found in this update.</div>;
  }

  return (
    <div className="todo-visual">
      <div className="todo-progress-row">
        <div className="todo-progress-track">
          <div className="todo-progress-fill" style={{ width: `${stats.percent}%` }} />
        </div>
        <span className="todo-progress-label">
          {stats.completed}/{stats.total} done
        </span>
      </div>

      <div className="todo-list">
        {todos.map((todo, index) => (
          <div key={`${todo.content}-${index}`} className={`todo-item todo-item-${todo.status}`}>
            <span className="todo-status-dot" />
            <div className="todo-item-content">
              <div className="todo-item-text">{renderTextWithFileLinks(todo.content)}</div>
              {todo.activeForm && (
                <div className="todo-item-active">{renderTextWithFileLinks(todo.activeForm)}</div>
              )}
            </div>
            <span className="todo-item-status">{statusLabel(todo.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

function statusLabel(status: TodoStatus): string {
  if (status === 'completed') return 'done';
  if (status === 'in_progress') return 'doing';
  if (status === 'pending') return 'queued';
  return 'other';
}
