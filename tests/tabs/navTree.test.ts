import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTabNavTree } from '../../src/webview/tabNav';
import type { WebviewTabGroup, WebviewTabSummary } from '../../src/extension/types/webview-messages';

function group(id: string, order: number, parentId?: string, label = id): WebviewTabGroup {
  return { id, parentId, label, color: '#4A9FD9', order };
}

function tab(id: string, tabNumber: number, groupId?: string, orderInGroup?: number): WebviewTabSummary {
  return {
    id,
    tabNumber,
    displayName: id,
    provider: 'claude',
    sessionId: null,
    groupId,
    orderInGroup,
    slotColor: '#4A9FD9',
  };
}

test('nested folders build recursively with subtree tab counts', () => {
  const groups = [group('root', 0), group('child', 0, 'root'), group('grand', 0, 'child')];
  const tabs = [tab('t1', 1, 'root', 0), tab('t2', 2, 'child', 0), tab('t3', 3, 'grand', 0)];
  const tree = buildTabNavTree(tabs, groups);
  assert.equal(tree.roots.length, 1);
  const root = tree.roots[0];
  assert.equal(root.depth, 0);
  assert.equal(root.subtreeTabs.length, 3);
  assert.equal(root.childGroups[0].group.id, 'child');
  assert.equal(root.childGroups[0].depth, 1);
  assert.equal(root.childGroups[0].subtreeTabs.length, 2);
  assert.equal(root.childGroups[0].childGroups[0].group.id, 'grand');
});

test('orphaned parentId lifts to top level', () => {
  const groups = [group('a', 0, 'no-such-parent'), group('b', 1)];
  const tree = buildTabNavTree([], groups);
  assert.deepEqual(tree.roots.map((n) => n.group.id), ['a', 'b']);
});

test('self-parenting lifts to top level', () => {
  const groups = [group('a', 0, 'a')];
  const tree = buildTabNavTree([], groups);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].childGroups.length, 0);
});

test('cycles render every group exactly once', () => {
  // a -> b -> a plus a normal root.
  const groups = [group('a', 0, 'b'), group('b', 1, 'a'), group('c', 2)];
  const tree = buildTabNavTree([], groups);
  const seen: string[] = [];
  const walk = (nodes: typeof tree.roots) => {
    for (const n of nodes) {
      seen.push(n.group.id);
      walk(n.childGroups);
    }
  };
  walk(tree.roots);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  assert.equal(seen.length, new Set(seen).size, 'no group renders twice');
});

test('duplicate group ids: first record wins', () => {
  const groups = [
    { ...group('dup', 0), label: 'first' },
    { ...group('dup', 1), label: 'second' },
  ];
  const tree = buildTabNavTree([], groups);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].group.label, 'first');
});

test('tab with unknown groupId falls back to ungrouped', () => {
  const tree = buildTabNavTree([tab('t1', 1, 'ghost', 0), tab('t2', 2)], []);
  assert.deepEqual(tree.ungrouped.map((t) => t.id), ['t1', 't2']);
});

test('sibling groups sort by order then id; tabs by orderInGroup/tabNumber/id', () => {
  const groups = [group('b', 1), group('a', 1), group('z', 0)];
  const tabs = [
    tab('t-late', 9, 'z', 1),
    tab('t-early', 5, 'z', 0),
    tab('t-nofinite', 1, 'z'),
  ];
  const tree = buildTabNavTree(tabs, groups);
  assert.deepEqual(tree.roots.map((n) => n.group.id), ['z', 'a', 'b']);
  assert.deepEqual(tree.roots[0].tabs.map((t) => t.id), ['t-early', 't-late', 't-nofinite']);
});

test('empty folders still render', () => {
  const tree = buildTabNavTree([], [group('empty', 0)]);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].tabs.length, 0);
  assert.equal(tree.roots[0].subtreeTabs.length, 0);
});
