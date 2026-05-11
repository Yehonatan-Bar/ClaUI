/**
 * Color palette and utilities for multi-participant sessions.
 * Deterministic author colors from participantId hash.
 */

/** Participant author color palette -- visually distinct, accessible on dark backgrounds */
const PARTICIPANT_PALETTE = [
  '#4A9FD9', // blue
  '#E06C75', // red
  '#98C379', // green
  '#D19A66', // orange
  '#C678DD', // purple
  '#56B6C2', // cyan
  '#E5C07B', // amber
  '#BE5046', // rust
  '#61AFEF', // sky
  '#7EE787', // mint
  '#F0883E', // tangerine
  '#BC8CFF', // lavender
];

/** Simple FNV-1a 32-bit hash for short strings */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/** Deterministic color for a given participantId */
export function getParticipantColor(participantId: string): string {
  const index = fnv1a(participantId) % PARTICIPANT_PALETTE.length;
  return PARTICIPANT_PALETTE[index];
}

/** Delivery status badge colors keyed by status string */
export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  pending: '#58a6ff',      // blue
  acknowledged: '#e3b341', // yellow
  running: '#e3b341',      // yellow
  streaming: '#56b6c2',    // cyan
  completed: '#3fb950',    // green
  failed: '#f85149',       // red
  interrupted: '#f0883e',  // orange
};

/** Kind badge background colors */
export const KIND_BADGE_COLORS: Record<string, string> = {
  human: '#3fb950',
  agent: '#58a6ff',
  orchestrator: '#bc8cff',
};
