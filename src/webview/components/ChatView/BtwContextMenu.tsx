import React, { useCallback, useEffect, useRef } from 'react';

interface BtwContextMenuProps {
  x: number;
  y: number;
  onBtwClick: () => void;
  onClose: () => void;
}

/**
 * Floating context menu with a single "btw" item.
 * Appears at the right-click coordinates and closes on outside click or Escape.
 */
export const BtwContextMenu: React.FC<BtwContextMenuProps> = ({ x, y, onBtwClick, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Viewport edge detection: flip menu if near edge
  const adjustedPosition = React.useMemo(() => {
    const menuWidth = 140;
    const menuHeight = 36;
    const margin = 8;
    let left = x;
    let top = y;

    if (x + menuWidth + margin > window.innerWidth) {
      left = x - menuWidth;
    }
    if (y + menuHeight + margin > window.innerHeight) {
      top = y - menuHeight;
    }
    // Clamp to viewport
    left = Math.max(margin, left);
    top = Math.max(margin, top);

    return { left, top };
  }, [x, y]);

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

  return (
    <div className="btw-context-menu-backdrop" onMouseDown={handleBackdropClick}>
      <div
        className="btw-context-menu"
        ref={menuRef}
        style={{ left: adjustedPosition.left, top: adjustedPosition.top }}
      >
        <button className="btw-context-menu-item" onClick={onBtwClick}>
          btw...
        </button>
      </div>
    </div>
  );
};
