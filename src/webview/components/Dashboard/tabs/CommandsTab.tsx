import React, { useState, useMemo } from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { BugRepeatTracker } from '../charts/SemanticWidgets';
import {
  DASH_COLORS,
  COMMAND_CATEGORY_COLORS,
  flattenCommands,
  formatTime,
  type CommandCategory,
  type CommandEntry,
} from '../dashboardUtils';

interface CommandsTabProps {
  turnHistory: TurnRecord[];
}

const ALL_CATEGORIES: CommandCategory[] = ['git', 'npm', 'test', 'build', 'deploy', 'search', 'file', 'other'];

export const CommandsTab: React.FC<CommandsTabProps> = ({ turnHistory }) => {
  const [activeCategories, setActiveCategories] = useState<Set<CommandCategory>>(new Set(ALL_CATEGORIES));
  const [searchText, setSearchText] = useState('');
  const hasBugRepeats = turnHistory.some((t) => t.semantics?.bugRepeat && t.semantics.bugRepeat !== 'none');

  const allCommands = useMemo(() => flattenCommands(turnHistory), [turnHistory]);

  const filteredCommands = useMemo(() => {
    return allCommands.filter((cmd) => {
      if (!activeCategories.has(cmd.category)) return false;
      if (searchText && !cmd.command.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [allCommands, activeCategories, searchText]);

  const toggleCategory = (cat: CommandCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  if (allCommands.length === 0) {
    return (
      <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '48px', fontSize: '14px' }}>
        No shell commands recorded yet
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '16px' }}>
      <div style={{ flex: 1 }}>
        {/* Category filter chips */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {ALL_CATEGORIES.map((cat) => {
            const active = activeCategories.has(cat);
            const count = allCommands.filter((c) => c.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  borderRadius: '12px',
                  border: `1px solid ${active ? COMMAND_CATEGORY_COLORS[cat] : DASH_COLORS.border}`,
                  background: active ? `${COMMAND_CATEGORY_COLORS[cat]}20` : 'transparent',
                  color: active ? COMMAND_CATEGORY_COLORS[cat] : DASH_COLORS.textMuted,
                  cursor: 'pointer',
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <input
          type="text"
          placeholder="Search commands..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: '12px',
            background: DASH_COLORS.cardBg,
            color: DASH_COLORS.text,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '6px',
            marginBottom: '12px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {/* Command list */}
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: '8px',
          maxHeight: '500px',
          overflowY: 'auto',
        }}>
          {filteredCommands.map((cmd, idx) => (
            <CommandRow key={idx} cmd={cmd} />
          ))}
          {filteredCommands.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: DASH_COLORS.textMuted, fontSize: '12px' }}>
              No matching commands
            </div>
          )}
        </div>
      </div>

      {/* Bug repeat sidebar */}
      {hasBugRepeats && (
        <div style={{ width: '280px', flexShrink: 0 }}>
          <BugRepeatTracker turnHistory={turnHistory} />
        </div>
      )}
    </div>
  );
};

const CommandRow: React.FC<{ cmd: CommandEntry }> = ({ cmd }) => {
  const truncated = cmd.command.length > 120 ? cmd.command.slice(0, 120) + '...' : cmd.command;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 12px',
      borderBottom: `1px solid ${DASH_COLORS.border}`,
      fontSize: '12px',
    }}>
      <span style={{ color: DASH_COLORS.textMuted, minWidth: '52px' }}>
        Turn {cmd.turnIndex + 1}
      </span>
      <span style={{
        padding: '1px 6px',
        borderRadius: '8px',
        fontSize: '10px',
        fontWeight: 600,
        color: COMMAND_CATEGORY_COLORS[cmd.category],
        border: `1px solid ${COMMAND_CATEGORY_COLORS[cmd.category]}40`,
        minWidth: '40px',
        textAlign: 'center',
      }}>
        {cmd.category}
      </span>
      <span
        style={{ fontFamily: 'monospace', color: DASH_COLORS.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={cmd.command}
      >
        {truncated}
      </span>
      <span style={{ color: DASH_COLORS.textMuted, minWidth: '60px', textAlign: 'right' }}>
        {formatTime(cmd.timestamp)}
      </span>
    </div>
  );
};
