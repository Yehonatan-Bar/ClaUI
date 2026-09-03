import { useState, useRef, useCallback } from 'react';
import { SlashCommand, filterSlashCommands } from '../data/slashCommands';

interface InsertResult {
  text: string;
  cursor: number;
}

/**
 * Slash-command autocomplete for the chat input, modeled on `useFileMention`.
 *
 * The command catalog is static and bundled, so filtering is synchronous (no
 * debounce, no round-trip to the extension host).
 *
 * Trigger rule mirrors the `@` file mention: scan backward from the caret for a
 * `/` that sits at the start of the input or directly after whitespace. That
 * keeps `src/webview` style paths from opening the menu, while still working
 * when the input already holds text, a leading space, or an earlier line.
 */
export function useSlashCommand(textareaRef: React.RefObject<HTMLTextAreaElement>) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const currentTextRef = useRef('');
  const triggerIndexRef = useRef(-1);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setResults([]);
    setSelectedIndex(0);
    triggerIndexRef.current = -1;
  }, []);

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      currentTextRef.current = text;

      // Scan backward from the caret for the '/' that opens the command token.
      let slashIndex = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '/') {
          // Only trigger at input start or right after whitespace (skips paths).
          if (i === 0 || /\s/.test(text[i - 1])) slashIndex = i;
          break;
        }
        // Whitespace before any '/' means the caret is not inside a command token.
        if (/\s/.test(ch)) break;
      }

      if (slashIndex === -1) {
        if (isOpen) dismiss();
        return;
      }

      const query = text.slice(slashIndex + 1, cursorPos);
      // A space in the query means the user moved on to the command's arguments.
      if (/\s/.test(query)) {
        if (isOpen) dismiss();
        return;
      }

      triggerIndexRef.current = slashIndex;
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
      const start = triggerIndexRef.current;
      if (start < 0) return null;
      const text = currentTextRef.current;

      // Replace from the slash through the end of the current (whitespace-free) token.
      let end = start + 1;
      while (end < text.length && !/\s/.test(text[end])) end++;

      const before = text.slice(0, start);
      const after = text.slice(end);
      const insert = `/${cmd.name}`;
      // Guarantee exactly one space between the command and whatever follows.
      const needsSpace = after.length === 0 || !/^\s/.test(after);
      const newText = before + insert + (needsSpace ? ' ' : '') + after;
      const newCursor = before.length + insert.length + (needsSpace ? 1 : 0);

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
