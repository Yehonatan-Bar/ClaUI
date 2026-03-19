import React from 'react';
import type { McpTemplateDefinition } from '../../../extension/types/webview-messages';

const cardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.14)',
  background: 'rgba(22, 27, 34, 0.92)',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  textAlign: 'left',
  cursor: 'pointer',
};

export const McpQuickAdd: React.FC<{
  templates: McpTemplateDefinition[];
  disabled?: boolean;
  onSelectTemplate: (template: McpTemplateDefinition) => void;
  onSelectCustom: (transport: 'stdio' | 'http' | 'sse') => void;
  onImportDesktop: () => void;
}> = ({ templates, disabled = false, onSelectTemplate, onSelectCustom, onImportDesktop }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9' }}>Recommended</div>
        <button
          onClick={onImportDesktop}
          disabled={disabled}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            background: 'rgba(56, 139, 253, 0.14)',
            color: disabled ? '#6e7681' : '#dbeafe',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Import from Claude Desktop
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelectTemplate(template)}
            disabled={disabled}
            style={{
              ...cardStyle,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>{template.title}</div>
              <span style={{ fontSize: 11, color: '#9fb3c8', textTransform: 'uppercase' }}>{template.transport}</span>
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.55 }}>{template.description}</div>
            <div style={{ fontSize: 11, color: '#6e7681' }}>
              Default: <code>{template.defaultName}</code> • {template.defaultScope}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(['stdio', 'http', 'sse'] as const).map((transport) => (
          <button
            key={transport}
            onClick={() => onSelectCustom(transport)}
            disabled={disabled}
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.18)',
              background: 'transparent',
              color: disabled ? '#6e7681' : '#c9d1d9',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            Custom {transport.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
};
