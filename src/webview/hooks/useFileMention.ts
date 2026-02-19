import { useState, useRef, useCallback, useEffect } from 'react';
import { postToExtension } from './useClaudeStream';

export interface FileSearchResult {
  relativePath: string;
  fileName: string;
}

interface InsertResult {
  text: string;
  cursor: number;
}

export function useFileMention(textareaRef: React.RefObject<HTMLTextAreaElement>) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const triggerIndexRef = useRef(-1);
  const currentTextRef = useRef('');
  const currentQueryRef = useRef('');
  const requestCounterRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for search results from extension
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'fileSearchResults') return;
      // Discard stale responses
      if (detail.requestId !== requestCounterRef.current) return;
      setResults(detail.results || []);
      setSelectedIndex(0);
      setIsLoading(false);
    };
    window.addEventListener('file-search-results', handler);
    return () => window.removeEventListener('file-search-results', handler);
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setResults([]);
    setSelectedIndex(0);
    setIsLoading(false);
    triggerIndexRef.current = -1;
    currentQueryRef.current = '';
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const handleTextChange = useCallback((text: string, cursorPos: number) => {
    currentTextRef.current = text;

    // Scan backward from cursor to find @ trigger
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '@') {
        // @ must be at start or preceded by whitespace
        if (i === 0 || /\s/.test(text[i - 1])) {
          atIndex = i;
        }
        break;
      }
      // Stop scanning if we hit a newline before finding @
      if (ch === '\n' || ch === '\r') {
        break;
      }
    }

    if (atIndex === -1) {
      if (isOpen) dismiss();
      return;
    }

    const query = text.substring(atIndex + 1, cursorPos);

    // If query contains whitespace, dismiss
    if (/\s/.test(query)) {
      if (isOpen) dismiss();
      return;
    }

    triggerIndexRef.current = atIndex;
    currentQueryRef.current = query;

    if (!isOpen) {
      setIsOpen(true);
      setResults([]);
      setSelectedIndex(0);
    }

    // Debounce search request
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      requestCounterRef.current++;
      postToExtension({
        type: 'fileSearch',
        query,
        requestId: requestCounterRef.current,
      } as any);
    }, 150);
  }, [isOpen, dismiss]);

  const moveSelection = useCallback((direction: 1 | -1) => {
    setSelectedIndex(prev => {
      const len = results.length;
      if (len === 0) return 0;
      const next = prev + direction;
      if (next < 0) return len - 1;
      if (next >= len) return 0;
      return next;
    });
  }, [results.length]);

  const selectPath = useCallback((filePath: string): InsertResult | null => {
    const text = currentTextRef.current;
    const atIdx = triggerIndexRef.current;
    if (atIdx === -1) return null;

    const queryLen = currentQueryRef.current.length;
    const before = text.substring(0, atIdx);
    const after = text.substring(atIdx + 1 + queryLen);
    const newText = before + filePath + ' ' + after;
    const newCursor = before.length + filePath.length + 1;

    dismiss();
    return { text: newText, cursor: newCursor };
  }, [dismiss]);

  const confirmSelection = useCallback((): InsertResult | null => {
    if (results.length === 0) return null;
    const selected = results[selectedIndex];
    if (!selected) return null;
    return selectPath(selected.relativePath);
  }, [results, selectedIndex, selectPath]);

  return {
    isOpen,
    results,
    selectedIndex,
    isLoading,
    handleTextChange,
    moveSelection,
    confirmSelection,
    selectPath,
    dismiss,
  };
}
