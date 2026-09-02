import React, { useRef, useEffect } from 'react';
import { SlashCommand } from '../../data/slashCommands';

interface SlashCommandPopupProps {
  results: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

/**
 * Inline autocomplete popup for slash commands. Floats above the input (same
 * positioning pattern as `FileMentionPopup`) and lists the filtered commands.
 * Selection is committed with `onMouseDown` + `preventDefault` so the textarea
 * never loses focus.
 */
export const SlashCommandPopup: React.FC<SlashCommandPopupProps> = ({
  results,
  selectedIndex,
  onSelect,
}) => {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

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
          className={`slash-command-item${index === selectedIndex ? ' selected' : ''}`}
          data-tooltip={`/${cmd.name}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus on the textarea
            onSelect(cmd);
          }}
        >
          <span className="slash-command-item-header">
            <span className="slash-command-name">/{cmd.name}</span>
            {cmd.argsHint && <span className="slash-command-args">{cmd.argsHint}</span>}
            {cmd.native && <span className="slash-command-badge">ClaUi</span>}
          </span>
          <span className="slash-command-desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
};
