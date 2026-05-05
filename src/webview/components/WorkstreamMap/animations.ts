import type { Variants, Transition } from 'framer-motion';

export const TRANSITION_DURATION = 300;
export const HOVER_SCALE = 1.15;

export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 200, damping: 25 };
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 400, damping: 30 };
export const SPRING_BOUNCY: Transition = { type: 'spring', stiffness: 300, damping: 15 };

export const pathDrawVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 1.8, delay: i * 0.2, ease: [0.33, 1, 0.68, 1] },
      opacity: { duration: 0.4, delay: i * 0.2 },
    },
  }),
};

export const stationPopVariants: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: (i: number) => ({
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 350,
      damping: 20,
      delay: 0.6 + i * 0.06,
    },
  }),
};

export const labelFadeVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, delay: 0.3 + i * 0.15, ease: 'easeOut' },
  }),
};

export const fadeSlideUpVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.3, ease: 'easeIn' },
  },
};

export const PARTICLE_COUNT = 3;
export const PARTICLE_BASE_DURATION = 3.5;

export const glassStyle = (opacity = 0.6) => ({
  background: `rgba(15, 23, 42, ${opacity})`,
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
});

export function fadeInStyle(delay: number = 0): Record<string, string | number> {
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
      0%, 100% { filter: drop-shadow(0 0 3px var(--glow-color, #4A9EFF)); }
      50% { filter: drop-shadow(0 0 10px var(--glow-color, #4A9EFF)); }
    }
    @keyframes ripple-ring {
      0% { r: 10; opacity: 0.6; stroke-width: 2; }
      100% { r: 30; opacity: 0; stroke-width: 0.5; }
    }
    @keyframes station-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
}
