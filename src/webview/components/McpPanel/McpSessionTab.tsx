import React from 'react';
import type { McpServerInfo } from '../../../extension/types/webview-messages';
import { McpServerCard } from './McpServerCard';
import { McpToolsMap } from './McpToolsMap';

export const McpSessionTab: React.FC<{
  servers: McpServerInfo[];
  pendingRestartCount: number;
}> = ({ servers, pendingRestartCount }) => {
  const runtimeServers = servers.filter((server) => server.source !== 'config');

  if (runtimeServers.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {pendingRestartCount > 0 && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(210, 153, 34, 0.14)', color: '#f2cc60' }}>
            Configured MCP servers exist, but this session has not loaded them yet.
          </div>
        )}
        <div style={{ padding: '18px 16px', borderRadius: 12, background: 'rgba(22, 27, 34, 0.92)', color: '#8b949e' }}>
          No active MCP servers were reported by the current Claude session.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {pendingRestartCount > 0 && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(210, 153, 34, 0.14)', color: '#f2cc60' }}>
          {pendingRestartCount} server{pendingRestartCount === 1 ? '' : 's'} differ between config and this running session.
        </div>
      )}

      {runtimeServers.map((server) => (
        <McpServerCard
          key={`${server.name}-${server.scope}`}
          server={server}
          subtitle={`Runtime status: ${server.runtimeStatus}`}
        >
          <McpToolsMap servers={[server]} />
        </McpServerCard>
      ))}
    </div>
  );
};
