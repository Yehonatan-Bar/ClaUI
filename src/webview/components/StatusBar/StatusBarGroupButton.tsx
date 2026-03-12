import React, { useRef, useEffect, useCallback } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';

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

  // Centralized outside-click handler (uses 'click', not 'mousedown')
  useOutsideClick(`sbg-${label}`, wrapperRef, isOpen, handleClose);

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
        data-tooltip={label}
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
