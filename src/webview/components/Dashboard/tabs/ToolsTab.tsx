import React from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { ToolFrequencyBar, CategoryDonut } from '../charts/RechartsWrappers';
import { DASH_COLORS } from '../dashboardUtils';

interface ToolsTabProps {
  turnHistory: TurnRecord[];
}

export const ToolsTab: React.FC<ToolsTabProps> = ({ turnHistory }) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Tool Frequency (Top 15)
        </div>
        <ToolFrequencyBar turnHistory={turnHistory} />
      </div>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Turn Category Distribution
        </div>
        <CategoryDonut turnHistory={turnHistory} />
      </div>
    </div>
  );
};
