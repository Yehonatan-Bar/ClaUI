import React from 'react';
import type { VisualProgressCard } from '../../../state/store';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_CHARACTERS } from './characters';

interface ProgressCardProps {
  card: VisualProgressCard;
}

export const ProgressCard: React.FC<ProgressCardProps> = ({ card }) => {
  const color = CATEGORY_COLORS[card.category];
  const label = CATEGORY_LABELS[card.category];
  const CharacterSvg = CATEGORY_CHARACTERS[card.category];
  const displayDescription = card.aiDescription || card.description;
  const timeStr = new Date(card.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fileName = card.filePath ? card.filePath.split(/[/\\]/).pop() : undefined;

  return (
    <div className="vpm-card" style={{ borderLeftColor: color }}>
      <div className="vpm-card-inner">
        <div className="vpm-card-character">
          <CharacterSvg color={color} />
        </div>
        <div className="vpm-card-content">
          <div className="vpm-card-description">{displayDescription}</div>
          <div className="vpm-card-meta">
            <span className="vpm-card-label" style={{ color }}>{label}</span>
            {fileName && <span className="vpm-card-file">{fileName}</span>}
            <span className="vpm-card-time">{timeStr}</span>
          </div>
        </div>
      </div>
      {card.isStreaming && (
        <div className="vpm-card-streaming-indicator">
          <span className="vpm-dot" style={{ background: color }} />
          <span className="vpm-dot" style={{ background: color }} />
          <span className="vpm-dot" style={{ background: color }} />
        </div>
      )}
    </div>
  );
};
