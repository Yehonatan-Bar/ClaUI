import React from 'react';

const SearchingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-magnify {
        0%, 100% { transform: translate(0, 0); }
        33% { transform: translate(8px, -3px); }
        66% { transform: translate(-4px, 3px); }
      }
      .vpm-magnifier { animation: vpm-magnify 2.2s ease-in-out infinite; }
    `}</style>
    {/* Head */}
    <circle cx="50" cy="30" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes - one big (looking through magnifier) */}
    <circle cx="44" cy="28" r="2" fill={color} />
    <circle cx="56" cy="28" r="3.5" fill={color} />
    {/* Curious smile */}
    <path d="M44 36 Q50 40 56 36" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="50" y1="46" x2="50" y2="75" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="50" y1="75" x2="36" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="50" y1="75" x2="64" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm */}
    <line x1="50" y1="56" x2="30" y2="68" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm holding magnifying glass */}
    <g className="vpm-magnifier">
      <line x1="50" y1="56" x2="75" y2="50" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Magnifying glass */}
      <circle cx="85" cy="44" r="12" stroke={color} strokeWidth="2.5" fill="none" />
      <line x1="77" y1="52" x2="72" y2="57" stroke={color} strokeWidth="3" strokeLinecap="round" />
      {/* Glass shine */}
      <path d="M80 38 Q82 36 84 38" stroke={color} strokeWidth="1.5" fill="none" opacity="0.4" strokeLinecap="round" />
    </g>
    {/* Shelf/files below */}
    <rect x="20" y="80" width="15" height="20" rx="1" stroke={color} strokeWidth="1.5" fill="none" opacity="0.3" />
    <rect x="38" y="80" width="15" height="20" rx="1" stroke={color} strokeWidth="1.5" fill="none" opacity="0.3" />
    <rect x="56" y="80" width="15" height="20" rx="1" stroke={color} strokeWidth="1.5" fill="none" opacity="0.3" />
  </svg>
);

export default SearchingCharacter;
