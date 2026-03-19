import React, { useEffect, useMemo, useState } from 'react';
import type {
  McpConfigDiffPreview,
  McpScope,
  McpServerConfig,
  McpTemplateDefinition,
  McpTransport,
} from '../../../extension/types/webview-messages';
import { postToExtension } from '../../hooks/useClaudeStream';
import { useAppStore } from '../../state/store';
import { McpAddForm, type McpDraftField, type McpDraftState } from './McpAddForm';
import { McpQuickAdd } from './McpQuickAdd';

type WizardSelection =
  | { kind: 'template'; template: McpTemplateDefinition }
  | { kind: 'custom'; transport: McpTransport };

function parseKeyValueText(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) {
      record[key] = value;
    }
  }
  return record;
}

function splitArgs(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function toFieldDrafts(template: McpTemplateDefinition): McpDraftField[] {
  return template.fields.map((field) => ({ ...field, value: '' }));
}

function toDraft(selection: WizardSelection): McpDraftState {
  if (selection.kind === 'template') {
    const template = selection.template;
    return {
      name: template.defaultName,
      scope: template.defaultScope,
      transport: template.transport,
      command: template.command ?? '',
      argsText: (template.args ?? []).join(' '),
      url: template.url ?? '',
      envText: Object.entries(template.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
      headerText: Object.entries(template.headers ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
      secretText: '',
      fields: toFieldDrafts(template),
      notes: template.notes ?? [],
    };
  }

  return {
    name: '',
    scope: selection.transport === 'stdio' ? 'project' : 'user',
    transport: selection.transport,
    command: selection.transport === 'stdio' ? 'cmd' : '',
    argsText: selection.transport === 'stdio' ? '/c npx -y your-mcp-package' : '',
    url: '',
    envText: '',
    headerText: '',
    secretText: '',
    fields: [],
    notes: [
      'For custom secrets, put the real value in "Secret values" and reference it from env/headers with ${VAR_NAME}.',
      'Project scope should be previewed before save so you can inspect the exact .mcp.json diff.',
    ],
  };
}

function previewMatchesDraft(preview: McpConfigDiffPreview | null, draft: McpDraftState): boolean {
  return !!preview && preview.name === draft.name && preview.scope === draft.scope;
}

export const McpAddWizard: React.FC = () => {
  const {
    provider,
    mcpTemplates,
    mcpLoading,
    mcpLastError,
    mcpDiffPreview,
    setMcpLoading,
    setMcpSelectedTab,
    setMcpDiffPreview,
  } = useAppStore();
  const [selection, setSelection] = useState<WizardSelection | null>(null);
  const [draft, setDraft] = useState<McpDraftState | null>(null);

  useEffect(() => {
    setSelection(null);
    setDraft(null);
  }, [provider]);

  const disabled = provider !== 'claude';

  useEffect(() => {
    if (!selection) {
      return;
    }
    setDraft(toDraft(selection));
  }, [selection]);

  const previewReady = useMemo(() => (draft ? previewMatchesDraft(mcpDiffPreview, draft) : false), [draft, mcpDiffPreview]);

  useEffect(() => {
    if (draft) {
      setMcpDiffPreview(null);
    }
  }, [
    draft?.name,
    draft?.scope,
    draft?.transport,
    draft?.command,
    draft?.argsText,
    draft?.url,
    draft?.envText,
    draft?.headerText,
    draft?.secretText,
    JSON.stringify(draft?.fields ?? []),
    setMcpDiffPreview,
  ]);

  const buildConfig = (): McpServerConfig | null => {
    if (!draft) {
      return null;
    }

    const env = parseKeyValueText(draft.envText);
    const headers = parseKeyValueText(draft.headerText);
    const secretValues = parseKeyValueText(draft.secretText);

    for (const field of draft.fields) {
      const nextValue = field.value.trim();
      if (!nextValue) {
        continue;
      }

      if (field.secret) {
        secretValues[field.envVar ?? field.key] = nextValue;
        if (field.target === 'env' && !env[field.key]) {
          env[field.key] = `\${${field.envVar ?? field.key}}`;
        }
        continue;
      }

      if (field.target === 'env') {
        env[field.key] = nextValue;
      } else {
        headers[field.key] = nextValue;
      }
    }

    return {
      transport: draft.transport,
      command: draft.transport === 'stdio' ? draft.command.trim() || undefined : undefined,
      args: draft.transport === 'stdio' ? splitArgs(draft.argsText) : undefined,
      url: draft.transport !== 'stdio' ? draft.url.trim() || undefined : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      secretValues: Object.keys(secretValues).length > 0 ? secretValues : undefined,
    };
  };

  const validate = (): string | null => {
    if (!draft) {
      return 'Choose a template or custom transport first.';
    }
    if (!draft.name.trim()) {
      return 'Server name is required.';
    }
    if (draft.transport === 'stdio' && !draft.command.trim()) {
      return 'stdio MCP servers require a command.';
    }
    if (draft.transport !== 'stdio' && !draft.url.trim()) {
      return `${draft.transport} MCP servers require a URL.`;
    }
    const missingField = draft.fields.find((field) => field.required && !field.value.trim());
    if (missingField) {
      return `${missingField.label} is required.`;
    }
    return null;
  };

  const handlePreview = () => {
    const error = validate();
    if (error) {
      window.alert(error);
      return;
    }
    const config = buildConfig();
    if (!config || !draft) {
      return;
    }
    setMcpLoading(true);
    postToExtension({
      type: 'mcpPreviewAddServer',
      name: draft.name.trim(),
      config,
      scope: draft.scope,
    });
  };

  const handleApply = () => {
    const error = validate();
    if (error) {
      window.alert(error);
      return;
    }
    const config = buildConfig();
    if (!config || !draft) {
      return;
    }
    if (draft.scope === 'project' && !previewReady) {
      handlePreview();
      return;
    }
    setMcpLoading(true);
    postToExtension({
      type: 'mcpAddServer',
      name: draft.name.trim(),
      config,
      scope: draft.scope,
    });
    setMcpSelectedTab('workspace');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {disabled && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(56, 139, 253, 0.12)', color: '#9ecbff' }}>
          MCP add/remove flows are available only in Claude tabs. This panel stays read-only in non-Claude providers.
        </div>
      )}

      <McpQuickAdd
        templates={mcpTemplates}
        disabled={disabled}
        onSelectTemplate={(template) => setSelection({ kind: 'template', template })}
        onSelectCustom={(transport) => setSelection({ kind: 'custom', transport })}
        onImportDesktop={() => {
          if (disabled) {
            return;
          }
          setMcpLoading(true);
          postToExtension({ type: 'mcpImportDesktop' });
          setMcpSelectedTab('workspace');
        }}
      />

      {draft && (
        <>
          <McpAddForm
            draft={draft}
            disabled={disabled || mcpLoading}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
            onFieldChange={(fieldId, value) =>
              setDraft((current) => {
                if (!current) {
                  return current;
                }
                return {
                  ...current,
                  fields: current.fields.map((field) => (field.id === fieldId ? { ...field, value } : field)),
                };
              })
            }
          />

          {draft.scope === 'project' && (
            <div
              style={{
                padding: '16px',
                borderRadius: 12,
                background: 'rgba(22, 27, 34, 0.92)',
                border: '1px solid rgba(148, 163, 184, 0.14)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>.mcp.json preview</div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>
                Project-scope writes require a preview first so you can inspect the projected config diff.
              </div>
              {mcpDiffPreview && previewReady && (
                <pre
                  style={{
                    margin: 0,
                    padding: '12px',
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid rgba(148, 163, 184, 0.14)',
                    color: '#c9d1d9',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}
                >
                  {mcpDiffPreview.diff}
                </pre>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {draft.scope === 'project' && (
              <button
                onClick={handlePreview}
                disabled={disabled || mcpLoading}
                style={{
                  padding: '9px 14px',
                  borderRadius: 9,
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  background: 'transparent',
                  color: disabled ? '#6e7681' : '#c9d1d9',
                  cursor: disabled || mcpLoading ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {mcpLoading ? 'Working...' : 'Preview project config'}
              </button>
            )}
            <button
              onClick={handleApply}
              disabled={disabled || mcpLoading}
              style={{
                padding: '9px 14px',
                borderRadius: 9,
                border: '1px solid rgba(88, 166, 255, 0.3)',
                background: 'rgba(56, 139, 253, 0.16)',
                color: disabled ? '#6e7681' : '#dbeafe',
                cursor: disabled || mcpLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {draft.scope === 'project' && !previewReady ? 'Preview before save' : 'Add server'}
            </button>
          </div>

          {mcpLastError && (
            <div style={{ fontSize: 12, color: '#ffaba8' }}>
              {mcpLastError}
            </div>
          )}
        </>
      )}
    </div>
  );
};
