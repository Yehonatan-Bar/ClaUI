import React from 'react';
import type { Split } from '../../../extension/types/workstreamTypes';

interface SplitJunctionProps {
  split: Split;
  x: number;
  y: number;
  scale?: number;
  onHover?: (hovering: boolean) => void;
  onClick?: () => void;
}

export const SplitJunction: React.FC<SplitJunctionProps> = ({
  split,
  x,
  y,
  scale = 1,
  onHover,
  onClick,
}) => {
  const size = 12 * scale;
  const strokeWidth = 1.5;
  const confidence = split.confidence;
  const fillOpacity = 0.8 + confidence * 0.2;

  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onClick={onClick}
    >
      {/* Main split circle with outward arrows */}
      <circle
        cx={0}
        cy={0}
        r={size / 2}
        fill="var(--vscode-editor-background, #1E1E1E)"
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={fillOpacity}
      />

      {/* Split arrows - diverging paths */}
      {/* Upper right arrow */}
      <line
        x1={0}
        y1={0}
        x2={size * 0.7}
        y2={-size * 0.7}
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={0.6}
      />
      <polygon
        points={`${size * 0.7},${-size * 0.7} ${size * 0.5},${-size * 0.8} ${size * 0.65},${-size * 0.5}`}
        fill="var(--vscode-foreground, #D4D4D4)"
        opacity={0.6}
      />

      {/* Lower right arrow */}
      <line
        x1={0}
        y1={0}
        x2={size * 0.7}
        y2={size * 0.7}
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth}
        opacity={0.6}
      />
      <polygon
        points={`${size * 0.7},${size * 0.7} ${size * 0.65},${size * 0.5} ${size * 0.5},${size * 0.8}`}
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
      <title>{split.reason || 'Workstream split'}</title>
    </g>
  );
};
