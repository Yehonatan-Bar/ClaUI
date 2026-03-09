import React from 'react';

const PlanningCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-check {
        0%, 60%, 100% { opacity: 0; }
        70%, 90% { opacity: 1; }
      }
      .vpm-check-1 { animation: vpm-check 3s ease-in-out infinite; }
      .vpm-check-2 { animation: vpm-check 3s ease-in-out 0.8s infinite; }
      .vpm-check-3 { animation: vpm-check 3s ease-in-out 1.6s infinite; }
    `}</style>
    {/* Head */}
    <circle cx="45" cy="30" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes */}
    <circle cx="40" cy="28" r="2" fill={color} />
    <circle cx="50" cy="28" r="2" fill={color} />
    {/* Thinking smile */}
    <path d="M40 36 Q45 39 50 36" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Body */}
    <line x1="45" y1="46" x2="45" y2="75" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="45" y1="75" x2="33" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="45" y1="75" x2="57" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Left arm holding clipboard */}
    <line x1="45" y1="55" x2="25" y2="62" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Right arm with pen */}
    <line x1="45" y1="55" x2="62" y2="65" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Clipboard */}
    <rect x="60" y="50" width="38" height="55" rx="3" stroke={color} strokeWidth="2" fill="none" />
    {/* Clipboard clip */}
    <rect x="72" y="46" width="14" height="8" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
    {/* Checklist items */}
    <rect x="66" y="60" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    <line x1="76" y1="63" x2="92" y2="63" stroke={color} strokeWidth="1" opacity="0.4" />
    <path className="vpm-check-1" d="M67 63 L69 65 L73 60" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />

    <rect x="66" y="72" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    <line x1="76" y1="75" x2="90" y2="75" stroke={color} strokeWidth="1" opacity="0.4" />
    <path className="vpm-check-2" d="M67 75 L69 77 L73 72" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />

    <rect x="66" y="84" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    <line x1="76" y1="87" x2="88" y2="87" stroke={color} strokeWidth="1" opacity="0.4" />
    <path className="vpm-check-3" d="M67 87 L69 89 L73 84" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />

    <rect x="66" y="96" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    <line x1="76" y1="99" x2="91" y2="99" stroke={color} strokeWidth="1" opacity="0.4" />
  </svg>
);

export default PlanningCharacter;
