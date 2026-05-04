import React from 'react';
import type { ProjectMapState } from '../../../extension/types/workstreamTypes';

interface MapHeaderProps {
  state: ProjectMapState;
  isClassifying: boolean;
  classifyProgress: number;
  classifyPhase: string;
}

export const MapHeader: React.FC<MapHeaderProps> = ({ state, isClassifying, classifyProgress, classifyPhase }) => {
  const activeCount = state.workstreams.filter(ws => ws.status === 'active').length;
  const blockedCount = state.workstreams.filter(ws => ws.status === 'blocked').length;
  const completedCount = state.workstreams.filter(ws => ws.status === 'completed').length;
  const uncertainCount = state.workstreams.filter(ws => ws.status === 'uncertain').length;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      borderBottom: '1px solid var(--vscode-panel-border, #334155)',
      background: 'var(--vscode-editor-background)',
      fontFamily: 'var(--vscode-font-family)',
      fontSize: 12,
      color: 'var(--vscode-foreground, #CBD5E1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {state.projectLabel}
        </span>
        <span style={{ color: '#64748B' }}>Workstream Map</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Summary chips */}
        {activeCount > 0 && (
          <Chip color="#4A9EFF" label={`${activeCount} Active`} />
        )}
        {blockedCount > 0 && (
          <Chip color="#F87171" label={`${blockedCount} Blocked`} />
        )}
        {completedCount > 0 && (
          <Chip color="#4ADE80" label={`${completedCount} Done`} />
        )}
        {uncertainCount > 0 && (
          <Chip color="#FACC15" label={`${uncertainCount} Uncertain`} />
        )}

        {/* Classification progress */}
        {isClassifying && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 60,
              height: 4,
              background: '#1E293B',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${classifyProgress * 100}%`,
                height: '100%',
                background: '#4A9EFF',
                transition: 'width 300ms',
              }} />
            </div>
            <span style={{ fontSize: 10, color: '#64748B' }}>{classifyPhase}</span>
          </div>
        )}

        {/* Recommended next action */}
        {state.currentState.recommendedNextAction && !isClassifying && (
          <span style={{
            fontSize: 10,
            color: '#94A3B8',
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            Next: {state.currentState.recommendedNextAction}
          </span>
        )}
      </div>
    </div>
  );
};

const Chip: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 10,
    background: `${color}15`,
    border: `1px solid ${color}30`,
    fontSize: 10,
    fontWeight: 500,
    color,
  }}>
    <span style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
    }} />
    {label}
  </span>
);
