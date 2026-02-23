import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { TextSettingsBar } from '../TextSettingsBar/TextSettingsBar';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { CodexModelSelector } from '../ModelSelector/CodexModelSelector';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';
import { PermissionModeSelector } from '../PermissionModeSelector/PermissionModeSelector';
import { VitalsInfoPanel } from '../Vitals/VitalsInfoPanel';
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

export const StatusBar: React.FC<{
  cost: { costUsd: number; totalCostUsd: number; inputTokens: number; outputTokens: number };
}> = ({ cost }) => {
  const [tickMs, setTickMs] = React.useState(() => Date.now());
  const [vitalsInfoOpen, setVitalsInfoOpen] = React.useState(false);
  const vitalsInfoRef = React.useRef<HTMLDivElement>(null);
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
    isConnected,
    isBusy,
    provider,
    selectedProvider,
    providerCapabilities,
    setSelectedProvider,
    setCodexConsultPanelOpen,
  } = useAppStore();

  const { barRef, isCollapsed } = useStatusBarCollapse();
  const [navOpen, setNavOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

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

  const handleOpenPlans = () => {
    postToExtension({ type: 'openPlanDocs' });
  };

  const handleFeedback = () => {
    postToExtension({ type: 'openFeedback' });
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

  const handleSetCodexProvider = () => {
    if (selectedProvider === 'codex' || isBusy) {
      return;
    }
    setSelectedProvider('codex');
    postToExtension({ type: 'setProvider', provider: 'codex' });
  };

  const codexButtonTitle = selectedProvider === 'codex'
    ? `Codex is the selected default provider${provider ? ` (current tab: ${provider === 'codex' ? 'Codex' : 'Claude'})` : ''}`
    : 'Switch default provider to Codex for new sessions/tabs';

  const isCodexUi = provider === 'codex' || !providerCapabilities.supportsPermissionModeSelector;
  const modelSelectorElement = isCodexUi ? <CodexModelSelector /> : <ModelSelector />;
  const permissionSelectorElement = providerCapabilities.supportsPermissionModeSelector
    ? <PermissionModeSelector />
    : null;
  const showGitPush = providerCapabilities.supportsGitPush;
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
        disabled={gitPushRunning}
        data-tooltip={gitPushSettings?.enabled ? 'Git: add, commit & push' : 'Git push (setup needed)'}
      >
        {gitPushRunning ? '...' : 'Git'}
      </button>
      <button
        className="status-bar-git-config-btn"
        onClick={handleToggleGitConfig}
        data-tooltip="Git push settings"
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

  // --- COLLAPSED mode ---
  if (isCollapsed) {
    return (
      <div className="status-bar status-bar-collapsed" ref={barRef}>
        {clockElement}

        <StatusBarGroupButton label="More" isOpen={navOpen} onToggle={handleNavToggle}>
          <button className="status-bar-group-dropdown-item" onClick={handleFeedback} data-tooltip="Send feedback or report a bug">
            Feedback
          </button>
          <button className="status-bar-group-dropdown-item" onClick={handleOpenPlans} data-tooltip="Open plan document in browser">
            Plans
          </button>
          <button className="status-bar-group-dropdown-item" onClick={handleHistory} data-tooltip="Conversation History (Ctrl+Shift+H)">
            History
          </button>
          <div className="status-bar-group-dropdown-separator" />
          <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
            <ProviderSelector />
          </div>
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
          {permissionSelectorElement && (
            <div className="status-bar-group-dropdown-item status-bar-group-dropdown-item--static">
              {permissionSelectorElement}
            </div>
          )}
          <div className="status-bar-group-dropdown-separator" />
          <button className="status-bar-group-dropdown-item" onClick={toggleDashboard} data-tooltip="Analytics Dashboard">
            Dashboard
          </button>
          {isConnected && showCodexConsult && (
            <button className="status-bar-group-dropdown-item" onClick={() => setCodexConsultPanelOpen(true)} data-tooltip="Consult Codex GPT expert">
              Consult Codex
            </button>
          )}
        </StatusBarGroupButton>

        <StatusBarGroupButton label="Tools" isOpen={toolsOpen} onToggle={handleToolsToggle} alignRight>
          {skillGenEnabled && (
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
          )}
          {achievementsEnabled && (
            <button className="status-bar-group-dropdown-item" onClick={handleAchievements}>
              {tAch(achievementLanguage).trophy} {achievementProfile.totalAchievements}
            </button>
          )}
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
      <button className="status-bar-plans-btn" onClick={handleOpenPlans} data-tooltip="Open plan document in browser">
        Plans
      </button>
      <button className="status-bar-feedback-btn" onClick={handleFeedback} data-tooltip="Send feedback or report a bug">
        Feedback
      </button>
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
        className={`status-bar-codex-btn ${selectedProvider === 'codex' ? 'active' : ''}`}
        onClick={handleSetCodexProvider}
        disabled={isBusy}
        data-tooltip={codexButtonTitle}
      >
        Codex
      </button>
      <ProviderSelector />
      {modelSelectorElement}
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
      {skillGenEnabled && (
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
      )}
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
