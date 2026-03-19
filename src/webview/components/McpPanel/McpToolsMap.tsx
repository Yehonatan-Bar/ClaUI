import React from 'react';
import type { McpServerInfo } from '../../../extension/types/webview-messages';

export const McpToolsMap: React.FC<{ servers: McpServerInfo[] }> = ({ servers }) => {
  const activeServers = servers.filter((server) => server.tools.length > 0);
  if (activeServers.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#8b949e' }}>
        No runtime MCP tools were reported for this session.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {activeServers.map((server) => (
        <div key={`${server.name}-${server.scope}`}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', marginBottom: 6 }}>
            {server.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {server.tools.map((tool) => (
              <span
                key={`${server.name}-${tool}`}
                style={{
                  padding: '4px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  background: 'rgba(88, 166, 255, 0.12)',
                  border: '1px solid rgba(88, 166, 255, 0.28)',
                  color: '#9ecbff',
                }}
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
