import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export function ParticleAcceleratorSettingsPanel() {
  const status = useAppStore(s => s.particleAcceleratorStatus);
  const error = useAppStore(s => s.particleAcceleratorError);

  const handleToggle = () => {
    postToExtension({ type: 'particleAcceleratorSetEnabled', enabled: !status?.enabled } as any);
  };

  const handleInstallHooks = (provider: 'claude' | 'codex' | 'both') => {
    postToExtension({ type: 'particleAcceleratorInstallHooks', provider } as any);
  };

  const handleUninstallHooks = (provider: 'claude' | 'codex' | 'both') => {
    postToExtension({ type: 'particleAcceleratorUninstallHooks', provider } as any);
  };

  const handleClearData = () => {
    postToExtension({ type: 'particleAcceleratorClearData', scope: 'all' } as any);
  };

  const handleRefresh = () => {
    postToExtension({ type: 'particleAcceleratorGetStatus' } as any);
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Particle Accelerator</span>
        <button
          onClick={handleToggle}
          style={{
            padding: '2px 8px',
            borderRadius: '3px',
            border: '1px solid var(--vscode-button-border, transparent)',
            backgroundColor: status?.enabled
              ? 'var(--vscode-button-background)'
              : 'var(--vscode-button-secondaryBackground)',
            color: status?.enabled
              ? 'var(--vscode-button-foreground)'
              : 'var(--vscode-button-secondaryForeground)',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {status?.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '4px 8px',
          backgroundColor: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
          border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
          borderRadius: '3px',
          fontSize: '12px',
          marginBottom: '8px',
        }}>
          {error}
        </div>
      )}

      {status?.enabled && (
        <>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>
            Version: {status.version ?? 'Not installed'} | Node: {status.nodeAvailable ? 'Available' : 'Missing'}
          </div>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '8px' }}>
            Codex mode: {status.codexMode}
          </div>

          <div style={{ fontSize: '12px', marginBottom: '8px' }}>
            <HookStatus label="Claude Hook" installed={status.claudeHookInstalled} />
            <HookStatus label="Codex Hook" installed={status.codexHookInstalled} />
          </div>

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <SmallButton
              onClick={() => status.claudeHookInstalled ? handleUninstallHooks('claude') : handleInstallHooks('claude')}
              label={status.claudeHookInstalled ? 'Remove Claude Hook' : 'Install Claude Hook'}
              active={status.claudeHookInstalled}
            />
            <SmallButton
              onClick={() => status.codexHookInstalled ? handleUninstallHooks('codex') : handleInstallHooks('codex')}
              label={status.codexHookInstalled ? 'Remove Codex Hook' : 'Install Codex Hook'}
              active={status.codexHookInstalled}
            />
            <SmallButton onClick={handleClearData} label="Clear Data" />
            <SmallButton onClick={handleRefresh} label="Refresh" />
          </div>
        </>
      )}
    </div>
  );
}

function HookStatus({ label, installed }: { label: string; installed: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: installed ? '#89d185' : '#6c6c6c',
        display: 'inline-block',
      }} />
      <span>{label}: {installed ? 'Installed' : 'Not installed'}</span>
    </div>
  );
}

function SmallButton({ onClick, label, active }: { onClick: () => void; label: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 6px',
        borderRadius: '3px',
        border: `1px solid ${active ? 'var(--vscode-button-border, transparent)' : 'var(--vscode-button-border, transparent)'}`,
        backgroundColor: active
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-button-secondaryBackground)',
        color: active
          ? 'var(--vscode-button-foreground)'
          : 'var(--vscode-button-secondaryForeground)',
        cursor: 'pointer',
        fontSize: '11px',
      }}
    >
      {label}
    </button>
  );
}
