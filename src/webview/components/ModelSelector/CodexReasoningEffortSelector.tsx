import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { CodexReasoningEffort } from '../../../extension/types/webview-messages';

const CODEX_REASONING_EFFORT_OPTIONS: Array<{ label: string; value: CodexReasoningEffort }> = [
  { label: 'Default', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
];

export const CodexReasoningEffortSelector: React.FC = () => {
  const {
    selectedModel,
    selectedCodexReasoningEffort,
    codexModelOptions,
    setSelectedCodexReasoningEffort,
  } = useAppStore();

  const availableOptions = useMemo(() => {
    const modelMeta = codexModelOptions.find((m) => m.value === selectedModel);
    const supported = modelMeta?.supportedReasoningEfforts;
    if (!supported || supported.length === 0) {
      return CODEX_REASONING_EFFORT_OPTIONS;
    }
    const filtered = CODEX_REASONING_EFFORT_OPTIONS.filter(
      (opt) => opt.value === '' || supported.includes(opt.value)
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
