import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { TextSettingsBar } from '../TextSettingsBar/TextSettingsBar';
import { VitalsInfoPanel } from '../Vitals/VitalsInfoPanel';
import { BabelFishPanel } from '../BabelFish/BabelFishPanel';
import { postToExtension } from '../../hooks/useClaudeStream';
import { t as tAch } from '../Achievements/achievementI18n';
import { getModelMaxContext, getContextColor } from '../../utils/modelContextLimits';
import { useStatusBarCollapse } from '../../hooks/useStatusBarCollapse';
import { StatusBarGroupButton } from './StatusBarGroupButton';
import { AIChip } from './AIChip';
import { ParticleAcceleratorStatusBadge } from '../ParticleAccelerator/ParticleAcceleratorStatusBadge';
import { SecretProtectionStatusBadge } from '../SecretProtectionStatusBadge';
import { SuperParticleAcceleratorStatusBadge } from '../SuperParticleAccelerator/SuperParticleAcceleratorStatusBadge';
import { useOutsideClick } from '../../hooks/useOutsideClick';

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

function usageBarColor(pct: number): string {
  if (pct > 75) return '#f85149';
  if (pct > 50) return '#d29922';
  return '#3fb950';
}

export const StatusBar: React.FC<{
  cost: { costUsd: number; totalCostUsd: number; inputTokens: number; outputTokens: number };
}> = ({ cost }) => {
  const [tickMs, setTickMs] = React.useState(() => Date.now());
  const [vitalsInfoOpen, setVitalsInfoOpen] = React.useState(false);
  const vitalsInfoRef = React.useRef<HTMLDivElement>(null);
  const [babelFishOpen, setBabelFishOpen] = React.useState(false);
  const babelFishRef = React.useRef<HTMLDivElement>(null);
  const [usagePopoverOpen, setUsagePopoverOpen] = React.useState(false);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const usageRef = React.useRef<HTMLDivElement>(null);
  const [goalOpen, setGoalOpen] = React.useState(false);
  const [goalInputText, setGoalInputText] = React.useState('');
  const goalRef = React.useRef<HTMLDivElement>(null);
  const {
    gitPushSettings,
    gitPushRunning,
    setGitPushRunning,
    setGitPushConfigPanelOpen,
    customSnippetText,
    setCustomSnippetConfigPanelOpen,
    achievementsEnabled,
    achievementProfile,
    achievementLanguage,
    setAchievementPanelOpen,
    vitalsEnabled,
    setVitalsEnabled,
    tabLayout,
    setTabLayout,
    toggleDashboard,
    sessionActivityStarted,
    sessionActivityElapsedMs,
    sessionActivityRunningSinceMs,
    skillGenEnabled,
    skillGenPendingDocs,
    skillGenThreshold,
    skillGenRunStatus,
    skillGenOnboardingSeen,
    setSkillGenPanelOpen,
    setSkillGenShowInfo,
    isConnected,
    isBusy,
    provider,
    providerCapabilities,
    setCodexConsultPanelOpen,
    setReviewLoopPanelOpen,
    resetReviewLoop,
    reviewLoopAutoStart,
    setReviewLoopAutoStart,
    reviewLoopSessionEnabled,
    setReviewLoopSessionEnabled,
    setPromptHistoryPanelOpen,
    usageStats,
    usageFetchedAt,
    usageError,
    babelFishEnabled,
    teamActive,
    contextWidgetVisible,
    setContextWidgetVisible,
    model,
    sessionWorktree,
    handoffStage,
    handoffTargetProvider,
    handoffError,
    handoffArtifactPath,
    handoffManualPrompt,
    mcpInventory,
    mcpPendingRestartCount,
    mcpLastError,
    setMcpPanelOpen,
    setMcpSelectedTab,
    goalActive,
    goalObjective,
    setGoalActive,
  } = useAppStore();

  const { barRef, layoutMode, hideClockFromBar, hideMcpFromBar, hideUsageFromBar } = useStatusBarCollapse();
  const logUiDebug = React.useCallback((event: string, payload?: Record<string, unknown>) => {
    postToExtension({
      type: 'uiDebugLog',
      source: 'StatusBar',
      event,
      payload,
      ts: Date.now(),
    });
  }, []);

  // Dropdown states for the new grouped layout
  const [aiChipOpen, setAiChipOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Centralized outside-click handlers
  useOutsideClick('statusbar-vitals', vitalsInfoRef, vitalsInfoOpen, () => setVitalsInfoOpen(false));
  useOutsideClick('statusbar-babelfish', babelFishRef, babelFishOpen, () => setBabelFishOpen(false));
  useOutsideClick('statusbar-usage', usageRef, usagePopoverOpen, () => setUsagePopoverOpen(false));
  useOutsideClick('statusbar-goal', goalRef, goalOpen, () => setGoalOpen(false));

  // Close all group dropdowns when layout mode changes
  useEffect(() => {
    setAiChipOpen(false);
    setSessionOpen(false);
    setToolsOpen(false);
    setViewOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
  }, [layoutMode]);

  const activityMs = sessionActivityElapsedMs + (
    sessionActivityRunningSinceMs ? Math.max(0, tickMs - sessionActivityRunningSinceMs) : 0
  );

  // --- Shared handlers ---

  const closeAllGroups = () => {
    setAiChipOpen(false);
    setSessionOpen(false);
    setToolsOpen(false);
    setViewOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
    setVitalsInfoOpen(false);
  };

  const handleAiChipToggle = () => {
    const next = !aiChipOpen;
    closeAllGroups();
    setAiChipOpen(next);
  };

  const handleSessionToggle = () => {
    const next = !sessionOpen;
    closeAllGroups();
    setSessionOpen(next);
  };

  const handleToolsToggle = () => {
    const next = !toolsOpen;
    closeAllGroups();
    setToolsOpen(next);
  };

  const handleViewToggle = () => {
    const next = !viewOpen;
    closeAllGroups();
    setViewOpen(next);
  };

  const handleMoreToggle = () => {
    const next = !moreOpen;
    closeAllGroups();
    setMoreOpen(next);
  };

  const handleMenuToggle = () => {
    const next = !menuOpen;
    closeAllGroups();
    setMenuOpen(next);
  };

  const handleHistory = (clickDetail?: number) => {
    logUiDebug('historyClick', {
      clickDetail: clickDetail ?? null,
      layoutMode,
      sessionOpen,
      toolsOpen,
      viewOpen,
      moreOpen,
      menuOpen,
    });
    closeAllGroups();
    postToExtension({ type: 'showHistory' });
  };

  const handlePromptHistory = (clickDetail?: number) => {
    logUiDebug('promptHistoryClick', {
      clickDetail: clickDetail ?? null,
      isConnected,
      layoutMode,
    });
    closeAllGroups();
    setPromptHistoryPanelOpen(true);
  };

  const handleOpenPlans = (clickDetail?: number) => {
    logUiDebug('openPlansClick', {
      clickDetail: clickDetail ?? null,
      layoutMode,
      sessionOpen,
      toolsOpen,
      viewOpen,
      moreOpen,
      menuOpen,
    });
    closeAllGroups();
    postToExtension({ type: 'openPlanDocs' });
  };

  const handleFeedbackAction = (action: 'bug' | 'feature' | 'email' | 'fullBugReport') => {
    postToExtension({ type: 'feedbackAction', action });
  };

  const handleSetGoal = React.useCallback(() => {
    const trimmed = goalInputText.trim();
    if (!trimmed || !isConnected) return;
    postToExtension({ type: 'sendMessage', text: `/goal ${trimmed}` });
    setGoalActive(true, trimmed);
    postToExtension({ type: 'setGoalState', active: true, objective: trimmed } as any);
    setGoalInputText('');
    setGoalOpen(false);
    closeAllGroups();
  }, [goalInputText, isConnected, setGoalActive, closeAllGroups]);

  const handleClearGoal = React.useCallback(() => {
    if (!isConnected) return;
    postToExtension({ type: 'sendMessage', text: '/goal clear' });
    setGoalActive(false, '');
    postToExtension({ type: 'setGoalState', active: false, objective: '' } as any);
    setGoalOpen(false);
    closeAllGroups();
  }, [isConnected, setGoalActive, closeAllGroups]);

  const handleCheckGoalStatus = React.useCallback(() => {
    if (!isConnected) return;
    postToExtension({ type: 'sendMessage', text: '/goal' });
    setGoalOpen(false);
    closeAllGroups();
  }, [isConnected, closeAllGroups]);

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

  const handleInsertSnippet = () => {
    if (!customSnippetText) {
      setCustomSnippetConfigPanelOpen(true);
      return;
    }
    window.dispatchEvent(new CustomEvent('claui-insert-snippet', { detail: customSnippetText }));
  };

  const handleToggleSnippetConfig = () => {
    setCustomSnippetConfigPanelOpen(!useAppStore.getState().customSnippetConfigPanelOpen);
  };

  const handleAchievements = () => {
    postToExtension({ type: 'getAchievementsSnapshot' });
    setAchievementPanelOpen(!useAppStore.getState().achievementPanelOpen);
  };

  const handleToggleVitals = () => {
    const next = !vitalsEnabled;
    setVitalsEnabled(next);
    postToExtension({ type: 'setVitalsEnabled', enabled: next });
  };

  const handleSelectTabLayout = (layout: 'horizontal' | 'vertical') => {
    if (layout === tabLayout) return;
    setTabLayout(layout);
    postToExtension({ type: 'setTabLayout', layout });
  };

  const handleUsageClick = () => {
    setUsagePopoverOpen((prev) => !prev);
    if (!usageStats.length) {
      setUsageLoading(true);
      postToExtension({ type: 'requestUsage' });
    }
  };

  const handleUsageRefresh = () => {
    setUsageLoading(true);
    postToExtension({ type: 'requestUsage' });
  };

  const prevUsageFetchedAt = React.useRef(usageFetchedAt);
  useEffect(() => {
    if (usageFetchedAt !== prevUsageFetchedAt.current) {
      prevUsageFetchedAt.current = usageFetchedAt;
      setUsageLoading(false);
    }
  }, [usageFetchedAt]);

  const handleVitalsSettingsToggle = () => {
    setVitalsInfoOpen((prev) => !prev);
  };

  const handleCopyManualCapsule = () => {
    if (!handoffManualPrompt) return;
    postToExtension({ type: 'copyToClipboard', text: handoffManualPrompt });
  };

  const handleContextWidgetToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextWidgetVisible(!contextWidgetVisible);
  };

  const providerLabel = (p: string): string => p === 'codex' ? 'Codex' : p === 'remote' ? 'Happy' : 'Claude Code';

  const isHandoffRunning =
    handoffStage !== 'idle' &&
    handoffStage !== 'completed' &&
    handoffStage !== 'failed';

  const handoffStageLabel: Record<string, string> = {
    idle: 'Idle',
    collecting_context: 'Collecting context',
    creating_target_tab: 'Creating target tab',
    starting_target_session: 'Starting target session',
    arming_first_user_prompt: 'Preparing first-user context',
    completed: 'Handoff completed',
    failed: 'Handoff failed',
  };

  const isCodexUi = provider === 'codex' || !providerCapabilities.supportsPermissionModeSelector;
  const gitPushSupported = providerCapabilities.supportsGitPush;
  const showCodexConsult = providerCapabilities.supportsCodexConsult;

  // Usage stats
  const maxUsagePct = usageStats.length > 0
    ? Math.max(...usageStats.map((s) => s.percentage))
    : null;

  // Context usage computation
  const ctxMax = getModelMaxContext(model ?? '');
  const ctxTokens = cost?.inputTokens ?? 0;
  const ctxPct = ctxMax > 0 ? Math.min((ctxTokens / ctxMax) * 100, 100) : 0;
  const ctxColor = getContextColor(ctxPct);
  const ctxHasData = ctxTokens > 0;

  // --- Layout mode helpers ---
  const isFull = layoutMode === 'full' || layoutMode === 'medium';
  const isCompact = layoutMode === 'collapsed';
  const isMinimal = layoutMode === 'minimal';

  const chipDisplayMode = isMinimal ? 'minimal' : isCompact ? 'compact' : 'full';

  // --- Handoff banner (shared across all modes) ---
  const handoffBanner = handoffStage !== 'idle' ? (
    <div className={`status-bar-handoff-banner ${handoffStage === 'failed' ? 'is-error' : handoffStage === 'completed' ? 'is-success' : ''}`}>
      <span className="status-bar-handoff-banner-text">
        Handoff: {handoffStageLabel[handoffStage] || handoffStage}
        {handoffTargetProvider ? ` -> ${providerLabel(handoffTargetProvider)}` : ''}
        {handoffArtifactPath ? ` | Artifact: ${handoffArtifactPath}` : ''}
        {handoffError ? ` | ${handoffError}` : ''}
      </span>
      {handoffStage === 'failed' && handoffManualPrompt && (
        <button
          className="status-bar-handoff-fallback-btn"
          onClick={handleCopyManualCapsule}
          data-tooltip="Copy capsule prompt for manual send"
        >
          Send capsule manually
        </button>
      )}
    </div>
  ) : null;

  // --- Right-side bar elements (defined before dropdown items so they can be reused) ---

  // --- Usage popover (rendered inline in the metrics area) ---
  const usagePopover = usagePopoverOpen ? (
    <div className="status-bar-usage-popover">
      <div className="status-bar-usage-popover-header">
        <span>Usage Data</span>
        <button
          className="vitals-info-close"
          onClick={handleUsageRefresh}
          disabled={usageLoading}
          data-tooltip="Refresh"
          style={{ fontSize: 13, padding: '0 4px' }}
        >
          {'\u21BB'}
        </button>
      </div>
      {usageLoading && !usageStats.length ? (
        <div className="status-bar-usage-popover-empty">Loading...</div>
      ) : usageError && !usageStats.length ? (
        <div className="status-bar-usage-popover-error">{usageError}</div>
      ) : usageStats.length > 0 ? (
        usageStats.map((stat, i) => (
          <div key={i} className="status-bar-usage-stat">
            <div className="status-bar-usage-stat-header">
              <span className="status-bar-usage-stat-label">{stat.label}</span>
              <span className="status-bar-usage-stat-pct" style={{ color: usageBarColor(stat.percentage) }}>
                {stat.percentage}%
              </span>
            </div>
            <div className="status-bar-usage-bar-bg">
              <div
                className="status-bar-usage-bar-fill"
                style={{ width: `${Math.min(stat.percentage, 100)}%`, background: usageBarColor(stat.percentage) }}
              />
            </div>
            {stat.resetsAt && (
              <div className="status-bar-usage-stat-resets">Resets {stat.resetsAt}</div>
            )}
          </div>
        ))
      ) : (
        <div className="status-bar-usage-popover-empty">No data -- click {'\u21BB'} to load</div>
      )}
      <div className="status-bar-usage-context-section">
        <div className="status-bar-usage-stat-header">
          <span className="status-bar-usage-stat-label">Context window</span>
          <span className="status-bar-usage-stat-pct" style={{ color: ctxHasData ? ctxColor : 'var(--vscode-descriptionForeground)' }}>
            {ctxHasData ? `${ctxPct.toFixed(1)}%` : '\u2014'}
          </span>
        </div>
        <div className="status-bar-usage-bar-bg" style={{ marginBottom: 6 }}>
          <div
            className="status-bar-usage-bar-fill"
            style={{ width: `${ctxPct}%`, background: ctxColor, transition: 'width 0.5s ease, background 0.5s ease' }}
          />
        </div>
        <button
          className={`status-bar-context-widget-toggle ${contextWidgetVisible ? 'active' : ''}`}
          onClick={handleContextWidgetToggle}
          data-tooltip={contextWidgetVisible ? 'Hide context strip' : 'Show context strip'}
        >
          {contextWidgetVisible ? 'Hide strip' : 'Show strip'}
        </button>
      </div>
    </div>
  ) : null;

  // --- Clock element ---
  const clockElement = (
    <div
      className={`status-bar-session-clock ${sessionActivityRunningSinceMs ? 'running' : ''}`}
      data-tooltip="Claude active processing time (starts after first prompt)"
    >
      {sessionActivityStarted ? formatDuration(activityMs) : '00:00:00'}
    </div>
  );

  // --- Usage metric with inline bar ---
  const usageMetric = !isCodexUi ? (
    <div className="status-bar-usage-wrapper" ref={usageRef}>
      <button
        className={`status-bar-usage-metric-btn ${usagePopoverOpen ? 'active' : ''}`}
        onClick={handleUsageClick}
        data-tooltip="Usage Data"
      >
        <span className="status-bar-usage-bar-inline">
          <span
            className="status-bar-usage-bar-inline-fill"
            style={{
              width: maxUsagePct !== null ? `${Math.min(maxUsagePct, 100)}%` : '0%',
              background: maxUsagePct !== null ? usageBarColor(maxUsagePct) : 'transparent',
            }}
          />
        </span>
        <span className="status-bar-usage-metric-label">
          {maxUsagePct !== null ? `${maxUsagePct}%` : 'Usage'}
        </span>
      </button>
      {usagePopover}
    </div>
  ) : null;

  const needsAuthCount = mcpInventory.filter((server) => server.effectiveStatus === 'needs_auth').length;
  const mcpChipLabel = provider !== 'claude'
    ? 'MCP read-only'
    : mcpLastError
      ? 'MCP error'
      : needsAuthCount > 0
        ? `MCP ${mcpInventory.length} | ${needsAuthCount} needs login`
        : mcpPendingRestartCount > 0
          ? `MCP ${mcpInventory.length} | restart needed`
          : `MCP ${mcpInventory.length}`;

  // Hide MCP chip entirely when there are no servers (MCP is not configured or errored with nothing to show)
  const mcpChip = mcpInventory.length === 0 ? null : (
    <button
      onClick={() => {
        setMcpSelectedTab(provider === 'claude' ? 'session' : 'debug');
        setMcpPanelOpen(true);
      }}
      data-tooltip="Open MCP inventory"
      style={{
        padding: '5px 10px',
        borderRadius: 999,
        border: mcpLastError
          ? '1px solid rgba(248, 81, 73, 0.35)'
          : mcpPendingRestartCount > 0
            ? '1px solid rgba(210, 153, 34, 0.35)'
            : '1px solid rgba(88, 166, 255, 0.26)',
        background: mcpLastError
          ? 'rgba(248, 81, 73, 0.12)'
          : mcpPendingRestartCount > 0
            ? 'rgba(210, 153, 34, 0.12)'
            : 'rgba(88, 166, 255, 0.12)',
        color: mcpLastError ? '#ffaba8' : mcpPendingRestartCount > 0 ? '#f2cc60' : '#9ecbff',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {mcpChipLabel}
    </button>
  );

  // --- Reusable dropdown item groups ---

  const sessionItems = (
    <>
      <button className="status-bar-group-dropdown-item" onClick={(e) => handleHistory(e.detail)} data-tooltip="Conversation History (Ctrl+Shift+H)">
        History
      </button>
      <button className="status-bar-group-dropdown-item" onClick={(e) => handleOpenPlans(e.detail)} data-tooltip="Open plan document in browser">
        Plans
      </button>
      <button className="status-bar-group-dropdown-item" onClick={(e) => handlePromptHistory(e.detail)} disabled={!isConnected} data-tooltip="Prompt History">
        Prompts
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => { useAppStore.getState().setChatSearchOpen(true); closeAllGroups(); }} data-tooltip="Search chat messages (Ctrl+Shift+F)">
        Search
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => { postToExtension({ type: 'openMultiParticipant' }); closeAllGroups(); }} data-tooltip={"Real-time collaboration: multiple users, each with their own AI agent, in one shared session.\n\nRequires a coordination server. See server/deploy/SERVER_SETUP_GUIDE.md in the ClaUi repo - give it to ChatGPT or Claude for step-by-step setup help."}>
        Multi-Participant
      </button>
      <div className="status-bar-group-dropdown-separator" />
      <button className="status-bar-group-dropdown-item" onClick={toggleDashboard} data-tooltip="Analytics Dashboard">
        Dashboard
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => useAppStore.getState().setWorkstreamMapOpen(true)} data-tooltip="Workstream Map">
        Workstream Map
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => { useAppStore.getState().setWorktreePanelOpen(true); closeAllGroups(); }} data-tooltip="Git worktrees dashboard: see every worktree and the sessions running on each">
        Worktrees
      </button>
      {teamActive && (
        <button className="status-bar-group-dropdown-item" onClick={() => useAppStore.getState().setTeamPanelOpen(true)} data-tooltip="Agent Teams Panel">
          Teams
        </button>
      )}
      {achievementsEnabled && (
        <button className="status-bar-group-dropdown-item" onClick={handleAchievements}>
          {tAch(achievementLanguage).trophy} {achievementProfile.totalAchievements}
        </button>
      )}
    </>
  );

  const gitGroup = (
    <div className="status-bar-git-group">
      <button
        className={`status-bar-git-btn ${gitPushSettings?.enabled ? '' : 'not-configured'}`}
        onClick={handleGitPush}
        disabled={gitPushRunning || !gitPushSupported}
        data-tooltip={
          !gitPushSupported
            ? 'Git push is not available in this mode yet'
            : gitPushSettings?.enabled
              ? 'Git: add, commit & push'
              : 'Git push (setup needed)'
        }
      >
        {gitPushRunning ? '...' : 'Git'}
      </button>
      <button
        className="status-bar-git-config-btn"
        onClick={handleToggleGitConfig}
        disabled={!gitPushSupported}
        data-tooltip={gitPushSupported ? 'Git push settings' : 'Git push settings are not available in this mode yet'}
      >
        *
      </button>
    </div>
  );

  const snippetLabel = (() => {
    if (!customSnippetText) return 'Snippet';
    const oneLine = customSnippetText.replace(/\s+/g, ' ').trim();
    return oneLine.length > 16 ? oneLine.slice(0, 16) + '...' : oneLine;
  })();

  const snippetGroup = (
    <div className="status-bar-snippet-group">
      <button
        className={`status-bar-snippet-btn ${customSnippetText ? '' : 'not-configured'}`}
        onClick={handleInsertSnippet}
        data-tooltip={
          customSnippetText
            ? `Insert snippet at cursor: ${customSnippetText.slice(0, 60)}${customSnippetText.length > 60 ? '...' : ''}`
            : 'Custom snippet (click to set it up)'
        }
      >
        {snippetLabel}
      </button>
      <button
        className="status-bar-snippet-config-btn"
        onClick={handleToggleSnippetConfig}
        data-tooltip="Edit custom snippet text"
      >
        *
      </button>
    </div>
  );

  const toolsItems = (
    <>
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" style={{ fontWeight: 600, opacity: 0.7 }}>
        Protection
      </div>
      <div
        className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static"
        onClick={() => closeAllGroups()}
        style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <SuperParticleAcceleratorStatusBadge />
        <SecretProtectionStatusBadge />
      </div>
      <div className="status-bar-group-dropdown-separator" />
      {hideMcpFromBar && mcpChip && (
        <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
          {mcpChip}
        </div>
      )}
      {hideMcpFromBar && mcpChip && <div className="status-bar-group-dropdown-separator" />}
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
        {gitGroup}
      </div>
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
        {snippetGroup}
      </div>
      {isConnected && showCodexConsult && (
        <button className="status-bar-group-dropdown-item" onClick={() => setCodexConsultPanelOpen(true)} data-tooltip="Consult Codex GPT expert">
          Consult Codex
        </button>
      )}
      {isConnected && showCodexConsult && !reviewLoopAutoStart && (
        <button
          className="status-bar-group-dropdown-item"
          onClick={() => {
            resetReviewLoop();
            setReviewLoopPanelOpen(true);
            postToExtension({ type: 'reviewLoopStart' });
          }}
          data-tooltip="Run a Claude + Codex review now (Auto-review is off)"
        >
          Run Review Now
        </button>
      )}
      {isConnected && showCodexConsult && (
        <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static status-bar-autoreview-row">
          <span id="autoreview-label" className="status-bar-autoreview-label">Auto-review</span>
          <span className="status-bar-autoreview-controls">
            <label
              className="review-loop-toggle"
              data-tooltip="Auto-start the review loop after each work turn — global default for all sessions."
            >
              <input
                type="checkbox"
                role="switch"
                aria-label="Auto-review (global default)"
                aria-labelledby="autoreview-label"
                checked={reviewLoopAutoStart}
                onChange={() => {
                  const next = !reviewLoopAutoStart;
                  setReviewLoopAutoStart(next);
                  postToExtension({ type: 'setReviewLoopAutoStart', enabled: next });
                }}
              />
              <span className="review-loop-toggle-slider" />
            </label>
            <button
              type="button"
              className={`status-bar-autoreview-session-btn ${reviewLoopSessionEnabled ? '' : 'off'}`}
              aria-label="Skip auto-review for this session"
              aria-pressed={!reviewLoopSessionEnabled}
              onClick={() => {
                const next = !reviewLoopSessionEnabled;
                setReviewLoopSessionEnabled(next);
                postToExtension({ type: 'setReviewLoopSessionEnabled', enabled: next });
              }}
              data-tooltip="Skip auto-review for THIS session only — turn off for a simple task. Does not affect other sessions or the global default."
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="8" cy="8" r="6.2" />
                <line x1="3.6" y1="3.6" x2="12.4" y2="12.4" />
              </svg>
            </button>
          </span>
        </div>
      )}
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={goalRef}>
        <button
          className={`status-bar-goal-btn${goalActive ? ' active' : ''}`}
          onClick={() => setGoalOpen((prev) => !prev)}
          disabled={!isConnected}
          data-tooltip={goalActive ? `Goal active: ${goalObjective.slice(0, 40)}` : 'Set autonomous goal'}
        >
          Goal{goalActive ? ' (Active)' : ''}
        </button>
        {goalOpen && (
          <div className="goal-popover">
            {goalActive ? (
              <>
                <div className="goal-popover-header">Active Goal</div>
                <div className="goal-popover-objective">{goalObjective}</div>
                <div className="goal-popover-actions">
                  <button className="goal-popover-check" onClick={handleCheckGoalStatus} disabled={!isConnected}>
                    Check Status
                  </button>
                  <button className="goal-popover-clear" onClick={handleClearGoal} disabled={!isConnected}>
                    Clear Goal
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="goal-popover-header">Set Goal</div>
                <p className="goal-popover-desc">Define an objective and completion condition. The AI will work autonomously until the goal is met.</p>
                <textarea
                  className="goal-popover-input"
                  placeholder="Describe the objective and completion condition..."
                  value={goalInputText}
                  onChange={(e) => setGoalInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSetGoal();
                    }
                  }}
                  rows={4}
                  autoFocus
                />
                <button
                  className="goal-popover-submit"
                  onClick={handleSetGoal}
                  disabled={!goalInputText.trim() || !isConnected}
                >
                  Set Goal (Ctrl+Enter)
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="status-bar-group-dropdown-separator" />
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" style={{ fontWeight: 600, opacity: 0.7 }}>
        Smart Search - Claude
      </div>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'claude', model: 'claude-opus-4-7' });
        }}
        data-tooltip="Search past sessions using Claude Opus 4.7"
      >
        Opus 4.7
      </button>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'claude', model: 'claude-sonnet-4-6' });
        }}
        data-tooltip="Search past sessions using Claude Sonnet 4.6"
      >
        Sonnet 4.6
      </button>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'claude', model: 'claude-haiku-4-5-20251001' });
        }}
        data-tooltip="Search past sessions using Claude Haiku 4.5"
      >
        Haiku 4.5
      </button>
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" style={{ fontWeight: 600, opacity: 0.7 }}>
        Smart Search - Codex
      </div>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'codex', model: 'gpt-5.4' });
        }}
        data-tooltip="Search past sessions using GPT-5.4"
      >
        GPT-5.4
      </button>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'codex', model: 'gpt-5.3-codex' });
        }}
        data-tooltip="Search past sessions using GPT-5.3-Codex"
      >
        GPT-5.3-Codex
      </button>
      <button
        className="status-bar-group-dropdown-item"
        onClick={() => {
          closeAllGroups();
          postToExtension({ type: 'openSmartSearch', provider: 'codex', model: 'gpt-5.1-codex-max' });
        }}
        data-tooltip="Search past sessions using GPT-5.1-Codex-Max"
      >
        GPT-5.1-Codex-Max
      </button>
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={babelFishRef}>
        <button
          className={`status-bar-babelfish-icon-btn ${babelFishEnabled ? 'active' : ''}`}
          onClick={() => setBabelFishOpen((prev) => !prev)}
          data-tooltip="Babel Fish translation settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 3Q23 3 23 12Q23 21 15 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <path d="M16 7Q20 7 20 12Q20 17 16 17" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            <path d="M15 12Q11 8.5 6 12Q11 15.5 15 12Z" fill="currentColor"/>
            <path d="M6 12L3 9.5M6 12L3 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12.5" cy="11.2" r="0.7" fill="var(--vscode-editor-background, #1e1e1e)"/>
          </svg>
          <span style={{ marginLeft: 4 }}>Babel Fish</span>
        </button>
        {babelFishOpen && <BabelFishPanel onClose={() => setBabelFishOpen(false)} />}
      </div>
      <div className="status-bar-group-dropdown-separator" />
      {skillGenEnabled && !isCodexUi && skillGenOnboardingSeen && (
        <div className="status-bar-group-dropdown-item-row">
          <button
            className={`status-bar-group-dropdown-item ${skillGenPendingDocs >= skillGenThreshold ? 'threshold-reached' : ''}`}
            onClick={() => {
              postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'panelOpened', data: { source: 'statusbar-grouped', pendingDocs: skillGenPendingDocs, threshold: skillGenThreshold } });
              postToExtension({ type: 'getSkillGenStatus' });
              setSkillGenPanelOpen(true);
            }}
          >
            SkillDocs {skillGenPendingDocs}/{skillGenThreshold}
          </button>
          <button
            className="skillgen-info-btn"
            data-tooltip="How Skills work"
            onClick={() => {
              postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'infoOpened', data: { source: 'statusbar-grouped' } });
              postToExtension({ type: 'getSkillGenStatus' });
              setSkillGenShowInfo(true);
              setSkillGenPanelOpen(true);
            }}
          >
            !
          </button>
        </div>
      )}
      <button className="status-bar-group-dropdown-item" onClick={() => handleFeedbackAction('bug')} data-tooltip="Open bug report">
        Report Bug
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => handleFeedbackAction('feature')} data-tooltip="Request a new feature">
        Feature Request
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => handleFeedbackAction('email')} data-tooltip="Send email feedback">
        Email Feedback
      </button>
      <button className="status-bar-group-dropdown-item" onClick={() => handleFeedbackAction('fullBugReport')} data-tooltip="Collect diagnostics and send full report">
        Full Bug Report
      </button>
    </>
  );

  const viewItems = (
    <>
      {hideClockFromBar && (
        <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
          <div className="status-bar-collapsed-row">
            <span className="status-bar-collapsed-label">Timer</span>
            {clockElement}
          </div>
        </div>
      )}
      {hideUsageFromBar && usageMetric && (
        <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
          {usageMetric}
        </div>
      )}
      {(hideClockFromBar || hideUsageFromBar) && <div className="status-bar-group-dropdown-separator" />}
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
        <TextSettingsBar />
      </div>
      <div className="status-bar-group-dropdown-separator" />
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={vitalsInfoRef}>
        <div className="status-bar-vitals-controls">
          <button
            className={`status-bar-vitals-btn ${vitalsEnabled ? 'active' : ''}`}
            onClick={handleToggleVitals}
            data-tooltip={vitalsEnabled ? 'Hide Session Vitals' : 'Show Session Vitals'}
          >
            Vitals
          </button>
          <button
            className="status-bar-vitals-settings-btn"
            onClick={handleVitalsSettingsToggle}
            data-tooltip="Vitals settings"
            aria-label="Vitals settings"
          >
            {'\u2699'}
          </button>
        </div>
        {vitalsInfoOpen && <VitalsInfoPanel onClose={() => setVitalsInfoOpen(false)} />}
      </div>
      <div className="status-bar-group-dropdown-separator" />
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
        <div className="status-bar-tab-layout-row">
          <span className="status-bar-tab-layout-label">Tab layout</span>
          <div className="status-bar-tab-layout-controls" role="group" aria-label="Tab layout">
            <button
              className={`status-bar-tab-layout-btn ${tabLayout === 'horizontal' ? 'active' : ''}`}
              onClick={() => handleSelectTabLayout('horizontal')}
              data-tooltip="All ClaUi tabs share one editor group (single row)"
              aria-pressed={tabLayout === 'horizontal'}
            >
              Horizontal
            </button>
            <button
              className={`status-bar-tab-layout-btn ${tabLayout === 'vertical' ? 'active' : ''}`}
              onClick={() => handleSelectTabLayout('vertical')}
              data-tooltip="Show a vertical ClaUi tab rail inside the chat panel"
              aria-pressed={tabLayout === 'vertical'}
            >
              Vertical
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // --- Single unified render ---
  return (
    <div className="status-bar status-bar-grouped" ref={barRef}>
      {handoffBanner}

      <div className="status-bar-left">
        {/* AI Chip: Provider + Model + Permissions compound control */}
        <AIChip
          isOpen={aiChipOpen}
          onToggle={handleAiChipToggle}
          displayMode={chipDisplayMode}
        />

        {/* Worktree indicator: shown only when the session runs in a non-primary worktree */}
        {sessionWorktree && (
          <div
            className="status-bar-worktree-chip"
            title={`Worktree: ${sessionWorktree.path}`}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path
                fillRule="evenodd"
                fill="currentColor"
                d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
              />
            </svg>
            <span className="status-bar-worktree-chip-name">{sessionWorktree.name}</span>
          </div>
        )}

        {/* Full: 3 separate group buttons */}
        {isFull && (
          <>
            <StatusBarGroupButton label="Session" isOpen={sessionOpen} onToggle={handleSessionToggle}>
              {sessionItems}
            </StatusBarGroupButton>
            <StatusBarGroupButton label="Tools" isOpen={toolsOpen} onToggle={handleToolsToggle}>
              {toolsItems}
            </StatusBarGroupButton>
            <StatusBarGroupButton label="View" isOpen={viewOpen} onToggle={handleViewToggle}>
              {viewItems}
            </StatusBarGroupButton>
          </>
        )}

        {/* Compact: Session + More (Tools+View merged) */}
        {isCompact && (
          <>
            <StatusBarGroupButton label="Session" isOpen={sessionOpen} onToggle={handleSessionToggle}>
              {sessionItems}
            </StatusBarGroupButton>
            <StatusBarGroupButton label="More" isOpen={moreOpen} onToggle={handleMoreToggle}>
              <div className="status-bar-group-dropdown-section-label">Tools</div>
              {toolsItems}
              <div className="status-bar-group-dropdown-separator" />
              <div className="status-bar-group-dropdown-section-label">View</div>
              {viewItems}
            </StatusBarGroupButton>
          </>
        )}

        {/* Minimal: single Menu button */}
        {isMinimal && (
          <StatusBarGroupButton label="Menu" isOpen={menuOpen} onToggle={handleMenuToggle}>
            <div className="status-bar-group-dropdown-section-label">Session</div>
            {sessionItems}
            <div className="status-bar-group-dropdown-separator" />
            <div className="status-bar-group-dropdown-section-label">Tools</div>
            {toolsItems}
            <div className="status-bar-group-dropdown-separator" />
            <div className="status-bar-group-dropdown-section-label">View</div>
            {viewItems}
          </StatusBarGroupButton>
        )}
      </div>

      <div className="status-bar-right">
        <ParticleAcceleratorStatusBadge />
        {!hideClockFromBar && clockElement}
        {!hideMcpFromBar && mcpChip}
        {!hideUsageFromBar && usageMetric}
      </div>
    </div>
  );
};
