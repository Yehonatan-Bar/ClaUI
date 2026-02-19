import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { AdventureEngine } from './adventure/AdventureEngine';

/**
 * Floating pixel-art dungeon crawler widget.
 * Visualizes Claude Code session activity as a roguelike adventure.
 */
export const AdventureWidget: React.FC = React.memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AdventureEngine | null>(null);
  const lastTurnIndex = useRef(-1);
  const [tooltip, setTooltip] = React.useState<string | null>(null);

  const adventureBeats = useAppStore((s) => s.adventureBeats);
  const isBusy = useAppStore((s) => s.isBusy);

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

  // Signal busy/idle
  useEffect(() => {
    engineRef.current?.setBusy(isBusy);
  }, [isBusy]);

  // Tooltip on hover
  const handleMouseMove = () => {
    const text = engineRef.current?.tooltipText ?? null;
    setTooltip(text);
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <div
      className="adventure-widget"
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

AdventureWidget.displayName = 'AdventureWidget';
