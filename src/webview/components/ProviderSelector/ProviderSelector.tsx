import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { ProviderId } from '../../../extension/types/webview-messages';

const PROVIDER_OPTIONS: Array<{ label: string; value: ProviderId }> = [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Happy', value: 'remote' },
];

function providerLabel(provider: ProviderId | null): string {
  if (provider === 'codex') { return 'Codex'; }
  if (provider === 'remote') { return 'Happy'; }
  return 'Claude';
}

export const ProviderSelector: React.FC = () => {
  const { selectedProvider, provider, setSelectedProvider } = useAppStore();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProvider = e.target.value as ProviderId;
    setSelectedProvider(nextProvider);
    postToExtension({ type: 'setProvider', provider: nextProvider });
  }, [setSelectedProvider]);

  return (
    <div className="provider-selector">
      <span className="provider-selector-label">Provider</span>
      <select
        className="provider-selector-select"
        value={selectedProvider}
        onChange={handleChange}
        data-tooltip={`Default for new sessions: ${providerLabel(selectedProvider)}${provider ? ` | Current tab: ${providerLabel(provider)}` : ''}`}
      >
        {PROVIDER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
