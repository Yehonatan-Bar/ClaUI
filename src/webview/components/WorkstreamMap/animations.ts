export const TRANSITION_DURATION = 300;
export const HOVER_SCALE = 1.15;

export function fadeInStyle(delay: number = 0): React.CSSProperties {
  return {
    opacity: 0,
    animation: `workstream-fade-in ${TRANSITION_DURATION}ms ease-out ${delay}ms forwards`,
  };
}

export function pulseKeyframes(): string {
  return `
    @keyframes workstream-pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @keyframes workstream-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes workstream-glow-pulse {
      0%, 100% { filter: drop-shadow(0 0 3px var(--glow-color)); }
      50% { filter: drop-shadow(0 0 8px var(--glow-color)); }
    }
  `;
}
