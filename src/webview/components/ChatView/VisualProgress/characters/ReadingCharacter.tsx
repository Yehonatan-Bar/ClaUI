import React from 'react';

const ReadingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-page-turn {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(-12deg); }
      }
      @keyframes vpm-eye-scan-l {
        0%, 100% { cx: 48px; }
        50% { cx: 43px; }
      }
      @keyframes vpm-eye-scan-r {
        0%, 100% { cx: 60px; }
        50% { cx: 55px; }
      }
      .vpm-page { animation: vpm-page-turn 2.5s ease-in-out infinite; transform-origin: 65px 75px; }
      .vpm-eye-l { animation: vpm-eye-scan-l 2s ease-in-out infinite; }
      .vpm-eye-r { animation: vpm-eye-scan-r 2s ease-in-out infinite; }
    `}</style>
    {/* Body */}
    <circle cx="55" cy="35" r="18" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes */}
    <circle className="vpm-eye-l" cx="48" cy="32" r="2.5" fill={color} />
    <circle className="vpm-eye-r" cx="60" cy="32" r="2.5" fill={color} />
    {/* Smile */}
    <path d="M48 40 Q54 46 60 40" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
    {/* Body line */}
    <line x1="55" y1="53" x2="55" y2="82" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="55" y1="82" x2="40" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="82" x2="70" y2="105" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Arms holding book */}
    <line x1="55" y1="62" x2="38" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="62" x2="72" y2="72" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Book */}
    <rect x="35" y="68" width="40" height="28" rx="2" stroke={color} strokeWidth="2" fill="none" />
    <line x1="55" y1="68" x2="55" y2="96" stroke={color} strokeWidth="1.5" />
    {/* Turning page */}
    <path className="vpm-page" d="M55 72 Q62 70 68 72 L68 90 Q62 88 55 90 Z" fill={color} opacity="0.15" />
    {/* Text lines on book */}
    <line x1="40" y1="76" x2="51" y2="76" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="40" y1="81" x2="50" y2="81" stroke={color} strokeWidth="1" opacity="0.4" />
    <line x1="40" y1="86" x2="48" y2="86" stroke={color} strokeWidth="1" opacity="0.4" />
  </svg>
);

export default ReadingCharacter;
