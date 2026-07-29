/**
 * Pure navigation-tree builder for the grouped vertical tab rail.
 *
 * Hardened against malformed persisted data: duplicate group ids (first
 * wins), orphaned parentId (lifted to top level), self-parenting, and cycles
 * (every group renders exactly once — unreachable cycle members are lifted to
 * top level in deterministic order). Tabs pointing at unknown groups fall
 * back to the ungrouped bucket.
 */
import type { WebviewTabGroup, WebviewTabSummary } from '../extension/types/webview-messages';

export interface TabNavGroupNode {
  group: WebviewTabGroup;
  depth: number;
  childGroups: TabNavGroupNode[];
  /** Direct tab children, sorted by sibling order. */
  tabs: WebviewTabSummary[];
  /** Every tab in this group's subtree (for header counts + status roll-up). */
  subtreeTabs: WebviewTabSummary[];
}

export interface TabNavTree {
  /** Tabs with no (known) folder, sorted. Rendered without a header. */
  ungrouped: WebviewTabSummary[];
  /** Top-level folder nodes in display order. */
  roots: TabNavGroupNode[];
}

/** Sibling sort: finite orderInGroup first, then tabNumber, then id. */
export function compareRailTabs(a: WebviewTabSummary, b: WebviewTabSummary): number {
  const aOrder = typeof a.orderInGroup === 'number' && Number.isFinite(a.orderInGroup)
    ? a.orderInGroup
    : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.orderInGroup === 'number' && Number.isFinite(b.orderInGroup)
    ? b.orderInGroup
    : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  if (a.tabNumber !== b.tabNumber) {
    return a.tabNumber - b.tabNumber;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareGroups(a: WebviewTabGroup, b: WebviewTabGroup): number {
  const aOrder = typeof a.order === 'number' && Number.isFinite(a.order)
    ? a.order
    : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.order === 'number' && Number.isFinite(b.order)
    ? b.order
    : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildTabNavTree(
  tabs: WebviewTabSummary[],
  groups: WebviewTabGroup[],
): TabNavTree {
  // Dedup by id — first record wins.
  const byId = new Map<string, WebviewTabGroup>();
  for (const group of groups) {
    if (group && typeof group.id === 'string' && !byId.has(group.id)) {
      byId.set(group.id, group);
    }
  }

  // Bucket child groups under an effective parent. Unknown or self parent =>
  // top level.
  const childrenByParent = new Map<string | undefined, WebviewTabGroup[]>();
  for (const group of byId.values()) {
    const parent =
      group.parentId && group.parentId !== group.id && byId.has(group.parentId)
        ? group.parentId
        : undefined;
    const list = childrenByParent.get(parent) ?? [];
    list.push(group);
    childrenByParent.set(parent, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort(compareGroups);
  }

  // Bucket tabs. Unknown groupId falls back to ungrouped.
  const tabsByGroup = new Map<string | undefined, WebviewTabSummary[]>();
  for (const tab of tabs) {
    const groupId = tab.groupId && byId.has(tab.groupId) ? tab.groupId : undefined;
    const list = tabsByGroup.get(groupId) ?? [];
    list.push(tab);
    tabsByGroup.set(groupId, list);
  }
  for (const list of tabsByGroup.values()) {
    list.sort(compareRailTabs);
  }

  const visited = new Set<string>();

  const buildNode = (group: WebviewTabGroup, depth: number): TabNavGroupNode | null => {
    if (visited.has(group.id)) {
      return null; // cycle guard — each group renders at most once
    }
    visited.add(group.id);
    const childGroups = (childrenByParent.get(group.id) ?? [])
      .map((child) => buildNode(child, depth + 1))
      .filter((node): node is TabNavGroupNode => node !== null);
    const directTabs = tabsByGroup.get(group.id) ?? [];
    const subtreeTabs = [...directTabs, ...childGroups.flatMap((node) => node.subtreeTabs)];
    return { group, depth, childGroups, tabs: directTabs, subtreeTabs };
  };

  const roots = (childrenByParent.get(undefined) ?? [])
    .map((group) => buildNode(group, 0))
    .filter((node): node is TabNavGroupNode => node !== null);

  // Cycle members are unreachable from any root — lift them deterministically.
  const leftovers = [...byId.values()].filter((g) => !visited.has(g.id)).sort(compareGroups);
  for (const group of leftovers) {
    const node = buildNode(group, 0);
    if (node) {
      roots.push(node);
    }
  }

  return {
    ungrouped: tabsByGroup.get(undefined) ?? [],
    roots,
  };
}
