import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { getModelMaxContext, getContextColor } from '../../utils/modelContextLimits';

const STORAGE_KEY = 'claui-context-widget-pos';
const WIDGET_WIDTH = 220;
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

/** Reset the Context widget to its default position */
export function resetContextWidgetPosition(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const ContextUsageWidget: React.FC = () => {
  const cost = useAppStore((s) => s.cost);
  const model = useAppStore((s) => s.model);

  const maxCtx = getModelMaxContext(model ?? '');
  const inputTokens = cost.inputTokens ?? 0;
  const pct = maxCtx > 0 ? Math.min((inputTokens / maxCtx) * 100, 100) : 0;
  const barColor = getContextColor(pct);

  const [position, setPosition] = useState<WidgetPosition | null>(loadPosition);
  const [dragging, setDragging] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Re-clamp on window resize
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => prev ? clampPosition(prev) : null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Document-level drag handlers, only active while dragging
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

  // Default position: bottom-right corner (distinct from UsageWidget at top-right)
  const computedLeft = position?.left ?? Math.max(0, window.innerWidth - WIDGET_WIDTH - DEFAULT_MARGIN);
  const computedTop = position?.top ?? Math.max(0, window.innerHeight - 130 - DEFAULT_TOP);

  const hasSession = inputTokens > 0;

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
        border: `1px solid ${hasSession ? barColor + '55' : 'var(--vscode-panel-border, rgba(255,255,255,0.15))'}`,
        borderRadius: 8,
        padding: '10px 12px',
        width: WIDGET_WIDTH,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10,
            color: 'var(--vscode-descriptionForeground)',
            opacity: 0.4,
            letterSpacing: 1,
          }}>
            {'\u2847'}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--vscode-foreground)' }}>
            Context
          </span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: hasSession ? barColor : 'var(--vscode-descriptionForeground)' }}>
          {hasSession ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 3,
        height: 7,
        overflow: 'hidden',
        marginBottom: 7,
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: barColor,
          borderRadius: 3,
          transition: 'width 0.5s ease, background 0.5s ease',
        }} />
      </div>

      {/* Token counts */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        color: 'var(--vscode-descriptionForeground)',
        opacity: 0.75,
      }}>
        <span>{hasSession ? formatTokens(inputTokens) : '—'}</span>
        <span>/ {formatTokens(maxCtx)}</span>
      </div>

      {/* Model name */}
      {model && (
        <div style={{
          marginTop: 6,
          fontSize: 9,
          color: 'var(--vscode-descriptionForeground)',
          opacity: 0.45,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {model}
        </div>
      )}
    </div>
  );
};
