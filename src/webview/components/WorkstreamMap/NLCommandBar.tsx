import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const NLCommandBar: React.FC = () => {
  const [input, setInput] = useState('');
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);
  const selectedStationId = useAppStore(s => s.selectedStationId);
  const hoveredEntityId = useAppStore(s => s.hoveredEntityId);
  const mapData = useAppStore(s => s.workstreamMapData);

  const handleSubmit = useCallback(() => {
    if (!input.trim()) { return; }

    postToExtension({
      type: 'workstreamMapNaturalLanguageEdit',
      text: input.trim(),
      context: {
        focusedWorkstreamId: focusedWorkstreamId ?? undefined,
        selectedStationId: selectedStationId ?? undefined,
        hoveredEntityId: hoveredEntityId ?? undefined,
        visibleWorkstreamIds: mapData?.workstreams.map(ws => ws.id) ?? [],
      },
    });

    setInput('');
  }, [input, focusedWorkstreamId, selectedStationId, hoveredEntityId, mapData]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 12px',
      borderTop: '1px solid var(--vscode-panel-border, #334155)',
      background: 'var(--vscode-editor-background)',
    }}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Edit the map... (e.g. 'merge these two lines', 'mark as complete')"
        style={{
          flex: 1,
          background: 'var(--vscode-input-background, #1E293B)',
          color: 'var(--vscode-input-foreground, #CBD5E1)',
          border: '1px solid var(--vscode-input-border, #334155)',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'var(--vscode-font-family)',
          outline: 'none',
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim()}
        style={{
          background: 'var(--vscode-button-background, #4A9EFF)',
          color: 'var(--vscode-button-foreground, #fff)',
          border: 'none',
          borderRadius: 4,
          padding: '4px 12px',
          cursor: input.trim() ? 'pointer' : 'default',
          fontSize: 11,
          fontFamily: 'var(--vscode-font-family)',
          opacity: input.trim() ? 1 : 0.5,
        }}
      >
        Apply
      </button>
    </div>
  );
};
