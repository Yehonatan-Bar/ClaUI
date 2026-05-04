import React, { useCallback } from 'react';
import type { Station } from '../../../extension/types/workstreamTypes';
import { getStationShape, getStationSize, GLOW_COLORS } from './visualEncoding';
import { useAppStore } from '../../state/store';

interface StationNodeProps {
  station: Station;
  x: number;
  y: number;
}

export const StationNode: React.FC<StationNodeProps> = React.memo(({ station, x, y }) => {
  const setSelectedStationId = useAppStore(s => s.setSelectedStationId);
  const setHoveredEntityId = useAppStore(s => s.setHoveredEntityId);
  const hoveredEntityId = useAppStore(s => s.hoveredEntityId);

  const shape = getStationShape(station.type);
  const size = getStationSize(station.visual.size);
  const isHovered = hoveredEntityId === station.id;
  const glowColor = GLOW_COLORS[station.visual.glow];

  const handleClick = useCallback(() => {
    setSelectedStationId(station.id);
  }, [station.id, setSelectedStationId]);

  const handleMouseEnter = useCallback(() => {
    setHoveredEntityId(station.id);
  }, [station.id, setHoveredEntityId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredEntityId(null);
  }, [setHoveredEntityId]);

  const renderShape = () => {
    const r = isHovered ? size * 1.2 : size;
    const fill = station.status === 'failed' ? '#F87171' :
                 station.status === 'pending' ? '#9CA3AF' :
                 station.status === 'partial' ? '#FACC15' :
                 '#E2E8F0';
    const stroke = station.status === 'completed' ? '#4ADE80' : '#64748B';

    switch (shape) {
      case 'circle':
        return <circle cx={x} cy={y} r={r / 2} fill={fill} stroke={stroke} strokeWidth={1.5} />;
      case 'diamond':
        return (
          <polygon
            points={`${x},${y - r / 2} ${x + r / 2},${y} ${x},${y + r / 2} ${x - r / 2},${y}`}
            fill={fill} stroke={stroke} strokeWidth={1.5}
          />
        );
      case 'square':
        return (
          <rect
            x={x - r / 2} y={y - r / 2} width={r} height={r}
            fill={fill} stroke={stroke} strokeWidth={1.5} rx={2}
          />
        );
      case 'triangle':
        return (
          <polygon
            points={`${x},${y - r / 2} ${x + r / 2},${y + r / 2} ${x - r / 2},${y + r / 2}`}
            fill={fill} stroke={stroke} strokeWidth={1.5}
          />
        );
      case 'star': {
        const outerR = r / 2;
        const innerR = outerR * 0.4;
        const points = Array.from({ length: 10 }, (_, i) => {
          const angle = (i * Math.PI) / 5 - Math.PI / 2;
          const radius = i % 2 === 0 ? outerR : innerR;
          return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
        }).join(' ');
        return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={1.5} />;
      }
      case 'x':
        return (
          <g>
            <line x1={x - r / 3} y1={y - r / 3} x2={x + r / 3} y2={y + r / 3} stroke="#F87171" strokeWidth={2.5} strokeLinecap="round" />
            <line x1={x + r / 3} y1={y - r / 3} x2={x - r / 3} y2={y + r / 3} stroke="#F87171" strokeWidth={2.5} strokeLinecap="round" />
          </g>
        );
      case 'lock':
        return (
          <g>
            <rect x={x - r / 3} y={y - r / 6} width={r * 0.66} height={r / 2} fill={fill} stroke={stroke} strokeWidth={1.5} rx={2} />
            <path d={`M ${x - r / 5} ${y - r / 6} V ${y - r / 3} A ${r / 5} ${r / 5} 0 0 1 ${x + r / 5} ${y - r / 3} V ${y - r / 6}`} fill="none" stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case 'junction':
        return (
          <g>
            <circle cx={x} cy={y} r={r / 2} fill="none" stroke={stroke} strokeWidth={2} />
            <circle cx={x} cy={y} r={r / 4} fill={fill} />
          </g>
        );
      case 'outlined-circle':
        return (
          <g>
            <circle cx={x} cy={y} r={r / 2} fill="none" stroke={stroke} strokeWidth={1.5} strokeDasharray="3,2" />
            <circle cx={x} cy={y} r={r / 4} fill={fill} />
          </g>
        );
      default:
        return <circle cx={x} cy={y} r={r / 2} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    }
  };

  return (
    <g
      className="station-node"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Station: ${station.label}, ${station.type}, ${station.status}`}
      tabIndex={0}
    >
      {station.visual.glow !== 'none' && (
        <circle
          cx={x} cy={y} r={size * 0.8}
          fill="none" stroke={glowColor} strokeWidth={2}
          opacity={0.4}
          style={{ animation: 'workstream-glow-pulse 2s ease-in-out infinite' }}
        />
      )}
      {renderShape()}
      {station.visual.labelVisible && (
        <text
          x={x}
          y={y - size - 4}
          textAnchor="middle"
          fill="var(--vscode-foreground, #CBD5E1)"
          fontSize={10}
          fontFamily="var(--vscode-font-family)"
          opacity={isHovered ? 1 : 0.8}
        >
          {station.label.length > 25 ? station.label.slice(0, 22) + '...' : station.label}
        </text>
      )}
    </g>
  );
});
