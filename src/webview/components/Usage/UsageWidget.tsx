import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { UsageStat } from '../../../extension/types/webview-messages';

const STORAGE_KEY = 'claui-usage-pos';
const WIDGET_WIDTH = 200;
const DEFAULT_MARGIN = 16;
const DEFAULT_TOP = 60;

interface WidgetPosition {
  left: number;
  top: number;
}

function clampPosition(pos: WidgetPosition): WidgetPosition {
  const maxLeft = Math.max(0, window.innerWidth - WIDGET_WIDTH);
  const maxTop = Math.max(0, window.innerHeight - 80);
  return {
    left: Math.max(0, Math.min(pos.left, maxLeft)),
    top: Math.max(0, Math.min(pos.top, maxTop)),
  };
}

function loadPosition(): WidgetPosition | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      return clampPosition(pos);
    }
  } catch { /* ignore */ }
  return null;
}

function savePosition(pos: WidgetPosition): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
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

  // Position defaults to top-right corner; loaded from localStorage if available
  const [position, setPosition] = useState<WidgetPosition | null>(loadPosition);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

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
      setPosition((prev) => prev ? clampPosition(prev) : null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Attach document mousemove/mouseup only while dragging (same pattern as AdventureWidget)
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const newLeft = e.clientX - dragOffset.current.x;
      const newTop = e.clientY - dragOffset.current.y;
      setPosition(clampPosition({ left: newLeft, top: newTop }));
    };

    const handleUp = (e: MouseEvent) => {
      const newLeft = e.clientX - dragOffset.current.x;
      const newTop = e.clientY - dragOffset.current.y;
      const clamped = clampPosition({ left: newLeft, top: newTop });
      setPosition(clamped);
      savePosition(clamped);
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = widgetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    e.preventDefault();
  }, []);

  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    postToExtension({ type: 'requestUsage' });
  }, []);

  const hasData = usageStats.length > 0;

  // Compute left/top: if no saved position, default to top-right corner
  const computedLeft = position?.left ?? Math.max(0, window.innerWidth - WIDGET_WIDTH - DEFAULT_MARGIN);
  const computedTop = position?.top ?? DEFAULT_TOP;

  return (
    <div
      ref={widgetRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        left: computedLeft,
        top: computedTop,
        zIndex: 900,
        background: 'var(--vscode-sideBar-background, #1e1e1e)',
        border: '1px solid var(--vscode-panel-border, rgba(255,255,255,0.15))',
        borderRadius: 8,
        padding: '10px 12px',
        width: WIDGET_WIDTH,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
      }}>
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
