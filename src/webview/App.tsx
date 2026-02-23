import React, { useMemo, useEffect } from 'react';
import { useClaudeStream } from './hooks/useClaudeStream';
import { useAppStore } from './state/store';
import { MessageList } from './components/ChatView/MessageList';
import { InputArea } from './components/InputArea/InputArea';
import { PlanApprovalBar } from './components/ChatView/PlanApprovalBar';
import { PromptHistoryPanel } from './components/ChatView/PromptHistoryPanel';
import { AchievementPanel } from './components/Achievements/AchievementPanel';
import { AchievementToastStack } from './components/Achievements/AchievementToastStack';
import { SessionRecapCard } from './components/Achievements/SessionRecapCard';
import { CommunityPanel } from './components/Achievements/CommunityPanel';
import { ShareCard } from './components/Achievements/ShareCard';
import { VitalsContainer } from './components/Vitals/VitalsContainer';
import { AdventureWidget } from './components/Vitals/AdventureWidget';
import { SessionTimeline } from './components/Vitals/SessionTimeline';
import { StatusBar } from './components/StatusBar/StatusBar';
import { DashboardPanel } from './components/Dashboard';
import { SkillGenPanel } from './components/SkillGen';
import { CodexConsultPanel } from './components/InputArea/CodexConsultPanel';
import { postToExtension } from './hooks/useClaudeStream';
import { detectRtl } from './hooks/useRtlDetection';
import { deriveTurnHistoryFromMessages } from './utils/turnVitals';
import { GlobalTooltip } from './components/Tooltip/GlobalTooltip';

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
    providerCapabilities,
    promptHistoryPanelOpen,
    activitySummary,
    achievementsEnabled,
    achievementPanelOpen,
    vitalsEnabled,
    adventureEnabled,
    turnHistory,
    dashboardOpen,
    skillGenPanelOpen,
    communityPanelOpen,
    codexConsultPanelOpen,
    setCodexConsultPanelOpen,
  } = useAppStore();
  const forkInit = useAppStore((s) => s.forkInit);
  const hasMessages = messages.length > 0 || streamingMessageId !== null;
  const [scrollFraction, setScrollFraction] = React.useState(0);
  const activityText = activitySummary ? `${activitySummary.shortLabel} ${activitySummary.fullSummary}` : '';
  const activityDir: 'rtl' | 'ltr' = activityText && detectRtl(activityText) ? 'rtl' : 'ltr';
  const resolvedTurnHistory = useMemo(
    () => (turnHistory.length > 0 ? turnHistory : deriveTurnHistoryFromMessages(messages)),
    [turnHistory, messages]
  );

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
      {achievementsEnabled && communityPanelOpen && <CommunityPanel />}
      {achievementsEnabled && <ShareCard />}
      {dashboardOpen && <DashboardPanel />}
      {skillGenPanelOpen && <SkillGenPanel />}

      {/* Error banner */}
      {lastError && (
        <div className="error-banner">
          <span>{lastError}</span>
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
            data-tooltip="Dismiss"
          >
            x
          </button>
        </div>
      )}

      {/* Vitals: weather widget + cost heat bar */}
      <VitalsContainer />
      {/* Adventure widget: independent of vitals, toggled via gear settings */}
      {adventureEnabled && <AdventureWidget />}

      {/* Always show messages if they exist, regardless of connection state */}
      {hasMessages ? (
        <div className="chat-area-wrapper">
          <MessageList onScrollFractionChange={setScrollFraction} />
          {vitalsEnabled && resolvedTurnHistory.length > 0 && (
            <SessionTimeline
              turnHistory={resolvedTurnHistory}
              scrollFraction={scrollFraction}
              onTurnClick={handleTimelineTurnClick}
            />
          )}
        </div>
      ) : isConnected ? <div className="chat-spacer" /> : null}

      {isConnected ? (
        <>
          {pendingApproval && providerCapabilities.supportsPlanApproval ? (
            <PlanApprovalBar />
          ) : (isBusy || !!activitySummary) ? (
            <div
              className={`busy-indicator ${activitySummary ? 'busy-indicator-with-activity' : ''} ${!isBusy && activitySummary ? 'busy-indicator-idle' : ''}`}
            >
              <div className="busy-indicator-main">
                {isBusy && (
                  <span className="thinking-dots">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </span>
                )}
                <span className="busy-indicator-text" dir={activityDir}>
                  {isBusy ? (
                    isResuming ? 'Resuming conversation...' : (
                      activitySummary ? activitySummary.shortLabel + '...' : 'Thinking...'
                    )
                  ) : (
                    activitySummary ? activitySummary.shortLabel : ''
                  )}
                </span>
              </div>
              {activitySummary && (
                <div className="activity-summary-detail" dir={activityDir}>
                  {activitySummary.fullSummary}
                </div>
              )}
            </div>
          ) : null}
          {providerCapabilities.supportsCodexConsult && codexConsultPanelOpen && (
            <CodexConsultPanel onClose={() => setCodexConsultPanelOpen(false)} />
          )}
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
      <GlobalTooltip delay={400} />
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
      <button className="start-button" onClick={handleStart} data-tooltip="Start a new Claude Code session">
        Start Session
      </button>
      <button className="history-button" onClick={handleHistory} data-tooltip="Browse previous conversations">
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
      <button className="restart-button" onClick={handleRestart} data-tooltip="Start a new session">
        New Session
      </button>
      <button className="history-link-button" onClick={handleHistory} data-tooltip="Browse previous conversations">
        History
      </button>
    </div>
  );
};
