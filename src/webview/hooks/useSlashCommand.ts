import { useState, useRef, useCallback } from 'react';
import { SlashCommand, filterSlashCommands } from '../data/slashCommands';

interface InsertResult {
  text: string;
  cursor: number;
}

/**
 * Slash-command autocomplete for the chat input, modeled on `useFileMention`.
 *
 * Unlike file mentions, the command catalog is static and bundled, so filtering
 * is synchronous (no debounce, no round-trip to the extension host). The popup
 * only triggers when `/` is the first character of the input (matching how the
 * CLI recognises slash commands), and closes once the caret moves past the
 * command token into its arguments.
 */
export function useSlashCommand(textareaRef: React.RefObject<HTMLTextAreaElement>) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const currentTextRef = useRef('');
  const triggerActiveRef = useRef(false);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setResults([]);
    setSelectedIndex(0);
    triggerActiveRef.current = false;
  }, []);

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      currentTextRef.current = text;

      // Slash commands only trigger when '/' is the very first character.
      if (text[0] !== '/') {
        if (isOpen) dismiss();
        return;
      }

      // The command token runs from the slash up to the first whitespace.
      const firstWs = text.search(/\s/);
      const tokenEnd = firstWs === -1 ? text.length : firstWs;

      // Once the caret is past the command token, the user is typing arguments.
      if (cursorPos > tokenEnd) {
        if (isOpen) dismiss();
        return;
      }

      const query = text.slice(1, tokenEnd);
      triggerActiveRef.current = true;
      setResults(filterSlashCommands(query));
      setSelectedIndex(0);
      setIsOpen(true);
    },
    [isOpen, dismiss]
  );

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      setSelectedIndex((prev) => {
        const len = results.length;
        if (len === 0) return 0;
        const next = prev + direction;
        if (next < 0) return len - 1;
        if (next >= len) return 0;
        return next;
      });
    },
    [results.length]
  );

  const selectCommand = useCallback(
    (cmd: SlashCommand): InsertResult | null => {
      if (!triggerActiveRef.current) return null;
      const text = currentTextRef.current;
      const firstWs = text.search(/\s/);
      const tokenEnd = firstWs === -1 ? text.length : firstWs;

      const after = text.slice(tokenEnd); // preserve any already-typed arguments
      const insert = `/${cmd.name}`;
      // Guarantee exactly one space between the command and whatever follows.
      const needsSpace = after.length === 0 || !/^\s/.test(after);
      const newText = insert + (needsSpace ? ' ' : '') + after;
      const newCursor = insert.length + (needsSpace ? 1 : 0);

      dismiss();
      return { text: newText, cursor: newCursor };
    },
    [dismiss]
  );

  const confirmSelection = useCallback((): InsertResult | null => {
    if (results.length === 0) return null;
    const selected = results[selectedIndex];
    if (!selected) return null;
    return selectCommand(selected);
  }, [results, selectedIndex, selectCommand]);

  return {
    isOpen,
    results,
    selectedIndex,
    handleTextChange,
    moveSelection,
    confirmSelection,
    selectCommand,
    dismiss,
  };
}
