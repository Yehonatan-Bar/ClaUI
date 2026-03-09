import React, { useState } from 'react';

/** Agent status colors matching teamColors.ts */
const STATUS_COLORS: Record<string, string> = {
  idle: '#8b949e',
  working: '#3fb950',
  blocked: '#f0883e',
  shutdown: '#f85149',
};

/** Team tool names that should render as team widgets */
export const TEAM_TOOLS = new Set(['TeamCreate', 'TeamDelete']);

interface TeamMember {
  name: string;
  agentType: string;
  status: string;
}

export interface TeamInlineWidgetProps {
  teamName: string;
  members: TeamMember[];
  taskCount: { total: number; completed: number };
  onOpenPanel?: () => void;
}

/**
 * Compact inline team card rendered when TeamCreate tool_use appears in chat.
 * Shows team name, member count, task progress, and member status dots.
 */
export const TeamInlineWidget: React.FC<TeamInlineWidgetProps> = ({
  teamName,
  members,
  taskCount,
  onOpenPanel,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="tool-use-block team-inline-widget">
      <div
        className="tool-use-header team-inline-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
        data-tooltip="Click to expand/collapse"
      >
        <span className={`tool-collapse-indicator${isCollapsed ? '' : ' expanded'}`} />
        <span className="team-inline-label">TEAM</span>
        <span className="team-inline-name">{teamName || 'unnamed'}</span>
        <span className="team-inline-stats">
          {members.length} agent{members.length !== 1 ? 's' : ''}
          {taskCount.total > 0 && (
            <> &middot; {taskCount.completed}/{taskCount.total} tasks</>
          )}
        </span>
      </div>

      {!isCollapsed && (
        <div className="tool-use-body team-inline-body">
          {/* Member status dots row */}
          <div className="team-inline-members">
            {members.map((member, i) => (
              <span
                key={`${member.name}-${i}`}
                className="team-member-chip"
                data-tooltip={`${member.name} (${member.agentType}) - ${member.status}`}
              >
                <span
                  className="team-member-dot"
                  style={{ background: STATUS_COLORS[member.status] || STATUS_COLORS.idle }}
                />
                <span className="team-member-name">{member.name}</span>
              </span>
            ))}
            {members.length === 0 && (
              <span style={{ opacity: 0.5, fontSize: 11 }}>No agents yet</span>
            )}
          </div>

          {/* Open panel link */}
          {onOpenPanel && (
            <button
              className="team-open-panel-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPanel();
              }}
            >
              Open Team Panel
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/** Extract team info from TeamCreate tool input */
export function extractTeamInfo(
  input?: Record<string, unknown>,
  partialInput?: string
): { teamName: string } {
  if (input && typeof input.name === 'string') {
    return { teamName: input.name };
  }
  if (partialInput) {
    try {
      const parsed = JSON.parse(partialInput);
      if (typeof parsed.name === 'string') return { teamName: parsed.name };
    } catch {
      const match = partialInput.match(/"name"\s*:\s*"([^"]+)"/);
      if (match) return { teamName: match[1] };
    }
  }
  return { teamName: '' };
}
