import React from 'react';

const EditingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-eraser {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        30% { transform: translate(-3px, -2px) rotate(-5deg); }
        60% { transform: translate(3px, -1px) rotate(5deg); }
      }
      .vpm-eraser-arm { animation: vpm-eraser 1.5s ease-in-out infinite; transform-origin: 55px 55px; }
    `}</style>
    {/* Head */}
    <circle cx="55" cy="28" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes - squinting */}
    <line x1="47" y1="26" x2="52" y2="26" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="58" y1="26" x2="63" y2="26" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Tongue out (concentrating) */}
    <path d="M52 34 Q55 38 58 34" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="55" y1="44" x2="55" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="55" y1="72" x2="42" y2="100" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="72" x2="68" y2="100" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm holding document */}
    <line x1="55" y1="55" x2="30" y2="65" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm with pencil/eraser */}
    <g className="vpm-eraser-arm">
      <line x1="55" y1="55" x2="78" y2="60" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Pencil */}
      <line x1="78" y1="60" x2="72" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="72,72 69,78 75,78" fill={color} opacity="0.6" />
    </g>
    {/* Document */}
    <rect x="18" y="58" width="30" height="40" rx="2" stroke={color} strokeWidth="2" fill="none" />
    {/* Text lines (some crossed out = editing) */}
    <line x1="24" y1="66" x2="42" y2="66" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="24" y1="66" x2="42" y2="66" stroke={color} strokeWidth="1.5" opacity="0.6" />
    <line x1="24" y1="72" x2="38" y2="72" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="24" y1="78" x2="40" y2="78" stroke={color} strokeWidth="1" opacity="0.2" />
    <line x1="22" y1="77" x2="42" y2="79" stroke={color} strokeWidth="1" opacity="0.5" />
    <line x1="24" y1="84" x2="36" y2="84" stroke={color} strokeWidth="1" opacity="0.4" />
  </svg>
);

export default EditingCharacter;
