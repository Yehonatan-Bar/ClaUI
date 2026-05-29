import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const CLAUDE_FAST_MODE_OPTIONS: Array<{ label: string; value: 'off' | 'fast' }> = [
  { label: 'Default', value: 'off' },
  { label: 'Fast', value: 'fast' },
];

/**
 * Claude Fast mode selector. Fast mode (~2.5x output speed, Opus only) is
 * applied via a settings override when the next session starts, mirroring how
 * the effort level is applied.
 */
export const ClaudeFastModeSelector: React.FC = () => {
  const { selectedClaudeFastMode, setSelectedClaudeFastMode } = useAppStore();

  const handleFastModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const fastMode = e.target.value === 'fast';
    setSelectedClaudeFastMode(fastMode);
    postToExtension({ type: 'setClaudeFastMode', fastMode });
  }, [setSelectedClaudeFastMode]);

  return (
    <div className="model-selector claude-fast-mode-selector">
      <span className="model-selector-label">Speed</span>
      <select
        className="model-selector-select"
        value={selectedClaudeFastMode ? 'fast' : 'off'}
        onChange={handleFastModeChange}
        data-tooltip="Claude Fast mode (~2.5x faster output on Opus, costs more; applies on next session start)"
      >
        {CLAUDE_FAST_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
