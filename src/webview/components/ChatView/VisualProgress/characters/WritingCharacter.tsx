import React from 'react';

const WritingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-write-hand {
        0%, 100% { transform: translate(0, 0); }
        25% { transform: translate(6px, 1px); }
        50% { transform: translate(12px, 0); }
        75% { transform: translate(6px, -1px); }
      }
      .vpm-writing-hand { animation: vpm-write-hand 1.8s ease-in-out infinite; }
    `}</style>
    {/* Head */}
    <circle cx="45" cy="28" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes - looking down */}
    <circle cx="39" cy="28" r="2" fill={color} />
    <circle cx="51" cy="28" r="2" fill={color} />
    {/* Focused expression */}
    <line x1="40" y1="35" x2="50" y2="35" stroke={color} strokeWidth="2" strokeLinecap="round" />
    {/* Body */}
    <line x1="45" y1="44" x2="45" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs (seated) */}
    <line x1="45" y1="72" x2="32" y2="95" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="45" y1="72" x2="58" y2="95" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm resting on desk */}
    <line x1="45" y1="55" x2="28" y2="70" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm writing */}
    <g className="vpm-writing-hand">
      <line x1="45" y1="55" x2="65" y2="70" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Pen */}
      <line x1="65" y1="70" x2="62" y2="80" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </g>
    {/* Desk/paper */}
    <rect x="25" y="78" width="50" height="30" rx="2" stroke={color} strokeWidth="2" fill="none" />
    {/* Written lines */}
    <line x1="32" y1="85" x2="55" y2="85" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="32" y1="90" x2="50" y2="90" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="32" y1="95" x2="45" y2="95" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="32" y1="100" x2="52" y2="100" stroke={color} strokeWidth="1" opacity="0.4" />
  </svg>
);

export default WritingCharacter;
