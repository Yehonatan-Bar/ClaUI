import React from 'react';
import { getProgress, VB_W, VB_H, PALETTE } from './shared';
import type { AnimationProps } from './shared';

/**
 * A winding mountain trail from bottom to top.
 * Path reveals progressively. Checkpoints mark milestones.
 * Each tool call extends the path.
 */

// Waypoints for a winding path (bottom to top)
const WAYPOINTS = [
  { x: 40,  y: 460 },
  { x: 100, y: 430 },
  { x: 200, y: 420 },
  { x: 260, y: 390 },
  { x: 220, y: 350 },
  { x: 140, y: 330 },
  { x: 60,  y: 300 },
  { x: 40,  y: 260 },
  { x: 120, y: 230 },
  { x: 220, y: 210 },
  { x: 260, y: 170 },
  { x: 200, y: 140 },
  { x: 120, y: 120 },
  { x: 60,  y: 90 },
  { x: 100, y: 55 },
  { x: 180, y: 35 },
  { x: 240, y: 20 },
];

// Build SVG path from waypoints
function buildPath(): { d: string; length: number } {
  let d = `M ${WAYPOINTS[0].x},${WAYPOINTS[0].y}`;
  let length = 0;
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const prev = WAYPOINTS[i - 1];
    const curr = WAYPOINTS[i];
    // Smooth curve through control point
    const cpx = (prev.x + curr.x) / 2;
    const cpy = prev.y;
    d += ` Q ${cpx},${cpy} ${curr.x},${curr.y}`;
    // Approximate arc length
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return { d, length };
}

const PATH = buildPath();

// Checkpoint positions (at various progress points along the path)
const CHECKPOINTS = [
  { atProgress: 0.06,  wpIdx: 1 },
  { atProgress: 0.12,  wpIdx: 2 },
  { atProgress: 0.20,  wpIdx: 3 },
  { atProgress: 0.28,  wpIdx: 4 },
  { atProgress: 0.36,  wpIdx: 5 },
  { atProgress: 0.44,  wpIdx: 6 },
  { atProgress: 0.52,  wpIdx: 7 },
  { atProgress: 0.60,  wpIdx: 8 },
  { atProgress: 0.68,  wpIdx: 9 },
  { atProgress: 0.76,  wpIdx: 10 },
  { atProgress: 0.84,  wpIdx: 11 },
  { atProgress: 0.90,  wpIdx: 13 },
  { atProgress: 0.96,  wpIdx: 15 },
];

export const ProgressPath: React.FC<AnimationProps> = ({ toolCount, isComplete }) => {
  const progress = getProgress(toolCount);
  const dashOffset = PATH.length * (1 - progress);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax meet">
      {/* Dim background path */}
      <path
        d={PATH.d}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={6}
        strokeLinecap="round"
      />

      {/* Revealed path */}
      {progress > 0 && (
        <path
          d={PATH.d}
          fill="none"
          stroke={isComplete ? '#ffd700' : 'rgba(100,200,255,0.6)'}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={PATH.length}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
          className={isComplete ? 'sm-glow-pulse' : undefined}
        />
      )}

      {/* Ghost checkpoint positions */}
      {CHECKPOINTS.map((cp, i) => {
        const wp = WAYPOINTS[cp.wpIdx];
        return (
          <circle
            key={`ghost-${i}`}
            cx={wp.x} cy={wp.y}
            r={6}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={1}
          />
        );
      })}

      {/* Active checkpoints */}
      {CHECKPOINTS.filter(cp => progress >= cp.atProgress).map((cp, i) => {
        const wp = WAYPOINTS[cp.wpIdx];
        const isLatest = i === CHECKPOINTS.filter(c => progress >= c.atProgress).length - 1 && !isComplete;
        return (
          <g key={`cp-${i}`}>
            <circle
              cx={wp.x} cy={wp.y}
              r={isLatest ? 9 : 7}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.9}
              className={isLatest ? 'sm-station-pulse' : undefined}
            />
            {/* Inner dot */}
            <circle
              cx={wp.x} cy={wp.y}
              r={3}
              fill="rgba(255,255,255,0.5)"
            />
          </g>
        );
      })}

      {/* Flag at the top when complete */}
      {isComplete && (
        <g>
          <line x1={240} y1={20} x2={240} y2={-5} stroke="#fff" strokeWidth={2} />
          <polygon points="240,-5 265,2 240,9" fill="#f44336" className="sm-flag-wave" />
        </g>
      )}
    </svg>
  );
};
