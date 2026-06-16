import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
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
import { SummaryModeWidget } from './components/ChatView/SummaryMode/SummaryModeWidget';
import { VisualProgressView } from './components/ChatView/VisualProgress/VisualProgressView';
import { UsageWidget } from './components/Usage/UsageWidget';
// ContextUsageWidget floating strip removed - context bar now lives in InputArea
import { SessionTimeline } from './components/Vitals/SessionTimeline';
import { StatusBar } from './components/StatusBar/StatusBar';
import { DashboardPanel } from './components/Dashboard';
import { SkillGenPanel, SkillGenOnboarding } from './components/SkillGen';
import { BugReportPanel } from './components/BugReport';
import { McpPanel } from './components/McpPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SuperParticleAcceleratorPanel } from './components/SuperParticleAccelerator/SuperParticleAcceleratorPanel';
import { CodexConsultPanel } from './components/InputArea/CodexConsultPanel';
import { ReviewLoopPanel } from './components/ReviewLoop/ReviewLoopPanel';
import { TeamPanel, TeamStatusWidget } from './components/Teams';
import { WorkstreamMapView } from './components/WorkstreamMap/WorkstreamMapView';
import { WorktreePanel } from './components/Worktree';
import { postToExtension } from './hooks/useClaudeStream';
import { detectRtl } from './hooks/useRtlDetection';
import { deriveTurnHistoryFromMessages } from './utils/turnVitals';
import { GlobalTooltip } from './components/Tooltip/GlobalTooltip';
import { ImageLightbox } from './components/ImageLightbox';
import { ChatSearchBar } from './components/ChatView/ChatSearchBar';
import { SmartSearchView } from './components/SmartSearch/SmartSearchView';
import { MPSessionView } from './components/MultiParticipant';

const SESSION_SUMMARY_IDLE_MS = 60 * 60 * 1000;
const SESSION_SUMMARY_DEFER_MS = 3 * 60 * 60 * 1000;

const RAIL_MIN_WIDTH = 80;
const RAIL_MAX_WIDTH = 300;

const VerticalTabRail: React.FC = () => {
  const tabs = useAppStore((s) => s.openTabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setRailWidth = useAppStore((s) => s.setVerticalTabRailWidth);
  const railRef = useRef<HTMLElement>(null);
  const resizing = useRef(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const sortedTabs = useMemo(
    () => [...tabs].sort((a, b) => (a.orderInGroup ?? a.tabNumber) - (b.orderInGroup ?? b.tabNumber)),
    [tabs]
  );

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, ev.clientX));
      setRailWidth(newWidth);
    };

    const onUp = () => {
      resizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [setRailWidth]);

  const handleDoubleClick = useCallback(() => {
    setRailWidth(null);
  }, [setRailWidth]);

  const handleDrop = useCallback(() => {
    if (!draggedId || dropIndex === null) return;
    const fromIndex = sortedTabs.findIndex(t => t.id === draggedId);
    if (fromIndex === -1 || fromIndex === dropIndex || fromIndex + 1 === dropIndex) {
      setDraggedId(null);
      setDropIndex(null);
      return;
    }
    const ids = sortedTabs.map(t => t.id);
    ids.splice(fromIndex, 1);
    const insertAt = fromIndex < dropIndex ? dropIndex - 1 : dropIndex;
    ids.splice(insertAt, 0, draggedId);
    postToExtension({ type: 'reorderTabs', tabIds: ids });
    setDraggedId(null);
    setDropIndex(null);
  }, [draggedId, dropIndex, sortedTabs]);

  if (sortedTabs.length <= 1) {
    return null;
  }

  const dragFromIndex = draggedId ? sortedTabs.findIndex(t => t.id === draggedId) : -1;

  return (
    <nav className="vertical-tab-rail" aria-label="ClaUi tabs" ref={railRef}>
      <div
        className="vertical-tab-rail-list"
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
        onDrop={(e) => { e.preventDefault(); handleDrop(); }}
      >
        {sortedTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragged = tab.id === draggedId;
          const providerLabel =
            tab.provider === 'codex' ? 'Codex' : tab.provider === 'remote' ? 'Happy' : 'Claude';
          const showDropBefore = dropIndex === index &&
            dragFromIndex !== index && dragFromIndex !== index - 1;
          const showDropAfter = dropIndex === sortedTabs.length &&
            index === sortedTabs.length - 1 && dragFromIndex !== sortedTabs.length - 1;
          return (
            <React.Fragment key={tab.id}>
              {showDropBefore && <div className="vertical-tab-drop-indicator" />}
              <button
                className={`vertical-tab-item ${isActive ? 'active' : ''} ${tab.isBusy ? 'vertical-tab-busy' : ''} ${isDragged ? 'vertical-tab-dragging' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDraggedId(tab.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tab.id);
                }}
                onDragEnd={() => { setDraggedId(null); setDropIndex(null); }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
                }}
                onClick={() => {
                  if (!isActive) {
                    postToExtension({ type: 'focusTab', tabId: tab.id });
                  }
                }}
                style={{ '--tab-color': tab.slotColor } as React.CSSProperties}
                title={`${providerLabel}: ${tab.displayName}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="vertical-tab-title">{tab.displayName}</span>
                <span
                  className="vertical-tab-provider"
                  aria-label="Close tab"
                  role="button"
                  data-letter={tab.provider === 'codex' ? 'X' : tab.provider === 'remote' ? 'H' : 'C'}
                  onClick={(e) => {
                    e.stopPropagation();
                    postToExtension({ type: 'closeTab', tabId: tab.id });
                  }}
                />
              </button>
              {showDropAfter && <div className="vertical-tab-drop-indicator" />}
            </React.Fragment>
          );
        })}
      </div>
      <div
        className="vertical-tab-resize-handle"
        onMouseDown={handleResizeStart}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize, double-click to reset"
      />
    </nav>
  );
};

