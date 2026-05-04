import React from 'react';
import type { Merge } from '../../../extension/types/workstreamTypes';

interface MergeJunctionProps {
  merge: Merge;
  x: number;
  y: number;
  scale?: number;
  onHover?: (hovering: boolean) => void;
  onClick?: () => void;
}

export const MergeJunction: React.FC<MergeJunctionProps> = ({
  merge,
  x,
  y,
  scale = 1,
  onHover,
  onClick,
}) => {
  const size = 12 * scale;
  const strokeWidth = 1.5;
  const confidence = merge.confidence;
  const fillOpacity = 0.8 + confidence * 0.2;

  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onClick={onClick}
    >
      {/* Main merge circle with inward arrows */}
      <circle
        cx={0}
        cy={0}
        r={size / 2}
        fill="var(--vscode-editor-background, #1E1E1E)"
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={fillOpacity}
      />

      {/* Merge arrows - converging paths */}
      {/* Upper left arrow */}
      <line
        x1={-size * 0.7}
        y1={-size * 0.7}
        x2={0}
        y2={0}
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={0.6}
      />
      <polygon
        points={`0,0 ${-size * 0.2},${-size * 0.15} ${-size * 0.15},${-size * 0.2}`}
        fill="var(--vscode-foreground, #D4D4D4)"
        opacity={0.6}
      />

      {/* Lower left arrow */}
      <line
        x1={-size * 0.7}
        y1={size * 0.7}
        x2={0}
        y2={0}
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={0.6}
      />
      <polygon
        points={`0,0 ${-size * 0.15},${size * 0.2} ${-size * 0.2},${size * 0.15}`}
        fill="var(--vscode-foreground, #D4D4D4)"
        opacity={0.6}
      />

      {/* Confidence indicator - low confidence shows dashed border */}
      {confidence < 0.7 && (
        <circle
          cx={0}
          cy={0}
          r={size / 2 + 2}
          fill="none"
          stroke="var(--vscode-editorWarning-foreground, #CED1CF)"
          strokeWidth={1}
          strokeDasharray="2,2"
          opacity={0.5}
        />
      )}

      {/* Tooltip on hover */}
      <title>{merge.reason || 'Workstream merge'}</title>
    </g>
  );
};
