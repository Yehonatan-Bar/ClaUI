import React from 'react';
import type { CompactBoundaryMarker } from '../../state/store';

/** Format a raw token count into a short human label, e.g. 128000 -> "128k". */
function formatTokens(count?: number): string | null {
  if (typeof count !== 'number' || !isFinite(count) || count <= 0) return null;
  if (count >= 1000) {
    const thousands = count / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return String(count);
}

/**
 * Inline chat divider marking where the CLI compacted the conversation context.
 * A 'pending' marker shows a live spinner ("Compacting context…") for a manual
 * /compact; once the CLI confirms via a compact_boundary event it becomes a
 * static "Context compacted" line with the pre-compaction token size.
 */
export const CompactDivider: React.FC<{ boundary: CompactBoundaryMarker }> = ({ boundary }) => {
  const pending = boundary.status === 'pending';
  const tokens = formatTokens(boundary.preTokens);
  const triggerLabel =
    boundary.trigger === 'auto' ? 'auto' : boundary.trigger === 'manual' ? 'manual' : null;

  return (
    <div
      className={`compact-divider${pending ? ' compact-divider-pending' : ''}`}
      role="separator"
      aria-label={pending ? 'Compacting context' : 'Context compacted'}
    >
      <span className="compact-divider-line" />
      <span className="compact-divider-label">
        {pending ? (
          <>
            <svg
              className="compact-divider-spin"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>Compacting context…</span>
          </>
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            <span>
              Context compacted
              {tokens ? ` · summarized ~${tokens} tokens` : ''}
              {triggerLabel ? ` · ${triggerLabel}` : ''}
            </span>
          </>
        )}
      </span>
      <span className="compact-divider-line" />
    </div>
  );
};
