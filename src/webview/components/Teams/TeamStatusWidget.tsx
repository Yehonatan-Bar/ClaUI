import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { AGENT_STATUS_COLORS } from './teamColors';

const STORAGE_KEY = 'claui-team-widget-pos';

function loadPos(): { top: number; left: number } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* fallback */ }
  return { top: 8, left: 8 };
}

export const TeamStatusWidget: React.FC = () => {
  const { teamName, teamConfig, teamAgentStatuses, teamTasks, setTeamPanelOpen } = useAppStore();
  const [pos, setPos] = useState(loadPos);
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
  const didDragRef = useRef(false);

  const members = teamConfig?.members || [];
  const workingCount = Object.values(teamAgentStatuses).filter(s => s === 'working').length;
  const idleCount = Object.values(teamAgentStatuses).filter(s => s === 'idle').length;
  const totalTasks = teamTasks.length;
  const completedTasks = teamTasks.filter(t => t.status === 'completed').length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    didDragRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: pos.top,
      startLeft: pos.left,
    };
  }, [pos]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      didDragRef.current = true;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newPos = {
        top: Math.max(0, dragRef.current.startTop + dy),
        left: Math.max(0, dragRef.current.startLeft + dx),
      };
      setPos(newPos);
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
        dragRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pos]);

  const handleClick = () => {
    if (didDragRef.current) return;
    setTeamPanelOpen(true);
  };

  if (minimized) {
    return (
      <div
        onMouseDown={handleMouseDown}
        onClick={() => { if (!didDragRef.current) setMinimized(false); }}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 900,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '50%',
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          fontSize: 12,
          color: '#58a6ff',
        }}
        data-tooltip={`Team: ${teamName}`}
      >
        T
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 900,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        minWidth: 160,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span
          onClick={handleClick}
          style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', cursor: 'pointer' }}
        >
          {teamName || 'Team'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#484f58',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
        >
          _
        </button>
      </div>

      <div onClick={handleClick} style={{ cursor: 'pointer' }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
          {members.length} agents
          <span style={{ margin: '0 4px', color: '#30363d' }}>|</span>
          <span style={{ color: AGENT_STATUS_COLORS.working }}>{workingCount} working</span>
          <span style={{ margin: '0 4px', color: '#30363d' }}>|</span>
          <span style={{ color: AGENT_STATUS_COLORS.idle }}>{idleCount} idle</span>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 4,
          background: '#21262d',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            background: progressPct === 100 ? '#3fb950' : '#58a6ff',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ fontSize: 10, color: '#484f58', marginTop: 2, textAlign: 'right' }}>
          {completedTasks}/{totalTasks} tasks
        </div>
      </div>
    </div>
  );
};
