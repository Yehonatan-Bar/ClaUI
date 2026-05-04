import React, { useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { MapHeader } from './MapHeader';
import { MapControls } from './MapControls';
import { MapLegend } from './MapLegend';
import { ProjectMapView } from './ProjectMapView';
import { WorkstreamDetailPanel } from './WorkstreamDetailPanel';
import { StationDetailView } from './StationDetailView';
import { ResolveToolbar } from './ResolveToolbar';
import { NLCommandBar } from './NLCommandBar';
import { postToExtension } from '../../hooks/useClaudeStream';

export const WorkstreamMapView: React.FC = () => {
  const mapData = useAppStore(s => s.workstreamMapData);
  const isClassifying = useAppStore(s => s.workstreamMapClassifying);
  const classifyProgress = useAppStore(s => s.workstreamMapClassifyProgress);
  const classifyPhase = useAppStore(s => s.workstreamMapClassifyPhase);
  const error = useAppStore(s => s.workstreamMapError);
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);
  const selectedStationId = useAppStore(s => s.selectedStationId);
  const resolveModeEnabled = useAppStore(s => s.resolveModeEnabled);
  const zoom = useAppStore(s => s.workstreamMapZoom);

  useEffect(() => {
    postToExtension({ type: 'workstreamMapRequestData' });
  }, []);

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontFamily: 'var(--vscode-font-family)',
        color: '#F87171',
        fontSize: 13,
        gap: 8,
      }}>
        <div>Error loading workstream map</div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>{error}</div>
        <button
          onClick={() => postToExtension({ type: 'workstreamMapReclassify', force: true })}
          style={{
            marginTop: 8,
            background: 'var(--vscode-button-background, #4A9EFF)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '6px 16px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Retry Classification
        </button>
      </div>
    );
  }

  if (!mapData && !isClassifying) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontFamily: 'var(--vscode-font-family)',
        color: '#94A3B8',
        fontSize: 13,
        gap: 12,
      }}>
        <div style={{ fontWeight: 600, fontSize: 16, color: '#CBD5E1' }}>Workstream Map</div>
        <div>No workstream data yet. Start a classification to build the map.</div>
        <button
          onClick={() => postToExtension({ type: 'workstreamMapReclassify', force: true })}
          style={{
            background: 'var(--vscode-button-background, #4A9EFF)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '8px 20px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Classify Project
        </button>
      </div>
    );
  }

  if (isClassifying && !mapData) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontFamily: 'var(--vscode-font-family)',
        color: '#CBD5E1',
        gap: 12,
      }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Building Workstream Map...</div>
        <div style={{
          width: 200,
          height: 6,
          background: '#1E293B',
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${classifyProgress * 100}%`,
            height: '100%',
            background: '#4A9EFF',
            transition: 'width 300ms',
          }} />
        </div>
        <div style={{ fontSize: 12, color: '#64748B' }}>{classifyPhase}</div>
      </div>
    );
  }

  if (!mapData) { return null; }

  const focusedWorkstream = focusedWorkstreamId
    ? mapData.workstreams.find(ws => ws.id === focusedWorkstreamId)
    : null;
  const selectedStation = selectedStationId
    ? mapData.stations.find(s => s.id === selectedStationId)
    : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--vscode-editor-background)',
    }}>
      {/* Header with summary chips */}
      <MapHeader
        state={mapData}
        isClassifying={isClassifying}
        classifyProgress={classifyProgress}
        classifyPhase={classifyPhase}
      />

      {/* Controls bar */}
      <MapControls />

      {/* Main content area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Map SVG */}
        <ProjectMapView state={mapData} />

        {/* Side panel - workstream detail or station detail */}
        {zoom === 'station_detail' && selectedStation && (
          <StationDetailView station={selectedStation} state={mapData} />
        )}
        {zoom === 'workstream' && focusedWorkstream && !selectedStation && (
          <WorkstreamDetailPanel workstream={focusedWorkstream} state={mapData} />
        )}
      </div>

      {/* Resolve toolbar and NL command bar */}
      {resolveModeEnabled && <ResolveToolbar />}
      {resolveModeEnabled && <NLCommandBar />}

      {/* Legend */}
      <MapLegend />
    </div>
  );
};
