import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseUsageLimitError } from '../../src/extension/process/usageLimitParser';

// A fixed "now" (9:00 local) so day-rollover logic is deterministic regardless of
// when the suite runs. parseTimeOnly writes LOCAL hours, and getHours() reads LOCAL
// hours, so the hour/minute assertions hold in any test-runner timezone.
const NOW = new Date('2026-09-08T09:00:00').getTime();

test('detects the Claude session-limit banner and parses the reset time', () => {
  const result = parseUsageLimitError(
    "You've hit your session limit · resets 5pm (Asia/Jerusalem)",
    NOW,
  );
  assert.ok(result, 'expected a parse result for the session-limit banner');
  assert.equal(new Date(result!.resetAtMs).getHours(), 17);
  assert.equal(new Date(result!.resetAtMs).getMinutes(), 0);
  assert.ok(result!.resetAtMs > NOW, 'reset time must be in the future');
});

test('parses session-limit banner with minutes', () => {
  const result = parseUsageLimitError(
    "You've hit your session limit · resets 5:30pm (Asia/Jerusalem)",
    NOW,
  );
  assert.ok(result);
  assert.equal(new Date(result!.resetAtMs).getHours(), 17);
  assert.equal(new Date(result!.resetAtMs).getMinutes(), 30);
});

test('parses "hit your usage limit" wording', () => {
  const result = parseUsageLimitError('You have hit your usage limit · resets 11am', NOW);
  assert.ok(result);
  assert.equal(new Date(result!.resetAtMs).getHours(), 11);
});

test('rolls a past reset time to the next day', () => {
  // 5am is before the fixed 9am "now" -> should schedule for tomorrow.
  const result = parseUsageLimitError("You've hit your session limit · resets 5am", NOW);
  assert.ok(result);
  assert.ok(result!.resetAtMs > NOW);
  assert.equal(new Date(result!.resetAtMs).getHours(), 5);
});

test('still detects the legacy "usage limit reached" wording', () => {
  const result = parseUsageLimitError(
    'Usage limit reached. Your limit will reset at 3:00pm.',
    NOW,
  );
  assert.ok(result, 'legacy wording must remain detected');
  assert.equal(new Date(result!.resetAtMs).getHours(), 15);
});

test('returns null for unrelated text', () => {
  assert.equal(parseUsageLimitError('The build succeeded in 5 seconds.', NOW), null);
  assert.equal(parseUsageLimitError('', NOW), null);
  assert.equal(parseUsageLimitError('Here is how rate limiting works in general.', NOW), null);
});
