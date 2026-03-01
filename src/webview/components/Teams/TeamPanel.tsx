import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { TopologyTab } from './TopologyTab';
import { TasksTab } from './TasksTab';
import { MessagesTab } from './MessagesTab';
import { ActivityTab } from './ActivityTab';

type TeamTab = 'topology' | 'tasks' | 'messages' | 'activity';

const TABS: { key: TeamTab; label: string }[] = [
  { key: 'topology', label: 'Topology' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'messages', label: 'Messages' },
  { key: 'activity', label: 'Activity' },
];

export const TeamPanel: React.FC = () => {
  const { teamName, setTeamPanelOpen, teamTasks } = useAppStore();
  const [activeTab, setActiveTab] = useState<TeamTab>('topology');

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTeamPanelOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setTeamPanelOpen]);

  const taskCounts = {
    pending: teamTasks.filter(t => t.status === 'pending').length,
    inProgress: teamTasks.filter(t => t.status === 'in_progress').length,
    completed: teamTasks.filter(t => t.status === 'completed').length,
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      backgroundColor: 'rgba(13, 17, 23, 0.97)',
      color: '#e6edf3',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid #30363d',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Agent Teams</span>
          {teamName && (
            <span style={{
              fontSize: 13,
              color: '#58a6ff',
              background: 'rgba(88, 166, 255, 0.1)',
              padding: '2px 8px',
              borderRadius: 4,
            }}>
              {teamName}
            </span>
          )}
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {taskCounts.inProgress} active / {taskCounts.pending} pending / {taskCounts.completed} done
          </span>
        </div>
        <button
          onClick={() => setTeamPanelOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8b949e',
            fontSize: 20,
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: 1,
          }}
          data-tooltip="Close (ESC)"
        >
          x
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #30363d',
        padding: '0 20px',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #58a6ff' : '2px solid transparent',
              color: activeTab === tab.key ? '#e6edf3' : '#8b949e',
              padding: '10px 16px',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'topology' && <TopologyTab />}
        {activeTab === 'tasks' && <TasksTab />}
        {activeTab === 'messages' && <MessagesTab />}
        {activeTab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
};
