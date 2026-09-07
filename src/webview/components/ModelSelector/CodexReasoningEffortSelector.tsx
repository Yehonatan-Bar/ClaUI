import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { CodexReasoningEffort } from '../../../extension/types/webview-messages';
import { resolveCodexModelOption } from '../../utils/codexModels';

const CODEX_REASONING_EFFORT_OPTIONS: Array<{ label: string; value: CodexReasoningEffort }> = [
  { label: 'Default', value: '' },
  { label: 'None', value: 'none' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
  { label: 'Max', value: 'max' },
  { label: 'Ultra', value: 'ultra' },
];

export const CodexReasoningEffortSelector: React.FC = () => {
  const {
    selectedModel,
    selectedCodexReasoningEffort,
    codexModelOptions,
    setSelectedCodexReasoningEffort,
  } = useAppStore();

  const availableOptions = useMemo(() => {
    // Prefer the live cache; fall back to the static capability table so the list
    // stays correct (e.g. Astra: no none/minimal) even before the CLI writes cache.
    const modelMeta = resolveCodexModelOption(selectedModel, codexModelOptions);
    const supported = modelMeta?.supportedReasoningEfforts;
    const defaultEffort = modelMeta?.defaultReasoningEffort;
    // Label the "Default" entry with the model's default reasoning effort when known.
    const withDefaultLabel = (opts: typeof CODEX_REASONING_EFFORT_OPTIONS) =>
      defaultEffort
        ? opts.map((opt) =>
            opt.value === '' ? { ...opt, label: `Default (${defaultEffort})` } : opt
          )
        : opts;

    if (!supported || supported.length === 0) {
      return withDefaultLabel(CODEX_REASONING_EFFORT_OPTIONS);
    }
    const filtered = withDefaultLabel(
      CODEX_REASONING_EFFORT_OPTIONS.filter((opt) => opt.value === '' || supported.includes(opt.value))
    );
    if (selectedCodexReasoningEffort && !filtered.some((opt) => opt.value === selectedCodexReasoningEffort)) {
      return [
        ...filtered,
        { label: `${selectedCodexReasoningEffort.toUpperCase()} (Current / Unsupported)`, value: selectedCodexReasoningEffort },
      ];
    }
    return filtered;
  }, [codexModelOptions, selectedModel, selectedCodexReasoningEffort]);

  const handleEffortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const effort = e.target.value as CodexReasoningEffort;
    setSelectedCodexReasoningEffort(effort);
    postToExtension({ type: 'setCodexReasoningEffort', effort });
  }, [setSelectedCodexReasoningEffort]);

  return (
    <div className="model-selector codex-reasoning-selector">
      <span className="model-selector-label">Reasoning</span>
      <select
        className="model-selector-select"
        value={selectedCodexReasoningEffort}
        onChange={handleEffortChange}
        data-tooltip="Codex reasoning effort (applies next turn)"
      >
        {availableOptions.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
