import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type {
  MapLayout,
  ProjectMapState,
  ProjectSummaryEntry,
  Station,
  Workstream,
} from '../../../extension/types/workstreamTypes';
import { computeLayout } from './layout';
import { getLineDashArray, getStationShape, getStationSize, GLOW_COLORS, STATUS_COLORS } from './visualEncoding';
import { pulseKeyframes } from './animations';
import { SplitJunction } from './SplitJunction';
import { MergeJunction } from './MergeJunction';
import { postToExtension } from '../../hooks/useClaudeStream';

const HEALTH_COLORS = {
  healthy: '#4ADE80',
  needs_attention: '#FACC15',
  blocked: '#F87171',
  stale: '#6B7280',
};

interface PortfolioProjectMapProps {
  project: ProjectSummaryEntry;
  isCurrentWorkspace: boolean;
  index: number;
  onNavigate: () => void;
  onOpenCachedView: (project: ProjectSummaryEntry) => void;
}

export const PortfolioProjectMap: React.FC<PortfolioProjectMapProps> = ({
  project,
  isCurrentWorkspace,
  index,
  onNavigate,
  onOpenCachedView,
}) => {
  const isMissing = project.pathExists === false;
  const isDimmed = isMissing || project.overallHealth === 'stale';
  const mapState = project.cachedMapState;
  const projectCode = `P${String(index + 1).padStart(2, '0')}`;
  const liveTime = relativeTime(project.lastActivityAt);

  const handleOpen = () => {
    if (isMissing) { return; }
    if (isCurrentWorkspace) {
      onNavigate();
    } else if (project.cachedMapState) {
      onOpenCachedView(project);
    } else {
      postToExtension({ type: 'workstreamPortfolioOpenProject', projectPath: project.projectPath });
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      style={{
        borderTop: index === 0 ? 'none' : '1px solid rgba(148, 163, 184, 0.12)',
        background: index % 2 === 0 ? 'rgba(15, 23, 42, 0.28)' : 'rgba(2, 6, 23, 0.2)',
        opacity: isDimmed ? 0.62 : 1,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        padding: '14px 20px 10px',
        borderLeft: `3px solid ${HEALTH_COLORS[project.overallHealth]}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            color: HEALTH_COLORS[project.overallHealth],
            padding: '2px 7px',
            borderRadius: 6,
            background: `${HEALTH_COLORS[project.overallHealth]}16`,
            border: `1px solid ${HEALTH_COLORS[project.overallHealth]}33`,
            letterSpacing: 0,
          }}>
            {projectCode}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{
                fontSize: 13,
                fontWeight: 650,
                color: 'var(--vscode-foreground, #E2E8F0)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {project.projectName}
              </span>
              {isCurrentWorkspace && <ProjectPill label="current" color="#4A9EFF" />}
              {isMissing && <ProjectPill label="not found" color="#F87171" />}
            </div>
            <div style={{
              marginTop: 3,
              fontSize: 10,
              color: '#64748B',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 'min(62vw, 720px)',
            }}>
              {shortPath(project.projectPath)} - {liveTime}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ProjectPill label={`${project.totalWorkstreams} streams`} color="#94A3B8" />
          {project.activeWorkstreams > 0 && <ProjectPill label={`${project.activeWorkstreams} active`} color={STATUS_COLORS.active} />}
          {project.blockedWorkstreams > 0 && <ProjectPill label={`${project.blockedWorkstreams} blocked`} color={STATUS_COLORS.blocked} />}
          {project.uncertainWorkstreams > 0 && <ProjectPill label={`${project.uncertainWorkstreams} uncertain`} color={STATUS_COLORS.uncertain} />}
          <button
            onClick={handleOpen}
            disabled={isMissing}
            style={{
              background: isMissing ? 'rgba(51, 65, 85, 0.28)' : 'rgba(51, 65, 85, 0.55)',
              color: isMissing ? '#64748B' : '#CBD5E1',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: isMissing ? 'not-allowed' : 'pointer',
              fontSize: 10,
              fontFamily: 'inherit',
            }}
            title={isCurrentWorkspace ? 'Open live project map' : 'Open project'}
          >
            Open
          </button>
        </div>
      </div>

      {mapState ? (
        <PortfolioMapCanvas
          state={mapState}
          domIdPrefix={makeDomId(`${project.projectId}-${index}`)}
          dimmed={isDimmed}
        />
      ) : (
        <PortfolioSnapshotFallback project={project} isMissing={isMissing} onOpen={handleOpen} />
      )}
    </motion.section>
  );
};

const PortfolioMapCanvas: React.FC<{
  state: ProjectMapState;
  domIdPrefix: string;
  dimmed: boolean;
}> = ({ state, domIdPrefix, dimmed }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const layout: MapLayout = useMemo(() => computeLayout(state, {
    includeCollapsed: true,
    maxVisibleLanes: Number.POSITIVE_INFINITY,
  }), [state]);

  const visibleStations = useMemo(() =>
    state.stations.filter(station => layout.stationPositions[station.id]),
    [state.stations, layout.stationPositions]
  );

  const stationIndexMap = useMemo(() => {
    const sorted = visibleStations
      .map(station => ({ id: station.id, x: layout.stationPositions[station.id]?.x ?? 0 }))
      .sort((a, b) => a.x - b.x);
    const map: Record<string, number> = {};
    sorted.forEach((station, i) => { map[station.id] = i; });
    return map;
  }, [visibleStations, layout.stationPositions]);

  const width = Math.max(layout.bounds.width, 860);
  const height = Math.max(layout.bounds.height, 150);

  return (
    <div style={{
      overflowX: 'auto',
      overflowY: 'hidden',
      padding: '0 20px 16px',
    }}>
      <style>{pulseKeyframes()}</style>
      <div style={{
        position: 'relative',
        width,
        minWidth: '100%',
        height,
      }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block' }}
          aria-label={`Workstream map for ${state.projectLabel}`}
        >
          <defs>
            <pattern id={`${domIdPrefix}-dots`} width={24} height={24} patternUnits="userSpaceOnUse">
              <circle cx={12} cy={12} r={0.6} fill="rgba(148, 163, 184, 0.11)" />
            </pattern>
            <filter id={`${domIdPrefix}-neon-blur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id={`${domIdPrefix}-blur-filter`}>
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
          </defs>

          <rect width="100%" height="100%" fill="var(--vscode-editor-background)" opacity={0.82} />
          <rect width="100%" height="100%" fill={`url(#${domIdPrefix}-dots)`} />

          <g opacity={dimmed ? 0.58 : 1}>
            {state.workstreams
              .filter(workstream => layout.workstreamPaths[workstream.id])
              .map((workstream, lineIndex) => (
                <PortfolioWorkstreamLine
                  key={workstream.id}
                  workstream={workstream}
                  pathDef={layout.workstreamPaths[workstream.id]}
                  labelPosition={layout.labelPositions[workstream.id] ?? { x: 0, y: 0 }}
                  index={lineIndex}
                  domIdPrefix={domIdPrefix}
                  hovered={hoveredId === `workstream:${workstream.id}`}
                  onHover={hovering => setHoveredId(hovering ? `workstream:${workstream.id}` : null)}
                />
              ))}

            {state.splits.map(split => {
              const pos = layout.junctionPositions[split.id];
              if (!pos) { return null; }
              return <SplitJunction key={`split-${split.id}`} split={split} x={pos.x} y={pos.y} scale={0.88} />;
            })}

            {state.merges.map(merge => {
              const pos = layout.junctionPositions[merge.id];
              if (!pos) { return null; }
              return <MergeJunction key={`merge-${merge.id}`} merge={merge} x={pos.x} y={pos.y} scale={0.88} />;
            })}

            {visibleStations.map(station => {
              const pos = layout.stationPositions[station.id];
              const parentWs = state.workstreams.find(workstream => workstream.id === station.workstreamId);
              return (
                <PortfolioStationNode
                  key={station.id}
                  station={station}
                  x={pos.x}
                  y={pos.y}
                  globalIndex={stationIndexMap[station.id] ?? 0}
                  workstreamColor={parentWs?.visual.colorToken ?? '#64748B'}
                  hovered={hoveredId === `station:${station.id}`}
                  onHover={hovering => setHoveredId(hovering ? `station:${station.id}` : null)}
                />
              );
            })}
          </g>
        </svg>

        <PortfolioMapTooltip state={state} layout={layout} hoveredId={hoveredId} />
      </div>
    </div>
  );
};

const PortfolioWorkstreamLine: React.FC<{
  workstream: Workstream;
  pathDef: MapLayout['workstreamPaths'][string];
  labelPosition: { x: number; y: number };
  index: number;
  domIdPrefix: string;
  hovered: boolean;
  onHover: (hovering: boolean) => void;
}> = ({ workstream, pathDef, labelPosition, index, domIdPrefix, hovered, onHover }) => {
  const dashArray = getLineDashArray(pathDef.texture);
  const baseThickness = Math.max(3, pathDef.thickness);
  const lineFilter = pathDef.texture === 'blurred' ? `url(#${domIdPrefix}-blur-filter)` : undefined;
  const lineOpacity = hovered ? 1 : pathDef.opacity;
  const labelLines = splitLabel(workstream.label, 22);

  return (
    <g
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ cursor: 'default' }}
    >
      <path d={pathDef.d} fill="none" stroke="transparent" strokeWidth={baseThickness + 12} />
      <path
        d={pathDef.d}
        fill="none"
        stroke={pathDef.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={baseThickness + 6}
        filter={`url(#${domIdPrefix}-neon-blur)`}
        opacity={hovered || workstream.status === 'active' || workstream.status === 'blocked' ? 0.14 : 0}
      />
      <motion.path
        d={pathDef.d}
        fill="none"
        stroke={pathDef.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray || undefined}
        filter={lineFilter}
        initial={{ pathLength: dashArray ? 1 : 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: lineOpacity, strokeWidth: hovered ? baseThickness + 1 : baseThickness }}
        transition={{
          pathLength: dashArray ? { duration: 0 } : { duration: 1.1, delay: index * 0.06, ease: [0.33, 1, 0.68, 1] },
          opacity: { duration: 0.25 },
          strokeWidth: { duration: 0.2 },
        }}
      />
      {workstream.confidence < 0.5 && (
        <circle cx={labelPosition.x - 8} cy={labelPosition.y} r={3} fill="#FACC15" opacity={0.8} />
      )}
      {workstream.visual.needsAttention && (
        <circle
          cx={labelPosition.x - 8}
          cy={workstream.confidence < 0.5 ? labelPosition.y - 10 : labelPosition.y}
          r={3}
          fill="#F87171"
          opacity={0.9}
        />
      )}
      <text
        x={labelPosition.x}
        textAnchor="start"
        fill={pathDef.color}
        fontSize={11}
        fontWeight={hovered ? 700 : 500}
        fontFamily="var(--vscode-font-family)"
        style={{
          userSelect: 'none',
          letterSpacing: 0,
          opacity: hovered ? 1 : 0.86,
        }}
      >
        {labelLines.map((line, lineIndex) => (
          <tspan
            key={lineIndex}
            x={labelPosition.x}
            y={labelLines.length > 1
              ? labelPosition.y + (lineIndex === 0 ? -7 : 7)
              : labelPosition.y}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
};

const PortfolioStationNode: React.FC<{
  station: Station;
  x: number;
  y: number;
  globalIndex: number;
  workstreamColor: string;
  hovered: boolean;
  onHover: (hovering: boolean) => void;
}> = ({ station, x, y, globalIndex, workstreamColor, hovered, onHover }) => {
  const shape = getStationShape(station.type);
  const size = getStationSize(station.visual.size);
  const glowColor = GLOW_COLORS[station.visual.glow];
  const labelLines = splitLabel(station.label, 18);
  const fillColor = station.status === 'failed' ? '#F87171'
    : station.status === 'pending' ? '#64748B'
    : station.status === 'partial' ? '#FACC15'
    : '#CBD5E1';
  const strokeColor = station.status === 'completed' ? '#4ADE80' : '#475569';

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        cursor: 'default',
        opacity: 0,
        animation: `station-enter 0.28s ease-out ${0.2 + globalIndex * 0.025}s forwards`,
      }}
    >
      <circle cx={0} cy={0} r={size} fill="transparent" />
      <circle
        cx={0}
        cy={0}
        r={size * 0.55}
        fill="none"
        stroke={workstreamColor}
        strokeWidth={2}
        opacity={hovered ? 0.75 : 0.36}
      />
      {station.visual.glow !== 'none' && (
        <circle cx={0} cy={0} r={size * 0.7} fill="none" stroke={glowColor} strokeWidth={2} opacity={0.35} />
      )}
      {hovered && (
        <circle cx={0} cy={0} r={size * 0.72} fill="none" stroke={fillColor} strokeWidth={4} opacity={0.22} />
      )}
      <g style={{
        transform: hovered ? 'scale(1.2)' : 'scale(1)',
        transformOrigin: '0 0',
        transition: 'transform 0.2s ease-out',
      }}>
        {renderStationShape(shape, size, fillColor, strokeColor)}
      </g>
      {station.visual.labelVisible && (
        <text
          x={0}
          textAnchor="middle"
          fill="var(--vscode-foreground, #CBD5E1)"
          fontSize={9}
          fontFamily="var(--vscode-font-family)"
          style={{ userSelect: 'none', letterSpacing: 0, opacity: hovered ? 1 : 0.72 }}
        >
          {labelLines.map((line, lineIndex) => (
            <tspan
              key={lineIndex}
              x={0}
              y={-size * 0.55 - (labelLines.length > 1 ? 18 : 6) + lineIndex * 12}
            >
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
};

const PortfolioMapTooltip: React.FC<{
  state: ProjectMapState;
  layout: MapLayout;
  hoveredId: string | null;
}> = ({ state, layout, hoveredId }) => {
  if (!hoveredId) { return null; }

  if (hoveredId.startsWith('workstream:')) {
    const id = hoveredId.slice('workstream:'.length);
    const workstream = state.workstreams.find(ws => ws.id === id);
    const pos = workstream ? layout.labelPositions[workstream.id] : null;
    if (!workstream || !pos) { return null; }
    return (
      <div style={tooltipStyle(pos.x + 34, pos.y - 12)}>
        <div style={{ fontWeight: 650, marginBottom: 2 }}>{workstream.label}</div>
        <div style={{ color: '#94A3B8', fontSize: 10, marginBottom: 4 }}>{workstream.goal}</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748B' }}>
          <span>Status: <span style={{ color: '#CBD5E1' }}>{workstream.status}</span></span>
          <span>{workstream.source === 'external_folder' ? 'Docs' : 'Sessions'}: <span style={{ color: '#CBD5E1' }}>{workstream.source === 'external_folder' ? (workstream.sourceDocumentCount ?? workstream.sourceFilePaths?.length ?? 0) : workstream.sessionIds.length}</span></span>
          <span>Confidence: <span style={{ color: '#CBD5E1' }}>{Math.round(workstream.confidence * 100)}%</span></span>
        </div>
      </div>
    );
  }

  if (hoveredId.startsWith('station:')) {
    const id = hoveredId.slice('station:'.length);
    const station = state.stations.find(item => item.id === id);
    const pos = station ? layout.stationPositions[station.id] : null;
    if (!station || !pos) { return null; }
    return (
      <div style={tooltipStyle(pos.x + 18, pos.y - 12)}>
        <div style={{ fontWeight: 650, marginBottom: 2 }}>{station.label}</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{station.description}</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748B', marginTop: 4 }}>
          <span>Type: <span style={{ color: '#CBD5E1' }}>{station.type}</span></span>
          <span>Status: <span style={{ color: '#CBD5E1' }}>{station.status}</span></span>
          <span>{new Date(station.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
    );
  }

  return null;
};

const ProjectPill: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 18,
    padding: '1px 7px',
    borderRadius: 8,
    background: `${color}14`,
    border: `1px solid ${color}2c`,
    color,
    fontSize: 9,
    fontWeight: 550,
    whiteSpace: 'nowrap',
  }}>
    {label}
  </span>
);

const PortfolioSnapshotFallback: React.FC<{
  project: ProjectSummaryEntry;
  isMissing: boolean;
  onOpen: () => void;
}> = ({ project, isMissing, onOpen }) => (
  <div style={{
    padding: '10px 20px 18px',
    color: '#64748B',
    fontSize: 11,
  }}>
    <div style={{
      border: '1px dashed rgba(148, 163, 184, 0.18)',
      borderRadius: 6,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <span>
        Full map snapshot unavailable for {project.projectName}.
      </span>
      {!isMissing && (
        <button
          onClick={onOpen}
          data-tooltip="Open this project"
          style={{
            background: 'rgba(51, 65, 85, 0.55)',
            color: '#CBD5E1',
            border: '1px solid rgba(255, 255, 255, 0.09)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          Open
        </button>
      )}
    </div>
  </div>
);

function renderStationShape(shape: string, size: number, fill: string, stroke: string): JSX.Element {
  const r = size / 2;
  switch (shape) {
    case 'diamond':
      return <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    case 'square':
      return <rect x={-r} y={-r} width={size} height={size} fill={fill} stroke={stroke} strokeWidth={1.5} rx={2} />;
    case 'triangle':
      return <polygon points={`0,${-r} ${r},${r * 0.8} ${-r},${r * 0.8}`} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    case 'star': {
      const points = Array.from({ length: 10 }, (_, i) => {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.4;
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
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
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

function splitLabel(label: string, maxLineLength: number): string[] {
  if (label.length <= maxLineLength) { return [label]; }
  const words = label.split(/\s+/);
  let first = '';
  let second = '';
  for (const word of words) {
    if (!second && (!first || `${first} ${word}`.trim().length <= maxLineLength)) {
      first = first ? `${first} ${word}` : word;
    } else {
      second = second ? `${second} ${word}` : word;
    }
  }
  if (!second && first.length > maxLineLength) {
    second = first.slice(maxLineLength);
    first = first.slice(0, maxLineLength);
  }
  if (second.length > maxLineLength + 2) {
    second = `${second.slice(0, maxLineLength)}...`;
  }
  return second ? [first, second] : [first];
}

function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) { return 'just now'; }
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  const days = Math.floor(hours / 24);
  if (days < 7) { return `${days}d ago`; }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) { return `${weeks}w ago`; }
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function shortPath(projectPath: string): string {
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) { return projectPath; }
  return `.../${parts.slice(-2).join('/')}`;
}

function makeDomId(value: string): string {
  return `portfolio-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function tooltipStyle(x: number, y: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    background: 'rgba(15, 23, 42, 0.96)',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: '8px 12px',
    maxWidth: 300,
    pointerEvents: 'none',
    zIndex: 20,
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 11,
    color: '#E2E8F0',
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
  };
}
