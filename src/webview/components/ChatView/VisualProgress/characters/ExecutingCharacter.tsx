import React from 'react';

const ExecutingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-type-l {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-4px); }
      }
      @keyframes vpm-type-r {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-4px); }
      }
      @keyframes vpm-cursor {
        0%, 49% { opacity: 1; }
        50%, 100% { opacity: 0; }
      }
      .vpm-arm-l { animation: vpm-type-l 0.45s ease-in-out infinite; transform-origin: 55px 65px; }
      .vpm-arm-r { animation: vpm-type-r 0.45s ease-in-out 0.22s infinite; transform-origin: 65px 65px; }
      .vpm-cursor { animation: vpm-cursor 0.9s step-end infinite; }
    `}</style>
    {/* Head */}
    <circle cx="60" cy="22" r="13" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes */}
    <circle cx="55" cy="20" r="1.8" fill={color} />
    <circle cx="65" cy="20" r="1.8" fill={color} />
    {/* Focused expression - slight frown */}
    <path d="M55 27 Q60 25 65 27" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="60" y1="35" x2="60" y2="68" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="60" y1="68" x2="45" y2="95" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="60" y1="68" x2="75" y2="95" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm (typing) */}
    <line className="vpm-arm-l" x1="60" y1="48" x2="38" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm (typing) */}
    <line className="vpm-arm-r" x1="60" y1="48" x2="82" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Keyboard base */}
    <rect x="28" y="78" width="64" height="10" rx="3" stroke={color} strokeWidth="1.5" fill="none" />
    {/* Keyboard keys hint */}
    <line x1="36" y1="83" x2="44" y2="83" stroke={color} strokeWidth="1" opacity="0.5" />
    <line x1="48" y1="83" x2="56" y2="83" stroke={color} strokeWidth="1" opacity="0.5" />
    <line x1="60" y1="83" x2="68" y2="83" stroke={color} strokeWidth="1" opacity="0.5" />
    <line x1="72" y1="83" x2="80" y2="83" stroke={color} strokeWidth="1" opacity="0.5" />
    {/* Terminal prompt above keyboard */}
    <text x="32" y="72" fontSize="8" fill={color} opacity="0.7" fontFamily="monospace">{'$>'}</text>
    {/* Blinking cursor */}
    <rect className="vpm-cursor" x="47" y="65" width="5" height="7" fill={color} opacity="0.8" />
  </svg>
);

export default ExecutingCharacter;
