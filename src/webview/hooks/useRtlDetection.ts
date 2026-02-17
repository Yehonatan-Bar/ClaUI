import { useMemo } from 'react';

/** Unicode ranges for Hebrew characters */
const HEBREW_RANGE = /[\u0590-\u05FF]/;
/** Unicode ranges for Arabic characters */
const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F]/;

/**
 * Detects whether a string contains RTL (Hebrew/Arabic) characters
 * and returns the appropriate text direction.
 */
export function useRtlDetection(text: string): {
  direction: 'ltr' | 'rtl' | 'auto';
  isRtl: boolean;
} {
  return useMemo(() => {
    if (!text) {
      return { direction: 'auto' as const, isRtl: false };
    }

    const isRtl = HEBREW_RANGE.test(text) || ARABIC_RANGE.test(text);
    return {
      direction: isRtl ? ('rtl' as const) : ('ltr' as const),
      isRtl,
    };
  }, [text]);
}

/** Non-hook version for use outside components */
export function detectRtl(text: string): boolean {
  return HEBREW_RANGE.test(text) || ARABIC_RANGE.test(text);
}
