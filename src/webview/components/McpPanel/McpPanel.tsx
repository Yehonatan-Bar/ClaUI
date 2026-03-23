import React, { useEffect, useState } from 'react';
import { postToExtension } from '../../hooks/useClaudeStream';
import { useAppStore } from '../../state/store';
import type { BugReportContext, McpServerInfo, ProviderId } from '../../../extension/types/webview-messages';
import { McpAddTab } from './McpAddTab';
import { McpDebugTab } from './McpDebugTab';
import { McpSessionTab } from './McpSessionTab';
import { McpWorkspaceTab } from './McpWorkspaceTab';

const TABS = [
  { key: 'session', label: 'Session' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'add', label: 'Add' },
  { key: 'debug', label: 'Debug' },
] as const;

function buildMcpBugReportContext(
  provider: ProviderId | null,
  servers: McpServerInfo[],
  pendingRestartCount: number,
  lastError: string | null,
  lastOperation: { op: string; name?: string; success: boolean; restartNeeded?: boolean; nextAction?: string } | null,
): BugReportContext {
  const inventoryLines = servers.length > 0
    ? servers.slice(0, 12).map((server) =>
      `- ${server.name} [scope=${server.scope}] status=${server.effectiveStatus} runtime=${server.runtimeStatus} transport=${server.transport ?? 'unknown'} tools=${server.tools.length}${server.pendingMutation ? ` pending=${server.pendingMutation}` : ''}${server.restartRequired ? ' restart=true' : ''}${server.nextAction && server.nextAction !== 'none' ? ` next=${server.nextAction}` : ''}${server.lastError ? ` error=${server.lastError}` : ''}`
    )
    : ['- No MCP servers detected in current inventory'];

  const metadataText = [
    `Provider: ${provider ?? 'unknown'}`,
    `MCP inventory count: ${servers.length}`,
    `Pending restart count: ${pendingRestartCount}`,
    `Last MCP error: ${lastError ?? 'none'}`,
    `Last MCP operation: ${lastOperation ? `${lastOperation.op}${lastOperation.name ? ` ${lastOperation.name}` : ''} | success=${lastOperation.success} | restartNeeded=${lastOperation.restartNeeded ? 'yes' : 'no'} | nextAction=${lastOperation.nextAction ?? 'none'}` : 'none'}`,
    'Servers:',
    ...inventoryLines,
  ].join('\n');

  return {
    source: 'mcp',
    title: 'Report MCP Issue',
    quickDescription: [
      'MCP issue summary:',
      '- What were you trying to do?',
      '- Which server or scope was affected?',
      '- What happened instead?',
      '- Can you reproduce it?',
      '',
      'An MCP state snapshot will be attached automatically.',
    ].join('\n'),
    aiPrompt: 'I am reporting an MCP issue in ClaUi. Use the attached MCP snapshot first, then help me diagnose the issue with focused follow-up questions.',
    metadataText,
  };
}

