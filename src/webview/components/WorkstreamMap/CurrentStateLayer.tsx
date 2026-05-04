import React from 'react';
import type { ProjectMapState, MapLayout } from '../../../extension/types/workstreamTypes';
import { GLOW_COLORS } from './visualEncoding';

interface CurrentStateLayerProps {
  state: ProjectMapState;
  layout: MapLayout;
  enabled: boolean;
}

export const CurrentStateLayer: React.FC<CurrentStateLayerProps> = React.memo(({ state, layout, enabled }) => {
  if (!enabled) { return null; }

  const resumeWsId = state.currentState.recommendedResumeWorkstreamId;
  const resumeStationId = state.currentState.recommendedResumeStationId;

  return (
    <g className="current-state-layer">
      {/* Resume point marker */}
      {resumeStationId && layout.stationPositions[resumeStationId] && (
        <g>
          <circle
            cx={layout.stationPositions[resumeStationId].x}
            cy={layout.stationPositions[resumeStationId].y}
            r={18}
            fill="none"
            stroke={GLOW_COLORS.recent}
            strokeWidth={2}
            strokeDasharray="4,2"
            style={{ animation: 'workstream-pulse 2s ease-in-out infinite' }}
          />
          <text
            x={layout.stationPositions[resumeStationId].x}
            y={layout.stationPositions[resumeStationId].y + 28}
            textAnchor="middle"
            fill={GLOW_COLORS.recent}
            fontSize={9}
            fontWeight={600}
            fontFamily="var(--vscode-font-family)"
          >
            RESUME HERE
          </text>
        </g>
      )}

      {/* Enlarged last meaningful station per active workstream */}
      {state.workstreams
        .filter(ws => ws.status === 'active')
        .map(ws => {
          const wsStations = state.stations
            .filter(s => s.workstreamId === ws.id)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          const lastStation = wsStations[0];
          if (!lastStation) { return null; }
          const pos = layout.stationPositions[lastStation.id];
          if (!pos) { return null; }

          return (
            <circle
              key={`active-marker-${ws.id}`}
              cx={pos.x}
              cy={pos.y}
              r={12}
              fill="none"
              stroke={ws.visual.colorToken}
              strokeWidth={1.5}
              opacity={0.5}
            />
          );
        })}

      {/* Blocker attention markers */}
      {state.currentState.blockers
        .filter(b => !b.resolvedAt && b.stationId)
        .map(blocker => {
          const pos = blocker.stationId ? layout.stationPositions[blocker.stationId] : null;
          if (!pos) { return null; }
          return (
            <g key={`blocker-${blocker.id}`}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={16}
                fill="none"
                stroke={GLOW_COLORS.attention}
                strokeWidth={2}
                opacity={0.6}
                style={{ animation: 'workstream-glow-pulse 2s ease-in-out infinite' }}
              />
            </g>
          );
        })}

      {/* Resume recommended marker on workstream label area */}
      {resumeWsId && layout.labelPositions[resumeWsId] && (
        <g>
          <polygon
            points={`${layout.labelPositions[resumeWsId].x + 20},${layout.labelPositions[resumeWsId].y - 6} ${layout.labelPositions[resumeWsId].x + 28},${layout.labelPositions[resumeWsId].y} ${layout.labelPositions[resumeWsId].x + 20},${layout.labelPositions[resumeWsId].y + 6}`}
            fill={GLOW_COLORS.recent}
            opacity={0.8}
          />
        </g>
      )}
    </g>
  );
});
