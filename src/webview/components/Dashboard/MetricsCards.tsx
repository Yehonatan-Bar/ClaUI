import React from 'react';
import type { TurnRecord } from '../../../extension/types/webview-messages';
import { DASH_COLORS, formatDuration } from './dashboardUtils';

interface MetricsCardsProps {
  turnHistory: TurnRecord[];
}

interface CardData {
  label: string;
  value: string;
  color: string;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({ turnHistory }) => {
  const totalTurns = turnHistory.length;
  const errorCount = turnHistory.filter((t) => t.isError).length;
  const errorRate = totalTurns > 0 ? (errorCount / totalTurns) * 100 : 0;
  const totalToolUses = turnHistory.reduce((s, t) => s + t.toolCount, 0);
  const totalDurationMs = turnHistory.reduce((s, t) => s + t.durationMs, 0);
  const avgDuration = totalTurns > 0 ? totalDurationMs / totalTurns : 0;

  // Find top tool
  const toolFreq: Record<string, number> = {};
  turnHistory.forEach((t) => {
    t.toolNames.forEach((name) => {
      const base = name.includes('__') ? name.split('__').pop()! : name;
      toolFreq[base] = (toolFreq[base] ?? 0) + 1;
    });
  });
  const topTool = Object.entries(toolFreq).sort((a, b) => b[1] - a[1])[0];

  // Count bash commands
  const totalCommands = turnHistory.reduce((s, t) => s + (t.bashCommands?.length ?? 0), 0);

  const cards: CardData[] = [
    { label: 'Total Turns', value: String(totalTurns), color: DASH_COLORS.blue },
    { label: 'Error Rate', value: `${errorRate.toFixed(1)}%`, color: errorRate > 20 ? DASH_COLORS.red : DASH_COLORS.textMuted },
    { label: 'Total Tool Uses', value: String(totalToolUses), color: DASH_COLORS.teal },
    { label: 'Top Tool', value: topTool ? `${topTool[0]} (${topTool[1]})` : '-', color: DASH_COLORS.purple },
    { label: 'Shell Commands', value: String(totalCommands), color: DASH_COLORS.orange },
    { label: 'Avg API Duration', value: formatDuration(avgDuration), color: DASH_COLORS.amber },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px',
      marginBottom: '20px',
    }}>
      {cards.map((card) => (
        <div key={card.label} style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: '8px',
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: '11px', color: DASH_COLORS.textMuted, marginBottom: '6px' }}>
            {card.label}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: card.color }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
};
