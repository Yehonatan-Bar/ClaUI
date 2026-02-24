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
import { TokenRatioTab } from './tabs/TokenRatioTab';
import { DASH_COLORS } from './dashboardUtils';

type SessionTab = 'overview' | 'tokens' | 'tools' | 'timeline' | 'commands' | 'context' | 'usage';
type ProjectTab = 'p-overview' | 'p-sessions' | 'p-tokens' | 'p-tools';
type UserTab = 'u-ratio';
type DashboardTab = SessionTab | ProjectTab | UserTab;

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

const USER_TABS: { key: UserTab; label: string }[] = [
  { key: 'u-ratio', label: 'Token Ratio' },
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

const MODE_COLORS: Record<string, string> = {
  session: DASH_COLORS.blue,
  project: DASH_COLORS.purple,
  user: DASH_COLORS.amber,
};

function getDefaultTab(mode: 'session' | 'project' | 'user'): DashboardTab {
  if (mode === 'project') return 'p-overview';
  if (mode === 'user') return 'u-ratio';
  return 'overview';
}

export const DashboardPanel: React.FC = () => {
  const { turnHistory, setDashboardOpen, projectSessions, projectDashboardMode, setProjectDashboardMode } = useAppStore();
  const [activeTab, setActiveTab] = useState<DashboardTab>(getDefaultTab(projectDashboardMode));
  const mode = projectDashboardMode;

  // Normalize local tab state to the persisted mode on mount / reopen.
  useEffect(() => {
    setActiveTab((prev) => {
      if (mode === 'project' && !prev.startsWith('p-')) return 'p-overview';
      if (mode === 'user' && !prev.startsWith('u-')) return 'u-ratio';
      if (mode === 'session' && (prev.startsWith('p-') || prev.startsWith('u-'))) return 'overview';
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

  const handleModeSwitch = (newMode: 'session' | 'project' | 'user') => {
    setProjectDashboardMode(newMode);
    setActiveTab(getDefaultTab(newMode));
  };

  const tabs = mode === 'project' ? PROJECT_TABS : mode === 'user' ? USER_TABS : SESSION_TABS;
  const modeColor = MODE_COLORS[mode] || DASH_COLORS.blue;

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
          {/* Session / Project / User mode toggle */}
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
            <button
              onClick={() => handleModeSwitch('user')}
              style={{
                ...modeToggleBase,
                background: mode === 'user' ? DASH_COLORS.amber : 'transparent',
                color: mode === 'user' ? '#fff' : DASH_COLORS.textMuted,
              }}
            >
              User
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

      {/* Tab bar (hidden when user mode has only 1 tab) */}
      {tabs.length > 1 && (
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
                color: activeTab === tab.key ? modeColor : DASH_COLORS.textMuted,
                background: 'none',
                border: 'none',
                borderBottomWidth: '2px',
                borderBottomStyle: 'solid',
                borderBottomColor: activeTab === tab.key ? modeColor : 'transparent',
                fontSize: '13px',
                fontWeight: activeTab === tab.key ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

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
        {/* User tabs */}
        {mode === 'user' && activeTab === 'u-ratio' && <TokenRatioTab />}
      </div>
    </div>
  );
};
