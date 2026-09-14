import { test } from 'node:test';
import assert from 'node:assert/strict';
import { punctuateFinal, cleanInterim, isQuestion, applySpokenPunctuation } from '../../src/extension/voice/punctuation';

test('hebrew: statement gets a period, single word gets nothing', () => {
  assert.equal(punctuateFinal('אני רוצה לבדוק את הקוד', 'he-IL'), 'אני רוצה לבדוק את הקוד.');
  assert.equal(punctuateFinal('אבי', 'he-IL'), 'אבי');
});

test('hebrew: question words at the start or tag words at the end give a question mark', () => {
  assert.equal(punctuateFinal('מה שלומך היום', 'he-IL'), 'מה שלומך היום?');
  assert.equal(punctuateFinal('האם זה עובד', 'he-IL'), 'האם זה עובד?');
  assert.equal(punctuateFinal('אתה מבין הבנת', 'he-IL'), 'אתה מבין הבנת?');
  assert.equal(punctuateFinal('תגיד לי איך זה עובד', 'he-IL'), 'תגיד לי איך זה עובד?');
  assert.equal(isQuestion('שלום מה שלומך', 'he-IL'), false, 'a question word in the middle is not a question');
  assert.equal(isQuestion('מהר מאוד', 'he-IL'), false, 'prefix of a question word is not a question word');
});

test('hebrew: spoken punctuation wins over automatic punctuation', () => {
  assert.equal(punctuateFinal('אני מסיים נקודה', 'he-IL'), 'אני מסיים.');
  assert.equal(punctuateFinal('שלום פסיק מה קורה', 'he-IL'), 'שלום, מה קורה.');
  assert.equal(punctuateFinal('באמת סימן שאלה', 'he-IL'), 'באמת?');
  assert.equal(applySpokenPunctuation('שורה ראשונה שורה חדשה שורה שנייה', 'he-IL'), 'שורה ראשונה\nשורה שנייה');
});

test('hebrew: niqqud is stripped and interim text never gets a terminal mark', () => {
  assert.equal(cleanInterim('שָׁלוֹם לְךָ', 'he-IL'), 'שלום לך');
  assert.equal(cleanInterim('מה שלומך', 'he-IL'), 'מה שלומך');
});

test('english: basic questions and spoken punctuation', () => {
  assert.equal(punctuateFinal('what is the status', 'en-US'), 'what is the status?');
  assert.equal(punctuateFinal('run the tests period', 'en-US'), 'run the tests.');
  assert.equal(punctuateFinal('fix it comma then push', 'en-US'), 'fix it, then push.');
});

test('auto punctuation can be turned off', () => {
  assert.equal(punctuateFinal('מה שלומך', 'he-IL', false), 'מה שלומך');
  assert.equal(punctuateFinal('אני מסיים נקודה', 'he-IL', false), 'אני מסיים.', 'spoken punctuation still applies');
});

test('unknown language: text passes through untouched except whitespace', () => {
  assert.equal(punctuateFinal('  hola   mundo ', 'es-ES'), 'hola mundo.');
});
