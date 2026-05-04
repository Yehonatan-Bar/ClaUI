import React from 'react';
import type { ResumeState, ProjectMapState, MapLayout } from '../../../extension/types/workstreamTypes';
import { GLOW_COLORS } from './visualEncoding';

interface ResumeViewLayerProps {
  resumeState: ResumeState;
  mapState: ProjectMapState;
  layout: MapLayout;
  enabled: boolean;
  onDismiss: () => void;
}

export const ResumeViewLayer: React.FC<ResumeViewLayerProps> = React.memo(({
  resumeState,
  mapState,
  layout,
  enabled,
  onDismiss,
}) => {
  if (!enabled) { return null; }

  return (
    <g className="resume-view-layer">
      {/* Banner overlay */}
      <foreignObject x={0} y={0} width={layout.bounds.width} height={50}>
        <div style={{
          background: 'rgba(30, 41, 59, 0.95)',
          borderBottom: '2px solid #4A9EFF',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--vscode-font-family)',
          color: '#E2E8F0',
          fontSize: '12px',
        }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: '#4A9EFF', marginRight: 8 }}>
              RESUME VIEW
            </span>
            <span>{resumeState.summary}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11 }}>
            {resumeState.newWorkstreamIds.length > 0 && (
              <span style={{ color: '#4ADE80' }}>
                +{resumeState.newWorkstreamIds.length} new
              </span>
            )}
            {resumeState.newlyCompletedWorkstreamIds.length > 0 && (
              <span style={{ color: '#4ADE80' }}>
                {resumeState.newlyCompletedWorkstreamIds.length} completed
              </span>
            )}
            {resumeState.newBlockerIds.length > 0 && (
              <span style={{ color: '#F87171' }}>
                {resumeState.newBlockerIds.length} blocked
              </span>
            )}
            {resumeState.resolvedBlockerIds.length > 0 && (
              <span style={{ color: '#4ADE80' }}>
                {resumeState.resolvedBlockerIds.length} resolved
              </span>
            )}
            <button
              onClick={onDismiss}
              style={{
                background: 'none',
                border: '1px solid #475569',
                borderRadius: 4,
                color: '#94A3B8',
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </foreignObject>

      {/* Highlight new workstream lines with green glow */}
      {resumeState.newWorkstreamIds.map(wsId => {
        const path = layout.workstreamPaths[wsId];
        if (!path) { return null; }
        return (
          <path
            key={`resume-new-${wsId}`}
            d={path.d}
            fill="none"
            stroke={GLOW_COLORS.resolved}
            strokeWidth={path.thickness + 3}
            opacity={0.3}
            strokeLinecap="round"
          />
        );
      })}

      {/* Highlight new stations with green circles */}
      {resumeState.newStationIds.map(stId => {
        const pos = layout.stationPositions[stId];
        if (!pos) { return null; }
        return (
          <circle
            key={`resume-station-${stId}`}
            cx={pos.x}
            cy={pos.y}
            r={14}
            fill="none"
            stroke={GLOW_COLORS.resolved}
            strokeWidth={2}
            opacity={0.5}
            strokeDasharray="3,2"
          />
        );
      })}
    </g>
  );
});
