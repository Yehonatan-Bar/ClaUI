import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, CouncilSettingsData, CouncilOpenAiProvider } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Council settings panel (Tools -> Council settings).
 *
 * Edits the whole model-council configuration without touching settings.json:
 * members (Claude Code / Codex / Grok / any OpenAI-compatible provider), the
 * chair, the per-member timeout, and the OpenAI-compatible provider profiles
 * (with one-click presets for GPT / Gemini / Claude API). Save persists to the
 * `claudeMirror.bridge.council.*` + `claudeMirror.bridge.openaiProviders`
 * settings; the extension mirrors them into ~/.claui/bridge.json for the runtime.
 */

type Engine = 'claude' | 'codex' | 'grok' | 'openai';

interface EditableMember {
  engine: Engine;
  model: string;
  providerId: string;
}

const ENGINE_LABELS: Record<Engine, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok',
  openai: 'OpenAI-compatible',
};

/** Provider presets — each maps a well-known API onto the OpenAI-compatible
 *  shape (Bearer auth, `/chat/completions` under baseUrl). Keys are read from
 *  environment variables (no secrets stored in settings). */
const PROVIDER_PRESETS: { key: string; label: string; make: () => CouncilOpenAiProvider }[] = [
  {
    key: 'gpt',
    label: 'GPT (OpenAI)',
    make: () => ({
      id: 'gpt',
      label: 'OpenAI GPT',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: ['gpt-4o'],
    }),
  },
  {
    key: 'gemini',
    label: 'Gemini (Google)',
    make: () => ({
      id: 'gemini',
      label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeyEnv: 'GEMINI_API_KEY',
      models: ['gemini-2.5-pro'],
    }),
  },
  {
    key: 'claude-api',
    label: 'Claude (Anthropic API)',
    make: () => ({
      id: 'claude-api',
      label: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: ['claude-sonnet-4-5'],
    }),
  },
];

function parseMember(token: string): EditableMember {
  const t = (token || '').trim();
  if (t.startsWith('openai/')) {
    const rest = t.slice('openai/'.length);
    const slash = rest.indexOf('/');
    return slash < 0
      ? { engine: 'openai', providerId: rest, model: '' }
      : { engine: 'openai', providerId: rest.slice(0, slash), model: rest.slice(slash + 1) };
  }
  const slash = t.indexOf('/');
  const head = (slash < 0 ? t : t.slice(0, slash)) as Engine;
  const engine: Engine = head === 'claude' || head === 'codex' || head === 'grok' ? head : 'claude';
  return { engine, providerId: '', model: slash < 0 ? '' : t.slice(slash + 1) };
}

function serializeMember(m: EditableMember): string {
  // Keep the openai shape even while incomplete so the row does not flip back to
  // a Claude row on re-parse; incomplete openai tokens are dropped on save.
  if (m.engine === 'openai') return `openai/${m.providerId}/${m.model}`;
  return m.model.trim() ? `${m.engine}/${m.model.trim()}` : m.engine;
}

/** A member token that will actually resolve at runtime (openai needs both a
 *  provider id and a model). Used to drop half-configured rows on save. */
function isCompleteMember(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (t.startsWith('openai/')) {
    const rest = t.slice('openai/'.length);
    const slash = rest.indexOf('/');
    return slash > 0 && rest.slice(slash + 1).trim().length > 0;
  }
  return true;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const box: React.CSSProperties = {
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
};
const btn: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
  border: 'none',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  ...btn,
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
};

