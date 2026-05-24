import React, { useEffect } from 'react';
import { useAppStore } from '../state/store';
import { postToExtension } from '../hooks/useClaudeStream';
import { AuditLogPanel } from './AuditLogPanel';
import { buildOutboundManifestPreview } from '../panels/OutboundManifestPanel';
import type { SecretProtectionSettings } from '../../shared/secret-protection/types';

type ToggleKey = NonNullable<{
  [K in keyof SecretProtectionSettings]: SecretProtectionSettings[K] extends boolean ? K : never;
}[keyof SecretProtectionSettings]>;

const TOGGLES: Array<{ key: ToggleKey; label: string }> = [
  { key: 'enabled', label: 'Enabled' },
  { key: 'scanPrompts', label: 'Prompts' },
  { key: 'scanTerminalOutput', label: 'Terminal' },
  { key: 'scanGitPublication', label: 'Git' },
  { key: 'scanMcp', label: 'MCP' },
  { key: 'blockProtectedPaths', label: 'Paths' },
  { key: 'requireBrowserCaptureApproval', label: 'Browser' },
  { key: 'enableEntropyScanner', label: 'Entropy' },
];

export const SettingsPanel: React.FC = () => {
  const open = useAppStore((s) => s.secretProtectionPanelOpen);
  const tab = useAppStore((s) => s.secretProtectionPanelTab);
  const settings = useAppStore((s) => s.secretProtectionSettings);
  const lastEvent = useAppStore((s) => s.secretProtectionLastEvent);
  const setOpen = useAppStore((s) => s.setSecretProtectionPanelOpen);
  const setTab = useAppStore((s) => s.setSecretProtectionPanelTab);

  useEffect(() => {
    if (open) {
      postToExtension({ type: 'secretProtectionGetStatus' });
      postToExtension({ type: 'secretProtectionGetAuditEvents', limit: 100 });
      postToExtension({ type: 'secretProtectionGetComplianceReport' });
    }
  }, [open]);

  if (!open) return null;

  const updateSetting = <K extends keyof SecretProtectionSettings>(key: K, value: SecretProtectionSettings[K]) => {
    postToExtension({ type: 'secretProtectionSetSetting', key, value });
  };

  const manifest = buildOutboundManifestPreview(settings, lastEvent);

  return (
    <div className="dlp-panel-backdrop" role="dialog" aria-modal="true" aria-label="Secret Protection">
      <div className="dlp-panel">
        <div className="dlp-panel-header">
          <div>
            <div className="dlp-panel-title">Secret Protection</div>
            <div className="dlp-panel-subtitle">{settings.mode} mode</div>
          </div>
          <button className="dlp-icon-btn" onClick={() => setOpen(false)} aria-label="Close">x</button>
        </div>

        <div className="dlp-tabs" role="tablist">
          {(['settings', 'audit', 'manifest'] as const).map((item) => (
            <button
              key={item}
              className={`dlp-tab ${tab === item ? 'active' : ''}`}
              onClick={() => setTab(item)}
              role="tab"
              aria-selected={tab === item}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'settings' && (
          <div className="dlp-panel-body">
            <div className="dlp-settings-grid">
              <label className="dlp-setting-row">
                <span>Mode</span>
                <select
                  value={settings.mode}
                  onChange={(e) => updateSetting('mode', e.target.value as SecretProtectionSettings['mode'])}
                >
                  <option value="off">Off</option>
                  <option value="observe">Observe</option>
                  <option value="balanced">Balanced</option>
                  <option value="strict">Strict</option>
                </select>
              </label>
              <label className="dlp-setting-row">
                <span>Exception minutes</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={settings.exceptionMaxMinutes}
                  onChange={(e) => updateSetting('exceptionMaxMinutes', Number(e.target.value))}
                />
              </label>
              <label className="dlp-setting-row">
                <span>Audit retention days</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.auditRetentionDays}
                  onChange={(e) => updateSetting('auditRetentionDays', Number(e.target.value))}
                />
              </label>
            </div>
            <div className="dlp-toggle-grid">
              {TOGGLES.map((item) => (
                <label key={item.key} className="dlp-toggle">
                  <input
                    type="checkbox"
                    checked={!!settings[item.key]}
                    onChange={(e) => updateSetting(item.key, e.target.checked as SecretProtectionSettings[typeof item.key])}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'audit' && <AuditLogPanel />}

        {tab === 'manifest' && (
          <div className="dlp-panel-body">
            <div className="manifest-grid">
              <div><span>Enabled</span><strong>{manifest.enabled ? 'Yes' : 'No'}</strong></div>
              <div><span>Mode</span><strong>{manifest.mode}</strong></div>
              <div><span>Last decision</span><strong>{manifest.lastDecision}</strong></div>
              <div><span>Last boundary</span><strong>{manifest.lastBoundary}</strong></div>
              <div><span>Redaction</span><strong>{manifest.redactionSummary}</strong></div>
            </div>
            <div className="manifest-boundaries">
              {manifest.guardedBoundaries.map((boundary) => (
                <span key={boundary}>{boundary}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
