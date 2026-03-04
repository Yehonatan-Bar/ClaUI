import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { getModelMaxContext, getContextColor } from '../../utils/modelContextLimits';

const STORAGE_KEY = 'claui-context-widget-pos';
const WIDGET_WIDTH = 160;
const WIDGET_HEIGHT = 10;
const DEFAULT_MARGIN = 16;

interface WidgetPosition {
  left: number;
  top: number;
}

function clampPosition(pos: WidgetPosition): WidgetPosition {
  const maxLeft = Math.max(0, window.innerWidth - WIDGET_WIDTH);
  const maxTop = Math.max(0, window.innerHeight - WIDGET_HEIGHT);
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

export const ContextUsageWidget: React.FC = () => {
  // Force re-read from store every 5 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const { inputTokens: rawIn, outputTokens: rawOut, costUsd, totalCostUsd } = useAppStore.getState().cost;
  const model = useAppStore.getState().model;

  const maxCtx = getModelMaxContext(model ?? '');
  const inputTokens = rawIn ?? 0;
  const pct = maxCtx > 0 ? Math.min((inputTokens / maxCtx) * 100, 100) : 0;
  const barColor = getContextColor(pct);

  // Diagnostic logging for context bar debugging
  console.log(`%c[CTX-BAR] model=${model} rawIn=${rawIn} inputTokens=${inputTokens} maxCtx=${maxCtx} pct=${pct.toFixed(1)}% color=${barColor}`, 'color: #ff9800; font-weight: bold');

  const [position, setPosition] = useState<WidgetPosition | null>(loadPosition);
  const [dragging, setDragging] = useState(false);

  const widgetRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => prev ? clampPosition(prev) : null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  const computedLeft = position?.left ?? Math.max(0, window.innerWidth - WIDGET_WIDTH - DEFAULT_MARGIN);
  const computedTop = position?.top ?? Math.max(0, window.innerHeight - 40);

  return (
    <div
      ref={widgetRef}
      onMouseDown={handleMouseDown}
      data-tooltip={`Context: ${pct.toFixed(1)}%`}
      style={{
        position: 'fixed',
        left: computedLeft,
        top: computedTop,
        zIndex: 900,
        width: WIDGET_WIDTH,
        height: WIDGET_HEIGHT,
        borderRadius: 5,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: barColor,
        borderRadius: 5,
        transition: 'width 0.5s ease, background 0.5s ease',
      }} />
    </div>
  );
};
