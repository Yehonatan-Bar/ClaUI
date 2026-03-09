import React from 'react';

const DecidingCharacter: React.FC<{ color: string }> = ({ color }) => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>{`
      @keyframes vpm-think-bubble {
        0%, 100% { opacity: 0.3; transform: translateY(0); }
        50% { opacity: 0.8; transform: translateY(-3px); }
      }
      .vpm-bubble-1 { animation: vpm-think-bubble 2s ease-in-out infinite; }
      .vpm-bubble-2 { animation: vpm-think-bubble 2s ease-in-out 0.4s infinite; }
      .vpm-bubble-3 { animation: vpm-think-bubble 2s ease-in-out 0.8s infinite; }
    `}</style>
    {/* Head */}
    <circle cx="55" cy="45" r="16" stroke={color} strokeWidth="2.5" fill="none" />
    {/* Eyes (looking up, thinking) */}
    <circle cx="50" cy="42" r="2" fill={color} />
    <circle cx="60" cy="42" r="2" fill={color} />
    {/* Hmm expression */}
    <line x1="50" y1="51" x2="58" y2="50" stroke={color} strokeWidth="2" strokeLinecap="round" />
    {/* Hand on chin */}
    <line x1="55" y1="61" x2="55" y2="85" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="68" x2="40" y2="56" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="68" x2="70" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Legs */}
    <line x1="55" y1="85" x2="42" y2="110" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="55" y1="85" x2="68" y2="110" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {/* Thought bubbles */}
    <circle className="vpm-bubble-1" cx="72" cy="30" r="3" stroke={color} strokeWidth="1.5" fill="none" />
    <circle className="vpm-bubble-2" cx="80" cy="20" r="5" stroke={color} strokeWidth="1.5" fill="none" />
    <circle className="vpm-bubble-3" cx="90" cy="10" r="8" stroke={color} strokeWidth="1.5" fill="none" />
    {/* Question mark in big bubble */}
    <text x="87" y="14" fontSize="10" fill={color} fontWeight="bold" textAnchor="middle">?</text>
    {/* Crossroads arrows */}
    <line x1="20" y1="95" x2="35" y2="80" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
    <polygon points="35,80 30,82 33,86" fill={color} opacity="0.3" />
    <line x1="90" y1="95" x2="75" y2="80" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
    <polygon points="75,80 78,86 80,82" fill={color} opacity="0.3" />
  </svg>
);

export default DecidingCharacter;
