import React from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { MetricsCards } from '../MetricsCards';
import { ToolFrequencyBar, CategoryDonut, DurationBar } from '../charts/RechartsWrappers';
import { MoodTimeline, FrustrationAlert } from '../charts/SemanticWidgets';
import { DASH_COLORS } from '../dashboardUtils';

interface OverviewTabProps {
  turnHistory: TurnRecord[];
}

const chartCardStyle = {
  background: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '8px',
  padding: '16px',
};

const chartTitleStyle = {
  fontSize: '13px',
  fontWeight: 600 as const,
  color: DASH_COLORS.text,
  marginBottom: '12px',
};

export const OverviewTab: React.FC<OverviewTabProps> = ({ turnHistory }) => {
  if (turnHistory.length === 0) {
    return (
      <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '48px', fontSize: '14px' }}>
        No turns yet - start a session to see analytics
      </div>
    );
  }

  return (
    <div>
      <MetricsCards turnHistory={turnHistory} />

      {/* Row 1: Duration */}
      <div style={{ marginBottom: '16px' }}>
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Duration per Turn</div>
          <DurationBar turnHistory={turnHistory} />
        </div>
      </div>

      {/* Row 2: Tool Frequency + Category Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Tool Frequency (Top 15)</div>
          <ToolFrequencyBar turnHistory={turnHistory} />
        </div>
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Turn Categories</div>
          <CategoryDonut turnHistory={turnHistory} />
        </div>
      </div>

      {/* Row 3: Mood Timeline */}
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>Mood Timeline</div>
        <MoodTimeline turnHistory={turnHistory} />
      </div>

      <FrustrationAlert turnHistory={turnHistory} />
    </div>
  );
};
