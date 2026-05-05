import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { CodexServiceTier } from '../../../extension/types/webview-messages';

const CODEX_SERVICE_TIER_OPTIONS: Array<{ label: string; value: CodexServiceTier }> = [
  { label: 'Default', value: '' },
  { label: 'Fast', value: 'fast' },
];

/**
 * Codex Fast mode selector. The setting is forwarded as a per-turn Codex CLI
 * config override, so changes apply the next time a Codex turn is spawned.
 */
export const CodexServiceTierSelector: React.FC = () => {
  const {
    selectedCodexServiceTier,
    setSelectedCodexServiceTier,
  } = useAppStore();

  const handleServiceTierChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const serviceTier = e.target.value as CodexServiceTier;
    setSelectedCodexServiceTier(serviceTier);
    postToExtension({ type: 'setCodexServiceTier', serviceTier });
  }, [setSelectedCodexServiceTier]);

  return (
    <div className="model-selector codex-service-tier-selector">
      <span className="model-selector-label">Speed</span>
      <select
        className="model-selector-select"
        value={selectedCodexServiceTier}
        onChange={handleServiceTierChange}
        data-tooltip="Codex service tier (Fast applies next turn and uses more credits on supported models)"
      >
        {CODEX_SERVICE_TIER_OPTIONS.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
