import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export function LocalBoostSettingsPanel() {
  const status = useAppStore(s => s.localBoostStatus);
  const error = useAppStore(s => s.localBoostError);

  const handleToggle = () => {
    postToExtension({ type: 'localBoostSetEnabled', enabled: !status?.enabled } as any);
  };

  const handleInstallHooks = (provider: 'claude' | 'codex' | 'both') => {
    postToExtension({ type: 'localBoostInstallHooks', provider } as any);
  };

  const handleUninstallHooks = (provider: 'claude' | 'codex' | 'both') => {
    postToExtension({ type: 'localBoostUninstallHooks', provider } as any);
  };

  const handleClearData = () => {
    postToExtension({ type: 'localBoostClearData', scope: 'all' } as any);
  };

  const handleRefresh = () => {
    postToExtension({ type: 'localBoostGetStatus' } as any);
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Local Boost</span>
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

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <SmallButton onClick={() => handleInstallHooks('claude')} label="Install Claude Hook" />
            <SmallButton onClick={() => handleUninstallHooks('claude')} label="Remove Claude Hook" />
            <SmallButton onClick={() => handleInstallHooks('codex')} label="Install Codex Hook" />
            <SmallButton onClick={handleClearData} label="Clear Data" />
            <SmallButton onClick={handleRefresh} label="Refresh" />
          </div>
        </>
      )}
    </div>
  );
}

function SmallButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 6px',
        borderRadius: '3px',
        border: '1px solid var(--vscode-button-border, transparent)',
        backgroundColor: 'var(--vscode-button-secondaryBackground)',
        color: 'var(--vscode-button-secondaryForeground)',
        cursor: 'pointer',
        fontSize: '11px',
      }}
    >
      {label}
    </button>
  );
}
