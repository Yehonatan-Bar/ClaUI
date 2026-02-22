import React from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { TokenStackedBar } from '../charts/RechartsWrappers';
import { DASH_COLORS, formatTokens } from '../dashboardUtils';

interface TokensTabProps {
  turnHistory: TurnRecord[];
}

export const TokensTab: React.FC<TokensTabProps> = ({ turnHistory }) => {
  const totalInput = turnHistory.reduce((s, t) => s + (t.inputTokens ?? 0), 0);
  const totalOutput = turnHistory.reduce((s, t) => s + (t.outputTokens ?? 0), 0);
  const totalCacheCreation = turnHistory.reduce((s, t) => s + (t.cacheCreationTokens ?? 0), 0);
  const totalCacheRead = turnHistory.reduce((s, t) => s + (t.cacheReadTokens ?? 0), 0);
  const cacheHitRate = totalInput > 0 ? (totalCacheRead / totalInput) * 100 : 0;

  const miniCards = [
    { label: 'Total Input', value: formatTokens(totalInput), color: DASH_COLORS.blue },
    { label: 'Total Output', value: formatTokens(totalOutput), color: DASH_COLORS.green },
    { label: 'Cache Created', value: formatTokens(totalCacheCreation), color: DASH_COLORS.amber },
    { label: 'Cache Read', value: `${formatTokens(totalCacheRead)} (${cacheHitRate.toFixed(1)}%)`, color: DASH_COLORS.teal },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {miniCards.map((card) => (
          <div key={card.label} style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '8px',
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: '11px', color: DASH_COLORS.textMuted, marginBottom: '4px' }}>{card.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Token Breakdown per Turn
        </div>
        <TokenStackedBar turnHistory={turnHistory} />
      </div>
    </div>
  );
};
