import React, { useMemo, useCallback, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, type MotionValue } from 'framer-motion';
import type { ProjectMapState, MapLayout } from '../../../extension/types/workstreamTypes';
import { computeLayout } from './layout';
import { pulseKeyframes } from './animations';
import { STATUS_COLORS } from './visualEncoding';
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
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);
  const setSelectedStationId = useAppStore(s => s.setSelectedStationId);

  const layout: MapLayout = useMemo(() => computeLayout(state), [state]);

  const visibleStations = useMemo(() =>
    state.stations.filter(s => s.visibleInProjectMap),
    [state.stations]
  );

  const stationIndexMap = useMemo(() => {
    const sorted = visibleStations
      .map(s => ({ id: s.id, x: layout.stationPositions[s.id]?.x ?? 0 }))
      .sort((a, b) => a.x - b.x);
    const map: Record<string, number> = {};
    sorted.forEach((s, i) => { map[s.id] = i; });
    return map;
  }, [visibleStations, layout.stationPositions]);

  // Pan/zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomMV = useMotionValue(1);
  const smoothZoom = useSpring(zoomMV, { stiffness: 200, damping: 30 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.station-node, .workstream-line, button')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStartRef.current.panX + e.clientX - dragStartRef.current.x,
      y: dragStartRef.current.panY + e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.93 : 1.07;
    const current = zoomMV.get();
    zoomMV.set(Math.max(0.3, Math.min(3, current * factor)));
  }, [zoomMV]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.station-node, .workstream-line')) return;
    setPan({ x: 0, y: 0 });
    zoomMV.set(1);
  }, [zoomMV]);

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
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <style>{pulseKeyframes()}</style>

      <motion.div
        style={{
          scale: smoothZoom,
          x: pan.x,
          y: pan.y,
          width: layout.bounds.width,
          height: layout.bounds.height,
          transformOrigin: '0 0',
        }}
      >
        <svg
          width={layout.bounds.width}
          height={layout.bounds.height}
          viewBox={`0 0 ${layout.bounds.width} ${layout.bounds.height}`}
          style={{ display: 'block' }}
        >
          <defs>
            {/* Background dot grid */}
            <pattern id="bg-dots" width={24} height={24} patternUnits="userSpaceOnUse">
              <circle cx={12} cy={12} r={0.6} fill="rgba(148, 163, 184, 0.12)" />
            </pattern>

            {/* Neon blur for hover glow */}
            <filter id="neon-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>

            {/* Ambient glow */}
            <radialGradient id="ambient-glow" cx="30%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#4A9EFF" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#4A9EFF" stopOpacity="0" />
            </radialGradient>

            {/* Existing filters */}
            <filter id="blur-filter">
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
            <filter id="glow-recent" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-attention" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-resolved" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-uncertain" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background layers */}
          <rect width="100%" height="100%" fill="var(--vscode-editor-background)" />
          <rect width="100%" height="100%" fill="url(#bg-dots)" />
          <rect width="100%" height="100%" fill="url(#ambient-glow)" />

          {/* Workstream lines */}
          {state.workstreams
            .filter(ws => !ws.visual.collapsed && layout.workstreamPaths[ws.id])
            .map((ws, i) => (
              <WorkstreamLine
                key={ws.id}
                workstream={ws}
                pathDef={layout.workstreamPaths[ws.id]}
                labelPosition={layout.labelPositions[ws.id] ?? { x: 0, y: 0 }}
                index={i}
              />
            ))}

          {/* Split and merge junctions */}
          {state.splits.map(split => {
            const pos = layout.junctionPositions[split.id];
            if (!pos) return null;
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
            if (!pos) return null;
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
            if (!pos) return null;
            const parentWs = state.workstreams.find(ws => ws.id === station.workstreamId);
            const wsColor = parentWs?.visual.colorToken ?? '#64748B';
            return (
              <StationNode
                key={station.id}
                station={station}
                x={pos.x}
                y={pos.y}
                globalIndex={stationIndexMap[station.id] ?? 0}
                workstreamColor={wsColor}
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
      </motion.div>

      {/* Floating tooltip */}
      <MapTooltip state={state} layout={layout} />

      {/* Minimap */}
      <Minimap state={state} layout={layout} pan={pan} zoomMV={zoomMV} containerRef={containerRef} />
    </div>
  );
};

interface MinimapProps {
  state: ProjectMapState;
  layout: MapLayout;
  pan: { x: number; y: number };
  zoomMV: MotionValue<number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const Minimap: React.FC<MinimapProps> = React.memo(({ state, layout, pan, zoomMV }) => {
  const scale = 0.08;
  const w = Math.max(140, layout.bounds.width * scale);
  const h = Math.max(60, layout.bounds.height * scale);

  return (
    <div style={{
      position: 'absolute',
      bottom: 8,
      right: 8,
      width: w,
      height: h,
      background: 'rgba(15, 23, 42, 0.7)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: 6,
      overflow: 'hidden',
      pointerEvents: 'none',
      opacity: 0.8,
    }}>
      <svg
        viewBox={`0 0 ${layout.bounds.width} ${layout.bounds.height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        {state.workstreams
          .filter(ws => !ws.visual.collapsed && layout.workstreamPaths[ws.id])
          .map(ws => (
            <path
              key={ws.id}
              d={layout.workstreamPaths[ws.id].d}
              fill="none"
              stroke={STATUS_COLORS[ws.status] ?? '#64748B'}
              strokeWidth={3}
              opacity={0.6}
            />
          ))}
        <rect
          x={Math.max(0, -pan.x / (zoomMV.get()))}
          y={Math.max(0, -pan.y / (zoomMV.get()))}
          width={Math.min(layout.bounds.width, layout.bounds.width / (zoomMV.get()))}
          height={Math.min(layout.bounds.height, layout.bounds.height / (zoomMV.get()))}
          fill="rgba(74, 158, 255, 0.08)"
          stroke="rgba(74, 158, 255, 0.4)"
          strokeWidth={2}
          rx={3}
        />
      </svg>
    </div>
  );
});
