import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { TurnRecord, TurnCategory } from '../../../extension/types/webview-messages';

const CATEGORY_COLORS: Record<TurnCategory, string> = {
  success: '#4caf50',
  error: '#f44336',
  discussion: '#2196f3',
  'code-write': '#9c27b0',
  research: '#ff9800',
  command: '#00bcd4',
};

const CATEGORY_LABELS: Record<TurnCategory, string> = {
  success: 'Success',
  error: 'Error',
  discussion: 'Discussion',
  'code-write': 'Code Write',
  research: 'Research',
  command: 'Command',
};

interface SessionTimelineProps {
  turnHistory: TurnRecord[];
  scrollFraction: number;
  onTurnClick: (messageId: string) => void;
}

export const SessionTimeline: React.FC<SessionTimelineProps> = React.memo(
  ({ turnHistory, scrollFraction, onTurnClick }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [showLegend, setShowLegend] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const maxCost = useMemo(
      () => Math.max(...turnHistory.map((t) => t.costUsd), 0.001),
      [turnHistory]
    );

    const segments = useMemo(() => {
      if (turnHistory.length === 0) return [];
      const totalDuration = turnHistory.reduce((sum, t) => sum + Math.max(t.durationMs, 200), 0);
      return turnHistory.map((turn) => {
        const heightPercent = totalDuration > 0
          ? (Math.max(turn.durationMs, 200) / totalDuration) * 100
          : 100 / turnHistory.length;
        const opacity = 0.35 + 0.65 * (turn.costUsd / maxCost);
        return { turn, heightPercent, opacity };
      });
    }, [turnHistory, maxCost]);

    const handleClick = useCallback(
      (messageId: string) => {
        if (messageId) onTurnClick(messageId);
      },
      [onTurnClick]
    );

    if (turnHistory.length === 0) return null;

    return (
      <div className="session-timeline" ref={containerRef}>
        {/* Info trigger with legend tooltip */}
        <div
          className="timeline-info-trigger"
          onMouseEnter={() => setShowLegend(true)}
          onMouseLeave={() => setShowLegend(false)}
        >
          ?
          {showLegend && (
            <div className="timeline-legend">
              <div className="timeline-legend-title">Session Timeline</div>
              <div className="timeline-legend-desc">
                Visual map of your conversation. Each block is a turn — taller blocks took longer, brighter blocks cost more.
              </div>
              <div className="timeline-legend-items">
                {(Object.keys(CATEGORY_COLORS) as TurnCategory[]).map((cat) => (
                  <div key={cat} className="timeline-legend-item">
                    <span
                      className="timeline-legend-swatch"
                      style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                    />
                    {CATEGORY_LABELS[cat]}
                  </div>
                ))}
              </div>
              <div className="timeline-legend-hint">Click a block to jump to that turn</div>
            </div>
          )}
        </div>

        {/* Segments area */}
        <div className="timeline-segments">
          {/* Position marker */}
          <div
            className="timeline-position-marker"
            style={{ top: `${scrollFraction * 100}%` }}
          />

          {/* Segments */}
          {segments.map(({ turn, heightPercent, opacity }) => (
            <div
              key={turn.turnIndex}
              className="timeline-segment"
              style={{
                height: `${heightPercent}%`,
                backgroundColor: CATEGORY_COLORS[turn.category],
                opacity,
              }}
              onClick={() => handleClick(turn.messageId)}
              onMouseEnter={() => setHoveredIndex(turn.turnIndex)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {hoveredIndex === turn.turnIndex && (
                <div className="timeline-tooltip">
                  <div>Turn {turn.turnIndex + 1}: {turn.category}</div>
                  {turn.toolNames.length > 0 && (
                    <div>{turn.toolNames.join(', ')}</div>
                  )}
                  <div>
                    {turn.durationMs > 0 ? `${(turn.durationMs / 1000).toFixed(1)}s` : ''}
                    {turn.costUsd > 0 ? ` | $${turn.costUsd.toFixed(4)}` : ''}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.turnHistory.length === next.turnHistory.length &&
    Math.abs(prev.scrollFraction - next.scrollFraction) < 0.01
);
