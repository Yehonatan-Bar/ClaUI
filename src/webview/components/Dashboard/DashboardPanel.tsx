import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { OverviewTab } from './tabs/OverviewTab';
import { TokensTab } from './tabs/TokensTab';
import { ToolsTab } from './tabs/ToolsTab';
import { TimelineTab } from './tabs/TimelineTab';
import { CommandsTab } from './tabs/CommandsTab';
import { ContextTab } from './tabs/ContextTab';
import { ProjectOverviewTab } from './tabs/ProjectOverviewTab';
import { ProjectSessionsTab } from './tabs/ProjectSessionsTab';
import { ProjectTokensTab } from './tabs/ProjectTokensTab';
import { ProjectToolsTab } from './tabs/ProjectToolsTab';
import { UsageTab } from './tabs/UsageTab';
import { DASH_COLORS } from './dashboardUtils';

type SessionTab = 'overview' | 'tokens' | 'tools' | 'timeline' | 'commands' | 'context' | 'usage';
type ProjectTab = 'p-overview' | 'p-sessions' | 'p-tokens' | 'p-tools';
type DashboardTab = SessionTab | ProjectTab;

const SESSION_TABS: { key: SessionTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'tools', label: 'Tools' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'commands', label: 'Commands' },
  { key: 'context', label: 'Context' },
  { key: 'usage', label: 'Usage' },
];

const PROJECT_TABS: { key: ProjectTab; label: string }[] = [
  { key: 'p-overview', label: 'Overview' },
  { key: 'p-sessions', label: 'Sessions' },
  { key: 'p-tokens', label: 'Tokens' },
  { key: 'p-tools', label: 'Tools' },
];

const modeToggleBase: React.CSSProperties = {
  padding: '5px 14px',
  cursor: 'pointer',
  border: 'none',
  fontSize: '12px',
  fontWeight: 600,
  borderRadius: '4px',
  transition: 'background 0.15s, color 0.15s',
};

export const DashboardPanel: React.FC = () => {
  const { turnHistory, setDashboardOpen, projectSessions, projectDashboardMode, setProjectDashboardMode } = useAppStore();
  const [activeTab, setActiveTab] = useState<DashboardTab>(
    projectDashboardMode === 'project' ? 'p-overview' : 'overview'
  );
  const mode = projectDashboardMode;

  // Normalize local tab state to the persisted mode on mount / reopen.
  // Without this, reopening the dashboard in Project mode can still render the
  // Session "overview" tab content (which may look like "no data").
  useEffect(() => {
    setActiveTab((prev) => {
      if (mode === 'project' && !prev.startsWith('p-')) {
        return 'p-overview';
      }
      if (mode === 'session' && prev.startsWith('p-')) {
        return 'overview';
      }
      return prev;
    });
  }, [mode]);

  // Request project analytics when switching to project mode
  useEffect(() => {
    if (mode === 'project') {
      postToExtension({ type: 'getProjectAnalytics' } as any);
    }
  }, [mode]);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDashboardOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setDashboardOpen]);

  const handleOpenSettings = () => {
    postToExtension({ type: 'openSettings', query: 'claudeMirror' } as any);
  };

  const handleModeSwitch = (newMode: 'session' | 'project') => {
    setProjectDashboardMode(newMode);
    // Reset to the first tab of the new mode
    setActiveTab(newMode === 'session' ? 'overview' : 'p-overview');
  };

  const tabs = mode === 'session' ? SESSION_TABS : PROJECT_TABS;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      backgroundColor: 'rgba(13, 17, 23, 0.97)',
      color: DASH_COLORS.text,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: `1px solid ${DASH_COLORS.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700 }}>ClaUi Analytics</span>
          {/* Session / Project mode toggle */}
          <div style={{
            display: 'flex',
            background: DASH_COLORS.cardBg,
            borderRadius: '6px',
            border: `1px solid ${DASH_COLORS.border}`,
            padding: '2px',
          }}>
            <button
              onClick={() => handleModeSwitch('session')}
              style={{
                ...modeToggleBase,
                background: mode === 'session' ? DASH_COLORS.blue : 'transparent',
                color: mode === 'session' ? '#fff' : DASH_COLORS.textMuted,
              }}
            >
              Session
            </button>
            <button
              onClick={() => handleModeSwitch('project')}
              style={{
                ...modeToggleBase,
                background: mode === 'project' ? DASH_COLORS.purple : 'transparent',
                color: mode === 'project' ? '#fff' : DASH_COLORS.textMuted,
              }}
            >
              Project
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleOpenSettings}
            data-tooltip="Open ClaUi settings"
            style={{
              background: 'none',
              border: 'none',
              color: DASH_COLORS.textMuted,
              cursor: 'pointer',
              fontSize: '16px',
              padding: '4px 8px',
            }}
          >
            {'\u2699'}
          </button>
          <button
            onClick={() => setDashboardOpen(false)}
            data-tooltip="Close dashboard (Esc)"
            style={{
              background: 'none',
              border: 'none',
              color: DASH_COLORS.textMuted,
              cursor: 'pointer',
              fontSize: '18px',
              fontWeight: 700,
              padding: '4px 8px',
            }}
          >
            x
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: '2px',
        borderBottom: `1px solid ${DASH_COLORS.border}`,
        padding: '0 20px',
        flexShrink: 0,
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px',
              cursor: 'pointer',
              color: activeTab === tab.key ? (mode === 'project' ? DASH_COLORS.purple : DASH_COLORS.blue) : DASH_COLORS.textMuted,
              background: 'none',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.key ? (mode === 'project' ? DASH_COLORS.purple : DASH_COLORS.blue) : 'transparent',
              fontSize: '13px',
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
      }}>
        {/* Session tabs */}
        {mode === 'session' && activeTab === 'overview' && <OverviewTab turnHistory={turnHistory} />}
        {mode === 'session' && activeTab === 'tokens' && <TokensTab turnHistory={turnHistory} />}
        {mode === 'session' && activeTab === 'tools' && <ToolsTab turnHistory={turnHistory} />}
        {mode === 'session' && activeTab === 'timeline' && <TimelineTab turnHistory={turnHistory} />}
        {mode === 'session' && activeTab === 'commands' && <CommandsTab turnHistory={turnHistory} />}
        {mode === 'session' && activeTab === 'context' && <ContextTab />}
        {mode === 'session' && activeTab === 'usage' && <UsageTab />}
        {/* Project tabs */}
        {mode === 'project' && activeTab === 'p-overview' && <ProjectOverviewTab sessions={projectSessions} />}
        {mode === 'project' && activeTab === 'p-sessions' && <ProjectSessionsTab sessions={projectSessions} />}
        {mode === 'project' && activeTab === 'p-tokens' && <ProjectTokensTab sessions={projectSessions} />}
        {mode === 'project' && activeTab === 'p-tools' && <ProjectToolsTab sessions={projectSessions} />}
      </div>
    </div>
  );
};
