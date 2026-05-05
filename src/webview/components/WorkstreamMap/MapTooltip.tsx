import React from 'react';
import type { ProjectMapState, MapLayout } from '../../../extension/types/workstreamTypes';
import { useAppStore } from '../../state/store';

interface MapTooltipProps {
  state: ProjectMapState;
  layout: MapLayout;
}

export const MapTooltip: React.FC<MapTooltipProps> = ({ state, layout }) => {
  const hoveredId = useAppStore(s => s.hoveredEntityId);
  if (!hoveredId) { return null; }

  // Check if hovering a workstream
  const ws = state.workstreams.find(w => w.id === hoveredId);
  if (ws) {
    const pos = layout.labelPositions[ws.id];
    if (!pos) { return null; }

    return (
      <div style={tooltipStyle(pos.x + 30, pos.y - 10)}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{ws.label}</div>
        <div style={{ color: '#94A3B8', fontSize: 10, marginBottom: 4 }}>{ws.goal}</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748B' }}>
          <span>Status: <span style={{ color: '#CBD5E1' }}>{ws.status}</span></span>
          <span>{ws.source === 'external_folder' ? 'Docs' : 'Sessions'}: <span style={{ color: '#CBD5E1' }}>{ws.source === 'external_folder' ? (ws.sourceDocumentCount ?? ws.sourceFilePaths?.length ?? 0) : ws.sessionIds.length}</span></span>
          <span>Confidence: <span style={{ color: '#CBD5E1' }}>{Math.round(ws.confidence * 100)}%</span></span>
        </div>
        {ws.currentState.phase !== 'unknown' && (
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
            Phase: {ws.currentState.phase}
          </div>
        )}
      </div>
    );
  }

  // Check if hovering a station
  const station = state.stations.find(s => s.id === hoveredId);
  if (station) {
    const pos = layout.stationPositions[station.id];
    if (!pos) { return null; }

    return (
      <div style={tooltipStyle(pos.x + 16, pos.y - 10)}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{station.label}</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{station.description}</div>
        {station.whyItMatters && (
          <div style={{ fontSize: 10, color: '#64748B', fontStyle: 'italic' }}>
            {station.whyItMatters}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748B', marginTop: 4 }}>
          <span>Type: <span style={{ color: '#CBD5E1' }}>{station.type}</span></span>
          <span>Status: <span style={{ color: '#CBD5E1' }}>{station.status}</span></span>
          <span>{new Date(station.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
    );
  }

  return null;
};

function tooltipStyle(x: number, y: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: '8px 12px',
    maxWidth: 280,
    pointerEvents: 'none',
    zIndex: 100,
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 11,
    color: '#E2E8F0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  };
}
