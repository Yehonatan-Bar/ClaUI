import React from 'react';

const SkillCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-sparkle {
        0%, 100% { opacity: 0; transform: scale(0.5); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      @keyframes vpm-wand-wave {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(-15deg); }
      }
      .vpm-sparkle-1 { animation: vpm-sparkle 1.5s ease-in-out infinite; }
      .vpm-sparkle-2 { animation: vpm-sparkle 1.5s ease-in-out 0.5s infinite; }
      .vpm-sparkle-3 { animation: vpm-sparkle 1.5s ease-in-out 1s infinite; }
      .vpm-wand { animation: vpm-wand-wave 2s ease-in-out infinite; transform-origin: 55px 58px; }
    `}</style>
    {/* Head */}
    <circle cx="50" cy="35" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Wizard hat */}
    <path d="M34 22 L50 2 L66 22" stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />
    {/* Star on hat */}
    <circle cx="50" cy="14" r="2" fill={color} opacity="0.6" />
    {/* Eyes (excited) */}
    <circle cx="44" cy="33" r="2.5" fill={color} />
    <circle cx="56" cy="33" r="2.5" fill={color} />
    {/* Excited smile */}
    <path d="M44 40 Q50 46 56 40" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="50" y1="51" x2="50" y2="80" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="50" y1="80" x2="38" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="50" y1="80" x2="62" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm */}
    <line x1="50" y1="58" x2="30" y2="68" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm with wand */}
    <g className="vpm-wand">
      <line x1="50" y1="58" x2="72" y2="48" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Wand */}
      <line x1="72" y1="48" x2="88" y2="30" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Wand tip star */}
      <circle cx="90" cy="28" r="3" fill={color} opacity="0.6" />
    </g>
    {/* Sparkles */}
    <g className="vpm-sparkle-1">
      <line x1="92" y1="18" x2="92" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="89" y1="15" x2="95" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </g>
    <g className="vpm-sparkle-2">
      <line x1="80" y1="22" x2="80" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="77" y1="19" x2="83" y2="19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </g>
    <g className="vpm-sparkle-3">
      <line x1="98" y1="34" x2="98" y2="28" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="95" y1="31" x2="101" y2="31" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </g>
  </svg>
);

export default SkillCharacter;
