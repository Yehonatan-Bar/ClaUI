import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

type TabKey = 'session' | 'project' | 'global';

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'session', label: 'Session' },
  { key: 'project', label: 'Project' },
  { key: 'global', label: 'Global' },
];

/**
 * Prompt history panel with 3 tabs:
 * - Session: prompts from the current session (from store.promptHistory)
 * - Project: prompts from all sessions in this project (fetched from extension)
 * - Global: all prompts across all projects (fetched from extension)
 *
 * Clicking a prompt inserts it into the input textarea.
 */
export const PromptHistoryPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('session');
  const [filter, setFilter] = useState('');
  const {
    promptHistory,
    projectPromptHistory,
    globalPromptHistory,
    setPromptHistoryPanelOpen,
  } = useAppStore();

  // Fetch project/global history when those tabs are selected
  useEffect(() => {
    if (activeTab === 'project') {
      postToExtension({ type: 'getPromptHistory', scope: 'project' });
    } else if (activeTab === 'global') {
      postToExtension({ type: 'getPromptHistory', scope: 'global' });
    }
  }, [activeTab]);

  const close = useCallback(() => {
    setPromptHistoryPanelOpen(false);
  }, [setPromptHistoryPanelOpen]);

  // Get the list for the active tab (reversed so newest first)
  const getPrompts = (): string[] => {
    switch (activeTab) {
      case 'session':
        return [...promptHistory].reverse();
      case 'project':
        return [...projectPromptHistory].reverse();
      case 'global':
        return [...globalPromptHistory].reverse();
    }
  };

  const allPrompts = getPrompts();
  const filtered = filter
    ? allPrompts.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
    : allPrompts;

  const handleSelect = (prompt: string) => {
    // Post the selected prompt as a message to be inserted into the input
    // We use a custom event on the window to communicate with InputArea
    window.dispatchEvent(
      new CustomEvent('prompt-history-select', { detail: prompt })
    );
    close();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [close]);

  return (
    <div className="prompt-history-overlay" onClick={close}>
      <div className="prompt-history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-history-header">
          <span className="prompt-history-title">Prompt History</span>
          <button className="prompt-history-close" onClick={close} title="Close (Esc)">
            x
          </button>
        </div>

        <div className="prompt-history-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`prompt-history-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          className="prompt-history-filter"
          type="text"
          placeholder="Filter prompts..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />

        <div className="prompt-history-list">
          {filtered.length === 0 ? (
            <div className="prompt-history-empty">
              {filter ? 'No matching prompts' : 'No prompts yet'}
            </div>
          ) : (
            filtered.map((prompt, i) => (
              <button
                key={`${activeTab}-${i}`}
                className="prompt-history-item"
                onClick={() => handleSelect(prompt)}
                title={prompt}
              >
                <span className="prompt-history-item-text">{prompt}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
