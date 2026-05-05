import React, { useCallback } from 'react';
import type { Station } from '../../../extension/types/workstreamTypes';
import { getStationShape, getStationSize, GLOW_COLORS } from './visualEncoding';
import { useAppStore } from '../../state/store';

interface StationNodeProps {
  station: Station;
  x: number;
  y: number;
  globalIndex: number;
  workstreamColor: string;
}

function renderShape(shape: string, size: number, fill: string, stroke: string): JSX.Element {
  const r = size / 2;
  switch (shape) {
    case 'circle':
      return <circle cx={0} cy={0} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    case 'diamond':
      return (
        <polygon
          points={`0,${-r} ${r},0 0,${r} ${-r},0`}
          fill={fill} stroke={stroke} strokeWidth={1.5}
        />
      );
    case 'square':
      return (
        <rect
          x={-r} y={-r} width={size} height={size}
          fill={fill} stroke={stroke} strokeWidth={1.5} rx={2}
        />
      );
    case 'triangle':
      return (
        <polygon
          points={`0,${-r} ${r},${r * 0.8} ${-r},${r * 0.8}`}
          fill={fill} stroke={stroke} strokeWidth={1.5}
        />
      );
    case 'star': {
      const outerR = r;
      const innerR = outerR * 0.4;
      const points = Array.from({ length: 10 }, (_, i) => {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const radius = i % 2 === 0 ? outerR : innerR;
        return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
      }).join(' ');
      return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    }
    case 'x':
      return (
        <g>
          <line x1={-r * 0.6} y1={-r * 0.6} x2={r * 0.6} y2={r * 0.6} stroke="#F87171" strokeWidth={2.5} strokeLinecap="round" />
          <line x1={r * 0.6} y1={-r * 0.6} x2={-r * 0.6} y2={r * 0.6} stroke="#F87171" strokeWidth={2.5} strokeLinecap="round" />
        </g>
      );
    case 'lock':
      return (
        <g>
          <rect x={-r * 0.5} y={-r * 0.15} width={r} height={r * 0.7} fill={fill} stroke={stroke} strokeWidth={1.5} rx={2} />
          <path
            d={`M ${-r * 0.3} ${-r * 0.15} V ${-r * 0.5} A ${r * 0.3} ${r * 0.3} 0 0 1 ${r * 0.3} ${-r * 0.5} V ${-r * 0.15}`}
            fill="none" stroke={stroke} strokeWidth={1.5}
          />
        </g>
      );
    case 'junction':
      return (
        <g>
          <circle cx={0} cy={0} r={r} fill="none" stroke={stroke} strokeWidth={2} />
          <circle cx={0} cy={0} r={r * 0.4} fill={fill} />
        </g>
      );
    case 'outlined-circle':
      return (
        <g>
          <circle cx={0} cy={0} r={r} fill="none" stroke={stroke} strokeWidth={1.5} strokeDasharray="3,2" />
          <circle cx={0} cy={0} r={r * 0.35} fill={fill} />
        </g>
      );
    default:
      return <circle cx={0} cy={0} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
  }
}

export const StationNode: React.FC<StationNodeProps> = React.memo(({ station, x, y, globalIndex, workstreamColor }) => {
  const setSelectedStationId = useAppStore(s => s.setSelectedStationId);
  const setHoveredEntityId = useAppStore(s => s.setHoveredEntityId);
  const hoveredEntityId = useAppStore(s => s.hoveredEntityId);

  const shape = getStationShape(station.type);
  const size = getStationSize(station.visual.size);
  const isHovered = hoveredEntityId === station.id;
  const glowColor = GLOW_COLORS[station.visual.glow];

  const fillColor = station.status === 'failed' ? '#F87171'
    : station.status === 'pending' ? '#64748B'
    : station.status === 'partial' ? '#FACC15'
    : '#CBD5E1';

  const strokeColor = station.status === 'completed' ? '#4ADE80' : '#475569';

  const handleClick = useCallback(() => {
    setSelectedStationId(station.id);
  }, [station.id, setSelectedStationId]);

  const handleMouseEnter = useCallback(() => {
    setHoveredEntityId(station.id);
  }, [station.id, setHoveredEntityId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredEntityId(null);
  }, [setHoveredEntityId]);

  const entranceDelay = 0.6 + globalIndex * 0.06;
  const hoverScale = isHovered ? 1.25 : 1;

  return (
    <g
      className="station-node"
      transform={`translate(${x}, ${y})`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        cursor: 'pointer',
        opacity: 0,
        animation: `station-enter 0.4s ease-out ${entranceDelay}s forwards`,
      }}
      role="button"
      aria-label={`Station: ${station.label}, ${station.type}, ${station.status}`}
      tabIndex={0}
    >
      {/* Invisible hit area */}
      <circle cx={0} cy={0} r={size} fill="transparent" />

      {/* Workstream color ring */}
      <circle
        cx={0} cy={0} r={size * 0.55}
        fill="none"
        stroke={workstreamColor}
        strokeWidth={2}
        opacity={isHovered ? 0.7 : 0.35}
        style={{ transition: 'opacity 0.25s ease' }}
      />

      {/* Glow ring for special states */}
      {station.visual.glow !== 'none' && (
        <circle
          cx={0} cy={0} r={size * 0.7}
          fill="none" stroke={glowColor} strokeWidth={2}
          opacity={0.4}
          style={{
            animation: 'workstream-glow-pulse 2s ease-in-out infinite',
            ['--glow-color' as string]: glowColor,
          }}
        />
      )}

      {/* Hover glow */}
      {isHovered && (
        <circle
          cx={0} cy={0} r={size * 0.65}
          fill="none" stroke={fillColor} strokeWidth={4}
          opacity={0.25}
          filter="url(#neon-blur)"
        />
      )}

      {/* Inner group with hover scale */}
      <g style={{
        transform: `scale(${hoverScale})`,
        transformOrigin: '0 0',
        transition: 'transform 0.2s ease-out',
      }}>
        {renderShape(shape, size, fillColor, strokeColor)}
      </g>

      {/* Label - two lines for longer text */}
      {station.visual.labelVisible && (
        <text
          x={0}
          textAnchor="middle"
          fill="var(--vscode-foreground, #CBD5E1)"
          fontSize={9}
          fontFamily="var(--vscode-font-family)"
          style={{
            userSelect: 'none',
            letterSpacing: '0.01em',
            opacity: isHovered ? 1 : 0.75,
            transition: 'opacity 0.2s ease',
          }}
        >
          {station.label.length <= 18 ? (
            <tspan x={0} y={-size * 0.55 - 6}>{station.label}</tspan>
          ) : (() => {
            const words = station.label.split(/\s+/);
            let line1 = '';
            let line2 = '';
            for (const word of words) {
              if (!line1 || (line1 + ' ' + word).length <= 18) {
                line1 = line1 ? line1 + ' ' + word : word;
              } else {
                line2 = line2 ? line2 + ' ' + word : word;
              }
            }
            if (line2.length > 20) { line2 = line2.slice(0, 18) + '...'; }
            if (!line2 && line1.length > 18) {
              line2 = line1.slice(18);
              line1 = line1.slice(0, 18);
              if (line2.length > 20) { line2 = line2.slice(0, 18) + '...'; }
            }
            return (
              <>
                <tspan x={0} y={-size * 0.55 - 18}>{line1}</tspan>
                {line2 && <tspan x={0} dy={12}>{line2}</tspan>}
              </>
            );
          })()}
        </text>
      )}
    </g>
  );
});
