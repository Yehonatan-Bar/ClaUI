import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SLASH_COMMAND_GROUPS, filterSlashCommands, SlashCommand } from '../../data/slashCommands';

interface SlashCommandBrowserProps {
  /** Called with the chosen command name (no slash) to insert into the input. */
  onSelect: (name: string) => void;
  onClose: () => void;
}

const CommandRow: React.FC<{ cmd: SlashCommand; onSelect: (name: string) => void }> = ({ cmd, onSelect }) => (
  <button className="slash-browser-item" onClick={() => onSelect(cmd.name)}>
    <span className="slash-browser-item-header">
      <span className="slash-command-name">/{cmd.name}</span>
      {cmd.argsHint && <span className="slash-command-args">{cmd.argsHint}</span>}
      {cmd.native && <span className="slash-command-badge">ClaUi</span>}
    </span>
    <span className="slash-command-desc">{cmd.description}</span>
  </button>
);

/**
 * Full browsable list of every built-in slash command, opened from the input
 * toolbar. Shows commands grouped by category (matching the CLI menu) with a
 * search box that flattens to a ranked result list while typing. Selecting a
 * command inserts it into the chat input and closes the modal.
 */
export const SlashCommandBrowser: React.FC<SlashCommandBrowserProps> = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Strip a leading slash so users can type "/model" or "model" interchangeably.
  const normalizedQuery = query.trim().replace(/^\//, '').toLowerCase();
  const flatResults = useMemo(
    () => (normalizedQuery ? filterSlashCommands(normalizedQuery) : null),
    [normalizedQuery]
  );

  return (
    <div className="slash-browser-backdrop" onMouseDown={onClose}>
      <div className="slash-browser" onMouseDown={(e) => e.stopPropagation()}>
        <div className="slash-browser-header">
          <span className="slash-browser-title">Slash commands</span>
          <button className="slash-browser-close" onClick={onClose} data-tooltip="Close">
            x
          </button>
        </div>
        <input
          ref={searchRef}
          className="slash-browser-search"
          placeholder="Search commands..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="slash-browser-body">
          {flatResults ? (
            flatResults.length === 0 ? (
              <div className="slash-browser-empty">No matching commands</div>
            ) : (
              <div className="slash-browser-group">
                {flatResults.map((cmd) => (
                  <CommandRow key={cmd.name} cmd={cmd} onSelect={onSelect} />
                ))}
              </div>
            )
          ) : (
            SLASH_COMMAND_GROUPS.map((group) => (
              <div className="slash-browser-group" key={group.category}>
                <div className="slash-browser-group-title">{group.category}</div>
                {group.commands.map((cmd) => (
                  <CommandRow key={cmd.name} cmd={cmd} onSelect={onSelect} />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="slash-browser-hint">
          Selecting a command inserts it into the input. Type / in the input for inline autocomplete.
        </div>
      </div>
    </div>
  );
};
