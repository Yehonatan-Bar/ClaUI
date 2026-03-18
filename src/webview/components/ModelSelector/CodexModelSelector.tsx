import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const CODEX_MODEL_OPTIONS_FALLBACK = [
  { label: 'Default', value: '' },
  { label: 'GPT-5.4', value: 'gpt-5.4' },
  { label: 'GPT-5.3-Codex', value: 'gpt-5.3-codex' },
  { label: 'GPT-5.2-Codex', value: 'gpt-5.2-codex' },
  { label: 'GPT-5.1-Codex-Max', value: 'gpt-5.1-codex-max' },
  { label: 'GPT-5.2', value: 'gpt-5.2' },
  { label: 'GPT-5.1-Codex-Mini', value: 'gpt-5.1-codex-mini' },
  // Keep older aliases for compatibility with existing configs.
  { label: 'GPT-5 Codex (Legacy)', value: 'gpt-5-codex' },
  { label: 'GPT-5 (Legacy)', value: 'gpt-5' },
];

/**
 * Codex model selector (separate from Claude selector to avoid mixing provider-specific labels/options).
 * Changes are persisted to `claudeMirror.codex.model`.
 */
export const CodexModelSelector: React.FC = () => {
  const {
    selectedModel,
    model,
    isConnected,
    codexModelOptions,
    setSelectedModel,
  } = useAppStore();

  const options = useMemo(() => {
    const baseOptions = [
      CODEX_MODEL_OPTIONS_FALLBACK[0],
      ...(codexModelOptions.length > 0 ? codexModelOptions : CODEX_MODEL_OPTIONS_FALLBACK.slice(1)),
    ];

    if (!selectedModel || baseOptions.some((opt) => opt.value === selectedModel)) {
      return baseOptions;
    }
    return [
      ...baseOptions,
      { label: `Custom (${selectedModel})`, value: selectedModel },
    ];
  }, [selectedModel, codexModelOptions]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    postToExtension({ type: 'setModel', model: newModel });
  }, [setSelectedModel]);

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
    </div>
  );
};