/**
 * Top-level App is a thin dispatcher: it calls the stream hook ONCE and
 * routes by tabKind. Each branch mounts its own component, so the heavy
 * chat-mode hooks live inside `<ChatAppContent/>` and never execute when
 * we are in a Smart Search tab. Keeping a fixed two-hook prelude here
 * (useClaudeStream + useAppStore selector) prevents the Rules of Hooks
 * violation that would otherwise fire when tabKind transitions from
 * 'chat' to 'search' after the first render.
 */
export const App: React.FC = () => {
  useClaudeStream();
  const tabKind = useAppStore((s) => s.tabKind);
  const tabLayout = useAppStore((s) => s.tabLayout);
  const openTabs = useAppStore((s) => s.openTabs);
  const verticalTabRailWidth = useAppStore((s) => s.verticalTabRailWidth);
  const showVerticalTabRail = tabLayout === 'vertical' && openTabs.length > 1;

  const wrapWithRail = (content: React.ReactNode) => {
    if (!showVerticalTabRail) return content;
    const style = verticalTabRailWidth
      ? { '--vertical-tab-rail-width': `${verticalTabRailWidth}px` } as React.CSSProperties
      : undefined;
    return (
      <div className="app-vertical-rail-wrapper" style={style}>
        <VerticalTabRail />
        {content}
      </div>
    );
  };

  if (tabKind === 'search') {
    return wrapWithRail(
      <>
        <GlobalTooltip />
        <ImageLightbox />
        <SmartSearchView />
      </>
    );
  }
  if (tabKind === 'multiparticipant') {
    return wrapWithRail(<MPSessionView />);
  }
  return wrapWithRail(<ChatAppContent />);
};

