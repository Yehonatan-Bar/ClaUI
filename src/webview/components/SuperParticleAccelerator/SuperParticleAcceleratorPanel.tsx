import React, { useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const SuperParticleAcceleratorPanel: React.FC = () => {
  const panelOpen = useAppStore((s) => s.superParticleAcceleratorPanelOpen);
  const enabled = useAppStore((s) => s.superParticleAcceleratorEnabled);
  const mode = useAppStore((s) => s.superParticleAcceleratorMode);
  const status = useAppStore((s) => s.superParticleAcceleratorStatus);
  const auditEvents = useAppStore((s) => s.superParticleAcceleratorAuditEvents);
  const error = useAppStore((s) => s.superParticleAcceleratorError);
  const setPanelOpen = useAppStore((s) => s.setSuperParticleAcceleratorPanelOpen);

  useEffect(() => {
    if (panelOpen) {
      postToExtension({ type: 'superParticleAcceleratorGetStatus' } as any);
      postToExtension({ type: 'superParticleAcceleratorGetAuditEvents', limit: 50 } as any);
    }
  }, [panelOpen]);

  if (!panelOpen) return null;

  const statusDotClass = `spa-status-dot spa-status-${status}`;

  return (
    <div
      className="dlp-panel-backdrop"
      role="dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) setPanelOpen(false);
      }}
    >
      <div className="dlp-panel spa-panel">
        <div className="dlp-panel-header">
          <h2>Super Particle Accelerator</h2>
          <button className="dlp-panel-close" onClick={() => setPanelOpen(false)} data-tooltip="Close">
            X
          </button>
        </div>

        <div className="dlp-panel-body">
          <div
            className="spa-main-toggle"
            title="Super Particle Accelerator intercepts every AI agent write operation and blocks any attempt to write API keys, tokens, credentials, or other secrets into your codebase."
          >
            <label className="spa-toggle-label">
              <span>Super Particle Accelerator</span>
              <span className="spa-toggle-description">
                Extra protection: blocks Claude Code and Codex from writing detected secrets into
                code, git commits, MCP writes, and public assets.
              </span>
            </label>
            {!enabled && (
              <div className="spa-toggle-actions">
                <span className="spa-disabled-hint">Currently disabled</span>
                <button
                  className="spa-toggle-button spa-toggle-enable"
                  onClick={() =>
                    postToExtension({ type: 'superParticleAcceleratorSetEnabled', enabled: true } as any)
                  }
                  data-tooltip="Enable Super Particle Accelerator"
                >
                  Enable
                </button>
              </div>
            )}
            {enabled && (
              <div className="spa-toggle-actions">
                <span className="spa-enabled-hint">Enabled</span>
                <button
                  className="spa-toggle-button spa-toggle-disable"
                  onClick={() =>
                    postToExtension({ type: 'superParticleAcceleratorSetEnabled', enabled: false } as any)
                  }
                  data-tooltip="Disable Super Particle Accelerator"
                >
                  Disable
                </button>
              </div>
            )}
          </div>

          <div className="spa-status-row">
            <span className={statusDotClass} />
            <span>{getStatusLabel(status)}</span>
          </div>

          {error && <div className="spa-error">{error}</div>}

          {enabled && (
            <>
              <div className="spa-mode-selector">
                <label>Mode: </label>
                <select
                  value={mode}
                  onChange={(e) =>
                    postToExtension({
                      type: 'superParticleAcceleratorSetMode',
                      mode: e.target.value,
                    } as any)
                  }
                >
                  <option value="block">Block (deny writes with secrets)</option>
                  <option value="audit">Audit (log only, do not block)</option>
                </select>
              </div>

              <div className="spa-audit-section">
                <h3>Recent Events ({auditEvents.length})</h3>
                {auditEvents.slice(0, 20).map((event) => (
                  <div key={event.id} className={`spa-audit-event spa-audit-${event.action}`}>
                    <span className="spa-audit-time">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="spa-audit-action">{event.action.toUpperCase()}</span>
                    <span className="spa-audit-tool">{event.toolName}</span>
                    {event.filePath && <span className="spa-audit-file">{event.filePath}</span>}
                    <span className="spa-audit-reason">{event.reason}</span>
                  </div>
                ))}
                {auditEvents.length === 0 && (
                  <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                    No events recorded yet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function getStatusLabel(status: string): string {
  switch (status) {
    case 'disabled':
      return 'Disabled';
    case 'enabled-hooks-installed':
      return 'Active - protecting Claude and Codex';
    case 'enabled-hooks-missing':
      return 'Hooks not installed - click to fix';
    case 'enabled-trust-required':
      return 'Codex hook trust required';
    case 'enabled-partial-coverage':
      return 'Partial coverage - check hook order';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

