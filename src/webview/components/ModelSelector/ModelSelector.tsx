import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { CLAUDE_MODEL_OPTIONS, getClaudeModelLabel } from '../../utils/claudeModelDisplay';

/**
 * Model selector dropdown for choosing which Claude model to use.
 * Changing the model live-switches the current session (stop + resume with new model).
 */
export const ModelSelector: React.FC = () => {
  const { selectedModel, model, isConnected, setSelectedModel } = useAppStore();

  const modelOptions = useMemo(() => {
    if (!selectedModel || CLAUDE_MODEL_OPTIONS.some((opt) => opt.value === selectedModel)) {
      return CLAUDE_MODEL_OPTIONS;
    }
    return [
      ...CLAUDE_MODEL_OPTIONS,
      { label: `Custom (${getClaudeModelLabel(selectedModel)})`, value: selectedModel },
    ];
  }, [selectedModel]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    postToExtension({ type: 'setModel', model: newModel });
  }, [setSelectedModel]);

  // Resolve display label for active model (from CLI, shown as hint)
  const activeModelLabel = model && model !== 'connecting...' && model !== 'connected' && model !== 'unknown'
    ? getClaudeModelLabel(model)
    : null;

  return (
    <div className="model-selector">
      <span className="model-selector-label">Model</span>
      <select
        className="model-selector-select"
        value={selectedModel}
        onChange={handleChange}
        data-tooltip={isConnected && activeModelLabel
          ? `Active: ${activeModelLabel}`
          : 'Select model'}
      >
        {modelOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {isConnected && activeModelLabel && (
        <span className="model-selector-active" data-tooltip="Currently active model">
          {activeModelLabel}
        </span>
      )}
    </div>
  );
};
