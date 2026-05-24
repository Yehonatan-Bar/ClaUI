import React from 'react';
import { useAppStore } from '../../state/store';
import { StatusBadge, StatusBadgeTone } from '../StatusBadge';

function toneForStatus(status: string, lastEvent?: { action: string }): StatusBadgeTone {
  if (status === 'disabled') return 'muted';
  if (status === 'error' || status === 'enabled-hooks-missing') return 'error';
  if (lastEvent?.action === 'deny') return 'error';
  if (status === 'enabled-hooks-installed') return 'ok';
  return 'warn';
}

export const SuperParticleAcceleratorStatusBadge: React.FC = () => {
  const enabled = useAppStore((s) => s.superParticleAcceleratorEnabled);
  const status = useAppStore((s) => s.superParticleAcceleratorStatus);
  const lastEvent = useAppStore((s) => s.superParticleAcceleratorLastEvent);
  const setPanelOpen = useAppStore((s) => s.setSuperParticleAcceleratorPanelOpen);

  const tone = toneForStatus(status, lastEvent);
  const label = 'SPA';
  const value = enabled ? (status === 'enabled-hooks-installed' ? 'On' : 'Warn') : 'Off';

  const titleMap: Record<string, string> = {
    disabled: 'Super Particle Accelerator: Disabled',
    'enabled-hooks-installed': 'Super Particle Accelerator: Active',
    'enabled-hooks-missing': 'Super Particle Accelerator: Hooks Missing',
    'enabled-trust-required': 'Super Particle Accelerator: Codex Trust Required',
    'enabled-partial-coverage': 'Super Particle Accelerator: Partial Coverage',
    error: 'Super Particle Accelerator: Error',
  };

  return (
    <StatusBadge
      label={label}
      value={value}
      tone={tone}
      title={titleMap[status] ?? 'Super Particle Accelerator'}
      onClick={() => setPanelOpen(true)}
    />
  );
};
