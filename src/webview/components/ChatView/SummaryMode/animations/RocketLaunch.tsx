import React from 'react';
import { getProgress, VB_W, VB_H } from './shared';
import type { AnimationProps } from './shared';

/**
 * Rocket launches from ground to deep space.
 * Smooth continuous movement. Background transitions through
 * atmosphere layers. Trail grows behind rocket.
 */

// Stars scattered across the sky — become visible as rocket rises
const STARS: Array<{ cx: number; cy: number; r: number; showAt: number }> = [];
for (let i = 0; i < 40; i++) {
  STARS.push({
    cx: (i * 73 + 17) % VB_W,
    cy: (i * 47 + 11) % (VB_H - 60),
    r: 1 + (i % 3) * 0.5,
    showAt: 0.15 + (i / 40) * 0.5,
  });
}

// Exhaust trail particles
const TRAIL_PARTICLES = 12;

export const RocketLaunch: React.FC<AnimationProps> = ({ toolCount, isComplete }) => {
  const progress = getProgress(toolCount);

  // Rocket Y: starts at bottom, moves to top
  const rocketY = VB_H - 80 - progress * (VB_H - 120);

  // Background: interpolate through atmosphere colors
  const skyPhase = Math.min(1, progress * 1.5); // darkens faster
  const topR = Math.round(135 * (1 - skyPhase));
  const topG = Math.round(206 * (1 - skyPhase));
  const topB = Math.round(235 * (1 - skyPhase));
  const botR = Math.round(91 * (1 - skyPhase * 0.8));
  const botG = Math.round(155 * (1 - skyPhase * 0.8));
  const botB = Math.round(213 * (1 - skyPhase * 0.8));
  const topColor = `rgb(${topR},${topG},${topB})`;
  const botColor = `rgb(${botR},${botG},${botB})`;

  // Trail length grows with progress
  const trailLen = Math.min(progress * VB_H * 0.6, rocketY - 20);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id="sm-rocket-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={topColor} />
          <stop offset="100%" stopColor={botColor} />
        </linearGradient>
        <linearGradient id="sm-exhaust-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff9800" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ff9800" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Sky background */}
      <rect width={VB_W} height={VB_H} fill="url(#sm-rocket-sky)" />

      {/* Ground (fades as rocket rises) */}
      {progress < 0.4 && (
        <rect
          x={0} y={VB_H - 30}
          width={VB_W} height={30}
          fill="#4a6741"
          opacity={1 - progress * 2.5}
        />
      )}

      {/* Stars */}
      {STARS.filter(s => progress >= s.showAt).map((s, i) => (
        <circle
          key={i}
          cx={s.cx} cy={s.cy} r={s.r}
          fill="white"
          opacity={Math.min(1, (progress - s.showAt) * 4)}
          className="sm-star-twinkle"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}

      {/* Exhaust trail */}
      {progress > 0.02 && (
        <>
          {Array.from({ length: TRAIL_PARTICLES }).map((_, i) => {
            const t = i / TRAIL_PARTICLES;
            const py = rocketY + 55 + t * trailLen;
            if (py > VB_H) return null;
            const spread = 3 + t * 15;
            return (
              <ellipse
                key={`trail-${i}`}
                cx={VB_W / 2}
                cy={py}
                rx={spread}
                ry={4 + t * 6}
                fill="#ff9800"
                opacity={(1 - t) * 0.4}
              />
            );
          })}
        </>
      )}

      {/* Rocket body */}
      <g transform={`translate(${VB_W / 2 - 18}, ${rocketY})`} style={{ transition: 'transform 0.3s ease-out' }}>
        {/* Nose cone */}
        <polygon points="18,0 0,22 36,22" fill="#e0e0e0" />
        <polygon points="18,0 8,22 18,18" fill="#ccc" opacity={0.5} />
        {/* Body */}
        <rect x={3} y={22} width={30} height={38} rx={2} fill="#b0bec5" />
        <rect x={3} y={22} width={15} height={38} rx={2} fill="#9eadb5" opacity={0.4} />
        {/* Window */}
        <circle cx={18} cy={36} r={7} fill="#42a5f5" />
        <circle cx={16} cy={34} r={2} fill="rgba(255,255,255,0.4)" />
        {/* Stripe */}
        <rect x={3} y={48} width={30} height={4} fill="#f44336" opacity={0.8} />
        {/* Fins */}
        <polygon points="0,48 -8,62 0,58" fill="#f44336" />
        <polygon points="36,48 44,62 36,58" fill="#d32f2f" />
        {/* Flame */}
        {progress > 0 && (
          <g className="sm-rocket-flame">
            <polygon points="8,60 18,82 28,60" fill="#ff9800" opacity={0.9} />
            <polygon points="12,60 18,74 24,60" fill="#ffeb3b" opacity={0.8} />
          </g>
        )}
      </g>

      {/* Destination star */}
      {isComplete && (
        <circle cx={VB_W / 2} cy={25} r={8} fill="#ffd700" className="sm-glow-pulse" />
      )}
    </svg>
  );
};
