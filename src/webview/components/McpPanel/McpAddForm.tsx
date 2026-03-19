import React from 'react';
import type { McpScope, McpTemplateField, McpTransport } from '../../../extension/types/webview-messages';

export interface McpDraftField extends McpTemplateField {
  value: string;
}

export interface McpDraftState {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
  headerText: string;
  secretText: string;
  fields: McpDraftField[];
  notes: string[];
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'rgba(15, 23, 42, 0.72)',
  color: '#f0f6fc',
  padding: '10px 12px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const sectionStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: 12,
  background: 'rgba(22, 27, 34, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export const McpAddForm: React.FC<{
  draft: McpDraftState;
  disabled?: boolean;
  onChange: (patch: Partial<McpDraftState>) => void;
  onFieldChange: (fieldId: string, value: string) => void;
}> = ({ draft, disabled = false, onChange, onFieldChange }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={sectionStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 140px', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Server name</span>
            <input
              value={draft.name}
              disabled={disabled}
              onChange={(event) => onChange({ name: event.target.value })}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Scope</span>
            <select
              value={draft.scope}
              disabled={disabled}
              onChange={(event) => onChange({ scope: event.target.value as McpScope })}
              style={inputStyle}
            >
              <option value="project">project</option>
              <option value="local">local</option>
              <option value="user">user</option>
              <option value="managed">managed</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Transport</span>
            <select
              value={draft.transport}
              disabled={disabled}
              onChange={(event) => onChange({ transport: event.target.value as McpTransport })}
              style={inputStyle}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>
        </div>
      </div>

      {draft.transport === 'stdio' ? (
        <div style={sectionStyle}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Command</span>
            <input
              value={draft.command}
              disabled={disabled}
              onChange={(event) => onChange({ command: event.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Args</span>
            <input
              value={draft.argsText}
              disabled={disabled}
              onChange={(event) => onChange({ argsText: event.target.value })}
              style={inputStyle}
              placeholder="--flag value"
            />
          </label>
        </div>
      ) : (
        <div style={sectionStyle}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>URL</span>
            <input
              value={draft.url}
              disabled={disabled}
              onChange={(event) => onChange({ url: event.target.value })}
              style={inputStyle}
              placeholder="https://example.com/mcp"
            />
          </label>
        </div>
      )}

      {draft.fields.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>Template fields</div>
          {draft.fields.map((field) => (
            <label key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#8b949e' }}>{field.label}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={field.value}
                disabled={disabled}
                onChange={(event) => onFieldChange(field.id, event.target.value)}
                placeholder={field.placeholder}
                style={inputStyle}
              />
              {field.description && (
                <span style={{ fontSize: 12, color: '#6e7681' }}>{field.description}</span>
              )}
            </label>
          ))}
        </div>
      )}

      <div style={sectionStyle}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#8b949e' }}>Environment vars</span>
          <textarea
            value={draft.envText}
            disabled={disabled}
            onChange={(event) => onChange({ envText: event.target.value })}
            style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
            placeholder={'KEY=value\nANOTHER_KEY=${PLACEHOLDER}'}
          />
        </label>

        {(draft.transport === 'http' || draft.transport === 'sse') && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Headers</span>
            <textarea
              value={draft.headerText}
              disabled={disabled}
              onChange={(event) => onChange({ headerText: event.target.value })}
              style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
              placeholder={'Authorization=Bearer ${TOKEN}\nX-Org=example'}
            />
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#8b949e' }}>Secret values</span>
          <textarea
            value={draft.secretText}
            disabled={disabled}
            onChange={(event) => onChange({ secretText: event.target.value })}
            style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
            placeholder={'TOKEN=actual-secret\nAPI_KEY=another-secret'}
          />
          <span style={{ fontSize: 12, color: '#6e7681' }}>
            Values go to SecretStorage only. Reference them from env/headers with {'${VAR_NAME}'} placeholders.
          </span>
        </label>
      </div>

      {draft.notes.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>Notes</div>
          {draft.notes.map((note) => (
            <div key={note} style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6 }}>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
