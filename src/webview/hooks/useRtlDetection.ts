/** Unicode ranges for Hebrew characters */
const HEBREW_RANGE = /[\u0590-\u05FF]/;
/** Unicode ranges for Arabic characters */
const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F]/;

/** Detects whether a string contains RTL (Hebrew/Arabic) characters */
export function detectRtl(text: string): boolean {
  return HEBREW_RANGE.test(text) || ARABIC_RANGE.test(text);
}
