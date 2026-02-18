import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/** Available Claude Code models with display labels */
const MODEL_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
  { label: 'Opus 4.6', value: 'claude-opus-4-6' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
];

/**
 * Model selector dropdown for choosing which Claude model to use.
 * Changes take effect on the next session start.
 */
export const ModelSelector: React.FC = () => {
  const { selectedModel, model, isConnected, setSelectedModel } = useAppStore();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    postToExtension({ type: 'setModel', model: newModel });
  }, [setSelectedModel]);

  // Resolve display label for active model (from CLI, shown as hint)
  const activeModelLabel = model && model !== 'connecting...' && model !== 'connected' && model !== 'unknown'
    ? MODEL_OPTIONS.find(o => model.includes(o.value) || o.value.includes(model))?.label || model
    : null;

  return (
    <div className="model-selector">
      <span className="model-selector-label">Model</span>
      <select
        className="model-selector-select"
        value={selectedModel}
        onChange={handleChange}
        title={isConnected && activeModelLabel
          ? `Active: ${activeModelLabel} (change takes effect on next session)`
          : 'Select model for next session'}
      >
        {MODEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {isConnected && activeModelLabel && (
        <span className="model-selector-active" title="Currently active model">
          {activeModelLabel}
        </span>
      )}
    </div>
  );
};
