/**
 * Caret-anchored dictation insertion, as a pure function so it can be unit-tested.
 *
 * The composer text is the source of truth. Dictation owns exactly one range,
 * the "interim range" [anchorStart, anchorEnd): interim results replace it, a
 * final result replaces it and closes it. Any manual edit collapses the range
 * to the caret (see `collapse`). Nothing is ever re-rendered from a stored
 * transcript, so text the user deleted can never come back.
 */

export interface DictationAnchor {
  start: number;
  end: number;
  /** True while an interim (not yet final) result is displayed in the range. */
  interimActive: boolean;
}

export interface DictationInsertResult {
  text: string;
  caret: number;
  anchor: DictationAnchor;
}

export function collapse(caret: number): DictationAnchor {
  const c = Math.max(0, caret | 0);
  return { start: c, end: c, interimActive: false };
}

/**
 * Apply a dictation result to `value`.
 * @param value    current composer text
 * @param caret    current caret position (used when no interim range is open)
 * @param anchor   dictation range state
 * @param spoken   recognized text (interim or final)
 * @param isFinal  final results close the range; interims keep it open
 */
export function applyDictation(
  value: string,
  caret: number,
  anchor: DictationAnchor,
  spoken: string,
  isFinal: boolean
): DictationInsertResult {
  let a = anchor.interimActive ? { ...anchor } : collapse(Math.min(caret, value.length));
  if (a.end > value.length) a.end = value.length;
  if (a.start > a.end) a.start = a.end;

  const before = value.slice(0, a.start);
  const after = value.slice(a.end);
  let ins = spoken || '';
  if (ins && before && !/\s$/.test(before)) ins = ' ' + ins;
  if (ins && after && !/^\s/.test(after)) ins = ins + ' ';

  const end = a.start + ins.length;
  const text = before + ins + after;
  if (isFinal || !ins) {
    a = { start: end, end, interimActive: false };
  } else {
    a = { start: a.start, end, interimActive: true };
  }
  return { text, caret: end, anchor: a };
}
