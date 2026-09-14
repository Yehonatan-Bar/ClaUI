/**
 * Local, offline punctuation for dictated text.
 *
 * Web Speech returns raw words with no punctuation. Each finalized utterance is
 * treated as one sentence: spoken punctuation words are replaced by symbols,
 * questions get "?", everything else gets ".". Interim (still-speaking) text only
 * gets the spoken-punctuation replacement so it never ends with a stray period.
 *
 * Hebrew is the first-class language here. Note that JavaScript's `\b` does not
 * work next to Hebrew letters (they are not `\w`), so word edges are always
 * spelled out as `(^|\s)` / `(?=\s|$)`.
 */

const NIQQUD = /[ְ-ׇֽֿׁׂׅׄ]/g;

interface LanguageRules {
  /** Spoken word/phrase -> symbol. Longer phrases must come first. */
  spoken: Array<[RegExp, string]>;
  /** A sentence starting with one of these is a question. */
  questionStart: RegExp | null;
  /** A sentence ending with one of these is a question (tag questions). */
  questionEnd: RegExp | null;
  /** A sentence containing one of these anywhere is a question. */
  questionAnywhere: RegExp | null;
}

const HEBREW: LanguageRules = {
  spoken: [
    [/(^|\s)סימן שאלה(?=\s|$)/g, '? '],
    [/(^|\s)סימן קריאה(?=\s|$)/g, '! '],
    [/(^|\s)נקודה פסיק(?=\s|$)/g, '; '],
    [/(^|\s)נקודתיים(?=\s|$)/g, ': '],
    [/(^|\s)שורה חדשה(?=\s|$)/g, '\n'],
    [/(^|\s)פסיק(?=\s|$)/g, ', '],
    [/(^|\s)נקודה(?=\s|$)/g, '. '],
  ],
  questionStart: /^(האם|מה|מי|למה|מדוע|איך|כיצד|מתי|איפה|היכן|לאן|כמה|למי|על מה|בשביל מה|אפשר|תוכל|תוכלי|תגיד|תגידי|תרצה)(?=\s|$)/,
  questionEnd: /(^|\s)(הבנת|הבנתם|הבנתן|נכון|בסדר|אוקיי|טוב|לא כך|מה אתה אומר|מה את אומרת|אפשר|כן|לא)$/,
  questionAnywhere: /(^|\s)(למה|האם|מדוע|איך)(?=\s|$)/,
};

const ENGLISH: LanguageRules = {
  spoken: [
    [/(^|\s)question mark(?=\s|$)/gi, '? '],
    [/(^|\s)exclamation (mark|point)(?=\s|$)/gi, '! '],
    [/(^|\s)semicolon(?=\s|$)/gi, '; '],
    [/(^|\s)colon(?=\s|$)/gi, ': '],
    [/(^|\s)new line(?=\s|$)/gi, '\n'],
    [/(^|\s)new paragraph(?=\s|$)/gi, '\n\n'],
    [/(^|\s)comma(?=\s|$)/gi, ', '],
    [/(^|\s)(period|full stop)(?=\s|$)/gi, '. '],
  ],
  questionStart: /^(what|why|how|when|where|who|which|whose|is|are|am|do|does|did|can|could|would|should|will|shall|have|has|may|might)(?=\s|$)/i,
  questionEnd: /(^|\s)(right|okay|ok|correct|isn't it|don't you|aren't they)$/i,
  questionAnywhere: null,
};

const GENERIC: LanguageRules = { spoken: [], questionStart: null, questionEnd: null, questionAnywhere: null };

function rulesFor(language: string): LanguageRules {
  const l = (language || '').toLowerCase();
  if (l.startsWith('he')) return HEBREW;
  if (l.startsWith('en')) return ENGLISH;
  return GENERIC;
}

function tidy(s: string): string {
  return s
    .replace(/[ \t]+([,.!?;:])/g, '$1')   // no space before punctuation
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Remove Hebrew vowel points; recognizers occasionally emit them and they break matching. */
export function stripNiqqud(s: string): string {
  return (s || '').replace(NIQQUD, '');
}

/** Replace spoken punctuation words ("נקודה", "comma") with symbols. Safe for interim text. */
export function applySpokenPunctuation(text: string, language: string): string {
  let s = stripNiqqud(text || '');
  for (const [re, sym] of rulesFor(language).spoken) {
    s = s.replace(re, (_m, lead: string) => (sym === '\n' || sym === '\n\n' ? sym : (lead ? ' ' : '') + sym.trimStart()));
  }
  return tidy(s);
}

/** Interim text: spoken punctuation only, no terminal mark. */
export function cleanInterim(text: string, language: string): string {
  return applySpokenPunctuation(text, language);
}

export function isQuestion(sentence: string, language: string): boolean {
  const r = rulesFor(language);
  const t = sentence.replace(/[.?!]+$/g, '').trim();
  if (!t) return false;
  if (r.questionStart && r.questionStart.test(t)) return true;
  if (r.questionEnd && r.questionEnd.test(t)) return true;
  if (r.questionAnywhere && r.questionAnywhere.test(t)) return true;
  return false;
}

/**
 * Finalize one utterance: spoken punctuation, then a terminal mark.
 * Single words get no terminal mark (they are usually a correction or a name).
 */
export function punctuateFinal(text: string, language: string, autoPunctuation = true): string {
  const s = applySpokenPunctuation(text, language);
  if (!s || !autoPunctuation) return s;
  if (/[.?!;:]$/.test(s)) return s; // the speaker already dictated the mark
  const core = s.replace(/[.?!]+$/g, '').trim();
  if (!core) return s;
  if (isQuestion(core, language)) return core + '?';
  if (core.split(/\s+/).length >= 2) return core + '.';
  return core;
}
