import React from 'react';
import type { McpScope, McpServerInfo } from '../../../extension/types/webview-messages';
import { postToExtension } from '../../hooks/useClaudeStream';
import { McpServerCard } from './McpServerCard';

const SCOPE_ORDER: McpScope[] = ['project', 'local', 'user', 'managed', 'unknown'];

export const McpWorkspaceTab: React.FC<{
  provider: 'claude' | 'codex' | 'remote' | null;
  servers: McpServerInfo[];
  onOpenConfig: (scope?: McpScope) => void;
}> = ({ provider, servers, onOpenConfig }) => {
  const configServers = servers.filter((server) => server.source !== 'runtime');

  if (configServers.length === 0) {
    return (
      <div style={{ padding: '18px 16px', borderRadius: 12, background: 'rgba(22, 27, 34, 0.92)', color: '#8b949e' }}>
        No configured MCP servers were discovered in workspace, user, or managed scope.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SCOPE_ORDER.map((scope) => {
        const scopedServers = configServers.filter((server) => server.scope === scope);
        if (scopedServers.length === 0) {
          return null;
        }

        return (
          <section key={scope} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#9fb3c8', textTransform: 'uppercase' }}>
                {scope}
              </div>
              <button
                onClick={() => onOpenConfig(scope)}
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
                Open Config
              </button>
            </div>

            {scopedServers.map((server) => (
              <McpServerCard
                key={`${server.name}-${server.scope}`}
                server={server}
                subtitle={`Source: ${server.source}`}
                actions={[
                  {
                    label: 'Open config',
                    onClick: () => onOpenConfig(server.scope),
                    tone: 'neutral',
                  },
                  {
                    label: 'Remove',
                    tone: 'danger',
                    disabled: provider !== 'claude',
                    onClick: () => {
                      if (provider !== 'claude') {
                        return;
                      }
                      const approved = window.confirm(`Remove MCP server "${server.name}" from ${server.scope} scope?`);
                      if (!approved) {
                        return;
                      }
                      postToExtension({ type: 'mcpRemoveServer', name: server.name, scope: server.scope });
                    },
                  },
                ]}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
};
