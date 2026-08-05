import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  planHibernation,
  type HibernationCandidate,
  type HibernationConfig,
} from '../../src/extension/session/hibernation/HibernationPlanner';

const HOUR = 3_600_000;
const NOW = 1_000_000 * HOUR;

const cfg = (overrides?: Partial<HibernationConfig>): HibernationConfig => ({
  enabled: true,
  idleHours: 12,
  deepIdleHours: 24,
  ...overrides,
});

const candidate = (overrides?: Partial<HibernationCandidate>): HibernationCandidate => ({
  tabId: 'tab-1',
  kind: 'claude',
  hasSessionId: true,
  processRunning: true,
  isBusy: false,
  isVisible: false,
  isSleeping: false,
  isDeepSleeping: false,
  hasBackgroundWork: false,
  isSearchTab: false,
  lastActivityAtMs: NOW - 13 * HOUR,
  ...overrides,
});

test('disabled config produces no actions', () => {
  const actions = planHibernation(NOW, cfg({ enabled: false }), [candidate()]);
  assert.deepEqual(actions, []);
});

test('idle claude tab past the light threshold is light-hibernated', () => {
  const actions = planHibernation(NOW, cfg(), [candidate()]);
  assert.deepEqual(actions, [{ tabId: 'tab-1', action: 'light' }]);
});

test('tab idle below the light threshold is left alone', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({ lastActivityAtMs: NOW - 11 * HOUR }),
  ]);
  assert.deepEqual(actions, []);
});

test('busy, visible or background-work tabs are never hibernated', () => {
  const stale = { lastActivityAtMs: NOW - 100 * HOUR };
  assert.deepEqual(planHibernation(NOW, cfg(), [candidate({ ...stale, isBusy: true })]), []);
  assert.deepEqual(planHibernation(NOW, cfg(), [candidate({ ...stale, isVisible: true })]), []);
  assert.deepEqual(
    planHibernation(NOW, cfg(), [candidate({ ...stale, hasBackgroundWork: true })]),
    [],
  );
});

test('tab without a session id is never hibernated', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({ hasSessionId: false, lastActivityAtMs: NOW - 100 * HOUR }),
  ]);
  assert.deepEqual(actions, []);
});

test('already-sleeping tab is not light-hibernated again', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({ isSleeping: true, processRunning: false }),
  ]);
  assert.deepEqual(actions, []);
});

test('tab without a running CLI process cannot light-hibernate', () => {
  const actions = planHibernation(NOW, cfg(), [candidate({ processRunning: false })]);
  assert.deepEqual(actions, []);
});

test('tab past the deep threshold is deep-hibernated (even if sleeping)', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({
      isSleeping: true,
      processRunning: false,
      lastActivityAtMs: NOW - 25 * HOUR,
    }),
  ]);
  assert.deepEqual(actions, [{ tabId: 'tab-1', action: 'deep' }]);
});

test('codex tabs are never hibernated (per-turn process; no placeholder support)', () => {
  const light = planHibernation(NOW, cfg(), [
    candidate({ kind: 'codex', lastActivityAtMs: NOW - 13 * HOUR }),
  ]);
  assert.deepEqual(light, []);
  const deep = planHibernation(NOW, cfg(), [
    candidate({ kind: 'codex', lastActivityAtMs: NOW - 25 * HOUR }),
  ]);
  assert.deepEqual(deep, []);
});

test('already deep-sleeping tab is not deep-hibernated again', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({
      isSleeping: true,
      isDeepSleeping: true,
      processRunning: false,
      lastActivityAtMs: NOW - 100 * HOUR,
    }),
  ]);
  assert.deepEqual(actions, []);
});

test('search tabs light-hibernate but never deep-hibernate', () => {
  const light = planHibernation(NOW, cfg(), [
    candidate({ isSearchTab: true, lastActivityAtMs: NOW - 13 * HOUR }),
  ]);
  assert.deepEqual(light, [{ tabId: 'tab-1', action: 'light' }]);
  const deep = planHibernation(NOW, cfg(), [
    candidate({ isSearchTab: true, lastActivityAtMs: NOW - 100 * HOUR }),
  ]);
  // Falls back to 'light' (still eligible), never 'deep'.
  assert.deepEqual(deep, [{ tabId: 'tab-1', action: 'light' }]);
});

test('multi-participant / unknown tabs are skipped entirely', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({ kind: 'other', lastActivityAtMs: NOW - 100 * HOUR }),
  ]);
  assert.deepEqual(actions, []);
});

test('deepIdleHours=0 disables deep hibernation', () => {
  const actions = planHibernation(NOW, cfg({ deepIdleHours: 0 }), [
    candidate({ lastActivityAtMs: NOW - 1000 * HOUR }),
  ]);
  assert.deepEqual(actions, [{ tabId: 'tab-1', action: 'light' }]);
});

test('deep threshold is clamped to at least the light threshold', () => {
  // deepIdleHours misconfigured below idleHours: 13h idle must NOT deep-hibernate.
  const actions = planHibernation(NOW, cfg({ idleHours: 20, deepIdleHours: 4 }), [
    candidate({ lastActivityAtMs: NOW - 13 * HOUR }),
  ]);
  assert.deepEqual(actions, []);
  const deep = planHibernation(NOW, cfg({ idleHours: 20, deepIdleHours: 4 }), [
    candidate({ lastActivityAtMs: NOW - 21 * HOUR }),
  ]);
  assert.deepEqual(deep, [{ tabId: 'tab-1', action: 'deep' }]);
});

test('mixed fleet: each tab gets its own decision', () => {
  const actions = planHibernation(NOW, cfg(), [
    candidate({ tabId: 'fresh', lastActivityAtMs: NOW - 1 * HOUR }),
    candidate({ tabId: 'idle', lastActivityAtMs: NOW - 13 * HOUR }),
    candidate({ tabId: 'ancient', lastActivityAtMs: NOW - 48 * HOUR }),
    candidate({ tabId: 'busy', isBusy: true, lastActivityAtMs: NOW - 48 * HOUR }),
  ]);
  assert.deepEqual(actions, [
    { tabId: 'idle', action: 'light' },
    { tabId: 'ancient', action: 'deep' },
  ]);
});
