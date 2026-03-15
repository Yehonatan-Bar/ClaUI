import { useState, useEffect, useRef } from 'react';

// New thresholds for grouped layout (far fewer top-level items)
// full: AI Chip + Session + Tools + View + clock + usage + tokens (~650px)
// collapsed (compact): AI Chip + Session + More + clock + usage (~450px)
// minimal: AI Chip (short) + Menu + usage (~250px)
const COLLAPSE_THRESHOLD = 600;
const EXPAND_THRESHOLD = 650;
const MINIMAL_COLLAPSE_THRESHOLD = 380;
const MINIMAL_EXPAND_THRESHOLD = 420;

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
          // 3-tier: full -> collapsed (compact) -> minimal
          // 'medium' is treated same as 'full' by the new StatusBar
          if (width < MINIMAL_COLLAPSE_THRESHOLD) return 'minimal';
          if (prev === 'minimal') {
            return width >= MINIMAL_EXPAND_THRESHOLD ? 'collapsed' : 'minimal';
          }

          if (width < COLLAPSE_THRESHOLD) return 'collapsed';
          if (prev === 'collapsed') {
            return width >= EXPAND_THRESHOLD ? 'full' : 'collapsed';
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
