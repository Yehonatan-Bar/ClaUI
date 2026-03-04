import { useState, useEffect, useRef } from 'react';

const MEDIUM_COLLAPSE_THRESHOLD = 1350;
const MEDIUM_EXPAND_THRESHOLD = 1390;
const COLLAPSE_THRESHOLD = 860;
const EXPAND_THRESHOLD = 900;
const MINIMAL_COLLAPSE_THRESHOLD = 480;
const MINIMAL_EXPAND_THRESHOLD = 520;

export type StatusBarLayoutMode = 'full' | 'medium' | 'collapsed' | 'minimal';

interface UseStatusBarCollapseReturn {
  barRef: React.RefObject<HTMLDivElement>;
  layoutMode: StatusBarLayoutMode;
}

export function useStatusBarCollapse(): UseStatusBarCollapseReturn {
  const barRef = useRef<HTMLDivElement>(null);
  const [layoutMode, setLayoutMode] = useState<StatusBarLayoutMode>('full');

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setLayoutMode((prev) => {
          // Pure threshold + hysteresis: collapse at lower threshold, expand at higher
          if (width < MINIMAL_COLLAPSE_THRESHOLD) return 'minimal';
          if (prev === 'minimal') {
            return width >= MINIMAL_EXPAND_THRESHOLD ? 'collapsed' : 'minimal';
          }

          if (width < COLLAPSE_THRESHOLD) return 'collapsed';
          if (prev === 'collapsed') {
            return width >= EXPAND_THRESHOLD ? 'medium' : 'collapsed';
          }

          if (width < MEDIUM_COLLAPSE_THRESHOLD) return 'medium';
          if (prev === 'medium') {
            return width >= MEDIUM_EXPAND_THRESHOLD ? 'full' : 'medium';
          }

          return 'full';
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { barRef, layoutMode };
}