const ChatAppContent: React.FC = () => {
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
    provider,
    providerCapabilities,
    promptHistoryPanelOpen,
    currentToolActivity,
    activitySummary,
    achievementsEnabled,
    achievementPanelOpen,
    vitalsEnabled,
    adventureEnabled,
    usageWidgetEnabled,
    summaryModeEnabled,
    vpmEnabled,
    contextWidgetVisible,
    turnHistory,
    dashboardOpen,
    mcpPanelOpen,
    skillGenPanelOpen,
    skillGenOnboardingSeen,
    communityPanelOpen,
    codexConsultPanelOpen,
    setCodexConsultPanelOpen,
    reviewLoopPanelOpen,
    setReviewLoopPanelOpen,
    bugReportPanelOpen,
    teamActive,
    teamPanelOpen,
    workstreamMapOpen,
    worktreePanelOpen,
    currentThinkingEffort,
    chatSearchOpen,
    activitySummaryDismissed,
    setActivitySummaryDismissed,
    activitySummaryEnabled,
  } = useAppStore();
  const forkInit = useAppStore((s) => s.forkInit);
  const [showDisablePermanently, setShowDisablePermanently] = useState(false);

  const handleDismissActivitySummary = useCallback(() => {
    setActivitySummaryDismissed(true);
    setShowDisablePermanently(true);
    const timer = setTimeout(() => setShowDisablePermanently(false), 4000);
    return () => clearTimeout(timer);
  }, [setActivitySummaryDismissed]);

  const handleDisableActivitySummaryPermanently = useCallback(() => {
    setShowDisablePermanently(false);
    setActivitySummaryDismissed(true);
    postToExtension({ type: 'setActivitySummaryEnabled', enabled: false });
  }, [setActivitySummaryDismissed]);

  const hasMessages = messages.length > 0 || streamingMessageId !== null;
  const [scrollFraction, setScrollFraction] = React.useState(0);
  const activityText = activitySummary ? `${activitySummary.shortLabel} ${activitySummary.fullSummary}` : '';
  const activityDir: 'rtl' | 'ltr' = activityText && detectRtl(activityText) ? 'rtl' : 'ltr';
  const resolvedTurnHistory = useMemo(
    () => (turnHistory.length > 0 ? turnHistory : deriveTurnHistoryFromMessages(messages)),
    [turnHistory, messages]
  );
  const isCodexCliMissingError =
    typeof lastError === 'string' && /codex cli not found/i.test(lastError);
  const isClaudeCliMissingError =
    typeof lastError === 'string' && /claude cli not found/i.test(lastError);
  const isAutoDismissCommandError =
    typeof lastError === 'string' &&
    /command failed\s*\(exit\s*\d+\)/i.test(lastError) &&
    !isCodexCliMissingError &&
    !isClaudeCliMissingError;

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [errorIsOverflowing, setErrorIsOverflowing] = useState(false);
  const errorMessageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setErrorExpanded(false);
  }, [lastError]);

  useEffect(() => {
    if (!lastError || isClaudeCliMissingError || isCodexCliMissingError) {
      setErrorIsOverflowing(false);
      return;
    }
    const el = errorMessageRef.current;
    if (!el) return;
    // When collapsed, scrollHeight exceeds clientHeight if the 2-line clamp is active.
    setErrorIsOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [lastError, errorExpanded, isClaudeCliMissingError, isCodexCliMissingError]);

  const handleTimelineTurnClick = React.useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Keyboard shortcut: Ctrl+Shift+F to toggle search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        const store = useAppStore.getState();
        store.setChatSearchOpen(!store.chatSearchOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  useEffect(() => {
    if (!isAutoDismissCommandError || !lastError) return;
    const timer = window.setTimeout(() => {
      if (useAppStore.getState().lastError === lastError) {
        setError(null);
      }
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [isAutoDismissCommandError, lastError, setError]);

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
      {mcpPanelOpen && <McpPanel />}
      <SettingsPanel />
      <SuperParticleAcceleratorPanel />
      {skillGenPanelOpen && <SkillGenPanel />}
      {bugReportPanelOpen && <BugReportPanel />}
      {teamPanelOpen && <TeamPanel />}
      {workstreamMapOpen && <WorkstreamMapView />}
      {worktreePanelOpen && <WorktreePanel />}

      {/* Error banner / setup guidance */}
      {lastError && (isClaudeCliMissingError ? (
        <div className="setup-notice-banner" role="alert" aria-live="polite">
          <div className="setup-notice-content">
            <div className="setup-notice-eyebrow">Claude Code CLI Not Found</div>
            <div className="setup-notice-title">The <code>claude</code> command was not found on this machine</div>
            <div className="setup-notice-text">
              You can use <strong>Codex</strong> instead, or install Claude Code CLI to use Claude mode.
            </div>
            <div className="setup-notice-actions">
              <button
                className="setup-notice-btn primary"
                onClick={() => {
                  setError(null);
                  postToExtension({ type: 'openProviderTab', provider: 'codex' });
                }}
              >
                Switch to Codex
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => {
                  postToExtension({ type: 'copyToClipboard', text: 'npm install -g @anthropic-ai/claude-code' });
                }}
                data-tooltip="Copies: npm install -g @anthropic-ai/claude-code"
              >
                Copy Install Command
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'openUrl', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' })}
              >
                Claude Code Docs
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'openSettings', query: 'claudeMirror.cliPath' })}
              >
                Set CLI Path
              </button>
              <button
                className="setup-notice-btn ghost"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : isCodexCliMissingError ? (
        <div className="setup-notice-banner" role="alert" aria-live="polite">
          <div className="setup-notice-content">
            <div className="setup-notice-eyebrow">Codex Setup Required</div>
            <div className="setup-notice-title">Codex CLI is not installed (or not in PATH)</div>
            <div className="setup-notice-text">
              ClaUi Codex mode uses the <code>codex</code> CLI command. Installing/signing in to the official Codex VS Code extension alone is not enough for ClaUi. If you already installed Codex CLI, start with <strong>Auto-detect Codex CLI</strong>.
            </div>
            <div className="setup-notice-actions">
              <button
                className="setup-notice-btn primary"
                onClick={() => postToExtension({ type: 'autoSetupCodexCli' })}
              >
                Auto-setup Codex CLI
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'autoDetectCodexCliPath' })}
              >
                Auto-detect Codex CLI
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'openUrl', url: 'https://github.com/openai/codex' })}
              >
                Open Install Guide
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'pickCodexCliPath' })}
              >
                Browse for codex executable
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'openSettings', query: 'claudeMirror.codex.cliPath' })}
              >
                Open Codex Path Setting
              </button>
              <button
                className="setup-notice-btn"
                onClick={() => postToExtension({ type: 'openCodexLogin' })}
              >
                Open Setup/Login Terminal
              </button>
              <button
                className="setup-notice-btn ghost"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`error-banner ${errorExpanded ? 'error-banner--expanded' : ''}`}>
          <div
            ref={errorMessageRef}
            className={`error-banner__message ${errorExpanded ? 'error-banner__message--expanded' : ''}`}
          >
            {lastError}
          </div>
          <div className="error-banner__actions">
            {(errorIsOverflowing || errorExpanded) && (
              <button
                className="error-banner__toggle"
                onClick={() => setErrorExpanded(e => !e)}
              >
                {errorExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
            <button
              className="error-dismiss"
              onClick={() => setError(null)}
              data-tooltip="Dismiss"
              aria-label="Dismiss"
            >
              x
            </button>
          </div>
        </div>
      ))}

      {/* Weather widget: floating mood icon, toggled independently via gear settings */}
      <VitalsContainer />
      {/* Adventure widget: independent of vitals, toggled via gear settings */}
      {adventureEnabled && <AdventureWidget />}
      {/* Usage widget: floating display of subscription usage data, toggled via gear settings */}
      {usageWidgetEnabled && <UsageWidget />}
      {/* Context usage strip is now rendered inside InputArea (bar above textarea) */}
      {/* Agent Teams widget: floating team status, appears when a team is active */}
      {teamActive && <TeamStatusWidget />}

      {/* Search bar — available even without messages (for project-wide search) */}
      {chatSearchOpen && <ChatSearchBar />}

      {/* Always show messages if they exist, regardless of connection state */}
      {hasMessages ? (
        <div className={`chat-area-wrapper ${summaryModeEnabled ? 'sm-split-layout' : ''} ${vpmEnabled ? 'vpm-split-layout' : ''}`}>
          {summaryModeEnabled && <SummaryModeWidget />}
          {vpmEnabled && <VisualProgressView />}
          <MessageList onScrollFractionChange={setScrollFraction} />
          {vitalsEnabled && !summaryModeEnabled && !vpmEnabled && resolvedTurnHistory.length > 0 && (
            <SessionTimeline
              turnHistory={resolvedTurnHistory}
              scrollFraction={scrollFraction}
              onTurnClick={handleTimelineTurnClick}
            />
          )}
        </div>
      ) : isConnected ? (
        vpmEnabled ? (
          <div className="chat-area-wrapper vpm-split-layout">
            <VisualProgressView />
            <div className="chat-spacer" />
          </div>
        ) : <div className="chat-spacer" />
      ) : null}

      {isConnected ? (
        <>
          {pendingApproval && providerCapabilities.supportsPlanApproval ? (
            <PlanApprovalBar />
          ) : (isBusy || (!!activitySummary && activitySummaryEnabled) || showDisablePermanently) ? (
            <>
              {showDisablePermanently && activitySummaryDismissed && (
                <div className="activity-summary-disable-bar">
                  <button
                    className="activity-summary-disable-btn"
                    onClick={handleDisableActivitySummaryPermanently}
                  >
                    Disable permanently
                  </button>
                </div>
              )}
              {(!activitySummaryDismissed || isBusy) && (
                <div
                  className={`busy-indicator ${activitySummary && !activitySummaryDismissed ? 'busy-indicator-with-activity' : ''} ${!isBusy && activitySummary && !activitySummaryDismissed ? 'busy-indicator-idle' : ''}`}
                >
                  {activitySummary && !activitySummaryDismissed && (
                    <button
                      className="activity-summary-dismiss-btn"
                      onClick={handleDismissActivitySummary}
                      title="Dismiss"
                    >
                      x
                    </button>
                  )}
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
                          currentToolActivity ? currentToolActivity + '...' : (
                            activitySummary && !activitySummaryDismissed ? activitySummary.shortLabel + '...' : (
                              currentThinkingEffort ? `Thinking with ${currentThinkingEffort} effort...` : 'Thinking...'
                            )
                          )
                        )
                      ) : (
                        activitySummary && !activitySummaryDismissed ? activitySummary.shortLabel : ''
                      )}
                    </span>
                  </div>
                  {activitySummary && !activitySummaryDismissed && (
                    <div className="activity-summary-detail" dir={activityDir}>
                      {activitySummary.fullSummary}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
          {providerCapabilities.supportsCodexConsult && codexConsultPanelOpen && (
            <CodexConsultPanel onClose={() => setCodexConsultPanelOpen(false)} />
          )}
          {providerCapabilities.supportsCodexConsult && reviewLoopPanelOpen && (
            <ReviewLoopPanel onClose={() => setReviewLoopPanelOpen(false)} />
          )}
          <InputArea />
          {achievementsEnabled && <SessionSummaryNudge hasMessages={hasMessages} />}
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
      {/* SkillDocs first-time onboarding FAB — shown until user makes a choice */}
      {!skillGenOnboardingSeen && provider !== 'codex' && <SkillGenOnboarding />}
      <GlobalTooltip delay={400} />
      <ImageLightbox />
    </div>
  );
};

const SessionSummaryNudge: React.FC<{ hasMessages: boolean }> = ({ hasMessages }) => {
  const { isConnected, isBusy, lastActivityAt, pendingApproval, sessionRecap } = useAppStore();
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [deferUntilMs, setDeferUntilMs] = React.useState(0);
  const [hiddenForActivityAt, setHiddenForActivityAt] = React.useState<number | null>(null);
  const lastSeenActivityRef = React.useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (lastActivityAt > 0 && lastActivityAt !== lastSeenActivityRef.current) {
      lastSeenActivityRef.current = lastActivityAt;
      setHiddenForActivityAt(null);
    }
  }, [lastActivityAt]);

  useEffect(() => {
    if (!isConnected) {
      setDeferUntilMs(0);
      setHiddenForActivityAt(null);
      lastSeenActivityRef.current = 0;
    }
  }, [isConnected]);

  if (!isConnected || !hasMessages || isBusy || !!pendingApproval || !!sessionRecap || lastActivityAt <= 0) {
    return null;
  }

  const idleMs = Math.max(0, nowMs - lastActivityAt);
  const shouldShow =
    idleMs >= SESSION_SUMMARY_IDLE_MS &&
    nowMs >= deferUntilMs &&
    hiddenForActivityAt !== lastActivityAt;

  if (!shouldShow) {
    return null;
  }

  const idleMinutes = Math.floor(idleMs / 60_000);

  return (
    <div className="session-summary-nudge" role="status" aria-live="polite">
      <span className="session-summary-nudge-text">
        Session idle for {idleMinutes}m. Want a session summary?
      </span>
      <div className="session-summary-nudge-actions">
        <button
          className="session-summary-nudge-btn primary"
          onClick={() => {
            postToExtension({ type: 'requestSessionRecapSnapshot' });
            setHiddenForActivityAt(lastActivityAt);
          }}
        >
          Session Summary
        </button>
        <button
          className="session-summary-nudge-btn"
          onClick={() => {
            setDeferUntilMs(Date.now() + SESSION_SUMMARY_DEFER_MS);
            setHiddenForActivityAt(lastActivityAt);
          }}
        >
          Later
        </button>
        <button
          className="session-summary-nudge-btn ghost"
          onClick={() => setHiddenForActivityAt(lastActivityAt)}
        >
          Dismiss
        </button>
      </div>
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
