import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { AdventureEngine } from './adventure/AdventureEngine';

const STORAGE_KEY = 'adventure-widget-position';
const ACTIVITY_GRACE_MS = 2500;

interface WidgetPosition {
  left: number;
  top: number;
}

function loadPosition(): WidgetPosition | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.left === 'number' && typeof pos.top === 'number') return pos;
  } catch { /* ignore */ }
  return null;
}

function savePosition(pos: WidgetPosition): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}

/**
 * Floating pixel-art dungeon crawler widget.
 * Visualizes Claude Code session activity as a roguelike adventure.
 * Draggable to any position on screen; position persists across reloads.
 */
export const AdventureWidget: React.FC = React.memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AdventureEngine | null>(null);
  const lastTurnIndex = useRef(-1);
  const [tooltip, setTooltip] = React.useState<string | null>(null);

  const adventureBeats = useAppStore((s) => s.adventureBeats);
  const isBusy = useAppStore((s) => s.isBusy);
  const lastActivityAt = useAppStore((s) => s.lastActivityAt);
  const [hasRecentActivity, setHasRecentActivity] = useState(false);

  // Drag state
  const [position, setPosition] = useState<WidgetPosition | null>(loadPosition);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);

  // Initialize engine on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    engineRef.current = new AdventureEngine(canvas);

    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // Feed new beats to the engine
  useEffect(() => {
    if (!engineRef.current) return;

    if (adventureBeats.length === 0) {
      lastTurnIndex.current = -1;
      return;
    }

    const newBeats = adventureBeats.filter((beat) => beat.turnIndex > lastTurnIndex.current);
    for (const beat of newBeats) {
      engineRef.current.addBeat(beat);
      lastTurnIndex.current = Math.max(lastTurnIndex.current, beat.turnIndex);
    }
  }, [adventureBeats]);

  useEffect(() => {
    if (!lastActivityAt) return;

    setHasRecentActivity(true);
    const timeoutId = window.setTimeout(() => {
      setHasRecentActivity(false);
    }, ACTIVITY_GRACE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lastActivityAt]);

  // Signal active/idle
  useEffect(() => {
    const isActive = isBusy || hasRecentActivity;
    engineRef.current?.setBusy(isActive);
  }, [isBusy, hasRecentActivity]);

  // --- Drag handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button
    if (e.button !== 0) return;
    const el = widgetRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const newLeft = e.clientX - dragOffset.current.x;
      const newTop = e.clientY - dragOffset.current.y;
      setPosition({ left: newLeft, top: newTop });
    };

    const handleUp = (e: MouseEvent) => {
      setDragging(false);
      const newLeft = e.clientX - dragOffset.current.x;
      const newTop = e.clientY - dragOffset.current.y;
      const clamped = clampPosition({ left: newLeft, top: newTop });
      setPosition(clamped);
      savePosition(clamped);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  // Tooltip on hover (only when not dragging)
  const handleMouseMove = () => {
    if (dragging) return;
    const text = engineRef.current?.tooltipText ?? null;
    setTooltip(text);
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  // Compute inline style: if we have a saved/dragged position, use left/top; otherwise CSS defaults apply
  const positionStyle: React.CSSProperties | undefined = position
    ? { left: position.left, top: position.top, right: 'auto' }
    : undefined;

  return (
    <div
      ref={widgetRef}
      className={`adventure-widget${dragging ? ' adventure-widget--dragging' : ''}`}
      style={positionStyle}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      title={tooltip ?? undefined}
    >
      <canvas
        ref={canvasRef}
        className="adventure-canvas"
      />
      {tooltip && (
        <div className="adventure-tooltip">
          {tooltip}
        </div>
      )}
    </div>
  );
});

function clampPosition(pos: WidgetPosition): WidgetPosition {
  const w = 120, h = 120;
  const maxLeft = window.innerWidth - w;
  const maxTop = window.innerHeight - h;
  return {
    left: Math.max(0, Math.min(pos.left, maxLeft)),
    top: Math.max(0, Math.min(pos.top, maxTop)),
  };
}

AdventureWidget.displayName = 'AdventureWidget';
