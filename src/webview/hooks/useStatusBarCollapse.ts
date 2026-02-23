import { useState, useEffect, useRef } from 'react';

const COLLAPSE_THRESHOLD = 900;
const EXPAND_THRESHOLD = 920;

interface UseStatusBarCollapseReturn {
  barRef: React.RefObject<HTMLDivElement>;
  isCollapsed: boolean;
}

export function useStatusBarCollapse(): UseStatusBarCollapseReturn {
  const barRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setIsCollapsed((prev) => {
          if (prev && width >= EXPAND_THRESHOLD) return false;
          if (!prev && width < COLLAPSE_THRESHOLD) return true;
          return prev;
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { barRef, isCollapsed };
}
