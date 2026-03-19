import React from 'react';
import type { McpServerInfo } from '../../../extension/types/webview-messages';

const STATUS_TONES: Record<McpServerInfo['effectiveStatus'], { bg: string; border: string; text: string; label: string }> = {
  active: { bg: 'rgba(35, 134, 54, 0.16)', border: '#2ea043', text: '#7ee787', label: 'Active' },
  configured: { bg: 'rgba(56, 139, 253, 0.14)', border: '#388bfd', text: '#9ecbff', label: 'Configured' },
  pending_restart: { bg: 'rgba(210, 153, 34, 0.14)', border: '#d29922', text: '#f2cc60', label: 'Restart needed' },
  needs_auth: { bg: 'rgba(251, 133, 0, 0.14)', border: '#fb8500', text: '#ffcc80', label: 'Needs login' },
  needs_approval: { bg: 'rgba(168, 85, 247, 0.15)', border: '#a855f7', text: '#d8b4fe', label: 'Needs approval' },
  broken: { bg: 'rgba(248, 81, 73, 0.15)', border: '#f85149', text: '#ffaba8', label: 'Broken' },
  unknown: { bg: 'rgba(110, 118, 129, 0.14)', border: '#6e7681', text: '#c9d1d9', label: 'Unknown' },
};

const baseCardStyle: React.CSSProperties = {
  borderRadius: 12,
  padding: '14px 16px',
  background: 'rgba(22, 27, 34, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export interface McpServerCardProps {
  server: McpServerInfo;
  subtitle?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
    tone?: 'primary' | 'danger' | 'neutral';
    disabled?: boolean;
  }>;
  children?: React.ReactNode;
}

export function getMcpStatusTone(status: McpServerInfo['effectiveStatus']) {
  return STATUS_TONES[status] ?? STATUS_TONES.unknown;
}

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  subtitle,
  actions,
  children,
}) => {
  const tone = getMcpStatusTone(server.effectiveStatus);

  return (
    <div style={{ ...baseCardStyle, borderColor: tone.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f0f6fc' }}>{server.name}</div>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: tone.bg,
            border: `1px solid ${tone.border}`,
            color: tone.text,
          }}
        >
          {tone.label}
        </span>
        <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>{server.scope}</span>
        {server.transport && (
          <span style={{ fontSize: 11, color: '#9fb3c8', textTransform: 'uppercase' }}>{server.transport}</span>
        )}
        {server.restartRequired && (
          <span style={{ fontSize: 11, color: '#f2cc60' }}>Restart session</span>
        )}
      </div>

      {subtitle && (
        <div style={{ fontSize: 12, color: '#8b949e' }}>{subtitle}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#c9d1d9' }}>
        {server.command && <span>Command: <code>{server.command}</code></span>}
        {server.url && <span>URL: <code>{server.url}</code></span>}
        {server.args && server.args.length > 0 && <span>Args: <code>{server.args.join(' ')}</code></span>}
        {server.envKeys && server.envKeys.length > 0 && <span>Env: <code>{server.envKeys.join(', ')}</code></span>}
        {server.headerKeys && server.headerKeys.length > 0 && <span>Headers: <code>{server.headerKeys.join(', ')}</code></span>}
      </div>

      {server.lastError && (
        <div style={{ fontSize: 12, color: '#ffaba8' }}>{server.lastError}</div>
      )}

      {children}

      {actions && actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.map((action) => {
            const tone = action.tone ?? 'primary';
            const palette =
              tone === 'danger'
                ? { border: 'rgba(248, 81, 73, 0.28)', bg: 'rgba(248, 81, 73, 0.12)', text: '#ffaba8' }
                : tone === 'neutral'
                  ? { border: 'rgba(148, 163, 184, 0.22)', bg: 'transparent', text: '#c9d1d9' }
                  : { border: 'rgba(88, 166, 255, 0.28)', bg: 'rgba(56, 139, 253, 0.16)', text: '#dbeafe' };
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: `1px solid ${palette.border}`,
                  background: palette.bg,
                  color: action.disabled ? '#6e7681' : palette.text,
                  cursor: action.disabled ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
