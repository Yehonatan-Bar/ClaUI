import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ProjectSummaryEntry, ProjectHealth } from '../../../extension/types/workstreamTypes';
import { postToExtension } from '../../hooks/useClaudeStream';

const HEALTH_COLORS: Record<ProjectHealth, string> = {
  healthy: '#4ADE80',
  needs_attention: '#FACC15',
  blocked: '#F87171',
  stale: '#6B7280',
};

const STATUS_COLORS = {
  active: '#4A9EFF',
  blocked: '#F87171',
  completed: '#4ADE80',
  uncertain: '#FACC15',
};

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

function useLiveRelativeTime(dateStr: string): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);
  return relativeTime(dateStr);
}

interface ProjectCardProps {
  project: ProjectSummaryEntry;
  isCurrentWorkspace: boolean;
  onNavigate: () => void;
  onOpenCachedView?: (project: ProjectSummaryEntry) => void;
  index: number;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, isCurrentWorkspace, onNavigate, onOpenCachedView, index }) => {
  const [hovered, setHovered] = useState(false);
  const healthColor = HEALTH_COLORS[project.overallHealth];
  const isStale = project.overallHealth === 'stale';
  const isMissing = project.pathExists === false;
  const liveTime = useLiveRelativeTime(project.lastActivityAt);

  const handleClick = () => {
    if (isMissing) { return; }
    if (isCurrentWorkspace) {
      onNavigate();
    } else if (onOpenCachedView && project.cachedMapState) {
      onOpenCachedView(project);
    } else {
      postToExtension({ type: 'workstreamPortfolioOpenProject', projectPath: project.projectPath });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      style={{
        position: 'relative',
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${hovered ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)'}`,
        borderLeft: `3px solid ${healthColor}`,
        borderRadius: 10,
        padding: '14px 16px',
        cursor: isMissing ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        transform: hovered && !isMissing ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && !isMissing ? `0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px ${healthColor}20` : '0 2px 8px rgba(0, 0, 0, 0.15)',
        opacity: isMissing ? 0.4 : isStale ? 0.6 : 1,
        fontFamily: 'var(--vscode-font-family)',
      }}
    >
      {/* Header row: name + badges */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isStale ? 'none' : healthColor,
            border: isStale ? `1.5px solid ${healthColor}` : 'none',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--vscode-foreground, #E2E8F0)',
            letterSpacing: '0.01em',
          }}>
            {project.projectName}
          </span>
          {isMissing && (
            <span style={{ fontSize: 9, color: '#F87171', opacity: 0.8, fontWeight: 500 }} title="Project folder not found">
              (not found)
            </span>
          )}
          {!isCurrentWorkspace && !isMissing && (
            <span style={{ fontSize: 10, color: '#64748B', opacity: 0.7 }} title="Different workspace">
              &#x2197;
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {project.activeWorkstreams > 0 && (
            <Badge color={STATUS_COLORS.active} count={project.activeWorkstreams} label="active" />
          )}
          {project.blockedWorkstreams > 0 && (
            <Badge color={STATUS_COLORS.blocked} count={project.blockedWorkstreams} label="blocked" />
          )}
          {project.completedWorkstreams > 0 && (
            <Badge color={STATUS_COLORS.completed} count={project.completedWorkstreams} label="done" />
          )}
        </div>
      </div>

      {/* Mini subway lines */}
      <div style={{ marginBottom: 8, padding: '2px 0' }}>
        {project.topWorkstreams.length > 0 ? (
          project.topWorkstreams.slice(0, 3).map((ws, i) => (
            <MiniSubwayLine key={ws.id} workstream={ws} index={i} />
          ))
        ) : (
          <div style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>No workstreams classified</div>
        )}
      </div>

      {/* Footer: last activity */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 10,
        color: '#64748B',
      }}>
        <span>{liveTime}</span>
        {project.totalSessions > 0 && (
          <span>{project.totalSessions} session{project.totalSessions !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Hover tooltip with current state */}
      {hovered && project.currentStateSummary && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -4,
            transform: 'translateY(100%)',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            color: '#94A3B8',
            zIndex: 20,
            lineHeight: 1.4,
            maxWidth: 400,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ marginBottom: 4, color: '#CBD5E1', fontWeight: 500 }}>Current State</div>
          <div>{project.currentStateSummary}</div>
          {project.recommendedNextAction && (
            <div style={{ marginTop: 4, color: '#4A9EFF' }}>
              Next: {project.recommendedNextAction}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

const Badge: React.FC<{ color: string; count: number; label: string }> = ({ color, count, label }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 6px',
    borderRadius: 8,
    background: `${color}15`,
    border: `1px solid ${color}30`,
    fontSize: 9,
    fontWeight: 500,
    color,
  }}>
    {count} {label}
  </span>
);

const MiniSubwayLine: React.FC<{
  workstream: ProjectSummaryEntry['topWorkstreams'][number];
  index: number;
}> = ({ workstream, index }) => {
  const stationDots = Math.min(workstream.stationCount, 6);
  const lineWidth = 120;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    }}>
      <svg width={lineWidth} height={12} viewBox={`0 0 ${lineWidth} 12`}>
        <line
          x1={4} y1={6} x2={lineWidth - 4} y2={6}
          stroke={workstream.colorToken}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.6}
        />
        {Array.from({ length: stationDots }).map((_, i) => (
          <circle
            key={i}
            cx={4 + ((lineWidth - 8) / Math.max(stationDots - 1, 1)) * i}
            cy={6}
            r={2.5}
            fill={workstream.colorToken}
          />
        ))}
      </svg>
      <span style={{
        fontSize: 10,
        color: '#94A3B8',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: 180,
      }}>
        {workstream.label}
      </span>
    </div>
  );
};
