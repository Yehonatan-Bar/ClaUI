import React, { useMemo, useEffect, useCallback } from 'react';
import type { ProjectMapState, MapLayout } from '../../../extension/types/workstreamTypes';
import { computeLayout } from './layout';
import { pulseKeyframes } from './animations';
import { WorkstreamLine } from './WorkstreamLine';
import { StationNode } from './StationNode';
import { SplitJunction } from './SplitJunction';
import { MergeJunction } from './MergeJunction';
import { CurrentStateLayer } from './CurrentStateLayer';
import { ResumeViewLayer } from './ResumeViewLayer';
import { MapTooltip } from './MapTooltip';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

interface ProjectMapViewProps {
  state: ProjectMapState;
}

export const ProjectMapView: React.FC<ProjectMapViewProps> = ({ state }) => {
  const currentStateEnabled = useAppStore(s => s.currentStateLayerEnabled);
  const resumeViewEnabled = useAppStore(s => s.resumeViewEnabled);
  const resumeState = useAppStore(s => s.workstreamResumeState);
  const setResumeViewEnabled = useAppStore(s => s.setResumeViewEnabled);
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);
  const setSelectedStationId = useAppStore(s => s.setSelectedStationId);

  const layout: MapLayout = useMemo(() => computeLayout(state), [state]);

  const visibleStations = useMemo(() =>
    state.stations.filter(s => s.visibleInProjectMap),
    [state.stations]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setFocusedWorkstreamId(null);
      setSelectedStationId(null);
    }
  }, [setFocusedWorkstreamId, setSelectedStationId]);

  const handleDismissResume = useCallback(() => {
    setResumeViewEnabled(false);
    postToExtension({ type: 'workstreamMapDismissResumeView' });
  }, [setResumeViewEnabled]);

  return (
    <div
      style={{ position: 'relative', flex: 1, overflow: 'auto' }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Inject animation keyframes */}
      <style>{pulseKeyframes()}</style>

      <svg
        width={layout.bounds.width}
        height={layout.bounds.height}
        viewBox={`0 0 ${layout.bounds.width} ${layout.bounds.height}`}
        style={{
          minWidth: '100%',
          minHeight: '100%',
          background: 'var(--vscode-editor-background)',
        }}
      >
        {/* SVG filters */}
        <defs>
          <filter id="blur-filter">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
          <filter id="glow-recent">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#4A9EFF" floodOpacity="0.6" />
          </filter>
          <filter id="glow-attention">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#F87171" floodOpacity="0.6" />
          </filter>
          <filter id="glow-resolved">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#4ADE80" floodOpacity="0.6" />
          </filter>
          <filter id="glow-uncertain">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FACC15" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* Workstream lines */}
        {state.workstreams
          .filter(ws => !ws.visual.collapsed && layout.workstreamPaths[ws.id])
          .map(ws => (
            <WorkstreamLine
              key={ws.id}
              workstream={ws}
              pathDef={layout.workstreamPaths[ws.id]}
              labelPosition={layout.labelPositions[ws.id] ?? { x: 0, y: 0 }}
            />
          ))}

        {/* Split and merge junctions */}
        {state.splits.map(split => {
          const pos = layout.junctionPositions[split.id];
          if (!pos) { return null; }
          return (
            <SplitJunction
              key={`split-${split.id}`}
              split={split}
              x={pos.x}
              y={pos.y}
            />
          );
        })}

        {state.merges.map(merge => {
          const pos = layout.junctionPositions[merge.id];
          if (!pos) { return null; }
          return (
            <MergeJunction
              key={`merge-${merge.id}`}
              merge={merge}
              x={pos.x}
              y={pos.y}
            />
          );
        })}

        {/* Station nodes */}
        {visibleStations.map(station => {
          const pos = layout.stationPositions[station.id];
          if (!pos) { return null; }
          return (
            <StationNode
              key={station.id}
              station={station}
              x={pos.x}
              y={pos.y}
            />
          );
        })}

        {/* Current state overlay */}
        <CurrentStateLayer
          state={state}
          layout={layout}
          enabled={currentStateEnabled}
        />

        {/* Resume view overlay */}
        {resumeState && (
          <ResumeViewLayer
            resumeState={resumeState}
            mapState={state}
            layout={layout}
            enabled={resumeViewEnabled}
            onDismiss={handleDismissResume}
          />
        )}
      </svg>

      {/* Floating tooltip */}
      <MapTooltip state={state} layout={layout} />
    </div>
  );
};
