/** Full progress at this many tool calls */
export const FULL_AT = 50;

/** Returns 0..1 progress based on tool count */
export function getProgress(toolCount: number): number {
  return Math.min(1, Math.max(0, toolCount / FULL_AT));
}

export interface AnimationProps {
  toolCount: number;
  isComplete: boolean;
}

/** Viewbox for all animations — tall portrait orientation */
export const VB_W = 300;
export const VB_H = 500;

/** Color palette for elements (stable per index) */
export const PALETTE = [
  '#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4',
  '#e040fb', '#f44336', '#ffb74d', '#689f38', '#ffd700',
  '#26a69a', '#5c6bc0', '#ef5350', '#ab47bc', '#42a5f5',
  '#66bb6a', '#ffa726', '#7e57c2', '#29b6f6', '#ec407a',
];
