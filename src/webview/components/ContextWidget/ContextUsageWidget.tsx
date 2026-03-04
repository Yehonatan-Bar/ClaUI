import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { getModelMaxContext } from '../../utils/modelContextLimits';

const STORAGE_KEY = 'claui-context-widget-pos';
const BAR_WIDTH = 160;
const BAR_HEIGHT = 3;
const HOVER_PADDING_X = 12;
const HOVER_PADDING_Y = 8;
const HITBOX_WIDTH = BAR_WIDTH + (HOVER_PADDING_X * 2);
const HITBOX_HEIGHT = BAR_HEIGHT + (HOVER_PADDING_Y * 2);
const DEFAULT_MARGIN = 16;
const DEFAULT_BOTTOM_OFFSET = 36;

interface WidgetPosition {
  left: number;
  top: number;
}

function clampPosition(pos: WidgetPosition): WidgetPosition {
  const maxLeft = Math.max(0, window.innerWidth - HITBOX_WIDTH);
  const maxTop = Math.max(0, window.innerHeight - HITBOX_HEIGHT);
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

  const { inputTokens: rawIn } = useAppStore.getState().cost;
  const model = useAppStore.getState().model;

  const maxCtx = getModelMaxContext(model ?? '');
  const inputTokens = rawIn ?? 0;
  const pct = maxCtx > 0 ? Math.min((inputTokens / maxCtx) * 100, 100) : 0;

  // Diagnostic logging for context bar debugging
  console.log(`%c[CTX-BAR] model=${model} rawIn=${rawIn} inputTokens=${inputTokens} maxCtx=${maxCtx} pct=${pct.toFixed(1)}%`, 'color: #ff9800; font-weight: bold');

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

  const [hovered, setHovered] = useState(false);

  const computedLeft = position?.left ?? Math.max(0, window.innerWidth - HITBOX_WIDTH - DEFAULT_MARGIN);
  const computedTop = position?.top ?? Math.max(0, window.innerHeight - HITBOX_HEIGHT - DEFAULT_BOTTOM_OFFSET);

  return (
    <div
      ref={widgetRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        left: computedLeft,
        top: computedTop,
        zIndex: 900,
        width: HITBOX_WIDTH,
        height: HITBOX_HEIGHT,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/* Track background */}
      <div
        style={{
          position: 'absolute',
          left: HOVER_PADDING_X,
          top: HOVER_PADDING_Y,
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.14)',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {/* Fill bar - gradient applied directly via background-size */}
        <div
          style={{
            width: `${pct}%`,
            minWidth: pct > 0 ? 1 : 0,
            height: '100%',
            borderRadius: 999,
            backgroundImage: 'linear-gradient(90deg, #3794ff 0%, #41b5ff 35%, #63c97a 62%, #d29922 82%, #f85149 100%)',
            backgroundSize: `${BAR_WIDTH}px ${BAR_HEIGHT}px`,
            backgroundRepeat: 'no-repeat',
            transition: 'width 0.65s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>

      {/* Tooltip on hover */}
      {hovered && !dragging && (
        <div
          style={{
            position: 'absolute',
            left: HOVER_PADDING_X + BAR_WIDTH / 2,
            transform: 'translateX(-50%)',
            bottom: HITBOX_HEIGHT + 4,
            background: 'var(--vscode-editorWidget-background, #252526)',
            border: '1px solid var(--vscode-editorWidget-border, #454545)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 11,
            lineHeight: 1.4,
            color: 'var(--vscode-editorWidget-foreground, #cccccc)',
            whiteSpace: 'nowrap' as const,
            pointerEvents: 'none' as const,
            boxShadow: '0 2px 8px rgba(0,0,0,0.36)',
            zIndex: 10001,
          }}
        >
          {`Context: ${pct.toFixed(1)}%`}
        </div>
      )}
    </div>
  );
};
