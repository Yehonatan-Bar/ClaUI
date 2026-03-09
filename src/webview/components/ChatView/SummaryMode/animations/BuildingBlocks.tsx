import React from 'react';
import { VB_W, VB_H, PALETTE } from './shared';
import type { AnimationProps } from './shared';

/**
 * A wall of bricks building from bottom to top.
 * Each tool call = one brick. Bricks stack in offset rows (brick pattern).
 * The wall fills the full SVG height as more bricks are added.
 */

const BRICK_W = 38;
const BRICK_H = 22;
const GAP = 3;
const MARGIN_X = 10;

// How many bricks fit in a full row
const COLS = Math.floor((VB_W - MARGIN_X * 2 + GAP) / (BRICK_W + GAP)); // ~7
const MAX_ROWS = Math.floor((VB_H - 40) / (BRICK_H + GAP)); // ~18
const MAX_BRICKS = COLS * MAX_ROWS;

interface BrickPos {
  x: number;
  y: number;
  row: number;
  col: number;
}

// Pre-compute all brick positions (bottom-up, offset rows)
const BRICKS: BrickPos[] = [];
for (let row = 0; row < MAX_ROWS; row++) {
  const isOffset = row % 2 === 1;
  const offsetX = isOffset ? (BRICK_W + GAP) / 2 : 0;
  const colsInRow = isOffset ? COLS - 1 : COLS;
  for (let col = 0; col < colsInRow; col++) {
    BRICKS.push({
      x: MARGIN_X + offsetX + col * (BRICK_W + GAP),
      y: VB_H - 30 - row * (BRICK_H + GAP),
      row,
      col,
    });
  }
}

export const BuildingBlocks: React.FC<AnimationProps> = ({ toolCount, isComplete }) => {
  const visible = Math.min(toolCount, MAX_BRICKS);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax meet">
      {/* Ground */}
      <rect x={5} y={VB_H - 6} width={VB_W - 10} height={6} rx={2} fill="rgba(255,255,255,0.08)" />

      {/* Bricks */}
      {BRICKS.slice(0, visible).map((b, i) => (
        <g key={i} className="sm-block-slide-in" style={{ animationDelay: `${b.col * 0.05}s` }}>
          <rect
            x={b.x} y={b.y}
            width={BRICK_W} height={BRICK_H}
            rx={3}
            fill={PALETTE[i % PALETTE.length]}
            opacity={0.9}
          />
          {/* Top highlight */}
          <rect
            x={b.x + 1} y={b.y + 1}
            width={BRICK_W - 2} height={4}
            rx={2}
            fill="rgba(255,255,255,0.2)"
          />
        </g>
      ))}

      {/* Completion glow */}
      {isComplete && visible > 0 && (
        <rect
          x={5} y={BRICKS[visible - 1]?.y - 5 || VB_H - 40}
          width={VB_W - 10}
          height={VB_H - (BRICKS[visible - 1]?.y || VB_H) + 30}
          rx={6} fill="none"
          stroke="#ffd700" strokeWidth={2}
          opacity={0.4}
          className="sm-glow-pulse"
        />
      )}
    </svg>
  );
};
