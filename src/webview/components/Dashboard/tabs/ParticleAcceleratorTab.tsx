import React, { useEffect } from 'react';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { ParticleAcceleratorTracePanel } from '../../ParticleAccelerator/ParticleAcceleratorTracePanel';
import { ParticleAcceleratorSettingsPanel } from '../../ParticleAccelerator/ParticleAcceleratorSettingsPanel';
import { DASH_COLORS } from '../dashboardUtils';

export const ParticleAcceleratorTab: React.FC = () => {
  useEffect(() => {
    postToExtension({ type: 'particleAcceleratorGetStatus' } as any);
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <ParticleAcceleratorSettingsPanel />
      </div>
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}>
        <ParticleAcceleratorTracePanel />
      </div>
    </div>
  );
};
