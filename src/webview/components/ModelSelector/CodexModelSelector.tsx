import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { CodexReasoningEffort } from '../../../extension/types/webview-messages';

const CODEX_MODEL_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'GPT-5 Codex', value: 'gpt-5-codex' },
  { label: 'GPT-5', value: 'gpt-5' },
];

const CODEX_REASONING_EFFORT_OPTIONS: Array<{ label: string; value: CodexReasoningEffort }> = [
  { label: 'Default', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
];

/**
 * Codex model selector (separate from Claude selector to avoid mixing provider-specific labels/options).
 * Changes are persisted to `claudeMirror.codex.model`.
 */
export const CodexModelSelector: React.FC = () => {
  const {
    selectedModel,
    selectedCodexReasoningEffort,
    model,
    isConnected,
    setSelectedModel,
    setSelectedCodexReasoningEffort,
  } = useAppStore();

  const options = useMemo(() => {
    if (!selectedModel || CODEX_MODEL_OPTIONS.some((opt) => opt.value === selectedModel)) {
      return CODEX_MODEL_OPTIONS;
    }
    return [
      ...CODEX_MODEL_OPTIONS,
      { label: `Custom (${selectedModel})`, value: selectedModel },
    ];
  }, [selectedModel]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    postToExtension({ type: 'setModel', model: newModel });
  }, [setSelectedModel]);

  const handleEffortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const effort = e.target.value as CodexReasoningEffort;
    setSelectedCodexReasoningEffort(effort);
    postToExtension({ type: 'setCodexReasoningEffort', effort });
  }, [setSelectedCodexReasoningEffort]);

  const activeModelLabel = model && model !== 'connecting...' && model !== 'connected' && model !== 'unknown'
    ? model
    : null;

  return (
    <div className="model-selector">
      <span className="model-selector-label">Codex</span>
      <select
        className="model-selector-select"
        value={selectedModel}
        onChange={handleChange}
        data-tooltip={isConnected && activeModelLabel
          ? `Active: ${activeModelLabel} (change applies next turn/session)`
          : 'Select Codex model (empty = CLI default)'}
      >
        {options.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {isConnected && activeModelLabel && (
        <span className="model-selector-active" data-tooltip="Currently active Codex model">
          {activeModelLabel}
        </span>
      )}
      <span className="model-selector-label">Reasoning</span>
      <select
        className="model-selector-select"
        value={selectedCodexReasoningEffort}
        onChange={handleEffortChange}
        data-tooltip="Codex reasoning effort (applies next turn)"
      >
        {CODEX_REASONING_EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
