import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const GitPushPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [instruction, setInstruction] = useState('');
  const { gitPushSettings, isConnected } = useAppStore();
  const isConfigured = gitPushSettings?.enabled ?? false;

  const handleSendConfig = useCallback(() => {
    const trimmed = instruction.trim();
    if (!trimmed || !isConnected) return;
    postToExtension({ type: 'gitPushConfig', instruction: trimmed });
    setInstruction('');
    onClose();
  }, [instruction, isConnected, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendConfig();
    }
  }, [handleSendConfig]);

  return (
    <div className="git-push-panel">
      <div className="git-push-panel-header">
        <span className="git-push-panel-title">Git Push Configuration</span>
        <button className="git-push-panel-close" onClick={onClose} title="Close">
          x
        </button>
      </div>
      <div className="git-push-panel-status">
        <span className={`git-push-status-dot ${isConfigured ? 'configured' : 'not-configured'}`} />
        <span>{isConfigured ? 'Configured' : 'Not configured'}</span>
      </div>
      {isConfigured && gitPushSettings && (
        <div className="git-push-panel-info">
          <span>Script: {gitPushSettings.scriptPath}</span>
          <span>Template: {gitPushSettings.commitMessageTemplate}</span>
        </div>
      )}
      <div className="git-push-config-input">
        <textarea
          className="git-push-config-textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConfigured
            ? 'Ask Claude to modify the git push configuration...'
            : 'Ask Claude to set up git push for this project...'}
          rows={2}
          disabled={!isConnected}
        />
        <button
          className="git-push-config-send"
          onClick={handleSendConfig}
          disabled={!instruction.trim() || !isConnected}
          title="Send to Claude (Ctrl+Enter)"
        >
          Ask Claude
        </button>
      </div>
    </div>
  );
};
