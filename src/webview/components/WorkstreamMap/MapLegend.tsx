import React from 'react';
import { STATUS_COLORS } from './visualEncoding';

export const MapLegend: React.FC = () => (
  <div style={{
    display: 'flex',
    gap: 12,
    padding: '6px 16px',
    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
    background: 'rgba(15, 23, 42, 0.5)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    fontSize: 10,
    fontFamily: 'var(--vscode-font-family)',
    color: '#64748B',
    flexWrap: 'wrap',
    letterSpacing: '0.01em',
  }}>
    {/* Line colors */}
    {Object.entries(STATUS_COLORS).map(([status, color]) => (
      <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
        {status}
      </span>
    ))}

    <span style={{ margin: '0 4px', color: '#334155' }}>|</span>

    {/* Line textures */}
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke="#94A3B8" strokeWidth={2} /></svg>
      solid = high confidence
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke="#94A3B8" strokeWidth={2} strokeDasharray="4,2" /></svg>
      dashed = uncertain
    </span>

    <span style={{ margin: '0 4px', color: '#334155' }}>|</span>

    {/* Station shapes */}
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="#E2E8F0" stroke="#64748B" strokeWidth={1} /></svg>
      session
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={10} height={10}><polygon points="5,1 9,5 5,9 1,5" fill="#E2E8F0" stroke="#64748B" strokeWidth={1} /></svg>
      decision
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={10} height={10}><rect x={1} y={1} width={8} height={8} fill="#E2E8F0" stroke="#64748B" strokeWidth={1} rx={1} /></svg>
      code change
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={10} height={10}><polygon points="5,1 9,9 1,9" fill="#FACC15" stroke="#64748B" strokeWidth={1} /></svg>
      problem
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <svg width={10} height={10}>
        <line x1={2} y1={2} x2={8} y2={8} stroke="#F87171" strokeWidth={2} />
        <line x1={8} y1={2} x2={2} y2={8} stroke="#F87171" strokeWidth={2} />
      </svg>
      failure
    </span>
  </div>
);
