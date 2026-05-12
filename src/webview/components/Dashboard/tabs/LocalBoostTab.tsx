import React from 'react';
import { LocalBoostTracePanel } from '../../LocalBoost/LocalBoostTracePanel';
import { LocalBoostSettingsPanel } from '../../LocalBoost/LocalBoostSettingsPanel';
import { DASH_COLORS } from '../dashboardUtils';

export const LocalBoostTab: React.FC = () => {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <LocalBoostSettingsPanel />
      </div>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <LocalBoostTracePanel />
      </div>
    </div>
  );
};
