import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const CustomSnippetPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { customSnippetText } = useAppStore();
  const [draft, setDraft] = useState(customSnippetText);

  const handleSave = useCallback(() => {
    postToExtension({ type: 'setCustomSnippet', text: draft });
    onClose();
  }, [draft, onClose]);

  const handleClear = useCallback(() => {
    setDraft('');
    postToExtension({ type: 'setCustomSnippet', text: '' });
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  return (
    <div className="custom-snippet-panel">
      <div className="custom-snippet-panel-header">
        <span className="custom-snippet-panel-title">Custom Snippet</span>
        <button className="custom-snippet-panel-close" onClick={onClose} data-tooltip="Close">
          x
        </button>
      </div>
      <div className="custom-snippet-panel-hint">
        Type any text. Clicking the snippet button inserts it at the cursor in the input box.
      </div>
      <textarea
        className="custom-snippet-config-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter snippet text..."
        rows={3}
        autoFocus
      />
      <div className="custom-snippet-panel-actions">
        <button
          className="custom-snippet-config-clear"
          onClick={handleClear}
          data-tooltip="Clear the saved snippet"
        >
          Clear
        </button>
        <button
          className="custom-snippet-config-save"
          onClick={handleSave}
          data-tooltip="Save (Ctrl+Enter)"
        >
          Save
        </button>
      </div>
    </div>
  );
};
