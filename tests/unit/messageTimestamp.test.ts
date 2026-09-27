import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatMessageTimestamp } from '../../src/webview/utils/messageTimestamp';

// The time part follows the runtime locale, so compare it against the same call.
const localTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

test('formatMessageTimestamp: dd/mm, short weekday, then time', () => {
  const date = new Date(2026, 8, 27, 14, 5); // Sunday 27 Sep 2026, local time
  assert.equal(formatMessageTimestamp(date), `27/09 Sun ${localTime(date)}`);
});

test('formatMessageTimestamp: zero-pads single-digit day and month', () => {
  const date = new Date(2026, 0, 5, 9, 30); // Monday 5 Jan 2026
  assert.equal(formatMessageTimestamp(date), `05/01 Mon ${localTime(date)}`);
});

test('formatMessageTimestamp: covers every weekday abbreviation', () => {
  const expectedWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  expectedWeekdays.forEach((weekday, offset) => {
    const date = new Date(2026, 0, 5 + offset, 12, 0); // Mon 5 Jan .. Sun 11 Jan 2026
    assert.equal(formatMessageTimestamp(date).split(' ')[1], weekday);
  });
});
