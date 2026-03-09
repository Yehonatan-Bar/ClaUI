import React from 'react';

const ResearchingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-globe-spin {
        0% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: 80; }
      }
      .vpm-globe-line { animation: vpm-globe-spin 4s linear infinite; stroke-dasharray: 8 4; }
    `}</style>
    {/* Head */}
    <circle cx="40" cy="32" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes */}
    <circle cx="35" cy="30" r="2" fill={color} />
    <circle cx="45" cy="30" r="2" fill={color} />
    {/* Curious open mouth */}
    <circle cx="40" cy="38" r="2.5" stroke={color} strokeWidth="1.5" fill="none" />
    {/* Body */}
    <line x1="40" y1="48" x2="40" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="40" y1="78" x2="28" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="40" y1="78" x2="52" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm */}
    <line x1="40" y1="58" x2="22" y2="68" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm reaching toward globe */}
    <line x1="40" y1="58" x2="60" y2="52" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Globe */}
    <circle cx="80" cy="45" r="20" stroke={color} strokeWidth="2" fill="none" />
    {/* Globe grid lines */}
    <ellipse cx="80" cy="45" rx="20" ry="8" stroke={color} strokeWidth="1" fill="none" opacity="0.3" />
    <ellipse cx="80" cy="45" rx="8" ry="20" stroke={color} strokeWidth="1" fill="none" opacity="0.3" />
    <line x1="60" y1="45" x2="100" y2="45" stroke={color} strokeWidth="1" opacity="0.3" />
    {/* Spinning highlight */}
    <circle className="vpm-globe-line" cx="80" cy="45" r="16" stroke={color} strokeWidth="1.5" fill="none" opacity="0.5" />
    {/* Search indicator dots */}
    <circle cx="75" cy="38" r="2" fill={color} opacity="0.4" />
    <circle cx="88" cy="42" r="2" fill={color} opacity="0.4" />
    <circle cx="80" cy="52" r="2" fill={color} opacity="0.4" />
  </svg>
);

export default ResearchingCharacter;
