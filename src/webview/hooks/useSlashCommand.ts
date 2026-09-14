import { useState, useRef, useCallback } from 'react';
import {
  SlashCommand,
  SlashArgOption,
  filterSlashCommands,
  filterArgOptions,
  findSlashCommand,
} from '../data/slashCommands';

interface InsertResult {
  text: string;
  cursor: number;
}

/** Result of picking an argument value: the completed input plus the command
 *  name and chosen value, so the caller can run "/name value" directly. */
export interface ArgInsertResult extends InsertResult {
  name: string;
  value: string;
}

type Mode = 'command' | 'arg';

/**
 * Two-stage slash autocomplete for the chat input, modeled on `useFileMention`.
 *
 * Stage 1 (command): typing `/` opens a list of commands, filtered as you type.
 * Stage 2 (argument): once a command that has selectable values is followed by a
 * space (e.g. `/effort `), the same popup switches to listing those values and
 * filters them as you type - so the user is never stranded with a bare command
 * and no idea what to type next. `getArgOptions` supplies the values (static
 * catalog options, or dynamic ones like the model list).
 *
 * The command catalog is static and bundled, so filtering is synchronous.
 *
 * Trigger rule mirrors the `@` file mention: scan backward from the caret for a
 * `/` that sits at the start of the input or directly after whitespace (which
 * keeps `src/webview` style paths from opening the menu). Unlike `@`, the scan
 * crosses spaces so the argument stage can see `/command <partial-value>`.
 */
export function useSlashCommand(
  textareaRef: React.RefObject<HTMLTextAreaElement>,
  getArgOptions?: (cmd: SlashCommand) => SlashArgOption[] | null,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('command');
  const [results, setResults] = useState<SlashCommand[]>([]);
  const [argResults, setArgResults] = useState<SlashArgOption[]>([]);
  const [argCommand, setArgCommand] = useState<SlashCommand | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const currentTextRef = useRef('');
  const triggerIndexRef = useRef(-1); // index of the command's leading '/'
  const argStartRef = useRef(-1); // index where the argument value begins
  const argCommandRef = useRef<SlashCommand | null>(null);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setMode('command');
    setResults([]);
    setArgResults([]);
    setArgCommand(null);
    setSelectedIndex(0);
    triggerIndexRef.current = -1;
    argStartRef.current = -1;
    argCommandRef.current = null;
  }, []);

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      currentTextRef.current = text;

      // Scan backward from the caret for the '/' that opens the command. Cross
      // spaces (the argument stage needs `/name <value>`), stop at the first
      // '/', and only accept it when it sits at input start or after whitespace.
      let slashIndex = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '\n') break; // command invocations are single-line
        if (ch === '/') {
          if (i === 0 || /\s/.test(text[i - 1])) slashIndex = i;
          break;
        }
      }

      if (slashIndex === -1) {
        if (isOpen) dismiss();
        return;
      }

      triggerIndexRef.current = slashIndex;
      const beforeCaret = text.slice(slashIndex + 1, cursorPos);
      const spaceIdx = beforeCaret.indexOf(' ');

      if (spaceIdx === -1) {
        // Stage 1: command name.
        setMode('command');
        setResults(filterSlashCommands(beforeCaret));
        setArgResults([]);
        setArgCommand(null);
        argCommandRef.current = null;
        setSelectedIndex(0);
        setIsOpen(true);
        return;
      }

      // Stage 2: argument value - only for a known command that offers options.
      const name = beforeCaret.slice(0, spaceIdx);
      const argQuery = beforeCaret.slice(spaceIdx + 1);
      const cmd = findSlashCommand(name);
      const options = cmd ? (getArgOptions?.(cmd) ?? cmd.argOptions ?? null) : null;
      if (cmd && options && options.length > 0) {
        setMode('arg');
        setArgCommand(cmd);
        argCommandRef.current = cmd;
        argStartRef.current = slashIndex + 1 + spaceIdx + 1;
        setArgResults(filterArgOptions(options, argQuery));
        setResults([]);
        setSelectedIndex(0);
        setIsOpen(true);
        return;
      }

      // A space after a command with no selectable values: leave autocomplete.
      if (isOpen) dismiss();
    },
    [isOpen, dismiss, getArgOptions],
  );

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      setSelectedIndex((prev) => {
        const len = mode === 'arg' ? argResults.length : results.length;
        if (len === 0) return 0;
        const next = prev + direction;
        if (next < 0) return len - 1;
        if (next >= len) return 0;
        return next;
      });
    },
    [mode, results.length, argResults.length],
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
    [dismiss],
  );

  const confirmSelection = useCallback((): InsertResult | null => {
    if (results.length === 0) return null;
    const selected = results[selectedIndex];
    if (!selected) return null;
    return selectCommand(selected);
  }, [results, selectedIndex, selectCommand]);

  const selectArg = useCallback(
    (option: SlashArgOption): ArgInsertResult | null => {
      const cmd = argCommandRef.current;
      const argStart = argStartRef.current;
      if (!cmd || argStart < 0) return null;
      const text = currentTextRef.current;

      // Replace the current (whitespace-free) argument token with the value.
      let end = argStart;
      while (end < text.length && !/\s/.test(text[end])) end++;

      const before = text.slice(0, argStart);
      const after = text.slice(end);
      const needsSpace = after.length === 0 || !/^\s/.test(after);
      const newText = before + option.value + (needsSpace ? ' ' : '') + after;
      const newCursor = before.length + option.value.length + (needsSpace ? 1 : 0);

      dismiss();
      return { text: newText, cursor: newCursor, name: cmd.name, value: option.value };
    },
    [dismiss],
  );

  const confirmArg = useCallback((): ArgInsertResult | null => {
    if (argResults.length === 0) return null;
    const selected = argResults[selectedIndex];
    if (!selected) return null;
    return selectArg(selected);
  }, [argResults, selectedIndex, selectArg]);

  return {
    isOpen,
    mode,
    results,
    argResults,
    argCommand,
    selectedIndex,
    handleTextChange,
    moveSelection,
    confirmSelection,
    selectCommand,
    confirmArg,
    selectArg,
    dismiss,
  };
}
