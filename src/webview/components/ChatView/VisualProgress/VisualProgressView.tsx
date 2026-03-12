import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../../state/store';
import { ProgressCard } from './ProgressCard';

export const VisualProgressView: React.FC = () => {
  const cards = useAppStore((s) => s.visualProgressCards);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Auto-scroll to bottom when cards change (new cards or updates)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || cards.length === 0) return;

    const isNewCard = cards.length > prevLengthRef.current;
    prevLengthRef.current = cards.length;

    // Always scroll for new cards; for updates, only if near bottom
    if (isNewCard) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (isNearBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [cards]);

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
