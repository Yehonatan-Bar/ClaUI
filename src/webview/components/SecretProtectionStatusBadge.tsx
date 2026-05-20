import React from 'react';
import { useAppStore } from '../state/store';
import { StatusBadge, StatusBadgeTone } from './StatusBadge';

function toneForSeverity(severity: string | null | undefined): StatusBadgeTone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
    case 'low':
      return 'warn';
    default:
      return 'ok';
  }
}

export const SecretProtectionStatusBadge: React.FC = () => {
  const enabled = useAppStore((s) => s.secretProtectionEnabled);
  const settings = useAppStore((s) => s.secretProtectionSettings);
  const auditCount = useAppStore((s) => s.secretProtectionAuditCount);
  const lastEvent = useAppStore((s) => s.secretProtectionLastEvent);
  const setPanelOpen = useAppStore((s) => s.setSecretProtectionPanelOpen);

  if (!settings.enabled && !enabled) {
    return (
      <StatusBadge
        label="DLP"
        value="Off"
        tone="muted"
        title="Secret Protection"
        onClick={() => setPanelOpen(true, 'settings')}
      />
    );
  }

  const tone = lastEvent ? toneForSeverity(lastEvent.severityMax) : 'ok';
  const value = auditCount > 0 ? `${auditCount}` : settings.mode;
  const title = lastEvent
    ? `Secret Protection: ${lastEvent.action} at ${lastEvent.boundary}`
    : `Secret Protection: ${settings.mode}`;

  return (
    <StatusBadge
      label="DLP"
      value={value}
      tone={tone}
      title={title}
      onClick={() => setPanelOpen(true, auditCount > 0 ? 'audit' : 'settings')}
    />
  );
};
