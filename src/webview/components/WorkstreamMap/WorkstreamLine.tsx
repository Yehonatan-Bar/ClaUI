import React, { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Workstream, SvgPathDefinition } from '../../../extension/types/workstreamTypes';
import { getLineDashArray, getLineFilter } from './visualEncoding';
import { labelFadeVariants, PARTICLE_COUNT, PARTICLE_BASE_DURATION } from './animations';
import { useAppStore } from '../../state/store';

interface WorkstreamLineProps {
  workstream: Workstream;
  pathDef: SvgPathDefinition;
  labelPosition: { x: number; y: number };
  index: number;
}

export const WorkstreamLine: React.FC<WorkstreamLineProps> = React.memo(({ workstream, pathDef, labelPosition, index }) => {
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);
  const setHoveredEntityId = useAppStore(s => s.setHoveredEntityId);
  const hoveredEntityId = useAppStore(s => s.hoveredEntityId);
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);

  const isHovered = hoveredEntityId === workstream.id;
  const isFocused = focusedWorkstreamId === workstream.id;
  const isFaded = focusedWorkstreamId !== null && !isFocused;
  const isActive = workstream.status === 'active' || workstream.status === 'blocked';

  const handleClick = useCallback(() => {
    setFocusedWorkstreamId(isFocused ? null : workstream.id);
  }, [workstream.id, isFocused, setFocusedWorkstreamId]);

  const handleMouseEnter = useCallback(() => {
    setHoveredEntityId(workstream.id);
  }, [workstream.id, setHoveredEntityId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredEntityId(null);
  }, [setHoveredEntityId]);

  const dashArray = useMemo(() => getLineDashArray(pathDef.texture), [pathDef.texture]);
  const lineFilter = useMemo(() => getLineFilter(pathDef.texture), [pathDef.texture]);
  const isDashed = !!dashArray;

  const targetOpacity = isFaded ? 0.15 : pathDef.opacity;
  const baseThickness = Math.max(3, pathDef.thickness);
  const targetStrokeWidth = baseThickness + (isHovered || isFocused ? 1.5 : 0);
  const pathId = `ws-path-${workstream.id}`;

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
      {/* Hit area */}
      <path
        d={pathDef.d}
        fill="none"
        stroke="transparent"
        strokeWidth={pathDef.thickness + 14}
      />

      {/* Neon glow layer behind main path */}
      <motion.path
        d={pathDef.d}
        fill="none"
        stroke={pathDef.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#neon-blur)"
        initial={{ opacity: 0, strokeWidth: baseThickness + 6 }}
        animate={{
          opacity: isHovered ? 0.3 : isFocused ? 0.2 : isActive ? 0.08 : 0,
          strokeWidth: targetStrokeWidth + 6,
        }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />

      {/* Main path with draw animation */}
      <motion.path
        id={pathId}
        d={pathDef.d}
        fill="none"
        stroke={pathDef.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray || undefined}
        filter={lineFilter || undefined}
        initial={{
          pathLength: isDashed ? 1 : 0,
          opacity: 0,
          strokeWidth: baseThickness,
        }}
        animate={{
          pathLength: 1,
          opacity: targetOpacity,
          strokeWidth: targetStrokeWidth,
        }}
        transition={{
          pathLength: isDashed ? { duration: 0 } : {
            duration: 1.8,
            delay: index * 0.2,
            ease: [0.33, 1, 0.68, 1],
          },
          opacity: {
            duration: isFaded ? 0.4 : 0.5,
            delay: isFaded ? 0 : index * 0.2,
          },
          strokeWidth: { duration: 0.25, ease: 'easeOut' },
        }}
      />

      {/* Particle flow for active/blocked workstreams */}
      {isActive && !isFaded && Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
        <circle
          key={`particle-${workstream.id}-${i}`}
          r={2 - i * 0.4}
          fill={pathDef.color}
          opacity={0}
        >
          <animateMotion
            dur={`${PARTICLE_BASE_DURATION + i * 0.7}s`}
            repeatCount="indefinite"
            begin={`${1.8 + i * 0.9}s`}
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
          <animate
            attributeName="opacity"
            values={`0;${0.7 - i * 0.15};${0.7 - i * 0.15};0`}
            keyTimes="0;0.1;0.9;1"
            dur={`${PARTICLE_BASE_DURATION + i * 0.7}s`}
            repeatCount="indefinite"
            begin={`${1.8 + i * 0.9}s`}
          />
        </circle>
      ))}

      {/* Confidence indicator dot - left of label */}
      {workstream.confidence < 0.5 && !isFaded && (
        <circle
          cx={labelPosition.x - 8}
          cy={labelPosition.y}
          r={3}
          fill="#FACC15"
          opacity={0.8}
        />
      )}

      {/* Attention indicator dot - left of label */}
      {workstream.visual.needsAttention && !isFaded && (
        <motion.circle
          cx={labelPosition.x - 8}
          cy={workstream.confidence < 0.5 ? labelPosition.y - 10 : labelPosition.y}
          r={3}
          fill="#F87171"
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 + index * 0.1 }}
          style={{ transformOrigin: `${labelPosition.x - 8}px ${workstream.confidence < 0.5 ? labelPosition.y - 10 : labelPosition.y}px` }}
        />
      )}

      {/* Label - two lines for long names */}
      <motion.text
        x={labelPosition.x}
        textAnchor="start"
        fill={pathDef.color}
        fontSize={11}
        fontWeight={isFocused || isHovered ? 700 : 500}
        fontFamily="var(--vscode-font-family)"
        variants={labelFadeVariants}
        custom={index}
        initial="hidden"
        animate="visible"
        style={{
          userSelect: 'none' as const,
          letterSpacing: '0.02em',
          opacity: isFaded ? 0.2 : isHovered ? 1 : 0.85,
          transition: 'opacity 0.3s, font-weight 0.2s',
        }}
      >
        {(() => {
          const label = workstream.label;
          if (label.length <= 22) {
            return <tspan x={labelPosition.x} y={labelPosition.y}>{label}</tspan>;
          }
          const words = label.split(/\s+/);
          let l1 = '', l2 = '';
          for (const word of words) {
            if (!l2 && (!l1 || (l1 + ' ' + word).length <= 22)) {
              l1 = l1 ? l1 + ' ' + word : word;
            } else {
              l2 = l2 ? l2 + ' ' + word : word;
            }
          }
          if (l2.length > 24) { l2 = l2.slice(0, 22) + '...'; }
          if (!l2 && l1.length > 22) { l2 = l1.slice(22); l1 = l1.slice(0, 22); }
          return (
            <>
              <tspan x={labelPosition.x} y={labelPosition.y - 7}>{l1}</tspan>
              {l2 && <tspan x={labelPosition.x} y={labelPosition.y + 7}>{l2}</tspan>}
            </>
          );
        })()}
      </motion.text>
    </g>
  );
});
