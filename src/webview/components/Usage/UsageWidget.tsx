import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { UsageStat } from '../../../extension/types/webview-messages';

const STORAGE_KEY = 'claui-usage-pos';
const WIDGET_WIDTH = 200;

function clampPosition(top: number, right: number): { top: number; right: number } {
  const maxTop = Math.max(0, window.innerHeight - 100);
  const maxRight = Math.max(0, window.innerWidth - WIDGET_WIDTH);
  return {
    top: Math.max(0, Math.min(top, maxTop)),
    right: Math.max(0, Math.min(right, maxRight)),
  };
}

function loadPosition(): { top: number; right: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const pos = JSON.parse(raw);
      if (typeof pos.top === 'number' && typeof pos.right === 'number') {
        return clampPosition(pos.top, pos.right);
      }
    }
  } catch { /* ignore */ }
  return null;
}

function savePosition(top: number, right: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ top, right }));
  } catch { /* ignore */ }
}

/** Reset the Usage widget to its default position (top-right corner) */
export function resetUsageWidgetPosition(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

function getBarColor(percentage: number): string {
  if (percentage > 75) return '#f85149';   // red
  if (percentage > 50) return '#d29922';   // yellow
  return '#3fb950';                         // green
}

function formatTimeAgo(fetchedAt: number | null): string {
  if (!fetchedAt) return '';
  const diffMs = Date.now() - fetchedAt;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

interface UsageBarProps {
  stat: UsageStat;
}

const UsageBar: React.FC<UsageBarProps> = ({ stat }) => {
  const color = getBarColor(stat.percentage);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.2 }}>
          {stat.label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color, marginLeft: 6, whiteSpace: 'nowrap' }}>
          {stat.percentage}%
        </span>
      </div>
      <div style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 3,
        height: 6,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(stat.percentage, 100)}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.4s ease',
        }} />
      </div>
      {stat.resetsAt && (
        <div style={{ fontSize: 9, color: 'var(--vscode-descriptionForeground)', opacity: 0.65, marginTop: 2 }}>
          Resets {stat.resetsAt}
        </div>
      )}
    </div>
  );
};

export const UsageWidget: React.FC = () => {
  const usageStats = useAppStore((s) => s.usageStats);
  const usageFetchedAt = useAppStore((s) => s.usageFetchedAt);
  const usageError = useAppStore((s) => s.usageError);

  const saved = loadPosition();
  const [pos, setPos] = useState({ top: saved?.top ?? 60, right: saved?.right ?? 16 });
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number; startY: number;
    startTop: number; startRight: number;
    moved: boolean;
  } | null>(null);

  // Track when data arrives so we can clear the loading state
  const prevFetchedAt = useRef(usageFetchedAt);
  useEffect(() => {
    if (usageFetchedAt !== prevFetchedAt.current) {
      prevFetchedAt.current = usageFetchedAt;
      setLoading(false);
    }
  }, [usageFetchedAt]);

  // Re-clamp position on window resize
  useEffect(() => {
    const onResize = () => {
      setPos((cur) => clampPosition(cur.top, cur.right));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    postToExtension({ type: 'requestUsage' });
  }, []);

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: pos.top,
      startRight: pos.right,
      moved: false,
    };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (!d.moved) {
        d.moved = true;
        setIsDragging(true);
      }
      const clamped = clampPosition(d.startTop + dy, d.startRight - dx);
      setPos(clamped);
    };
    const onMouseUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (d.moved) {
        setPos((cur) => { savePosition(cur.top, cur.right); return cur; });
      }
      dragRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const hasData = usageStats.length > 0;

  return (
    <div
      ref={widgetRef}
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        zIndex: 900,
        background: 'var(--vscode-sideBar-background, #1e1e1e)',
        border: '1px solid var(--vscode-panel-border, rgba(255,255,255,0.15))',
        borderRadius: 8,
        padding: '10px 12px',
        width: WIDGET_WIDTH,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {/* Draggable header row */}
      <div
        onMouseDown={onMouseDown}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10,
            color: 'var(--vscode-descriptionForeground)',
            opacity: 0.4,
            letterSpacing: 1,
            lineHeight: 1,
          }}>
            {'\u2847'}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--vscode-foreground)' }}>
            Usage Data
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {usageFetchedAt && (
            <span style={{ fontSize: 9, color: 'var(--vscode-descriptionForeground)', opacity: 0.6 }}>
              {formatTimeAgo(usageFetchedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            data-tooltip="Refresh usage data"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--vscode-descriptionForeground)',
              cursor: loading ? 'wait' : 'pointer',
              fontSize: 13,
              padding: '0 2px',
              lineHeight: 1,
              opacity: loading ? 0.4 : 0.8,
            }}
          >
            {'\u21BB'}
          </button>
        </div>
      </div>

      {/* Content */}
      {loading && !hasData ? (
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', textAlign: 'center', padding: '8px 0' }}>
          Loading...
        </div>
      ) : usageError && !hasData ? (
        <div style={{ fontSize: 10, color: '#f85149', lineHeight: 1.4 }}>
          {usageError}
        </div>
      ) : hasData ? (
        usageStats.map((stat, i) => <UsageBar key={i} stat={stat} />)
      ) : (
        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', textAlign: 'center', padding: '8px 0' }}>
          Click {'\u21BB'} to load usage
        </div>
      )}
    </div>
  );
};
