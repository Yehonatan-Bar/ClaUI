import React from 'react';
import { motion } from 'framer-motion';
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
      {/* Resume point marker with ripple rings */}
      {resumeStationId && layout.stationPositions[resumeStationId] && (
        <g>
          {/* Ripple rings */}
          {[0, 1, 2].map(i => (
            <circle
              key={`ripple-${i}`}
              cx={layout.stationPositions[resumeStationId].x}
              cy={layout.stationPositions[resumeStationId].y}
              fill="none"
              stroke={GLOW_COLORS.recent}
              strokeWidth={1.5}
              opacity={0}
              style={{
                animation: `ripple-ring 2.5s ease-out ${i * 0.8}s infinite`,
              }}
            />
          ))}

          {/* Main dashed ring */}
          <motion.circle
            cx={layout.stationPositions[resumeStationId].x}
            cy={layout.stationPositions[resumeStationId].y}
            r={18}
            fill="none"
            stroke={GLOW_COLORS.recent}
            strokeWidth={2}
            strokeDasharray="4,2"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 1.5 }}
            style={{ transformOrigin: `${layout.stationPositions[resumeStationId].x}px ${layout.stationPositions[resumeStationId].y}px` }}
          />

          <motion.text
            x={layout.stationPositions[resumeStationId].x}
            y={layout.stationPositions[resumeStationId].y + 30}
            textAnchor="middle"
            fill={GLOW_COLORS.recent}
            fontSize={9}
            fontWeight={700}
            fontFamily="var(--vscode-font-family)"
            initial={{ opacity: 0, y: layout.stationPositions[resumeStationId].y + 25 }}
            animate={{ opacity: 1, y: layout.stationPositions[resumeStationId].y + 30 }}
            transition={{ duration: 0.4, delay: 1.8 }}
            style={{ letterSpacing: '0.08em' }}
          >
            RESUME HERE
          </motion.text>
        </g>
      )}

      {/* Active workstream head markers */}
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
            <motion.circle
              key={`active-marker-${ws.id}`}
              cx={pos.x}
              cy={pos.y}
              r={12}
              fill="none"
              stroke={ws.visual.colorToken}
              strokeWidth={1.5}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 0.5, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 1.2 }}
              style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
            />
          );
        })}

      {/* Blocker attention markers with enhanced glow */}
      {state.currentState.blockers
        .filter(b => !b.resolvedAt && b.stationId)
        .map(blocker => {
          const pos = blocker.stationId ? layout.stationPositions[blocker.stationId] : null;
          if (!pos) { return null; }
          return (
            <g key={`blocker-${blocker.id}`}>
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={16}
                fill="none"
                stroke={GLOW_COLORS.attention}
                strokeWidth={2}
                filter="url(#glow-attention)"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={20}
                fill="none"
                stroke={GLOW_COLORS.attention}
                strokeWidth={1}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.3, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              />
            </g>
          );
        })}

      {/* Resume arrow - to the left of the label */}
      {resumeWsId && layout.labelPositions[resumeWsId] && (
        <motion.polygon
          points={`${layout.labelPositions[resumeWsId].x - 12},${layout.labelPositions[resumeWsId].y - 5} ${layout.labelPositions[resumeWsId].x - 4},${layout.labelPositions[resumeWsId].y} ${layout.labelPositions[resumeWsId].x - 12},${layout.labelPositions[resumeWsId].y + 5}`}
          fill={GLOW_COLORS.recent}
          initial={{ opacity: 0, x: -5 }}
          animate={{ opacity: 0.8, x: 0 }}
          transition={{ duration: 0.4, delay: 1.6 }}
        />
      )}
    </g>
  );
});
