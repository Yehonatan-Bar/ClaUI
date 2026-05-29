import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { ClaudeEffortLevel } from '../../../extension/types/webview-messages';

const CLAUDE_EFFORT_OPTIONS: Array<{ label: string; value: ClaudeEffortLevel }> = [
  { label: 'Default', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High', value: 'xhigh' },
  { label: 'Max', value: 'max' },
];

export const ClaudeEffortSelector: React.FC = () => {
  const {
    selectedClaudeEffort,
    setSelectedClaudeEffort,
  } = useAppStore();

  const handleEffortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const effort = e.target.value as ClaudeEffortLevel;
    setSelectedClaudeEffort(effort);
    postToExtension({ type: 'setClaudeEffort', effort });
  }, [setSelectedClaudeEffort]);

  return (
    <div className="model-selector claude-effort-selector">
      <span className="model-selector-label">Effort</span>
      <select
        className="model-selector-select"
        value={selectedClaudeEffort}
        onChange={handleEffortChange}
        data-tooltip="Claude thinking effort level (applies on next session start)"
      >
        {CLAUDE_EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value || 'default'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
