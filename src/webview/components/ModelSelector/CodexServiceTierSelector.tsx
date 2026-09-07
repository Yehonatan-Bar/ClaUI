import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { CodexServiceTier } from '../../../extension/types/webview-messages';
import { resolveCodexModelOption } from '../../utils/codexModels';

/**
 * Codex Fast mode selector. The setting is forwarded as a per-turn Codex CLI
 * config override, so changes apply the next time a Codex turn is spawned.
 *
 * Fast is offered only for models whose capability metadata advertises it
 * (`supportsFast`, from the CLI cache or the static fallback table). Fast uses
 * more credits and may be blocked by workspace or residency policy, so we never
 * present it as available for a model that does not support it. When the saved
 * selection is Fast but the model does not support it, it is shown as
 * unsupported rather than silently sent to the CLI.
 */
export const CodexServiceTierSelector: React.FC = () => {
  const {
    selectedModel,
    selectedCodexServiceTier,
    codexModelOptions,
    setSelectedCodexServiceTier,
  } = useAppStore();

  const modelMeta = resolveCodexModelOption(selectedModel, codexModelOptions);
  // Unknown models (no metadata at all) keep Fast enabled so we don't hide a
  // capability the CLI might actually support; only hide it when we positively
  // know the model does not offer Fast.
  const supportsFast = modelMeta ? modelMeta.supportsFast !== false : true;

  const options = useMemo(() => {
    const base: Array<{ label: string; value: CodexServiceTier; disabled?: boolean }> = [
      { label: 'Default', value: '' },
    ];
    if (supportsFast) {
      base.push({ label: 'Fast', value: 'fast' });
    } else if (selectedCodexServiceTier === 'fast') {
      // Preserve the saved selection but flag it as unsupported for this model.
      base.push({ label: 'Fast (Unsupported)', value: 'fast', disabled: true });
    } else {
      base.push({ label: 'Fast (Unavailable)', value: 'fast', disabled: true });
    }
    return base;
  }, [supportsFast, selectedCodexServiceTier]);

  const handleServiceTierChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const serviceTier = e.target.value as CodexServiceTier;
    setSelectedCodexServiceTier(serviceTier);
    postToExtension({ type: 'setCodexServiceTier', serviceTier });
  }, [setSelectedCodexServiceTier]);

  const fastUnsupportedSelected = !supportsFast && selectedCodexServiceTier === 'fast';

  return (
    <div className="model-selector codex-service-tier-selector">
      <span className="model-selector-label">Speed</span>
      <select
        className="model-selector-select"
        value={selectedCodexServiceTier}
        onChange={handleServiceTierChange}
        data-tooltip={
          supportsFast
            ? 'Codex service tier (Fast applies next turn and uses more credits on supported models)'
            : 'This model does not offer a Fast tier for the current account/client. Fast may also be blocked by workspace or residency policy.'
        }
      >
        {options.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {fastUnsupportedSelected && (
        <span
          className="model-selector-warning"
          data-tooltip={`Fast is selected but "${selectedModel || 'the current model'}" does not support it for the current account/client. Fast will not be sent this turn.`}
        >
          Fast unsupported
        </span>
      )}
    </div>
  );
};
