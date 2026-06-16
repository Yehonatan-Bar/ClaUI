import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { CLAUDE_MODEL_OPTIONS, getClaudeModelLabel } from '../../utils/claudeModelDisplay';

/**
 * Model selector dropdown for choosing which Claude model to use.
 * Changing the model live-switches the current session (stop + resume with new model).
 */
export const ModelSelector: React.FC = () => {
  const { selectedModel, model, isConnected, lastResolvedDefaultModel, setSelectedModel } = useAppStore();

  // "Default" (empty value) means no --model flag is passed and the Claude CLI
  // picks the model itself. Only when Default is the active selection does the
  // CLI-reported `model` reflect that default resolution (with a specific model
  // selected it would just echo the explicit choice).
  const isDefaultSelected = !selectedModel;

  // Resolve display label for active model (from CLI, shown as hint)
  const activeModelLabel = model && model !== 'connected' && model !== 'unknown'
    ? getClaudeModelLabel(model)
    : null;

  // Live: this Default session's own resolved model, as reported by the CLI. The
  // CLI only emits its system/init (with the model) after the FIRST message is
  // sent, so this stays null on a freshly opened session until the first turn.
  const liveDefaultLabel = isDefaultSelected && isConnected ? activeModelLabel : null;

  // Remembered: the model the CLI resolved Default to last time, pushed from the
  // extension's globalState. Used as a fallback so the user can see "the model
  // that will run" on hover BEFORE this session's first turn reports it.
  const rememberedDefaultLabel = isDefaultSelected && !liveDefaultLabel && lastResolvedDefaultModel
    ? getClaudeModelLabel(lastResolvedDefaultModel)
    : null;

  // Prefer the live value (this session) over the remembered one (last session).
  const resolvedDefaultLabel = liveDefaultLabel ?? rememberedDefaultLabel;

  const modelOptions = useMemo(() => {
    const base = !selectedModel || CLAUDE_MODEL_OPTIONS.some((opt) => opt.value === selectedModel)
      ? CLAUDE_MODEL_OPTIONS
      : [
          ...CLAUDE_MODEL_OPTIONS,
          { label: `Custom (${getClaudeModelLabel(selectedModel)})`, value: selectedModel },
        ];

    // Surface the resolved model inline on the Default option so it is visible
    // in the open dropdown, e.g. "Default (Opus 4.8)".
    if (!resolvedDefaultLabel) {
      return base;
    }
    return base.map((opt) =>
      opt.value === '' ? { ...opt, label: `Default (${resolvedDefaultLabel})` } : opt,
    );
  }, [selectedModel, resolvedDefaultLabel]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    postToExtension({ type: 'setModel', model: newModel });
  }, [setSelectedModel]);

  // Tooltip: for Default, explain that the CLI chooses and reveal the resolved
  // model once known; for an explicit model, keep the active-model hint.
  const selectTooltip = isDefaultSelected
    ? (liveDefaultLabel
        ? `Default: Claude CLI is running ${liveDefaultLabel}`
        : rememberedDefaultLabel
          ? `Default: Claude CLI will run ${rememberedDefaultLabel} (confirmed once the session starts)`
          : 'Default: Claude CLI picks the model (resolved once the session starts)')
    : (isConnected && activeModelLabel
        ? `Active: ${activeModelLabel}`
        : 'Select model');

  return (
    <div className="model-selector">
      <span className="model-selector-label">Model</span>
      <select
        className="model-selector-select"
        value={selectedModel}
        onChange={handleChange}
        data-tooltip={selectTooltip}
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
