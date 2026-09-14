import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDictation, collapse } from '../../src/webview/utils/voiceInsert';

test('interim results replace the same range; a final closes it', () => {
  let r = applyDictation('', 0, collapse(0), 'מה', false);
  assert.equal(r.text, 'מה');
  r = applyDictation(r.text, r.caret, r.anchor, 'מה שלומך', false);
  assert.equal(r.text, 'מה שלומך');
  r = applyDictation(r.text, r.caret, r.anchor, 'מה שלומך?', true);
  assert.equal(r.text, 'מה שלומך?');
  assert.equal(r.anchor.interimActive, false);
  assert.equal(r.anchor.start, r.text.length);
});

test('a second utterance is separated by exactly one space', () => {
  let r = applyDictation('מה שלומך?', 9, collapse(9), 'אני בסדר', false);
  assert.equal(r.text, 'מה שלומך? אני בסדר');
  r = applyDictation(r.text, r.caret, r.anchor, 'אני בסדר.', true);
  assert.equal(r.text, 'מה שלומך? אני בסדר.');
});

test('a user edit collapses the range; dictation continues from the caret and deleted text stays deleted', () => {
  let r = applyDictation('', 0, collapse(0), 'אני רוצה לבדוק את הקוד.', true);
  // user deletes "את הקוד." and leaves the caret at the end
  const edited = 'אני רוצה לבדוק ';
  const anchor = collapse(edited.length);
  r = applyDictation(edited, edited.length, anchor, 'את הסקריפט', false);
  assert.equal(r.text, 'אני רוצה לבדוק את הסקריפט');
  r = applyDictation(r.text, r.caret, r.anchor, 'את הסקריפט.', true);
  assert.equal(r.text, 'אני רוצה לבדוק את הסקריפט.');
  assert.ok(!r.text.includes('הקוד'), 'deleted words must not come back');
});

test('insertion in the middle of existing text keeps spacing on both sides', () => {
  const value = 'לפני אחרי';
  const r = applyDictation(value, 4, collapse(4), 'באמצע', true);
  assert.equal(r.text, 'לפני באמצע אחרי');
  assert.equal(r.caret, 'לפני באמצע'.length, 'caret sits right after the inserted words');
});

test('an empty interim clears the range without touching other text', () => {
  let r = applyDictation('שלום', 4, collapse(4), 'עולם', false);
  assert.equal(r.text, 'שלום עולם');
  r = applyDictation(r.text, r.caret, r.anchor, '', false);
  assert.equal(r.text, 'שלום', 'the separator space belongs to the range and goes with it');
  assert.equal(r.anchor.interimActive, false);
});

test('stale anchors beyond the text length are clamped (composer was cleared by send)', () => {
  const r = applyDictation('', 0, { start: 40, end: 60, interimActive: true }, 'חדש', false);
  assert.equal(r.text, 'חדש');
});
