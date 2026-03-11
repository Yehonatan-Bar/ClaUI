import React, { useCallback, useEffect, useRef } from 'react';

interface BtwContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onBtwClick: () => void;
  onClose: () => void;
}

/**
 * Floating context menu with clipboard actions and a "btw..." side-thought item.
 * Appears at the right-click coordinates and closes on outside click or Escape.
 */
export const BtwContextMenu: React.FC<BtwContextMenuProps> = ({ x, y, hasSelection, onBtwClick, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Estimate menu height based on number of items
  const itemCount = hasSelection ? 3 : 2; // Copy (if selection) + Paste + separator + btw
  const estimatedHeight = itemCount * 32 + 12; // items + separator + padding

  // Viewport edge detection: flip menu if near edge
  const adjustedPosition = React.useMemo(() => {
    const menuWidth = 160;
    const margin = 8;
    let left = x;
    let top = y;

    if (x + menuWidth + margin > window.innerWidth) {
      left = x - menuWidth;
    }
    if (y + estimatedHeight + margin > window.innerHeight) {
      top = y - estimatedHeight;
    }
    left = Math.max(margin, left);
    top = Math.max(margin, top);

    return { left, top };
  }, [x, y, estimatedHeight]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleCopy = useCallback(() => {
    document.execCommand('copy');
    onClose();
  }, [onClose]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      // Find the active element and insert text if it's editable
      const active = document.activeElement as HTMLElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
        document.execCommand('insertText', false, text);
      }
    } catch {
      // Clipboard API may not be available in webview context
      document.execCommand('paste');
    }
    onClose();
  }, [onClose]);

  return (
    <div className="btw-context-menu-backdrop" onMouseDown={handleBackdropClick}>
      <div
        className="btw-context-menu"
        ref={menuRef}
        style={{ left: adjustedPosition.left, top: adjustedPosition.top }}
      >
        {hasSelection && (
          <button className="btw-context-menu-item" onClick={handleCopy}>
            Copy
          </button>
        )}
        <button className="btw-context-menu-item" onClick={handlePaste}>
          Paste
        </button>
        <div className="btw-context-menu-separator" />
        <button className="btw-context-menu-item" onClick={onBtwClick}>
          btw...
        </button>
      </div>
    </div>
  );
};
