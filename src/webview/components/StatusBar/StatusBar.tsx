import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { TextSettingsBar } from '../TextSettingsBar/TextSettingsBar';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { CodexModelSelector } from '../ModelSelector/CodexModelSelector';
import { CodexReasoningEffortSelector } from '../ModelSelector/CodexReasoningEffortSelector';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';
import { PermissionModeSelector } from '../PermissionModeSelector/PermissionModeSelector';
import { VitalsInfoPanel } from '../Vitals/VitalsInfoPanel';
import { BabelFishPanel } from '../BabelFish/BabelFishPanel';
import { postToExtension } from '../../hooks/useClaudeStream';
import { t as tAch } from '../Achievements/achievementI18n';
import { useStatusBarCollapse } from '../../hooks/useStatusBarCollapse';
import { StatusBarGroupButton } from './StatusBarGroupButton';

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
    setSkillGenPanelOpen,
    setSkillGenShowInfo,
    isConnected,
    isBusy,
    provider,
    selectedProvider,
    providerCapabilities,
    setSelectedProvider,
    setCodexConsultPanelOpen,
    setPromptHistoryPanelOpen,
    usageStats,
    usageFetchedAt,
    usageError,
    babelFishEnabled,
    teamActive,
  } = useAppStore();

  const { barRef, isCollapsed } = useStatusBarCollapse();
  const [navOpen, setNavOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close vitals info panel on outside click
  useEffect(() => {
    if (!vitalsInfoOpen) return;
    const handler = (e: MouseEvent) => {
      if (vitalsInfoRef.current && !vitalsInfoRef.current.contains(e.target as Node)) {
        setVitalsInfoOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [vitalsInfoOpen]);

  // Close Babel Fish panel on outside click
  useEffect(() => {
    if (!babelFishOpen) return;
    const handler = (e: MouseEvent) => {
      if (babelFishRef.current && !babelFishRef.current.contains(e.target as Node)) {
        setBabelFishOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [babelFishOpen]);

  // Close usage popover on outside click
  useEffect(() => {
    if (!usagePopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (usageRef.current && !usageRef.current.contains(e.target as Node)) {
        setUsagePopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [usagePopoverOpen]);

  // Close dropdowns when expanding back
  useEffect(() => {
    if (!isCollapsed) {
      setNavOpen(false);
      setToolsOpen(false);
    }
  }, [isCollapsed]);

  const activityMs = sessionActivityElapsedMs + (
    sessionActivityRunningSinceMs ? Math.max(0, tickMs - sessionActivityRunningSinceMs) : 0
  );

  const handleHistory = () => {
    postToExtension({ type: 'showHistory' });
  };

  const handlePromptHistory = () => {
    setPromptHistoryPanelOpen(true);
  };

  const handleOpenPlans = () => {
    postToExtension({ type: 'openPlanDocs' });
  };

  const handleFeedbackToggle = () => {
    setFeedbackOpen(!feedbackOpen);
  };

  const handleFeedbackAction = (action: 'bug' | 'feature' | 'email' | 'fullBugReport') => {
    setFeedbackOpen(false);
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

  // Clear loading indicator when new data arrives
  const prevUsageFetchedAt = React.useRef(usageFetchedAt);
  useEffect(() => {
    if (usageFetchedAt !== prevUsageFetchedAt.current) {
      prevUsageFetchedAt.current = usageFetchedAt;
      setUsageLoading(false);
    }
  }, [usageFetchedAt]);

  const handleNavToggle = () => {
    setNavOpen((p) => !p);
    setToolsOpen(false);
    setVitalsInfoOpen(false);
  };

  const handleToolsToggle = () => {
    setToolsOpen((p) => !p);
    setNavOpen(false);
    setVitalsInfoOpen(false);
  };

  const handleOpenProviderTab = (targetProvider: 'claude' | 'codex') => {
    const targetLabel = targetProvider === 'codex' ? 'Codex' : 'Claude';

    if (provider === targetProvider || isBusy) {
      const reason = provider === targetProvider ? `current-tab-is-${targetProvider}` : 'busy';
      console.log(`[StatusBar] ${targetLabel} button ignored`, {
        reason,
        targetProvider,
        selectedProvider,
        provider,
        isBusy,
      });
      postToExtension({
        type: 'diag',
        phase: `statusbar.${targetProvider}.click.ignored`,
        detail: `reason=${reason} target=${targetProvider} selected=${selectedProvider} current=${provider ?? 'none'} busy=${isBusy}`,
      } as any);
      return;
    }
    console.log(`[StatusBar] ${targetLabel} button clicked -> open new ${targetLabel} tab`, {
      targetProvider,
      selectedProviderBefore: selectedProvider,
      currentTabProvider: provider,
      isBusy,
    });
    postToExtension({
      type: 'diag',
      phase: `statusbar.${targetProvider}.click`,
      detail: `target=${targetProvider} selectedBefore=${selectedProvider} current=${provider ?? 'none'} busy=${isBusy}`,
    } as any);
    if (selectedProvider !== targetProvider) {
      setSelectedProvider(targetProvider);
    }
    postToExtension({ type: 'openProviderTab', provider: targetProvider });
  };

  const handleSetClaudeProvider = () => handleOpenProviderTab('claude');
  const handleSetCodexProvider = () => handleOpenProviderTab('codex');

  const claudeButtonTitle = provider === 'claude'
    ? 'Claude is the current provider'
    : selectedProvider === 'claude'
      ? 'Open a new Claude tab'
      : 'Switch default provider to Claude and open a new Claude tab';

  const codexButtonTitle = provider === 'codex'
    ? 'Codex is the current provider'
    : selectedProvider === 'codex'
      ? 'Open a new Codex tab'
      : 'Switch default provider to Codex and open a new Codex tab';

  const isCodexUi = provider === 'codex' || !providerCapabilities.supportsPermissionModeSelector;
  const modelSelectorElement = isCodexUi ? <CodexModelSelector /> : <ModelSelector />;
  const codexReasoningSelectorElement = isCodexUi ? <CodexReasoningEffortSelector /> : null;
  const permissionSelectorElement = providerCapabilities.supportsPermissionModeSelector
    ? <PermissionModeSelector />
    : null;
  const gitPushSupported = providerCapabilities.supportsGitPush;
  const showGitPush = true;
  const showCodexConsult = providerCapabilities.supportsCodexConsult;

  // --- Shared elements ---

  const clockElement = (
    <div
      className={`status-bar-session-clock ${sessionActivityRunningSinceMs ? 'running' : ''}`}
      data-tooltip="Claude active processing time (starts after first prompt)"
    >
      Active: {sessionActivityStarted ? formatDuration(activityMs) : '00:00:00'}
    </div>
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

  const tokensElement = (
    <div className="cost-display">
      <span>In: {(cost?.inputTokens ?? 0).toLocaleString()}</span>
      <span>Out: {(cost?.outputTokens ?? 0).toLocaleString()}</span>
    </div>
  );

  // The highest single usage percentage (for button label hint)
  const maxUsagePct = usageStats.length > 0
    ? Math.max(...usageStats.map((s) => s.percentage))
    : null;

  // Inline popover for the Usage button
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
        <div className="status-bar-usage-popover-empty">No data — click {'\u21BB'} to load</div>
      )}
    </div>
  ) : null;

  // --- COLLAPSED mode ---
  if (isCollapsed) {
    return (
      <div className="status-bar status-bar-collapsed" ref={barRef}>
        {clockElement}

        <StatusBarGroupButton label="More" isOpen={navOpen} onToggle={handleNavToggle}>
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
          <button className="status-bar-group-dropdown-item" onClick={handleOpenPlans} data-tooltip="Open plan document in browser">
            Plans
          </button>
          <button className="status-bar-group-dropdown-item" onClick={handleHistory} data-tooltip="Conversation History (Ctrl+Shift+H)">
            History
          </button>
          <button className="status-bar-group-dropdown-item" onClick={handlePromptHistory} disabled={!isConnected} data-tooltip="Prompt History">
            Prompts
          </button>
          <div className="status-bar-group-dropdown-separator" />
          <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
            <ProviderSelector />
          </div>
          <button
            className={`status-bar-group-dropdown-item ${selectedProvider === 'claude' ? 'active' : ''}`}
            onClick={handleSetClaudeProvider}
            disabled={isBusy}
            data-tooltip={claudeButtonTitle}
          >
            Claude
          </button>
          <button
            className={`status-bar-group-dropdown-item ${selectedProvider === 'codex' ? 'active' : ''}`}
            onClick={handleSetCodexProvider}
            disabled={isBusy}
            data-tooltip={codexButtonTitle}
          >
            Codex
          </button>
          <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
            {modelSelectorElement}
          </div>
          {codexReasoningSelectorElement && (
            <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
              {codexReasoningSelectorElement}
            </div>
          )}
          {permissionSelectorElement && (
            <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
              {permissionSelectorElement}
            </div>
          )}
          <div className="status-bar-group-dropdown-separator" />
          <button className="status-bar-group-dropdown-item" onClick={toggleDashboard} data-tooltip="Analytics Dashboard">
            Dashboard
          </button>
          {teamActive && (
            <button className="status-bar-group-dropdown-item" onClick={() => useAppStore.getState().setTeamPanelOpen(true)} data-tooltip="Agent Teams Panel">
              Teams
            </button>
          )}
          {isConnected && showCodexConsult && (
            <button className="status-bar-group-dropdown-item" onClick={() => setCodexConsultPanelOpen(true)} data-tooltip="Consult Codex GPT expert">
              Consult Codex
            </button>
          )}
        </StatusBarGroupButton>

        <StatusBarGroupButton label="Tools" isOpen={toolsOpen} onToggle={handleToolsToggle} alignRight>
          {skillGenEnabled && !isCodexUi && (
            <div className="status-bar-group-dropdown-item-row">
              <button
                className={`status-bar-group-dropdown-item ${skillGenPendingDocs >= skillGenThreshold ? 'threshold-reached' : ''}`}
                onClick={() => {
                  postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'panelOpened', data: { source: 'statusbar-collapsed', pendingDocs: skillGenPendingDocs, threshold: skillGenThreshold } });
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
                  postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'infoOpened', data: { source: 'statusbar-collapsed' } });
                  postToExtension({ type: 'getSkillGenStatus' });
                  setSkillGenShowInfo(true);
                  setSkillGenPanelOpen(true);
                }}
              >
                !
              </button>
            </div>
          )}
          {achievementsEnabled && (
            <button className="status-bar-group-dropdown-item" onClick={handleAchievements}>
              {tAch(achievementLanguage).trophy} {achievementProfile.totalAchievements}
            </button>
          )}
          {!isCodexUi && (
            <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={usageRef}>
              <button
                className={`status-bar-vitals-btn ${usagePopoverOpen ? 'active' : ''}`}
                onClick={handleUsageClick}
                data-tooltip="Usage Data"
              >
                {maxUsagePct !== null ? `Usage ${maxUsagePct}%` : 'Usage'}
              </button>
              {usagePopover}
            </div>
          )}
          <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={babelFishRef}>
            <button
              className={`status-bar-babelfish-icon-btn ${babelFishEnabled ? 'active' : ''}`}
              onClick={() => setBabelFishOpen((prev) => !prev)}
              data-tooltip="Babel Fish translation settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Ear - outer helix arc */}
                <path d="M15 3Q23 3 23 12Q23 21 15 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                {/* Ear - inner fold */}
                <path d="M16 7Q20 7 20 12Q20 17 16 17" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                {/* Fish body swimming right into ear */}
                <path d="M15 12Q11 8.5 6 12Q11 15.5 15 12Z" fill="currentColor"/>
                {/* Fish tail - forked */}
                <path d="M6 12L3 9.5M6 12L3 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                {/* Fish eye */}
                <circle cx="12.5" cy="11.2" r="0.7" fill="var(--vscode-editor-background, #1e1e1e)"/>
              </svg>
            </button>
            {babelFishOpen && <BabelFishPanel onClose={() => setBabelFishOpen(false)} />}
          </div>
          <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static" ref={vitalsInfoRef}>
            <button
              className={`status-bar-vitals-btn ${vitalsEnabled ? 'active' : ''}`}
              onClick={handleToggleVitals}
              data-tooltip={vitalsEnabled ? 'Hide Session Vitals' : 'Show Session Vitals'}
            >
              Vitals
            </button>
            <button
              className="status-bar-vitals-settings-btn"
              onClick={() => setVitalsInfoOpen((prev) => !prev)}
              data-tooltip="Vitals settings"
              aria-label="Vitals settings"
            >
              {'\u2699'}
            </button>
            {vitalsInfoOpen && <VitalsInfoPanel onClose={() => setVitalsInfoOpen(false)} />}
          </div>
        </StatusBarGroupButton>

        {showGitPush && gitGroup}
        <TextSettingsBar />
        {tokensElement}
      </div>
    );
  }

  // --- EXPANDED mode (original layout) ---
  return (
    <div className="status-bar" ref={barRef}>
      {clockElement}
      {achievementsEnabled && (
        <button
          className="status-bar-achievements-btn"
          onClick={handleAchievements}
          data-tooltip={tAch(achievementLanguage).achievements}
        >
          {tAch(achievementLanguage).trophy} {achievementProfile.totalAchievements}
        </button>
      )}
      <button className="status-bar-history-btn" onClick={handleHistory} data-tooltip="Conversation History (Ctrl+Shift+H)">
        History
      </button>
      <button className="status-bar-prompt-history-btn" onClick={handlePromptHistory} data-tooltip="Prompt History" disabled={!isConnected}>
        Prompts
      </button>
      <button className="status-bar-plans-btn" onClick={handleOpenPlans} data-tooltip="Open plan document in browser">
        Plans
      </button>
      <StatusBarGroupButton label="Feedback" isOpen={feedbackOpen} onToggle={handleFeedbackToggle}>
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
      </StatusBarGroupButton>
      {isConnected && showCodexConsult && (
        <button
          className="status-bar-consult-btn"
          onClick={() => setCodexConsultPanelOpen(true)}
          data-tooltip="Consult Codex GPT expert"
        >
          Consult
        </button>
      )}
      {showGitPush && gitGroup}
      <button
        className={`status-bar-provider-quick-btn ${selectedProvider === 'claude' ? 'active' : ''}`}
        onClick={handleSetClaudeProvider}
        disabled={isBusy}
        data-tooltip={claudeButtonTitle}
      >
        Claude
      </button>
      <button
        className={`status-bar-provider-quick-btn ${selectedProvider === 'codex' ? 'active' : ''}`}
        onClick={handleSetCodexProvider}
        disabled={isBusy}
        data-tooltip={codexButtonTitle}
      >
        Codex
      </button>
      <ProviderSelector />
      {modelSelectorElement}
      {codexReasoningSelectorElement}
      {permissionSelectorElement}
      <TextSettingsBar />
      <button
        className="status-bar-dashboard-btn"
        data-tooltip="Analytics Dashboard"
        aria-label="Open analytics dashboard"
        onClick={toggleDashboard}
        style={{
          background: 'none',
          border: '1px solid rgba(255,255,255,0.15)',
          color: '#e6edf3',
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
        }}
      >
        Dashboard
      </button>
      {teamActive && (
        <button
          className="status-bar-team-btn"
          data-tooltip="Agent Teams Panel"
          aria-label="Open Agent Teams panel"
          onClick={() => useAppStore.getState().setTeamPanelOpen(true)}
          style={{
            background: 'none',
            border: '1px solid rgba(88, 166, 255, 0.3)',
            color: '#58a6ff',
            cursor: 'pointer',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          Teams
        </button>
      )}
      {skillGenEnabled && !isCodexUi && (
        <>
          <button
            className={`status-bar-skillgen-btn ${skillGenPendingDocs >= skillGenThreshold ? 'threshold-reached' : ''} ${skillGenRunStatus !== 'idle' && skillGenRunStatus !== 'succeeded' && skillGenRunStatus !== 'failed' ? 'running' : ''}`}
            data-tooltip={`SkillDocs: ${skillGenPendingDocs}/${skillGenThreshold} pending${skillGenRunStatus !== 'idle' ? ` (${skillGenRunStatus})` : ''}`}
            onClick={() => {
              postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'panelOpened', data: { source: 'statusbar-expanded', pendingDocs: skillGenPendingDocs, threshold: skillGenThreshold, runStatus: skillGenRunStatus } });
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
              postToExtension({ type: 'skillGenUiLog', level: 'INFO', event: 'infoOpened', data: { source: 'statusbar-expanded' } });
              postToExtension({ type: 'getSkillGenStatus' });
              setSkillGenShowInfo(true);
              setSkillGenPanelOpen(true);
            }}
          >
            !
          </button>
        </>
      )}
      {!isCodexUi && (
        <div className="status-bar-usage-wrapper" ref={usageRef}>
          <button
            className={`status-bar-vitals-btn ${usagePopoverOpen ? 'active' : ''}`}
            onClick={handleUsageClick}
            data-tooltip="Usage Data"
          >
            {maxUsagePct !== null ? `Usage ${maxUsagePct}%` : 'Usage'}
          </button>
          {usagePopover}
        </div>
      )}
      <div className="status-bar-babelfish-wrapper" ref={babelFishRef}>
        <button
          className={`status-bar-babelfish-icon-btn ${babelFishEnabled ? 'active' : ''}`}
          onClick={() => setBabelFishOpen((prev) => !prev)}
          data-tooltip="Babel Fish translation settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Ear - outer helix arc */}
            <path d="M15 3Q23 3 23 12Q23 21 15 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            {/* Ear - inner fold */}
            <path d="M16 7Q20 7 20 12Q20 17 16 17" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            {/* Fish body swimming right into ear */}
            <path d="M15 12Q11 8.5 6 12Q11 15.5 15 12Z" fill="currentColor"/>
            {/* Fish tail - forked */}
            <path d="M6 12L3 9.5M6 12L3 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            {/* Fish eye */}
            <circle cx="12.5" cy="11.2" r="0.7" fill="var(--vscode-editor-background, #1e1e1e)"/>
          </svg>
        </button>
        {babelFishOpen && <BabelFishPanel onClose={() => setBabelFishOpen(false)} />}
      </div>
      <div className="status-bar-vitals-wrapper" ref={vitalsInfoRef}>
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
            onClick={() => setVitalsInfoOpen((prev) => !prev)}
            data-tooltip="Vitals settings"
            aria-label="Vitals settings"
          >
            {'\u2699'}
          </button>
        </div>
        {vitalsInfoOpen && <VitalsInfoPanel onClose={() => setVitalsInfoOpen(false)} />}
      </div>
      {tokensElement}
    </div>
  );
};
