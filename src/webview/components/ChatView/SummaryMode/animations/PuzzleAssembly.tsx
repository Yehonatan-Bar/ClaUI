import React from 'react';
import { VB_W, VB_H, PALETTE } from './shared';
import type { AnimationProps } from './shared';

/**
 * A large jigsaw puzzle that assembles piece by piece.
 * Each tool call = one puzzle piece. Pieces fly in from edges.
 * Grid fills from center outward for visual interest.
 */

const COLS = 6;
const ROWS = 8;
const PIECE_W = (VB_W - 20) / COLS;
const PIECE_H = (VB_H - 40) / ROWS;
const MARGIN_X = 10;
const MARGIN_Y = 20;

interface PiecePos {
  x: number;
  y: number;
  row: number;
  col: number;
  flyDir: number;
}

// Determine placement order — spiral from center outward
function spiralOrder(): PiecePos[] {
  const grid: PiecePos[] = [];
  const visited = new Set<string>();
  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);

  const positions: Array<{ r: number; c: number; dist: number }> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dist = Math.sqrt((r - cy) ** 2 + (c - cx) ** 2);
      positions.push({ r, c, dist });
    }
  }
  positions.sort((a, b) => a.dist - b.dist);

  for (const pos of positions) {
    const key = `${pos.r},${pos.c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    grid.push({
      x: MARGIN_X + pos.c * PIECE_W,
      y: MARGIN_Y + pos.r * PIECE_H,
      row: pos.r,
      col: pos.c,
      flyDir: (pos.r + pos.c) % 4,
    });
  }
  return grid;
}

const PIECES = spiralOrder();
const MAX_PIECES = PIECES.length;

export const PuzzleAssembly: React.FC<AnimationProps> = ({ toolCount, isComplete }) => {
  const visible = Math.min(toolCount, MAX_PIECES);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
      {/* Ghost grid */}
      {PIECES.map((p, i) => (
        <rect
          key={`ghost-${i}`}
          x={p.x + 1} y={p.y + 1}
          width={PIECE_W - 2} height={PIECE_H - 2}
          rx={3}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}

      {/* Placed pieces */}
      {PIECES.slice(0, visible).map((p, i) => (
        <g
          key={i}
          className={`sm-puzzle-fly-in-${p.flyDir}`}
          style={{ animationDelay: `${(i % 6) * 0.04}s` }}
        >
          <rect
            x={p.x + 1} y={p.y + 1}
            width={PIECE_W - 2} height={PIECE_H - 2}
            rx={3}
            fill={PALETTE[i % PALETTE.length]}
            opacity={0.85}
          />
          {/* Jigsaw tab (right side) */}
          {p.col < COLS - 1 && (
            <circle
              cx={p.x + PIECE_W}
              cy={p.y + PIECE_H / 2}
              r={5}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.85}
            />
          )}
          {/* Jigsaw tab (bottom) */}
          {p.row < ROWS - 1 && (
            <circle
              cx={p.x + PIECE_W / 2}
              cy={p.y + PIECE_H}
              r={5}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.85}
            />
          )}
          {/* Inner highlight */}
          <rect
            x={p.x + 3} y={p.y + 3}
            width={PIECE_W - 6} height={6}
            rx={2}
            fill="rgba(255,255,255,0.15)"
          />
        </g>
      ))}

      {/* Completion glow */}
      {isComplete && visible > 0 && (
        <rect
          x={MARGIN_X - 2} y={MARGIN_Y - 2}
          width={COLS * PIECE_W + 4} height={ROWS * PIECE_H + 4}
          rx={6} fill="none"
          stroke="#ffd700" strokeWidth={2.5}
          opacity={0.5}
          className="sm-glow-pulse"
        />
      )}
    </svg>
  );
};
