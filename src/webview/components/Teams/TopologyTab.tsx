import React from 'react';
import { useAppStore } from '../../state/store';
import { AGENT_STATUS_COLORS, getAgentColor } from './teamColors';

export const TopologyTab: React.FC = () => {
  const { teamConfig, teamAgentStatuses, teamTasks } = useAppStore();

  if (!teamConfig) return <div style={{ color: '#8b949e', padding: 24 }}>No team data available.</div>;

  const members = teamConfig.members || [];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 12,
      padding: 16,
    }}>
      {members.map((member, idx) => {
        const status = teamAgentStatuses[member.name] || 'idle';
        const statusColor = AGENT_STATUS_COLORS[status] || '#8b949e';
        const agentColor = member.color || getAgentColor(idx);
        const currentTask = teamTasks.find(t =>
          (t.owner === member.name || (!t.owner && t.subject === member.name)) &&
          t.status === 'in_progress'
        );
        const isWorking = status === 'working';

        return (
          <div
            key={member.agentId || member.name}
            style={{
              background: '#161b22',
              border: `1px solid #30363d`,
              borderLeft: `3px solid ${agentColor}`,
              borderRadius: 8,
              padding: 14,
              position: 'relative',
              animation: isWorking ? 'teamPulse 2s ease-in-out infinite' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: statusColor,
                display: 'inline-block',
                boxShadow: isWorking ? `0 0 6px ${statusColor}` : undefined,
              }} />
              <span style={{ fontWeight: 600, color: '#e6edf3', fontSize: 14 }}>
                {member.name}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
              <span style={{
                background: '#21262d',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {member.agentType || 'agent'}
              </span>
              <span style={{ marginLeft: 8 }}>{status}</span>
            </div>
            {currentTask && (
              <div style={{
                fontSize: 12,
                color: '#58a6ff',
                marginTop: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {currentTask.activeForm ||
                  (currentTask.subject !== member.name ? currentTask.subject : null) ||
                  currentTask.description?.slice(0, 60) ||
                  'Working...'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