export const CouncilSettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { councilSettings, councilDetected } = useAppStore();
  const [draft, setDraft] = useState<CouncilSettingsData | null>(null);
  const dirtyRef = useRef(false);

  // Ask the extension for the current config on open.
  useEffect(() => {
    postToExtension({ type: 'getCouncilSettings' });
  }, []);

  // Adopt fetched config as the working draft — but never clobber unsaved edits.
  useEffect(() => {
    if (councilSettings && !dirtyRef.current) setDraft(clone(councilSettings));
  }, [councilSettings]);

  const mutate = useCallback((fn: (d: CouncilSettingsData) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      fn(next);
      dirtyRef.current = true;
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!draft) return;
    const cleaned: CouncilSettingsData = {
      ...draft,
      members: draft.members.map((m) => m.trim()).filter(isCompleteMember),
      providers: draft.providers.filter((p) => p.id.trim() && p.baseUrl.trim()),
    };
    postToExtension({ type: 'setCouncilSettings', settings: cleaned });
    dirtyRef.current = false;
    onClose();
  }, [draft, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  const engineHint = (engine: Engine): string => {
    if (engine === 'openai') return 'HTTP (needs a provider + key)';
    if (!councilDetected) return '';
    const ok = councilDetected[engine];
    return ok ? 'installed' : 'not found';
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
  const card: React.CSSProperties = {
    background: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editor-foreground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 6,
    width: 'min(680px, 94vw)',
    maxHeight: '88vh',
    overflowY: 'auto',
    padding: 16,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
  };
  const sectionTitle: React.CSSProperties = { fontWeight: 600, margin: '14px 0 6px', fontSize: 13 };

  const members = draft?.members ?? [];

  return (
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={handleKeyDown}>
      <div style={card} role="dialog" aria-label="Council settings">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Council settings</span>
          <button style={btn} onClick={onClose} data-tooltip="Close (Esc)">
            x
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          Each turn asks every member independently; the chair then synthesizes one ruling. A council
          needs at least 2 available members. Cost is reported as 0 (a turn calls several paid models).
        </div>

        {!draft ? (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.7 }}>Loading…</div>
        ) : (
          <>
            {/* Enabled */}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => mutate((d) => (d.enabled = e.target.checked))}
              />
              Show the Council entry in the model picker
            </label>

            {/* Members */}
            <div style={sectionTitle}>Members</div>
            {members.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                No members yet — add at least 2 below.
              </div>
            )}
            {members.map((token, i) => {
              const m = parseMember(token);
              return (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <select
                    style={{ ...box, minWidth: 130 }}
                    value={m.engine}
                    onChange={(e) =>
                      mutate((d) => {
                        const nm = { ...m, engine: e.target.value as Engine };
                        d.members[i] = serializeMember(nm);
                      })
                    }
                  >
                    {(Object.keys(ENGINE_LABELS) as Engine[]).map((eng) => (
                      <option key={eng} value={eng}>
                        {ENGINE_LABELS[eng]}
                      </option>
                    ))}
                  </select>
                  {m.engine === 'openai' && (
                    <select
                      style={{ ...box, minWidth: 120 }}
                      value={m.providerId}
                      onChange={(e) => mutate((d) => (d.members[i] = serializeMember({ ...m, providerId: e.target.value })))}
                    >
                      <option value="">(provider)</option>
                      {draft.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label || p.id}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    style={{ ...box, flex: 1, minWidth: 120 }}
                    value={m.model}
                    placeholder={m.engine === 'openai' ? 'model (e.g. gpt-4o)' : 'model — blank = engine default'}
                    onChange={(e) => mutate((d) => (d.members[i] = serializeMember({ ...m, model: e.target.value })))}
                  />
                  <span style={{ fontSize: 11, opacity: 0.65, minWidth: 70 }}>{engineHint(m.engine)}</span>
                  <button style={btn} onClick={() => mutate((d) => d.members.splice(i, 1))} data-tooltip="Remove member">
                    -
                  </button>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <button style={btn} onClick={() => mutate((d) => d.members.push('claude'))}>
                + Claude Code
              </button>
              <button style={btn} onClick={() => mutate((d) => d.members.push('codex'))}>
                + Codex
              </button>
              <button style={btn} onClick={() => mutate((d) => d.members.push('grok'))}>
                + Grok
              </button>
              <button
                style={btn}
                onClick={() => mutate((d) => d.members.push(draft.providers[0] ? `openai/${draft.providers[0].id}/` : 'openai//'))}
              >
                + OpenAI provider
              </button>
            </div>

            {/* Chair */}
            <div style={sectionTitle}>Chair (synthesizes the final ruling)</div>
            <select
              style={{ ...box, width: '100%' }}
              value={draft.chair}
              onChange={(e) => mutate((d) => (d.chair = e.target.value))}
            >
              <option value="">Auto (prefers Claude, else first available member)</option>
              {members
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>

            {/* Timeout */}
            <div style={sectionTitle}>Per-member timeout (seconds)</div>
            <input
              type="number"
              min={15}
              max={600}
              style={{ ...box, width: 120 }}
              value={Math.round((draft.timeoutMs || 240000) / 1000)}
              onChange={(e) => mutate((d) => (d.timeoutMs = Math.max(15, Math.min(600, Number(e.target.value) || 240)) * 1000))}
            />

            {/* Providers */}
            <div style={sectionTitle}>OpenAI-compatible providers (GPT / Gemini / Claude API / local)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  style={btn}
                  onClick={() =>
                    mutate((d) => {
                      const p = preset.make();
                      let id = p.id;
                      let n = 2;
                      while (d.providers.some((x) => x.id === id)) id = `${p.id}-${n++}`;
                      d.providers.push({ ...p, id });
                    })
                  }
                  data-tooltip={`Add a ${preset.label} provider preset (API key read from an env var)`}
                >
                  + {preset.label}
                </button>
              ))}
            </div>
            {draft.providers.map((p, i) => (
              <div
                key={i}
                style={{ border: '1px solid var(--vscode-panel-border)', borderRadius: 4, padding: 8, marginBottom: 8 }}
              >
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    style={{ ...box, width: 110 }}
                    value={p.id}
                    placeholder="id"
                    onChange={(e) => mutate((d) => (d.providers[i].id = e.target.value.trim()))}
                  />
                  <input
                    style={{ ...box, flex: 1, minWidth: 120 }}
                    value={p.label || ''}
                    placeholder="label"
                    onChange={(e) => mutate((d) => (d.providers[i].label = e.target.value))}
                  />
                  <button style={btn} onClick={() => mutate((d) => d.providers.splice(i, 1))} data-tooltip="Remove provider">
                    -
                  </button>
                </div>
                <input
                  style={{ ...box, width: '100%', marginTop: 6 }}
                  value={p.baseUrl}
                  placeholder="baseUrl (e.g. https://api.openai.com/v1) — '/chat/completions' is appended"
                  onChange={(e) => mutate((d) => (d.providers[i].baseUrl = e.target.value.trim()))}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <input
                    style={{ ...box, flex: 1, minWidth: 140 }}
                    value={p.apiKeyEnv || ''}
                    placeholder="apiKeyEnv (env var holding the key)"
                    onChange={(e) => mutate((d) => (d.providers[i].apiKeyEnv = e.target.value.trim()))}
                  />
                  <input
                    style={{ ...box, flex: 2, minWidth: 160 }}
                    value={(p.models || []).join(', ')}
                    placeholder="models (comma-separated)"
                    onChange={(e) =>
                      mutate(
                        (d) =>
                          (d.providers[i].models = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)),
                      )
                    }
                  />
                </div>
              </div>
            ))}

            {/* Footer */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={btn} onClick={onClose}>
                Cancel
              </button>
              <button style={primaryBtn} onClick={handleSave}>
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
