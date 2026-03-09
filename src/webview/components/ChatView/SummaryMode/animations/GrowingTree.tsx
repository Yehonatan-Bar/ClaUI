import React from 'react';
import { getProgress, VB_W, VB_H, PALETTE } from './shared';
import type { AnimationProps } from './shared';

/**
 * A tree that grows from a seed to a full canopy.
 * Trunk grows upward, branches sprout at intervals, leaves appear.
 * Each tool call adds visible growth.
 */

const GROUND_Y = VB_H - 20;
const TRUNK_X = VB_W / 2;
const MAX_TRUNK_H = 320;

// Branch definitions — appear at various trunk heights
const BRANCH_DEFS = [
  { atProgress: 0.08, side: -1, y: 0.85, len: 50, angle: -35 },
  { atProgress: 0.12, side: 1,  y: 0.80, len: 55, angle: -30 },
  { atProgress: 0.18, side: -1, y: 0.70, len: 65, angle: -40 },
  { atProgress: 0.22, side: 1,  y: 0.65, len: 60, angle: -35 },
  { atProgress: 0.28, side: -1, y: 0.55, len: 70, angle: -45 },
  { atProgress: 0.32, side: 1,  y: 0.50, len: 75, angle: -30 },
  { atProgress: 0.38, side: -1, y: 0.42, len: 55, angle: -50 },
  { atProgress: 0.42, side: 1,  y: 0.38, len: 60, angle: -40 },
  { atProgress: 0.50, side: -1, y: 0.30, len: 45, angle: -55 },
  { atProgress: 0.55, side: 1,  y: 0.25, len: 50, angle: -45 },
  { atProgress: 0.62, side: -1, y: 0.20, len: 35, angle: -60 },
  { atProgress: 0.68, side: 1,  y: 0.18, len: 40, angle: -50 },
];

// Leaf clusters — appear after their branch
const LEAF_DEFS = [
  { atProgress: 0.15, cx: -55, cy: 0.83 },
  { atProgress: 0.18, cx: 58,  cy: 0.78 },
  { atProgress: 0.25, cx: -72, cy: 0.68 },
  { atProgress: 0.28, cx: 65,  cy: 0.63 },
  { atProgress: 0.35, cx: -78, cy: 0.53 },
  { atProgress: 0.38, cx: 80,  cy: 0.48 },
  { atProgress: 0.45, cx: -60, cy: 0.40 },
  { atProgress: 0.48, cx: 65,  cy: 0.36 },
  { atProgress: 0.55, cx: -50, cy: 0.28 },
  { atProgress: 0.60, cx: 55,  cy: 0.23 },
  { atProgress: 0.65, cx: -40, cy: 0.18 },
  { atProgress: 0.70, cx: 45,  cy: 0.16 },
  // Crown leaves
  { atProgress: 0.72, cx: -20, cy: 0.12 },
  { atProgress: 0.75, cx: 20,  cy: 0.10 },
  { atProgress: 0.78, cx: 0,   cy: 0.08 },
  { atProgress: 0.80, cx: -35, cy: 0.14 },
  { atProgress: 0.83, cx: 35,  cy: 0.12 },
  { atProgress: 0.86, cx: -10, cy: 0.06 },
  { atProgress: 0.90, cx: 10,  cy: 0.05 },
];

// Fruit/flowers — appear near completion
const FRUIT_DEFS = [
  { atProgress: 0.85, cx: -50, cy: 0.50 },
  { atProgress: 0.88, cx: 60,  cy: 0.40 },
  { atProgress: 0.91, cx: -30, cy: 0.30 },
  { atProgress: 0.94, cx: 40,  cy: 0.22 },
  { atProgress: 0.97, cx: 0,   cy: 0.15 },
];

export const GrowingTree: React.FC<AnimationProps> = ({ toolCount, isComplete }) => {
  const progress = getProgress(toolCount);
  const trunkH = progress * MAX_TRUNK_H;
  const trunkTopY = GROUND_Y - trunkH;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax meet">
      {/* Ground */}
      <ellipse cx={TRUNK_X} cy={GROUND_Y + 2} rx={80} ry={8} fill="rgba(139,115,85,0.3)" />

      {/* Trunk — grows upward */}
      {progress > 0 && (
        <rect
          x={TRUNK_X - 6} y={trunkTopY}
          width={12} height={trunkH}
          rx={4}
          fill="#8d6e63"
          className="sm-tree-grow"
        />
      )}

      {/* Trunk texture lines */}
      {progress > 0.1 && (
        <>
          <line x1={TRUNK_X - 2} y1={GROUND_Y - trunkH * 0.3} x2={TRUNK_X - 2} y2={GROUND_Y - trunkH * 0.1} stroke="#6d4c41" strokeWidth={1} opacity={0.4} />
          <line x1={TRUNK_X + 3} y1={GROUND_Y - trunkH * 0.6} x2={TRUNK_X + 3} y2={GROUND_Y - trunkH * 0.35} stroke="#6d4c41" strokeWidth={1} opacity={0.4} />
        </>
      )}

      {/* Branches */}
      {BRANCH_DEFS.filter(b => progress >= b.atProgress).map((b, i) => {
        const branchY = GROUND_Y - trunkH * b.y;
        const endX = TRUNK_X + b.side * b.len;
        const endY = branchY + b.len * Math.sin(b.angle * Math.PI / 180);
        const cpX = TRUNK_X + b.side * b.len * 0.4;
        const cpY = branchY - 10;
        return (
          <path
            key={`branch-${i}`}
            d={`M ${TRUNK_X},${branchY} Q ${cpX},${cpY} ${endX},${endY}`}
            fill="none"
            stroke="#8d6e63"
            strokeWidth={3}
            strokeLinecap="round"
            className="sm-branch-grow"
            style={{ animationDelay: `${i * 0.08}s` }}
          />
        );
      })}

      {/* Leaves */}
      {LEAF_DEFS.filter(l => progress >= l.atProgress).map((l, i) => {
        const leafY = GROUND_Y - trunkH * l.cy;
        return (
          <circle
            key={`leaf-${i}`}
            cx={TRUNK_X + l.cx}
            cy={leafY}
            r={12}
            fill={PALETTE[i % PALETTE.length]}
            opacity={0.7}
            className={isComplete ? 'sm-leaf-sway' : 'sm-leaf-bud'}
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        );
      })}

      {/* Fruits */}
      {FRUIT_DEFS.filter(f => progress >= f.atProgress).map((f, i) => {
        const fruitY = GROUND_Y - trunkH * f.cy;
        return (
          <circle
            key={`fruit-${i}`}
            cx={TRUNK_X + f.cx}
            cy={fruitY}
            r={6}
            fill="#f44336"
            stroke="#fff"
            strokeWidth={1}
            opacity={0.9}
            className="sm-leaf-bud"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        );
      })}

      {/* Completion: birds */}
      {isComplete && (
        <>
          <g className="sm-bird-fly" style={{ animationDelay: '0s' }}>
            <path d="M 60,60 q-8,-6 -16,0 q8,-8 16,0" fill="none" stroke="#333" strokeWidth={1.5} />
          </g>
          <g className="sm-bird-fly" style={{ animationDelay: '0.7s' }}>
            <path d="M 200,40 q-6,-5 -12,0 q6,-7 12,0" fill="none" stroke="#333" strokeWidth={1.5} />
          </g>
        </>
      )}
    </svg>
  );
};
