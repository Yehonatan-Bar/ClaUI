import React from 'react';
import { useAppStore } from '../../state/store';

export const ConflictWarning: React.FC = () => {
  const conflicts = useAppStore((s) => s.mpFileConflicts);
  const dismissedIds = useAppStore((s) => s.mpDismissedConflictIds);
  const dismissConflict = useAppStore((s) => s.dismissMpConflict);

  const visible = conflicts.filter((c) => !dismissedIds.has(c.conflictId));
  if (visible.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '8px 12px',
      margin: '0 0 4px 0',
    }}>
      {visible.map((warning) => (
        <div key={warning.conflictId} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 4,
          background: '#f0883e15',
          border: '1px solid #f0883e44',
        }}>
          <span style={{ color: '#f0883e', fontSize: 14, flexShrink: 0, lineHeight: '18px' }}>!</span>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--vscode-foreground, #e6edf3)' }}>
            <div style={{ fontWeight: 600, marginBottom: 2, color: '#f0883e' }}>
              File Conflict
            </div>
            <div style={{ color: 'var(--vscode-descriptionForeground, #8b949e)', marginBottom: 4 }}>
              {warning.message ?? `${warning.deliveries.length} agents editing the same file(s)`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {warning.filePaths.map((fp) => (
                <span key={fp} style={{
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--vscode-badge-background, #30363d)',
                  color: 'var(--vscode-badge-foreground, #e6edf3)',
                  fontSize: 11,
                  fontFamily: 'var(--vscode-editor-font-family, monospace)',
                }}>
                  {fp}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--vscode-descriptionForeground, #8b949e)' }}>
              {warning.deliveries.map((d) => d.agentDisplayName).join(', ')}
            </div>
          </div>
          <button
            onClick={() => dismissConflict(warning.conflictId)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--vscode-descriptionForeground, #8b949e)',
              cursor: 'pointer',
              fontSize: 14,
              padding: '0 2px',
              lineHeight: '18px',
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};
