import React from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { DurationBar, TaskTypeDonut, OutcomeBar } from '../charts/RechartsWrappers';
import { TurnTable } from '../TurnTable';
import { DASH_COLORS } from '../dashboardUtils';

interface TimelineTabProps {
  turnHistory: TurnRecord[];
}

export const TimelineTab: React.FC<TimelineTabProps> = ({ turnHistory }) => {
  const hasSemantics = turnHistory.some((t) => t.semantics);

  return (
    <div>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          API Duration per Turn
        </div>
        <DurationBar turnHistory={turnHistory} />
      </div>

      {hasSemantics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '8px',
            padding: '16px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
              Task Type Distribution
            </div>
            <TaskTypeDonut turnHistory={turnHistory} />
          </div>
          <div style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '8px',
            padding: '16px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
              Task Outcomes
            </div>
            <OutcomeBar turnHistory={turnHistory} />
          </div>
        </div>
      )}

      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Turn Details
        </div>
        <TurnTable turnHistory={turnHistory} />
      </div>
    </div>
  );
};
