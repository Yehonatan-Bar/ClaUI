import React, { useMemo, useEffect } from 'react';
import { useClaudeStream } from './hooks/useClaudeStream';
import { useAppStore } from './state/store';
import { MessageList } from './components/ChatView/MessageList';
import { InputArea } from './components/InputArea/InputArea';
import { TextSettingsBar } from './components/TextSettingsBar/TextSettingsBar';
import { ModelSelector } from './components/ModelSelector/ModelSelector';
import { PermissionModeSelector } from './components/PermissionModeSelector/PermissionModeSelector';
import { PlanApprovalBar } from './components/ChatView/PlanApprovalBar';
import { PromptHistoryPanel } from './components/ChatView/PromptHistoryPanel';
import { AchievementPanel } from './components/Achievements/AchievementPanel';
import { AchievementToastStack } from './components/Achievements/AchievementToastStack';
import { SessionRecapCard } from './components/Achievements/SessionRecapCard';
import { VitalsContainer } from './components/Vitals/VitalsContainer';
import { SessionTimeline } from './components/Vitals/SessionTimeline';
import { postToExtension } from './hooks/useClaudeStream';

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

export const App: React.FC = () => {
  useClaudeStream();

  const {
    isConnected,
    isBusy,
    isResuming,
    lastError,
    cost,
    setError,
    messages,
    streamingMessageId,
    textSettings,
    typingTheme,
    pendingApproval,
    promptHistoryPanelOpen,
    activitySummary,
    achievementsEnabled,
    achievementPanelOpen,
    vitalsEnabled,
    turnHistory,
  } = useAppStore();
  const forkInit = useAppStore((s) => s.forkInit);
  const hasMessages = messages.length > 0 || streamingMessageId !== null;
  const [scrollFraction, setScrollFraction] = React.useState(0);

  const handleTimelineTurnClick = React.useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

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
    <div className={`app-container theme-${typingTheme}`} style={containerStyle}>
      {/* Prompt history panel overlay */}
      {promptHistoryPanelOpen && <PromptHistoryPanel />}
      {achievementsEnabled && achievementPanelOpen && <AchievementPanel />}

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

      {/* Vitals: weather widget + cost heat bar */}
      <VitalsContainer />

      {/* Always show messages if they exist, regardless of connection state */}
      {hasMessages ? (
        <div className="chat-area-wrapper">
          <MessageList onScrollFractionChange={setScrollFraction} />
          {vitalsEnabled && turnHistory.length > 0 && (
            <SessionTimeline
              turnHistory={turnHistory}
              scrollFraction={scrollFraction}
              onTurnClick={handleTimelineTurnClick}
            />
          )}
        </div>
      ) : isConnected ? <div className="chat-spacer" /> : null}

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
          {achievementsEnabled && <SessionRecapCard />}
          <StatusBar cost={cost} />
        </>
      ) : hasMessages ? (
        <>
          {achievementsEnabled && <SessionRecapCard />}
          <SessionEndedBar />
          <StatusBar cost={cost} />
        </>
      ) : (
        <WelcomeScreen />
      )}
      {achievementsEnabled && <AchievementToastStack />}
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
  const [tickMs, setTickMs] = React.useState(() => Date.now());
  const {
    gitPushSettings,
    gitPushRunning,
    setGitPushRunning,
    setGitPushConfigPanelOpen,
    achievementsEnabled,
    achievementProfile,
    setAchievementPanelOpen,
    vitalsEnabled,
    setVitalsEnabled,
    sessionActivityStarted,
    sessionActivityElapsedMs,
    sessionActivityRunningSinceMs,
  } = useAppStore();

  useEffect(() => {
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const activityMs = sessionActivityElapsedMs + (
    sessionActivityRunningSinceMs ? Math.max(0, tickMs - sessionActivityRunningSinceMs) : 0
  );

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

  const handleAchievements = () => {
    postToExtension({ type: 'getAchievementsSnapshot' });
    setAchievementPanelOpen(!useAppStore.getState().achievementPanelOpen);
  };

  return (
    <div className="status-bar">
      <div className="cost-display">
        <span>Turn: ${(cost?.costUsd ?? 0).toFixed(4)}</span>
        <span>Total: ${(cost?.totalCostUsd ?? 0).toFixed(4)}</span>
      </div>
      <div
        className={`status-bar-session-clock ${sessionActivityRunningSinceMs ? 'running' : ''}`}
        title="Claude active processing time (starts after first prompt)"
      >
        Active: {sessionActivityStarted ? formatDuration(activityMs) : '00:00:00'}
      </div>
      {achievementsEnabled && (
        <button
          className="status-bar-achievements-btn"
          onClick={handleAchievements}
          title="Achievements"
        >
          🏆 {achievementProfile.totalAchievements}
        </button>
      )}
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
      <ModelSelector />
      <PermissionModeSelector />
      <TextSettingsBar />
      <button
        className={`status-bar-vitals-btn ${vitalsEnabled ? 'active' : ''}`}
        onClick={() => {
          const next = !vitalsEnabled;
          setVitalsEnabled(next);
          postToExtension({ type: 'setVitalsEnabled', enabled: next });
        }}
        title={vitalsEnabled ? 'Hide Session Vitals' : 'Show Session Vitals'}
      >
        Vitals
      </button>
      <div className="cost-display">
        <span>In: {(cost?.inputTokens ?? 0).toLocaleString()}</span>
        <span>Out: {(cost?.outputTokens ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
};
