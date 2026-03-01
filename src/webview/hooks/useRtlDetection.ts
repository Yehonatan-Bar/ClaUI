/** Unicode ranges for Hebrew characters */
const HEBREW_RANGE = /[\u0590-\u05FF]/;
/** Unicode ranges for Arabic characters */
const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F]/;
/** Non-Latin script characters (CJK, Cyrillic, Devanagari, Thai, etc.) */
const NON_LATIN_RANGE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0400-\u04FF\u0900-\u097F\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/g;

/** Detects whether a string contains RTL (Hebrew/Arabic) characters */
export function detectRtl(text: string): boolean {
  return HEBREW_RANGE.test(text) || ARABIC_RANGE.test(text);
}

/**
 * Heuristic: returns true if the text is predominantly Latin/ASCII
 * (i.e. already in English or a Latin-script language).
 * Checks whether non-Latin script characters make up less than 5% of the letters.
 */
export function isLikelyEnglish(text: string): boolean {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length === 0) return true;
  const nonLatinMatches = letters.match(NON_LATIN_RANGE);
  const nonLatinCount = nonLatinMatches ? nonLatinMatches.length : 0;
  return nonLatinCount / letters.length < 0.05;
}
