import React, { useCallback } from 'react';
import type { Workstream, SvgPathDefinition } from '../../../extension/types/workstreamTypes';
import { getLineDashArray, getLineFilter } from './visualEncoding';
import { useAppStore } from '../../state/store';

interface WorkstreamLineProps {
  workstream: Workstream;
  pathDef: SvgPathDefinition;
  labelPosition: { x: number; y: number };
}

export const WorkstreamLine: React.FC<WorkstreamLineProps> = React.memo(({ workstream, pathDef, labelPosition }) => {
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);
  const setHoveredEntityId = useAppStore(s => s.setHoveredEntityId);
  const hoveredEntityId = useAppStore(s => s.hoveredEntityId);
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);

  const isHovered = hoveredEntityId === workstream.id;
  const isFocused = focusedWorkstreamId === workstream.id;
  const isFaded = focusedWorkstreamId !== null && !isFocused;

  const handleClick = useCallback(() => {
    setFocusedWorkstreamId(isFocused ? null : workstream.id);
  }, [workstream.id, isFocused, setFocusedWorkstreamId]);

  const handleMouseEnter = useCallback(() => {
    setHoveredEntityId(workstream.id);
  }, [workstream.id, setHoveredEntityId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredEntityId(null);
  }, [setHoveredEntityId]);

  const opacity = isFaded ? 0.25 : pathDef.opacity;
  const strokeWidth = isHovered ? pathDef.thickness + 1 : pathDef.thickness;

  return (
    <g
      className="workstream-line"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Workstream: ${workstream.label}, ${workstream.status}, confidence ${Math.round(workstream.confidence * 100)}%`}
      tabIndex={0}
    >
      {/* Hit area (wider invisible path for easier clicking) */}
      <path
        d={pathDef.d}
        fill="none"
        stroke="transparent"
        strokeWidth={strokeWidth + 10}
      />

      {/* Visual line */}
      <path
        d={pathDef.d}
        fill="none"
        stroke={pathDef.color}
        strokeWidth={strokeWidth}
        strokeDasharray={getLineDashArray(pathDef.texture)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        filter={getLineFilter(pathDef.texture)}
        style={{ transition: 'stroke-width 150ms, opacity 150ms' }}
      />

      {/* Workstream label */}
      <text
        x={labelPosition.x}
        y={labelPosition.y}
        textAnchor="end"
        fill={pathDef.color}
        fontSize={11}
        fontWeight={isFocused || isHovered ? 600 : 400}
        fontFamily="var(--vscode-font-family)"
        opacity={isFaded ? 0.3 : isHovered ? 1 : 0.85}
        style={{ transition: 'opacity 150ms' }}
      >
        {workstream.label}
      </text>

      {/* Status badge */}
      {workstream.visual.needsAttention && (
        <circle
          cx={labelPosition.x + 8}
          cy={labelPosition.y - 4}
          r={3}
          fill="#F87171"
          style={{ animation: 'workstream-pulse 2s ease-in-out infinite' }}
        />
      )}

      {/* Confidence indicator for low-confidence workstreams */}
      {workstream.confidence < 0.5 && (
        <text
          x={labelPosition.x + 14}
          y={labelPosition.y}
          fill="#FACC15"
          fontSize={10}
          fontFamily="var(--vscode-font-family)"
          opacity={0.7}
        >
          ?
        </text>
      )}
    </g>
  );
});
