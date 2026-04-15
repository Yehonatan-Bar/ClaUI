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
  const {
    gitPushSettings,
    gitPushRunning,
    setGitPushRunning,
    setGitPushConfigPanelOpen,
    achievementsEnabled,
    achievementProfile,
    achievementLanguage,
    setAchievementPanelOpen,
    vitalsEnabled,
    setVitalsEnabled,
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
    setPromptHistoryPanelOpen,
    usageStats,
    usageFetchedAt,
    usageError,
    babelFishEnabled,
    teamActive,
    contextWidgetVisible,
    setContextWidgetVisible,
    model,
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

  const handleToggleVitals = () => {
    const next = !vitalsEnabled;
    setVitalsEnabled(next);
    postToExtension({ type: 'setVitalsEnabled', enabled: next });
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
      <div className="status-bar-group-dropdown-separator" />
      <button className="status-bar-group-dropdown-item" onClick={toggleDashboard} data-tooltip="Analytics Dashboard">
        Dashboard
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

  const toolsItems = (
    <>
      {hideMcpFromBar && mcpChip && (
        <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
          {mcpChip}
        </div>
      )}
      {hideMcpFromBar && mcpChip && <div className="status-bar-group-dropdown-separator" />}
      <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
        {gitGroup}
      </div>
      {isConnected && showCodexConsult && (
        <button className="status-bar-group-dropdown-item" onClick={() => setCodexConsultPanelOpen(true)} data-tooltip="Consult Codex GPT expert">
          Consult Codex
        </button>
      )}
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
        {!hideClockFromBar && clockElement}
        {!hideMcpFromBar && mcpChip}
        {!hideUsageFromBar && usageMetric}
      </div>
    </div>
  );
};
