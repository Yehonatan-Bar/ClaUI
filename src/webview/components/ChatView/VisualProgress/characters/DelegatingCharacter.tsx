import React from 'react';

const DelegatingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-messenger {
        0% { transform: translate(0, 0); opacity: 1; }
        70% { transform: translate(30px, -15px); opacity: 1; }
        100% { transform: translate(40px, -20px); opacity: 0; }
      }
      .vpm-messenger { animation: vpm-messenger 2.5s ease-out infinite; }
    `}</style>
    {/* Main person */}
    <circle cx="40" cy="35" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes */}
    <circle cx="35" cy="33" r="2" fill={color} />
    <circle cx="45" cy="33" r="2" fill={color} />
    {/* Confident smile */}
    <path d="M35 40 Q40 44 45 40" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="40" y1="51" x2="40" y2="80" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="40" y1="80" x2="28" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="40" y1="80" x2="52" y2="108" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm down */}
    <line x1="40" y1="60" x2="22" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm pointing out */}
    <line x1="40" y1="58" x2="62" y2="48" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Messenger helper going out */}
    <g className="vpm-messenger">
      {/* Small helper person */}
      <circle cx="72" cy="38" r="8" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="70" cy="37" r="1" fill={color} />
      <circle cx="74" cy="37" r="1" fill={color} />
      <line x1="72" y1="46" x2="72" y2="58" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="72" y1="58" x2="66" y2="68" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="72" y1="58" x2="78" y2="68" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {/* Speed lines */}
      <line x1="82" y1="42" x2="90" y2="38" stroke={color} strokeWidth="1" opacity="0.4" />
      <line x1="82" y1="48" x2="88" y2="48" stroke={color} strokeWidth="1" opacity="0.4" />
    </g>
  </svg>
);

export default DelegatingCharacter;
