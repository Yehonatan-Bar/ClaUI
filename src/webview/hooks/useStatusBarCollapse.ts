import { useState, useEffect, useRef } from 'react';

// Left-side layout thresholds (dropdown grouping)
// full: AI Chip + Session + Tools + View + clock + usage + tokens (~650px)
// collapsed (compact): AI Chip + Session + More + clock + usage (~450px)
// minimal: AI Chip (short) + Menu + usage (~250px)
const COLLAPSE_THRESHOLD = 600;
const EXPAND_THRESHOLD = 650;
const MINIMAL_COLLAPSE_THRESHOLD = 380;
const MINIMAL_EXPAND_THRESHOLD = 420;

// Right-side progressive collapse thresholds (bar elements -> dropdowns)
// Stage 1: session timer moves into View dropdown
// Stage 2: MCP chip moves into Tools dropdown
// Stage 3: usage metric moves into View dropdown
const RIGHT_CLOCK_COLLAPSE = 580;
const RIGHT_CLOCK_EXPAND = 600;
const RIGHT_MCP_COLLAPSE = 500;
const RIGHT_MCP_EXPAND = 520;
const RIGHT_USAGE_COLLAPSE = 430;
const RIGHT_USAGE_EXPAND = 450;

export type StatusBarLayoutMode = 'full' | 'medium' | 'collapsed' | 'minimal';

interface UseStatusBarCollapseReturn {
  barRef: React.RefObject<HTMLDivElement>;
  layoutMode: StatusBarLayoutMode;
  /** When true, session timer should be hidden from bar and shown in View dropdown */
  hideClockFromBar: boolean;
  /** When true, MCP chip should be hidden from bar and shown in Tools dropdown */
  hideMcpFromBar: boolean;
  /** When true, usage metric should be hidden from bar and shown in View dropdown */
  hideUsageFromBar: boolean;
}

export function useStatusBarCollapse(): UseStatusBarCollapseReturn {
  const barRef = useRef<HTMLDivElement>(null);
  const [layoutMode, setLayoutMode] = useState<StatusBarLayoutMode>('full');
  // Right-side collapse level: 0=all visible, 1=clock hidden, 2=+MCP hidden, 3=+usage hidden
  const [rightCollapseLevel, setRightCollapseLevel] = useState(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;

        // Left-side layout mode (dropdown grouping)
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

        // Right-side progressive collapse (with hysteresis)
        setRightCollapseLevel((prev) => {
          if (width < RIGHT_USAGE_COLLAPSE) return 3;
          if (prev >= 3 && width < RIGHT_USAGE_EXPAND) return 3;

          if (width < RIGHT_MCP_COLLAPSE) return 2;
          if (prev >= 2 && width < RIGHT_MCP_EXPAND) return 2;

          if (width < RIGHT_CLOCK_COLLAPSE) return 1;
          if (prev >= 1 && width < RIGHT_CLOCK_EXPAND) return 1;

          return 0;
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return {
    barRef,
    layoutMode,
    hideClockFromBar: rightCollapseLevel >= 1,
    hideMcpFromBar: rightCollapseLevel >= 2,
    hideUsageFromBar: rightCollapseLevel >= 3,
  };
}
