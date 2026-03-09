import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../../state/store';
import { ProgressCard } from './ProgressCard';

export const VisualProgressView: React.FC = () => {
  const cards = useAppStore((s) => s.visualProgressCards);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new cards arrive
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Only auto-scroll if already near the bottom (within 150px)
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [cards.length]);

  if (cards.length === 0) {
    return (
      <div className="vpm-container" ref={containerRef}>
        <div className="vpm-empty">
          <div className="vpm-empty-title">Visual Progress Mode</div>
          <div className="vpm-empty-subtitle">Tool actions will appear here as animated cards</div>
        </div>
      </div>
    );
  }

  return (
    <div className="vpm-container" ref={containerRef}>
      <div className="vpm-timeline">
        {cards.map((card, i) => (
          <React.Fragment key={card.id}>
            {i > 0 && (
              <div className="vpm-connector">
                <div className="vpm-connector-line" />
                <div className="vpm-connector-arrow" />
              </div>
            )}
            <ProgressCard card={card} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