export const McpPanel: React.FC = () => {
  const {
    provider,
    mcpPanelOpen,
    mcpSelectedTab,
    mcpInventory,
    mcpPendingRestartCount,
    mcpLoading,
    mcpLastError,
    mcpLastOperation,
    mcpConfigPaths,
    setMcpPanelOpen,
    setMcpSelectedTab,
    setMcpLoading,
    setBugReportContext,
    setBugReportMode,
    setBugReportPanelOpen,
  } = useAppStore();

  useEffect(() => {
    if (!mcpPanelOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMcpPanelOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mcpPanelOpen, setMcpPanelOpen]);

  if (!mcpPanelOpen) {
    return null;
  }

  const handleRefresh = () => {
    setMcpLoading(true);
    postToExtension({ type: 'mcpRefresh' });
  };

  const handleOpenConfig = (scope?: 'local' | 'project' | 'user' | 'managed' | 'unknown') => {
    postToExtension({ type: 'mcpOpenConfig', scope });
  };

  const handleOpenLogs = () => {
    postToExtension({ type: 'mcpOpenLogs' });
  };

  const handleReportIssue = () => {
    setBugReportContext(
      buildMcpBugReportContext(
        provider,
        mcpInventory,
        mcpPendingRestartCount,
        mcpLastError,
        mcpLastOperation,
      ),
    );
    setBugReportMode('quick');
    setBugReportPanelOpen(true);
  };

  const hasReconnectAction =
    provider === 'claude' &&
    mcpInventory.some((server) => server.nextAction === 'reconnect');
  const hasRestartAction =
    provider === 'claude' &&
    (
      mcpPendingRestartCount > 0 ||
      mcpLastOperation?.nextAction === 'restart-session' ||
      mcpLastOperation?.restartNeeded
    );

  // Track restart operation lifecycle for user feedback
  const [restartInFlight, setRestartInFlight] = useState(false);
  const restartSucceeded = mcpLastOperation?.op === 'restartSession' && mcpLastOperation?.success === true;
  const restartFailed = mcpLastOperation?.op === 'restartSession' && mcpLastOperation?.success === false;

  // Clear in-flight state when the restart operation result arrives
  useEffect(() => {
    if (mcpLastOperation?.op === 'restartSession') {
      setRestartInFlight(false);
    }
  }, [mcpLastOperation]);

  // Show banner when restart is needed, in progress, or just succeeded (waiting for reload)
  const restartBannerVisible = hasRestartAction || hasReconnectAction || restartInFlight;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        background: 'rgba(4, 8, 15, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          margin: '24px',
          flex: 1,
          borderRadius: 18,
          overflow: 'hidden',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          background: 'linear-gradient(180deg, rgba(13, 18, 28, 0.98) 0%, rgba(9, 13, 20, 0.98) 100%)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 30px 70px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f0f6fc' }}>MCP Inventory</div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>
              {mcpInventory.length} server{mcpInventory.length === 1 ? '' : 's'}
              {mcpPendingRestartCount > 0 ? ` | ${mcpPendingRestartCount} pending restart` : ''}
              {provider !== 'claude' ? ' | read-only in this provider' : ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleReportIssue}
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid rgba(249, 115, 22, 0.35)',
                background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.28), rgba(239, 68, 68, 0.22))',
                color: '#ffedd5',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 800,
                boxShadow: '0 8px 24px rgba(239, 68, 68, 0.16)',
              }}
              title="Send an MCP-specific bug report with current MCP state attached"
            >
              Report MCP issue
            </button>
            <button
              onClick={handleRefresh}
              disabled={mcpLoading}
              style={{
                padding: '8px 12px',
                borderRadius: 9,
                border: '1px solid rgba(148, 163, 184, 0.2)',
                background: 'rgba(56, 139, 253, 0.14)',
                color: mcpLoading ? '#6e7681' : '#dbeafe',
                cursor: mcpLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {mcpLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={() => setMcpPanelOpen(false)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                border: '1px solid rgba(148, 163, 184, 0.16)',
                background: 'transparent',
                color: '#c9d1d9',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              x
            </button>
          </div>
        </div>

        {restartBannerVisible && (
          <div
            style={{
              padding: '12px 18px',
              borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
              background: restartSucceeded
                ? 'rgba(46, 160, 67, 0.12)'
                : restartFailed
                  ? 'rgba(248, 81, 73, 0.12)'
                  : 'rgba(210, 153, 34, 0.12)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{
              fontSize: 12,
              color: restartSucceeded
                ? '#7ee787'
                : restartFailed
                  ? '#f85149'
                  : '#f2cc60',
            }}>
              {restartInFlight
                ? 'Restarting session...'
                : restartSucceeded
                  ? 'Session restarted successfully. MCP servers are reloading...'
                  : restartFailed
                    ? `Restart failed: ${mcpLastError || 'Unknown error'}`
                    : hasRestartAction
                      ? 'Config changed. Restart the active Claude session to load updated MCP settings.'
                      : 'One or more MCP servers look disconnected. Try reconnecting the active Claude session.'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!restartSucceeded && (
                <button
                  onClick={() => {
                    setRestartInFlight(true);
                    setMcpLoading(true);
                    postToExtension({ type: 'mcpRestartSession' });
                  }}
                  disabled={restartInFlight || mcpLoading}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${restartInFlight ? 'rgba(148, 163, 184, 0.2)' : 'rgba(210, 153, 34, 0.3)'}`,
                    background: restartInFlight ? 'rgba(148, 163, 184, 0.08)' : 'rgba(210, 153, 34, 0.18)',
                    color: restartInFlight ? '#8b949e' : '#fff3bf',
                    cursor: restartInFlight || mcpLoading ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    opacity: restartInFlight || mcpLoading ? 0.6 : 1,
                  }}
                >
                  {restartInFlight
                    ? 'Restarting...'
                    : hasRestartAction ? 'Restart session now' : 'Try reconnect'}
                </button>
              )}
              {hasRestartAction && !restartSucceeded && !restartInFlight && (
                <button
                  onClick={() => setMcpSelectedTab('session')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    background: 'transparent',
                    color: '#c9d1d9',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Apply later
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, padding: '14px 18px 0' }}>
          {TABS.map((tab) => {
            const active = tab.key === mcpSelectedTab;
            return (
              <button
                key={tab.key}
                onClick={() => setMcpSelectedTab(tab.key)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '10px 10px 0 0',
                  border: '1px solid rgba(148, 163, 184, 0.14)',
                  borderBottomColor: active ? 'transparent' : 'rgba(148, 163, 184, 0.14)',
                  background: active ? 'rgba(15, 23, 42, 0.98)' : 'rgba(15, 23, 42, 0.45)',
                  color: active ? '#f0f6fc' : '#8b949e',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, background: 'rgba(15, 23, 42, 0.55)' }}>
          {mcpSelectedTab === 'session' && (
            <McpSessionTab servers={mcpInventory} pendingRestartCount={mcpPendingRestartCount} />
          )}
          {mcpSelectedTab === 'workspace' && (
            <McpWorkspaceTab provider={provider} servers={mcpInventory} onOpenConfig={handleOpenConfig} />
          )}
          {mcpSelectedTab === 'add' && <McpAddTab />}
          {mcpSelectedTab === 'debug' && (
            <McpDebugTab
              provider={provider}
              servers={mcpInventory}
              configPaths={mcpConfigPaths}
              lastError={mcpLastError}
              lastOperation={mcpLastOperation}
              onOpenConfig={handleOpenConfig}
              onOpenLogs={handleOpenLogs}
            />
          )}
        </div>
      </div>
    </div>
  );
};
