import React, { useState } from 'react';
import { useAppStore } from '../../state/store';
import { TASK_STATUS_COLORS, getAgentColor } from './teamColors';
import { postToExtension } from '../../hooks/useClaudeStream';

interface TeamTaskItem {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  status: string;
  blockedBy?: number[];
  blocks?: number[];
}

const TaskCard: React.FC<{ task: TeamTaskItem; members: Array<{ name: string }> }> = ({ task, members }) => {
  const ownerIdx = members.findIndex(m => m.name === task.owner);
  const ownerColor = ownerIdx >= 0 ? getAgentColor(ownerIdx) : '#8b949e';

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
    }}>
      <div style={{ fontWeight: 500, color: '#e6edf3', fontSize: 13, marginBottom: 4 }}>
        #{task.id} {task.subject}
      </div>
      {task.owner && (
        <span style={{
          fontSize: 10,
          background: '#21262d',
          color: ownerColor,
          padding: '2px 6px',
          borderRadius: 4,
          marginRight: 4,
        }}>
          {task.owner}
        </span>
      )}
      {task.blockedBy && task.blockedBy.length > 0 && task.blockedBy.map(id => (
        <span key={`blocked-${id}`} style={{
          fontSize: 10,
          background: 'rgba(240, 136, 62, 0.15)',
          color: '#f0883e',
          padding: '2px 6px',
          borderRadius: 4,
          marginRight: 4,
        }}>
          Blocked by #{id}
        </span>
      ))}
      {task.blocks && task.blocks.length > 0 && task.blocks.map(id => (
        <span key={`blocks-${id}`} style={{
          fontSize: 10,
          background: 'rgba(88, 166, 255, 0.15)',
          color: '#58a6ff',
          padding: '2px 6px',
          borderRadius: 4,
          marginRight: 4,
        }}>
          Blocks #{id}
        </span>
      ))}
    </div>
  );
};

export const TasksTab: React.FC = () => {
  const { teamTasks, teamConfig } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const members = teamConfig?.members || [];

  const pending = teamTasks.filter(t => t.status === 'pending');
  const inProgress = teamTasks.filter(t => t.status === 'in_progress');
  const completed = teamTasks.filter(t => t.status === 'completed');

  const handleAddTask = () => {
    if (!newSubject.trim()) return;
    postToExtension({ type: 'teamCreateTask', subject: newSubject.trim() });
    setNewSubject('');
    setShowAddForm(false);
  };

  const columnStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '0 8px',
  };

  const headerStyle = (color: string): React.CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: `2px solid ${color}`,
  });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              background: '#238636',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + Add Task
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input
              type="text"
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTask()}
              placeholder="Task subject..."
              autoFocus
              style={{
                flex: 1,
                background: '#0d1117',
                border: '1px solid #30363d',
                color: '#e6edf3',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            />
            <button
              onClick={handleAddTask}
              style={{
                background: '#238636',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewSubject(''); }}
              style={{
                background: '#21262d',
                color: '#8b949e',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={columnStyle}>
          <div style={headerStyle(TASK_STATUS_COLORS.pending)}>
            Pending ({pending.length})
          </div>
          {pending.map(t => <TaskCard key={t.id} task={t} members={members} />)}
        </div>
        <div style={columnStyle}>
          <div style={headerStyle(TASK_STATUS_COLORS.in_progress)}>
            In Progress ({inProgress.length})
          </div>
          {inProgress.map(t => <TaskCard key={t.id} task={t} members={members} />)}
        </div>
        <div style={columnStyle}>
          <div style={headerStyle(TASK_STATUS_COLORS.completed)}>
            Completed ({completed.length})
          </div>
          {completed.map(t => <TaskCard key={t.id} task={t} members={members} />)}
        </div>
      </div>
    </div>
  );
};
