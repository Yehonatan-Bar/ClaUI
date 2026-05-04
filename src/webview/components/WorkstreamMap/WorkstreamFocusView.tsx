import React, { useMemo, useCallback } from 'react';
import type { ProjectMapState, Workstream } from '../../../extension/types/workstreamTypes';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

interface WorkstreamFocusViewProps {
  workstream: Workstream;
  state: ProjectMapState;
}

export const WorkstreamFocusView: React.FC<WorkstreamFocusViewProps> = ({ workstream, state }) => {
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);
  const setSelectedStationId = useAppStore(s => s.setSelectedStationId);

  const workstreamSessions = useMemo(() =>
    state.stations.filter(s => s.workstreamId === workstream.id),
    [state.stations, workstream.id]
  );

  const relatedWorkstreams = useMemo(() =>
    state.workstreams.filter(
      ws => workstream.relatedWorkstreamIds.includes(ws.id) || ws.relatedWorkstreamIds.includes(workstream.id)
    ),
    [state.workstreams, workstream.relatedWorkstreamIds]
  );

  const handleBack = useCallback(() => {
    setFocusedWorkstreamId(null);
  }, [setFocusedWorkstreamId]);

  const statusColor =
    workstream.status === 'completed'
      ? '#34D399'
      : workstream.status === 'blocked'
        ? '#F87171'
        : workstream.status === 'active'
          ? '#4A9EFF'
          : '#94A3B8';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--vscode-editor-background)',
        color: 'var(--vscode-foreground)',
        fontFamily: 'var(--vscode-font-family)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--vscode-editor-lineHighlightBorder, rgba(255,255,255,0.05))',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          onClick={handleBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--vscode-descriptionForeground)',
            cursor: 'pointer',
            fontSize: 16,
            padding: '4px 8px',
          }}
          title="Back to project map"
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{workstream.label}</span>
            <span
              style={{
                fontSize: 11,
                background: statusColor,
                color: '#000',
                padding: '2px 8px',
                borderRadius: 3,
              }}
            >
              {workstream.status}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
            {workstream.goal}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Metrics */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--vscode-descriptionForeground)' }}>
            Metrics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <MetricCard label="Sessions" value={workstream.metrics.totalSessions} />
            <MetricCard label="Turns" value={workstream.metrics.totalTurns} />
            <MetricCard label="Files Modified" value={workstream.metrics.filesModified.length} />
            <MetricCard
              label="Cost"
              value={`$${workstream.metrics.totalCostUsd.toFixed(2)}`}
            />
          </div>
        </div>

        {/* Current State */}
        {workstream.currentState && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--vscode-descriptionForeground)' }}>
              Current State
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--vscode-foreground)',
                padding: '8px 12px',
                background: 'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))',
                borderRadius: 4,
                borderLeft: `3px solid ${statusColor}`,
              }}
            >
              {workstream.currentState.summary}
            </div>
          </div>
        )}

        {/* Stations/Events */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--vscode-descriptionForeground)' }}>
            Key Events ({workstreamSessions.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workstreamSessions.slice(0, 5).map(station => (
              <div
                key={station.id}
                onClick={() => setSelectedStationId(station.id)}
                style={{
                  padding: '8px 12px',
                  background: 'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.background =
                    'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))')
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.background =
                    'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))')
                }
              >
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{station.label}</div>
                <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
                  {station.type}
                </div>
              </div>
            ))}
            {workstreamSessions.length > 5 && (
              <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginTop: 4 }}>
                +{workstreamSessions.length - 5} more
              </div>
            )}
          </div>
        </div>

        {/* Related Workstreams */}
        {relatedWorkstreams.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--vscode-descriptionForeground)' }}>
              Related Workstreams
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {relatedWorkstreams.map(ws => (
                <div
                  key={ws.id}
                  onClick={() => setFocusedWorkstreamId(ws.id)}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.background =
                      'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.background =
                      'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))')
                  }
                >
                  {ws.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: string | number;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value }) => (
  <div
    style={{
      padding: '8px 12px',
      background: 'var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.02))',
      borderRadius: 4,
      border: '1px solid var(--vscode-editor-lineHighlightBorder, rgba(255,255,255,0.05))',
    }}
  >
    <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
  </div>
);
