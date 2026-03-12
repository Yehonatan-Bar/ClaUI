import { useEffect, useRef } from 'react';

/**
 * Centralized outside-click manager.
 *
 * Instead of each dropdown/popover attaching its own `mousedown` listener to
 * the document, a single shared `click` listener checks every registered
 * entry on each click.
 *
 * Using `click` (not `mousedown`) is intentional: it fires in the same event
 * phase as button `onClick` handlers, so React batches all resulting state
 * updates together. With `mousedown`, the close fires before the target
 * button's `click`, causing a re-render that can swallow the click — the
 * classic "first click does nothing" bug.
 */

type DropdownEntry = {
  ref: React.RefObject<HTMLElement | null>;
  close: () => void;
};

// Module-level registry shared across all components
const registry = new Map<string, DropdownEntry>();
let listenerActive = false;

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as Node;
  // Collect entries to close first (avoid mutating map during iteration)
  const toClose: (() => void)[] = [];
  registry.forEach((entry) => {
    if (entry.ref.current && !entry.ref.current.contains(target)) {
      toClose.push(entry.close);
    }
  });
  toClose.forEach((close) => close());
}

function ensureListener() {
  if (!listenerActive) {
    document.addEventListener('click', handleDocumentClick);
    listenerActive = true;
  }
}

function removeListenerIfEmpty() {
  if (listenerActive && registry.size === 0) {
    document.removeEventListener('click', handleDocumentClick);
    listenerActive = false;
  }
}

/**
 * Register a dropdown/popover for centralized outside-click handling.
 *
 * @param id      Unique key for this dropdown (e.g. 'statusbar-vitals')
 * @param ref     Ref to the container element — clicks inside it are ignored
 * @param isOpen  Whether the dropdown is currently open
 * @param onClose Callback to close the dropdown
 */
export function useOutsideClick(
  id: string,
  ref: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
): void {
  // Keep onClose in a ref so the registry always calls the latest version
  // without needing to re-register on every render
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) {
      registry.delete(id);
      removeListenerIfEmpty();
      return;
    }

    registry.set(id, {
      ref,
      close: () => closeRef.current(),
    });
    ensureListener();

    return () => {
      registry.delete(id);
      removeListenerIfEmpty();
    };
  }, [id, ref, isOpen]);
}
