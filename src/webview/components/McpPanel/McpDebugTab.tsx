import React from 'react';
import type { McpConfigPaths, McpScope, McpServerInfo, ProviderId } from '../../../extension/types/webview-messages';
import { postToExtension } from '../../hooks/useClaudeStream';

const commandStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  color: '#c9d1d9',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
};

function renderScopePath(label: string, scope: McpScope, configPath: string | undefined, onOpenConfig: (scope?: McpScope) => void) {
  return (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#8b949e', wordBreak: 'break-all' }}>{configPath || 'Not discovered'}</div>
      </div>
      <button
        onClick={() => onOpenConfig(scope)}
        disabled={!configPath}
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.2)',
          background: 'transparent',
          color: configPath ? '#9ecbff' : '#6e7681',
          cursor: configPath ? 'pointer' : 'not-allowed',
          fontSize: 12,
        }}
      >
        Open
      </button>
    </div>
  );
}

export const McpDebugTab: React.FC<{
  provider: ProviderId | null;
  servers: McpServerInfo[];
  configPaths: McpConfigPaths | null;
  lastError: string | null;
  lastOperation: { op: string; name?: string; success: boolean; restartNeeded?: boolean; nextAction?: import('../../../extension/types/webview-messages').McpNextAction } | null;
  onOpenConfig: (scope?: McpScope) => void;
  onOpenLogs: () => void;
}> = ({ provider, servers, configPaths, lastError, lastOperation, onOpenConfig, onOpenLogs }) => {
  const runtimeNames = servers.filter((server) => server.source !== 'config').map((server) => server.name).join(', ') || 'none';
  const configuredNames = servers.filter((server) => server.source !== 'runtime').map((server) => `${server.name} (${server.scope})`).join(', ') || 'none';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {provider !== 'claude' && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(56, 139, 253, 0.12)', color: '#9ecbff' }}>
          Non-Claude providers do not expose Claude session MCP runtime parity. This panel stays read-only here.
        </div>
      )}

      <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(22, 27, 34, 0.92)', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9', marginBottom: 10 }}>Config paths</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {renderScopePath('Project (.mcp.json)', 'project', configPaths?.workspaceConfigPath, onOpenConfig)}
          {renderScopePath('User (~/.claude.json)', 'user', configPaths?.userConfigPath, onOpenConfig)}
          {renderScopePath('Local project entry', 'local', configPaths?.localConfigPath, onOpenConfig)}
          {renderScopePath('Managed', 'managed', configPaths?.managedConfigPath, onOpenConfig)}
        </div>
      </div>

      <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(22, 27, 34, 0.92)', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9', marginBottom: 10 }}>Runtime vs config</div>
        <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>
          <div>Runtime: {runtimeNames}</div>
          <div>Configured: {configuredNames}</div>
        </div>
      </div>

      <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(22, 27, 34, 0.92)', border: '1px solid rgba(148, 163, 184, 0.14)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9', marginBottom: 10 }}>Diagnostics</div>
        <div style={{ fontSize: 12, color: lastError ? '#ffaba8' : '#8b949e', marginBottom: 8 }}>
          Last error: {lastError || 'none'}
        </div>
        <div style={{ fontSize: 12, color: '#8b949e' }}>
          Last operation: {lastOperation ? `${lastOperation.op}${lastOperation.name ? ` (${lastOperation.name})` : ''} -> ${lastOperation.success ? 'ok' : 'failed'}` : 'none'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {['claude mcp list', 'claude mcp get <name>', 'claude --mcp-debug'].map((command) => (
          <div key={command} style={commandStyle}>
            <code style={{ color: '#dbeafe' }}>{command}</code>
            <button
              onClick={() => postToExtension({ type: 'copyToClipboard', text: command })}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(148, 163, 184, 0.2)',
                background: 'transparent',
                color: '#9ecbff',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Copy
            </button>
          </div>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={onOpenLogs}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.2)',
              background: 'transparent',
              color: '#9ecbff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Open ClaUi logs
          </button>
          <button
            onClick={() => postToExtension({ type: 'mcpResetProjectChoices' })}
            disabled={provider !== 'claude'}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.2)',
              background: 'transparent',
              color: provider === 'claude' ? '#c9d1d9' : '#6e7681',
              cursor: provider === 'claude' ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Reset project approvals
          </button>
        </div>
      </div>
    </div>
  );
};
