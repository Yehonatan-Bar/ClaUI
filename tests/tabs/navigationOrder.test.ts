import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMoveTabInNavigation,
  planNormalizeAllOrders,
  type OrderableTab,
} from '../../src/extension/session/tabOrdering';

function tab(
  id: string,
  tabNumber: number,
  groupId?: string,
  orderInGroup?: number,
): OrderableTab {
  return { id, tabNumber, groupId, orderInGroup };
}

/** Apply a plan to a tab list (simulates what TabManager does). */
function apply(tabs: OrderableTab[], plan: ReturnType<typeof planMoveTabInNavigation>): OrderableTab[] {
  assert.ok(plan, 'expected a non-null plan');
  return tabs.map((t) => {
    const a = plan.find((x) => x.id === t.id);
    return a ? { ...t, groupId: a.groupId, orderInGroup: a.orderInGroup } : t;
  });
}

function ordered(tabs: OrderableTab[], groupId?: string): string[] {
  return tabs
    .filter((t) => (t.groupId ?? undefined) === groupId)
    .sort((a, b) => (a.orderInGroup ?? 0) - (b.orderInGroup ?? 0))
    .map((t) => t.id);
}

test('same-group move down', () => {
  const tabs = [tab('a', 1, 'g', 0), tab('b', 2, 'g', 1), tab('c', 3, 'g', 2)];
  // Move a below b: siblings-without-a = [b, c]; index 1 = between b and c.
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'a', 'g', 1));
  assert.deepEqual(ordered(next, 'g'), ['b', 'a', 'c']);
});

test('same-group move up', () => {
  const tabs = [tab('a', 1, 'g', 0), tab('b', 2, 'g', 1), tab('c', 3, 'g', 2)];
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'c', 'g', 0));
  assert.deepEqual(ordered(next, 'g'), ['c', 'a', 'b']);
});

test('no-op move returns empty plan', () => {
  const tabs = [tab('a', 1, 'g', 0), tab('b', 2, 'g', 1)];
  const plan = planMoveTabInNavigation(tabs, 'a', 'g', 0);
  assert.ok(plan);
  assert.equal(plan.length, 0);
});

test('cross-group move renumbers both lists', () => {
  const tabs = [
    tab('a', 1, 'g1', 0), tab('b', 2, 'g1', 1), tab('c', 3, 'g1', 2),
    tab('d', 4, 'g2', 0),
  ];
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'b', 'g2', 0));
  assert.deepEqual(ordered(next, 'g1'), ['a', 'c']);
  assert.deepEqual(ordered(next, 'g2'), ['b', 'd']);
  // Source list must be contiguous 0..n-1.
  assert.deepEqual(
    next.filter((t) => t.groupId === 'g1').map((t) => t.orderInGroup).sort(),
    [0, 1],
  );
});

test('move into empty group', () => {
  const tabs = [tab('a', 1, 'g1', 0), tab('b', 2)];
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'b', 'gEmpty', 0));
  assert.deepEqual(ordered(next, 'gEmpty'), ['b']);
});

test('move to ungrouped (null target)', () => {
  const tabs = [tab('a', 1, 'g1', 0), tab('u1', 2, undefined, 0), tab('u2', 3, undefined, 1)];
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'a', null, 1));
  assert.deepEqual(ordered(next, undefined), ['u1', 'a', 'u2']);
});

test('index clamps: huge index appends, negative prepends', () => {
  const tabs = [tab('a', 1, 'g', 0), tab('b', 2, 'g', 1), tab('c', 3)];
  const appended = apply(tabs, planMoveTabInNavigation(tabs, 'c', 'g', 999));
  assert.deepEqual(ordered(appended, 'g'), ['a', 'b', 'c']);
  const prepended = apply(tabs, planMoveTabInNavigation(tabs, 'c', 'g', -5));
  assert.deepEqual(ordered(prepended, 'g'), ['c', 'a', 'b']);
});

test('invalid requests return null', () => {
  const tabs = [tab('a', 1)];
  assert.equal(planMoveTabInNavigation(tabs, 'missing', null, 0), null);
  assert.equal(planMoveTabInNavigation(tabs, 'a', null, Number.NaN), null);
  assert.equal(planMoveTabInNavigation(tabs, 'a', null, Number.POSITIVE_INFINITY), null);
});

test('fractional index floors', () => {
  const tabs = [tab('a', 1, 'g', 0), tab('b', 2, 'g', 1), tab('c', 3)];
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'c', 'g', 1.9));
  assert.deepEqual(ordered(next, 'g'), ['a', 'c', 'b']);
});

test('legacy duplicate/undefined orderInGroup stays deterministic', () => {
  // Legacy flat numbering: duplicates across and inside groups + undefined.
  const tabs = [
    tab('a', 5, 'g', 2), tab('b', 1, 'g', 2), tab('c', 3, 'g'), tab('d', 2, 'g', 0),
  ];
  // Comparator: finite order first (d=0, then a/b tie -> tabNumber b(1) before a(5)), undefined last.
  const next = apply(tabs, planMoveTabInNavigation(tabs, 'c', 'g', 0));
  assert.deepEqual(ordered(next, 'g'), ['c', 'd', 'b', 'a']);
});

test('normalizeAllOrders produces contiguous per-group numbering and is idempotent', () => {
  const tabs = [
    tab('a', 1, 'g1', 7), tab('b', 2, 'g1', 7), tab('c', 3, 'g2'), tab('d', 4, undefined, 9),
  ];
  const plan = planNormalizeAllOrders(tabs);
  const next = apply(tabs, plan);
  assert.deepEqual(ordered(next, 'g1'), ['a', 'b']);
  assert.deepEqual(next.find((t) => t.id === 'c')?.orderInGroup, 0);
  assert.deepEqual(next.find((t) => t.id === 'd')?.orderInGroup, 0);
  assert.equal(planNormalizeAllOrders(next).length, 0);
});
