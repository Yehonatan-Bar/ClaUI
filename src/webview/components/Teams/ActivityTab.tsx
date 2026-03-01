import React from 'react';
import { useAppStore } from '../../state/store';
import { AGENT_STATUS_COLORS, getAgentColor } from './teamColors';
import { postToExtension } from '../../hooks/useClaudeStream';

export const ActivityTab: React.FC = () => {
  const { teamConfig, teamAgentStatuses, teamTasks, teamRecentMessages } = useAppStore();
  const members = teamConfig?.members || [];

  return (
    <div style={{ padding: 16 }}>
      {members.map((member, idx) => {
        const status = teamAgentStatuses[member.name] || 'idle';
        const statusColor = AGENT_STATUS_COLORS[status] || '#8b949e';
        const agentColor = member.color || getAgentColor(idx);
        const currentTask = teamTasks.find(t =>
          (t.owner === member.name || (!t.owner && t.subject === member.name)) &&
          t.status === 'in_progress'
        );
        const recentMsg = [...teamRecentMessages]
          .reverse()
          .find(m => m.from === member.name);
        const lastActivity = recentMsg?.timestamp
          ? new Date(recentMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : 'No activity';

        return (
          <div key={member.name} style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 14,
            marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: statusColor,
                  display: 'inline-block',
                }} />
                <span style={{ fontWeight: 600, color: agentColor, fontSize: 14 }}>
                  {member.name}
                </span>
                <span style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: `${statusColor}22`,
                  color: statusColor,
                }}>
                  {status}
                </span>
              </div>
              {status !== 'shutdown' && (
                <button
                  onClick={() => postToExtension({ type: 'teamShutdownAgent', agentName: member.name })}
                  style={{
                    background: 'transparent',
                    border: '1px solid #f8514933',
                    color: '#f85149',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  Shutdown
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: '#484f58' }}>Current task: </span>
                {currentTask
                  ? <span style={{ color: '#58a6ff' }}>
                      {currentTask.activeForm ||
                        (currentTask.subject !== member.name ? currentTask.subject : null) ||
                        currentTask.description?.slice(0, 60) ||
                        'Working...'}
                    </span>
                  : <span>None</span>
                }
              </div>
              <div>
                <span style={{ color: '#484f58' }}>Last activity: </span>
                <span>{lastActivity}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
