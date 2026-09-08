import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  WHATS_NEW_MAX_BANNER_ITEMS,
  compareVersions,
  computeWhatsNewState,
  dismissAllEligible,
  isValidVersion,
  normalizeAnnouncements,
  parseVersion,
  sanitizePersistedState,
  selectEligible,
  unionIds,
} from '../../src/extension/whatsnew/whatsNewLogic';

const EMPTY = { knownIds: [], dismissedIds: [] };

function entry(id: string, version: string, extra: Record<string, unknown> = {}) {
  return { id, version, title: `Title ${id}`, highlights: [`Highlight for ${id}`], ...extra };
}

test('parseVersion / isValidVersion: numeric dotted versions only', () => {
  assert.deepEqual(parseVersion('0.1.229'), [0, 1, 229]);
  assert.deepEqual(parseVersion('v1.2'), [1, 2]);
  assert.equal(parseVersion('1.2.3-beta'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion('1.2.3.4.5'), null);
  assert.equal(isValidVersion('0.1.228'), true);
  assert.equal(isValidVersion('unknown'), false);
});

test('compareVersions: numeric ordering, missing parts count as zero', () => {
  assert.equal(compareVersions('0.1.229', '0.1.230'), -1);
  assert.equal(compareVersions('0.1.230', '0.1.229'), 1);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.1.999'), 1);
});

test('normalizeAnnouncements: drops malformed entries, dedupes ids, sorts newest first', () => {
  const raw = {
    announcements: [
      entry('old', '0.1.200', { date: '2026-01-01' }),
      { id: '', version: '0.1.201', title: 'no id' },
      { id: 'no-version', title: 'x' },
      { id: 'bad-highlights', version: '0.1.202', title: 'x', highlights: 'not-an-array' },
      entry('dup', '0.1.203'),
      entry('dup', '0.1.204'),
      entry('newest', '0.1.230', { date: '2026-09-08', highlights: ['a', '', 'b '] }),
      entry('same-version-later-date', '0.1.230', { date: '2026-09-09' }),
    ],
  };
  const { valid, invalidCount } = normalizeAnnouncements(raw);
  assert.equal(invalidCount, 4, 'three malformed + one duplicate id');
  assert.deepEqual(
    valid.map((a) => a.id),
    ['same-version-later-date', 'newest', 'dup', 'old'],
  );
  const newest = valid.find((a) => a.id === 'newest');
  assert.deepEqual(newest?.highlights, ['a', 'b'], 'empty highlights removed, whitespace trimmed');
  assert.equal('__fileIndex' in (newest as object), false, 'sort helper must not leak into the payload');
});

test('normalizeAnnouncements: keeps optional Hebrew fields; malformed Hebrew falls back to English only', () => {
  const { valid, invalidCount } = normalizeAnnouncements([
    entry('bilingual', '0.1.1', { titleHe: ' כותרת ', highlightsHe: ['נקודה ראשונה', '', 7, '  שנייה '] }),
    entry('english-only', '0.1.2', { titleHe: '', highlightsHe: 'not-an-array' }),
    entry('empty-hebrew-list', '0.1.3', { highlightsHe: ['', '   '] }),
  ]);
  assert.equal(invalidCount, 0, 'Hebrew problems never invalidate an entry');
  const bilingual = valid.find((a) => a.id === 'bilingual');
  assert.equal(bilingual?.titleHe, 'כותרת');
  assert.deepEqual(bilingual?.highlightsHe, ['נקודה ראשונה', 'שנייה']);
  const englishOnly = valid.find((a) => a.id === 'english-only');
  assert.equal(englishOnly?.titleHe, undefined);
  assert.equal(englishOnly?.highlightsHe, undefined);
  assert.equal(valid.find((a) => a.id === 'empty-hebrew-list')?.highlightsHe, undefined);
});

test('normalizeAnnouncements: accepts a bare array and rejects garbage', () => {
  assert.equal(normalizeAnnouncements([entry('a', '1.0.0')]).valid.length, 1);
  assert.equal(normalizeAnnouncements(null).valid.length, 0);
  assert.equal(normalizeAnnouncements('nope').valid.length, 0);
  assert.equal(normalizeAnnouncements({ announcements: 'nope' }).valid.length, 0);
});

test('selectEligible: version <= current only; invalid current version yields nothing', () => {
  const raw = [entry('past', '0.1.100'), entry('now', '0.1.228'), entry('future', '0.1.229')];
  assert.deepEqual(selectEligible(raw, '0.1.228').map((a) => a.id), ['now', 'past']);
  assert.deepEqual(selectEligible(raw, 'garbage'), []);
});

test('unionIds / sanitizePersistedState: order-preserving union and corruption safety', () => {
  assert.deepEqual(unionIds(['a', 'b'], ['b', 'c', 'a']), ['a', 'b', 'c']);
  assert.deepEqual(sanitizePersistedState(undefined), EMPTY);
  assert.deepEqual(sanitizePersistedState('corrupt'), EMPTY);
  assert.deepEqual(
    sanitizePersistedState({ knownIds: ['a', 5, 'a', 'b'], dismissedIds: 'nope' }),
    { knownIds: ['a', 'b'], dismissedIds: [] },
  );
});

test('fresh install: eligible ids seeded as known+dismissed, nothing pending, no toast', () => {
  const result = computeWhatsNewState({
    announcements: [entry('feature', '0.1.228')],
    currentVersion: '0.1.228',
    persisted: EMPTY,
    isExistingInstall: false,
    notificationsEnabled: true,
  });
  assert.equal(result.validVersion, true);
  assert.deepEqual(result.pending, []);
  assert.equal(result.shouldToast, false);
  assert.deepEqual(result.nextPersisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
});

test('existing install without prior state (first release of the feature): shows eligible + toast', () => {
  const result = computeWhatsNewState({
    announcements: [entry('feature', '0.1.228')],
    currentVersion: '0.1.229',
    persisted: EMPTY,
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(result.pending.map((a) => a.id), ['feature']);
  assert.deepEqual(result.newlyDiscovered.map((a) => a.id), ['feature']);
  assert.equal(result.shouldToast, true);
  assert.deepEqual(result.nextPersisted, { knownIds: ['feature'], dismissedIds: [] });
});

test('skipped releases: every missed entry is pending, capped to the newest N', () => {
  const announcements = [
    entry('r1', '0.1.201'),
    entry('r2', '0.1.202'),
    entry('r3', '0.1.203'),
    entry('r4', '0.1.204'),
    entry('r5', '0.1.205'),
  ];
  const result = computeWhatsNewState({
    announcements,
    currentVersion: '0.1.210',
    persisted: { knownIds: ['r1'], dismissedIds: ['r1'] },
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.equal(result.pending.length, WHATS_NEW_MAX_BANNER_ITEMS);
  assert.deepEqual(result.pending.map((a) => a.id), ['r5', 'r4', 'r3']);
  assert.deepEqual(result.newlyDiscovered.map((a) => a.id), ['r5', 'r4', 'r3', 'r2']);
  assert.deepEqual(result.nextPersisted.knownIds, ['r1', 'r5', 'r4', 'r3', 'r2']);
  assert.equal(result.shouldToast, true);
});

test('future entries (version above installed) are ignored until that version ships', () => {
  const result = computeWhatsNewState({
    announcements: [entry('future', '0.1.300')],
    currentVersion: '0.1.228',
    persisted: EMPTY,
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(result.eligible, []);
  assert.deepEqual(result.pending, []);
  assert.equal(result.shouldToast, false);
  assert.deepEqual(result.nextPersisted, EMPTY);
});

test('same-version reinstall (dev deploy:local): nothing new, no toast, pending unchanged', () => {
  const result = computeWhatsNewState({
    announcements: [entry('feature', '0.1.228')],
    currentVersion: '0.1.228',
    persisted: { knownIds: ['feature'], dismissedIds: [] },
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(result.newlyDiscovered, []);
  assert.equal(result.shouldToast, false);
  assert.deepEqual(result.pending.map((a) => a.id), ['feature'], 'still pending until dismissed');
});

test('JSON says 0.1.229 but vsce published 0.1.230: entry is eligible and shown', () => {
  const result = computeWhatsNewState({
    announcements: [entry('feature', '0.1.229')],
    currentVersion: '0.1.230',
    persisted: { knownIds: [], dismissedIds: [] },
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(result.pending.map((a) => a.id), ['feature']);
  assert.equal(result.shouldToast, true);
});

test('notifications disabled: everything eligible is acknowledged, no banner, no toast', () => {
  const result = computeWhatsNewState({
    announcements: [entry('a', '0.1.228'), entry('b', '0.1.227')],
    currentVersion: '0.1.228',
    persisted: { knownIds: ['b'], dismissedIds: [] },
    isExistingInstall: true,
    notificationsEnabled: false,
  });
  assert.deepEqual(result.pending, []);
  assert.equal(result.shouldToast, false);
  assert.deepEqual(result.nextPersisted, { knownIds: ['b', 'a'], dismissedIds: ['a', 'b'] });
});

test('dismissed ids stay hidden; unknown historical ids in storage are preserved', () => {
  const result = computeWhatsNewState({
    announcements: [entry('a', '0.1.228'), entry('b', '0.1.228')],
    currentVersion: '0.1.228',
    persisted: { knownIds: ['a', 'b', 'removed-from-json'], dismissedIds: ['a', 'removed-from-json'] },
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(result.pending.map((a) => a.id), ['b']);
  assert.equal(result.shouldToast, false, 'nothing newly discovered');
  assert.ok(result.nextPersisted.knownIds.includes('removed-from-json'));
  assert.ok(result.nextPersisted.dismissedIds.includes('removed-from-json'));
});

test('downgrade then re-upgrade: sets stay monotonic, nothing resurrects', () => {
  const announcements = [entry('feature', '0.1.229')];
  const afterDismiss = { knownIds: ['feature'], dismissedIds: ['feature'] };
  const downgraded = computeWhatsNewState({
    announcements,
    currentVersion: '0.1.220',
    persisted: afterDismiss,
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(downgraded.pending, []);
  assert.deepEqual(downgraded.nextPersisted, afterDismiss, 'downgrade must not lower the sets');
  const upgradedAgain = computeWhatsNewState({
    announcements,
    currentVersion: '0.1.229',
    persisted: downgraded.nextPersisted,
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.deepEqual(upgradedAgain.pending, []);
  assert.equal(upgradedAgain.shouldToast, false);
});

test('invalid installed version: no-op result, persisted state untouched', () => {
  const persisted = { knownIds: ['x'], dismissedIds: [] };
  const result = computeWhatsNewState({
    announcements: [entry('a', '0.1.228'), { broken: true }],
    currentVersion: 'unknown',
    persisted,
    isExistingInstall: true,
    notificationsEnabled: true,
  });
  assert.equal(result.validVersion, false);
  assert.deepEqual(result.pending, []);
  assert.equal(result.shouldToast, false);
  assert.deepEqual(result.nextPersisted, persisted);
  assert.equal(result.invalidEntryCount, 1);
});

test('dismissAllEligible: acknowledges every eligible id without dropping existing ones', () => {
  const next = dismissAllEligible(
    { knownIds: ['old'], dismissedIds: ['old'] },
    [entry('a', '0.1.1') as never, entry('b', '0.1.2') as never],
  );
  assert.deepEqual(next, { knownIds: ['old', 'a', 'b'], dismissedIds: ['old', 'a', 'b'] });
});
