import React from 'react';

export type StatusBadgeTone = 'ok' | 'warn' | 'error' | 'muted';

export interface StatusBadgeProps {
  label: string;
  value?: string;
  tone?: StatusBadgeTone;
  title?: string;
  onClick?: () => void;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  value,
  tone = 'muted',
  title,
  onClick,
}) => {
  const className = `status-badge status-badge--${tone} ${onClick ? 'status-badge--button' : ''}`;
  const content = (
    <>
      <span className="status-badge-dot" />
      <span className="status-badge-label">{label}</span>
      {value && <span className="status-badge-value">{value}</span>}
    </>
  );

  if (onClick) {
    return (
      <button className={className} title={title} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content}
    </span>
  );
};
