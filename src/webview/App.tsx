import React, { useMemo, useEffect } from 'react';
import { useClaudeStream } from './hooks/useClaudeStream';
import { useAppStore } from './state/store';
import { MessageList } from './components/ChatView/MessageList';
import { InputArea } from './components/InputArea/InputArea';
import { TextSettingsBar } from './components/TextSettingsBar/TextSettingsBar';
import { ModelSelector } from './components/ModelSelector/ModelSelector';
import { SwitchToSonnetButton } from './components/ModelSelector/SwitchToSonnetButton';
import { PermissionModeSelector } from './components/PermissionModeSelector/PermissionModeSelector';
import { PlanApprovalBar } from './components/ChatView/PlanApprovalBar';
import { PromptHistoryPanel } from './components/ChatView/PromptHistoryPanel';
import { postToExtension } from './hooks/useClaudeStream';

export const App: React.FC = () => {
  useClaudeStream();

  const { isConnected, isBusy, isResuming, lastError, cost, setError, messages, streamingMessageId, textSettings, pendingApproval, promptHistoryPanelOpen, activitySummary } = useAppStore();
  const forkInit = useAppStore((s) => s.forkInit);
  const hasMessages = messages.length > 0 || streamingMessageId !== null;

  // Fork completion: messages are already loaded into the store by
  // useClaudeStream's forkInit handler. Just set the prompt text in
  // the input area and clear the fork state.
  useEffect(() => {
    if (!forkInit) return;
    const { promptText } = forkInit;
    if (promptText) {
      window.dispatchEvent(
        new CustomEvent('fork-set-input', { detail: promptText })
      );
    }
    useAppStore.getState().setForkInit(null);
  }, [forkInit]);

  console.log(`%c[App] render`, 'color: white; font-weight: bold; background: #333; padding: 2px 6px', {
    isConnected,
    hasMessages,
    messageCount: messages.length,
    streamingId: streamingMessageId,
    isBusy,
    lastError,
    rendering: !isConnected && !hasMessages ? 'WelcomeScreen' : isConnected ? 'ChatUI' : 'SessionEndedBar',
  });

  // Apply text settings as CSS custom properties on the container
  const containerStyle = useMemo(() => ({
    '--chat-font-size': `${textSettings.fontSize}px`,
    '--chat-font-family': textSettings.fontFamily || undefined,
  } as React.CSSProperties), [textSettings.fontSize, textSettings.fontFamily]);

  return (
    <div className="app-container" style={containerStyle}>
      {/* Prompt history panel overlay */}
      {promptHistoryPanelOpen && <PromptHistoryPanel />}

      {/* Error banner */}
      {lastError && (
        <div className="error-banner">
          <span>{lastError}</span>
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
            title="Dismiss"
          >
            x
          </button>
        </div>
      )}

      {/* Always show messages if they exist, regardless of connection state */}
      {hasMessages ? <MessageList /> : isConnected ? <div className="chat-spacer" /> : null}

      {isConnected ? (
        <>
          {pendingApproval ? (
            <PlanApprovalBar />
          ) : isBusy ? (
            <div className={`busy-indicator ${activitySummary ? 'busy-indicator-with-activity' : ''}`}>
              <div className="busy-indicator-main">
                <span className="thinking-dots">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </span>
                <span className="busy-indicator-text">
                  {isResuming ? 'Resuming conversation...' : (
                    activitySummary ? activitySummary.shortLabel + '...' : 'Thinking...'
                  )}
                </span>
              </div>
              {activitySummary && (
                <div className="activity-summary-detail">
                  {activitySummary.fullSummary}
                </div>
              )}
            </div>
          ) : null}
          <InputArea />
          <StatusBar cost={cost} />
        </>
      ) : hasMessages ? (
        <>
          <SessionEndedBar />
          <StatusBar cost={cost} />
        </>
      ) : (
        <WelcomeScreen />
      )}
    </div>
  );
};

/** Welcome screen shown when no session is active and no messages exist */
const WelcomeScreen: React.FC = () => {
  const handleStart = () => {
    postToExtension({ type: 'startSession' });
  };

  const handleHistory = () => {
    postToExtension({ type: 'showHistory' });
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-title">ClaUi</div>
      <div className="welcome-hint">
        Start a new session to begin chatting with Claude Code.
        Your conversation will be visible in both the chat UI and terminal.
      </div>
      <button className="start-button" onClick={handleStart}>
        Start Session
      </button>
      <button className="history-button" onClick={handleHistory}>
        Conversation History
      </button>
    </div>
  );
};

/** Bar shown when session ended but messages are still visible */
const SessionEndedBar: React.FC = () => {
  const handleRestart = () => {
    postToExtension({ type: 'startSession' });
  };

  const handleHistory = () => {
    postToExtension({ type: 'showHistory' });
  };

  return (
    <div className="session-ended-bar">
      <span>Session ended</span>
      <button className="restart-button" onClick={handleRestart}>
        New Session
      </button>
      <button className="history-link-button" onClick={handleHistory}>
        History
      </button>
    </div>
  );
};

/** Bottom status bar showing cost and token info */
const StatusBar: React.FC<{
  cost: { costUsd: number; totalCostUsd: number; inputTokens: number; outputTokens: number };
}> = ({ cost }) => {
  const { gitPushSettings, gitPushRunning, setGitPushRunning, setGitPushConfigPanelOpen } = useAppStore();

  const handleHistory = () => {
    postToExtension({ type: 'showHistory' });
  };

  const handleOpenPlans = () => {
    postToExtension({ type: 'openPlanDocs' });
  };

  const handleGitPush = () => {
    if (!gitPushSettings?.enabled) {
      setGitPushConfigPanelOpen(true);
      return;
    }
    setGitPushRunning(true);
    postToExtension({ type: 'gitPush' });
  };

  const handleToggleGitConfig = () => {
    setGitPushConfigPanelOpen(!useAppStore.getState().gitPushConfigPanelOpen);
  };

  return (
    <div className="status-bar">
      <div className="cost-display">
        <span>Turn: ${(cost?.costUsd ?? 0).toFixed(4)}</span>
        <span>Total: ${(cost?.totalCostUsd ?? 0).toFixed(4)}</span>
      </div>
      <button className="status-bar-history-btn" onClick={handleHistory} title="Conversation History (Ctrl+Shift+H)">
        History
      </button>
      <button className="status-bar-plans-btn" onClick={handleOpenPlans} title="Open plan document in browser">
        Plans
      </button>
      <div className="status-bar-git-group">
        <button
          className={`status-bar-git-btn ${gitPushSettings?.enabled ? '' : 'not-configured'}`}
          onClick={handleGitPush}
          disabled={gitPushRunning}
          title={gitPushSettings?.enabled ? 'Git: add, commit & push' : 'Git push (setup needed)'}
        >
          {gitPushRunning ? '...' : 'Git'}
        </button>
        <button
          className="status-bar-git-config-btn"
          onClick={handleToggleGitConfig}
          title="Git push settings"
        >
          *
        </button>
      </div>
      <SwitchToSonnetButton />
      <ModelSelector />
      <PermissionModeSelector />
      <TextSettingsBar />
      <div className="cost-display">
        <span>In: {(cost?.inputTokens ?? 0).toLocaleString()}</span>
        <span>Out: {(cost?.outputTokens ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
};
