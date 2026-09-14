import React, { useRef, useEffect } from 'react';
import { SlashCommand, SlashArgOption } from '../../data/slashCommands';

interface SlashCommandPopupProps {
  mode: 'command' | 'arg';
  results: SlashCommand[];
  argResults: SlashArgOption[];
  argCommand: SlashCommand | null;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onSelectArg: (opt: SlashArgOption) => void;
}

/**
 * Inline autocomplete popup for slash commands. Floats above the input (same
 * positioning pattern as `FileMentionPopup`). It has two modes: `command` lists
 * the filtered commands; `arg` lists the selectable values for the command the
 * user is currently completing (e.g. the effort levels for `/effort`).
 * Selection is committed with `onMouseDown` + `preventDefault` so the textarea
 * never loses focus.
 */
export const SlashCommandPopup: React.FC<SlashCommandPopupProps> = ({
  mode,
  results,
  argResults,
  argCommand,
  selectedIndex,
  onSelect,
  onSelectArg,
}) => {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (mode === 'arg') {
    return (
      <div className="slash-command-popup">
        {argCommand && (
          <div className="slash-command-arg-header">
            <span className="slash-command-name">/{argCommand.name}</span>
            <span className="slash-command-args">{argCommand.argsHint ?? '[value]'}</span>
          </div>
        )}
        {argResults.length === 0 ? (
          <div className="slash-command-empty">No matching options</div>
        ) : (
          argResults.map((opt, index) => (
            <button
              key={opt.value}
              ref={index === selectedIndex ? selectedRef : undefined}
              className={`slash-command-item${index === selectedIndex ? ' selected' : ''}`}
              data-tooltip={opt.value}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the textarea
                onSelectArg(opt);
              }}
            >
              <span className="slash-command-item-header">
                <span className="slash-command-name">{opt.label ?? opt.value}</span>
              </span>
              {opt.description && <span className="slash-command-desc">{opt.description}</span>}
            </button>
          ))
        )}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="slash-command-popup">
        <div className="slash-command-empty">No matching commands</div>
      </div>
    );
  }

  return (
    <div className="slash-command-popup">
      {results.map((cmd, index) => (
        <button
          key={cmd.name}
          ref={index === selectedIndex ? selectedRef : undefined}
          className={`slash-command-item${index === selectedIndex ? ' selected' : ''}${cmd.unavailable ? ' unavailable' : ''}`}
          data-tooltip={cmd.unavailable ? `/${cmd.name} - not available in this environment` : `/${cmd.name}`}
          disabled={cmd.unavailable}
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus on the textarea
            if (cmd.unavailable) return;
            onSelect(cmd);
          }}
        >
          <span className="slash-command-item-header">
            <span className="slash-command-name">/{cmd.name}</span>
            {cmd.argsHint && <span className="slash-command-args">{cmd.argsHint}</span>}
            {cmd.native && <span className="slash-command-badge">ClaUi</span>}
            {cmd.unavailable && <span className="slash-command-badge unavailable">לא זמין</span>}
          </span>
          <span className="slash-command-desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
};
