import React, { useEffect, useState } from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { ToolFrequencyBar, CategoryDonut } from '../charts/RechartsWrappers';
import { DASH_COLORS } from '../dashboardUtils';

interface ToolsTabProps {
  turnHistory: TurnRecord[];
}

const cardStyle: React.CSSProperties = {
  background: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '8px',
  padding: '16px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: DASH_COLORS.textMuted,
  marginBottom: '6px',
};

const buttonStyle: React.CSSProperties = {
  border: `1px solid ${DASH_COLORS.border}`,
  background: 'transparent',
  color: DASH_COLORS.text,
  borderRadius: '6px',
  padding: '6px 10px',
  cursor: 'pointer',
};

export const ToolsTab: React.FC<ToolsTabProps> = ({ turnHistory }) => {
  const {
    workspaceAccessGuardEnabled,
    workspaceAccessGuardMode,
    workspaceAccessGuardStatus,
    workspaceAccessGuardAllowedRoots,
    workspaceAccessGuardOrgPolicyStatus,
    workspaceAccessGuardAuditEvents,
    workspaceAccessGuardTestResult,
    workspaceAccessGuardError,
  } = useAppStore();
  const [testValue, setTestValue] = useState('');
  const [testKind, setTestKind] = useState<'path' | 'command'>('path');

  useEffect(() => {
    postToExtension({ type: 'workspaceAccessGuardGetStatus' } as any);
    postToExtension({ type: 'workspaceAccessGuardGetAllowedRoots' } as any);
    postToExtension({ type: 'workspaceAccessGuardGetOrgPolicyStatus' } as any);
    postToExtension({ type: 'workspaceAccessGuardGetAuditEvents', limit: 20 } as any);
  }, []);

  const lastEvent = workspaceAccessGuardAuditEvents[0];
  const decisionColor = workspaceAccessGuardTestResult?.action === 'allow'
    ? '#3fb950'
    : workspaceAccessGuardTestResult?.action === 'audit'
      ? '#d29922'
      : '#f85149';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
      <div style={cardStyle}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Tool Frequency (Top 15)
        </div>
        <ToolFrequencyBar turnHistory={turnHistory} />
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: DASH_COLORS.text, marginBottom: '12px' }}>
          Turn Category Distribution
        </div>
        <CategoryDonut turnHistory={turnHistory} />
      </div>

      <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: DASH_COLORS.text }}>
              Workspace Access Guard
            </div>
            <div style={{ fontSize: '12px', color: DASH_COLORS.textMuted, marginTop: '3px' }}>
              Status: {workspaceAccessGuardStatus}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={workspaceAccessGuardMode}
              onChange={event => postToExtension({
                type: 'workspaceAccessGuardSetMode',
                mode: event.target.value as 'block' | 'audit',
              } as any)}
              style={{ ...buttonStyle, padding: '6px 8px' }}
            >
              <option value="block">Block</option>
              <option value="audit">Audit</option>
            </select>
            <button
              type="button"
              data-tooltip="Toggle Workspace Access Guard"
              style={{
                ...buttonStyle,
                background: workspaceAccessGuardEnabled ? '#1f6feb' : 'transparent',
                borderColor: workspaceAccessGuardEnabled ? '#1f6feb' : DASH_COLORS.border,
              }}
              onClick={() => postToExtension({
                type: 'workspaceAccessGuardSetEnabled',
                enabled: !workspaceAccessGuardEnabled,
              } as any)}
            >
              {workspaceAccessGuardEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          <section>
            <div style={labelStyle}>Allowed Working Folders</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <button type="button" style={buttonStyle} data-tooltip="Pick a folder to allow" onClick={() => postToExtension({ type: 'workspaceAccessGuardPickAllowedRoots' } as any)}>
                Add Folder
              </button>
              <button type="button" style={buttonStyle} data-tooltip="Allow current workspace folder" onClick={() => postToExtension({ type: 'workspaceAccessGuardAddCurrentWorkspace' } as any)}>
                Add Workspace
              </button>
            </div>
            <div style={{ display: 'grid', gap: '8px' }}>
              {workspaceAccessGuardAllowedRoots.length === 0 && (
                <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px' }}>No allowed folders configured.</div>
              )}
              {workspaceAccessGuardAllowedRoots.map(root => (
                <div
                  key={root.path}
                  style={{
                    border: `1px solid ${root.isBroad ? '#d29922' : DASH_COLORS.border}`,
                    borderRadius: '6px',
                    padding: '8px',
                    display: 'grid',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <code style={{ color: DASH_COLORS.text, wordBreak: 'break-all', fontSize: '12px' }}>{root.path}</code>
                    <button
                      type="button"
                      data-tooltip="Remove this allowed folder"
                      style={{ ...buttonStyle, padding: '4px 8px' }}
                      onClick={() => postToExtension({ type: 'workspaceAccessGuardRemoveAllowedRoot', root: root.path } as any)}
                    >
                      Remove
                    </button>
                  </div>
                  {root.broadWarning && (
                    <div style={{ color: '#d29922', fontSize: '12px' }}>{root.broadWarning}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div style={labelStyle}>Organization Policy</div>
            <div style={{ display: 'grid', gap: '6px', color: DASH_COLORS.text, fontSize: '12px' }}>
              <div>Source: {workspaceAccessGuardOrgPolicyStatus?.source ?? 'unknown'}</div>
              <div>Policy: {workspaceAccessGuardOrgPolicyStatus?.policyName ?? 'unknown'}</div>
              <div>Denied roots: {workspaceAccessGuardOrgPolicyStatus?.deniedRootCount ?? 0}</div>
              {workspaceAccessGuardOrgPolicyStatus?.filePath && (
                <code style={{ wordBreak: 'break-all' }}>{workspaceAccessGuardOrgPolicyStatus.filePath}</code>
              )}
              {workspaceAccessGuardOrgPolicyStatus?.error && (
                <div style={{ color: '#f85149' }}>{workspaceAccessGuardOrgPolicyStatus.error}</div>
              )}
            </div>

            <div style={{ ...labelStyle, marginTop: '14px' }}>Last Audit Event</div>
            {lastEvent ? (
              <div style={{ display: 'grid', gap: '5px', color: DASH_COLORS.text, fontSize: '12px' }}>
                <div>{lastEvent.provider} / {lastEvent.toolName} / {lastEvent.action}</div>
                <div>{lastEvent.reason}</div>
                {lastEvent.matchedPath && <code style={{ wordBreak: 'break-all' }}>{lastEvent.matchedPath}</code>}
              </div>
            ) : (
              <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px' }}>No WAG audit events.</div>
            )}
          </section>

          <section>
            <div style={labelStyle}>Test Path Or Command</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                type="button"
                data-tooltip="Test against a file path"
                style={{ ...buttonStyle, background: testKind === 'path' ? '#1f6feb' : 'transparent' }}
                onClick={() => setTestKind('path')}
              >
                Path
              </button>
              <button
                type="button"
                data-tooltip="Test against a shell command"
                style={{ ...buttonStyle, background: testKind === 'command' ? '#1f6feb' : 'transparent' }}
                onClick={() => setTestKind('command')}
              >
                Command
              </button>
            </div>
            <textarea
              value={testValue}
              onChange={event => setTestValue(event.target.value)}
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(0,0,0,0.18)',
                color: DASH_COLORS.text,
                border: `1px solid ${DASH_COLORS.border}`,
                borderRadius: '6px',
                padding: '8px',
                resize: 'vertical',
              }}
            />
            <button
              type="button"
              data-tooltip="Check guard decision for input"
              style={{ ...buttonStyle, marginTop: '8px' }}
              onClick={() => {
                const value = testValue.trim();
                if (!value) return;
                postToExtension(testKind === 'path'
                  ? { type: 'workspaceAccessGuardTestPath', value } as any
                  : { type: 'workspaceAccessGuardTestCommand', command: value } as any);
              }}
            >
              Check
            </button>
            {workspaceAccessGuardTestResult && (
              <div style={{ marginTop: '10px', color: DASH_COLORS.text, fontSize: '12px', display: 'grid', gap: '5px' }}>
                <div style={{ color: decisionColor, fontWeight: 700 }}>{workspaceAccessGuardTestResult.action.toUpperCase()}</div>
                <div>{workspaceAccessGuardTestResult.reason}</div>
                {workspaceAccessGuardTestResult.matchedPath && (
                  <code style={{ wordBreak: 'break-all' }}>{workspaceAccessGuardTestResult.matchedPath}</code>
                )}
              </div>
            )}
            {workspaceAccessGuardError && (
              <div style={{ color: '#f85149', fontSize: '12px', marginTop: '10px' }}>{workspaceAccessGuardError}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
