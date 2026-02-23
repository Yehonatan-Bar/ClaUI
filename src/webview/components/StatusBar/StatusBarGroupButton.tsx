import React, { useRef, useEffect, useCallback } from 'react';

interface StatusBarGroupButtonProps {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  alignRight?: boolean;
  children: React.ReactNode;
}

export const StatusBarGroupButton: React.FC<StatusBarGroupButtonProps> = ({
  label,
  isOpen,
  onToggle,
  alignRight,
  children,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    if (isOpen) onToggle();
  }, [isOpen, onToggle]);

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, handleClose]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  return (
    <div className="status-bar-group-wrapper" ref={wrapperRef}>
      <button
        className={`status-bar-group-btn ${isOpen ? 'active' : ''}`}
        onClick={onToggle}
      >
        {label} {isOpen ? '\u25BC' : '\u25B2'}
      </button>
      {isOpen && (
        <div
          className="status-bar-group-dropdown"
          style={alignRight ? { right: 0, left: 'auto' } : undefined}
        >
          <div className="status-bar-group-dropdown-items">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};
