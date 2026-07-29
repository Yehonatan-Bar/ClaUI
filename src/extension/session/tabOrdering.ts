/**
 * Pure ordering logic for the grouped vertical tab rail.
 *
 * No vscode imports — everything here is unit-testable. TabManager translates
 * the returned assignments into snapshot-entry mutations and persists them.
 *
 * Ordering invariant: `orderInGroup` is sibling-relative — contiguous 0..n-1
 * within each folder (and within the top-level "ungrouped" list). Legacy data
 * may hold undefined/duplicate/global values; the stable comparator below
 * makes those deterministic, and every move re-normalizes the affected lists.
 */

/** Minimal tab shape the ordering planner needs. */
export interface OrderableTab {
  id: string;
  tabNumber: number;
  groupId?: string;
  orderInGroup?: number;
}

/** A single (tab -> group/order) write the caller should apply. */
export interface OrderAssignment {
  id: string;
  groupId: string | undefined;
  orderInGroup: number;
}

/**
 * Stable sibling comparator: finite orderInGroup first (missing/invalid sorts
 * last), then creation order (tabNumber), then id as the final tie-break.
 */
export function compareTabs(a: OrderableTab, b: OrderableTab): number {
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

/** Tabs belonging to the given folder (undefined = ungrouped), sorted, minus one excluded id. */
function siblingsOf(
  tabs: OrderableTab[],
  groupId: string | undefined,
  excludeId?: string,
): OrderableTab[] {
  return tabs
    .filter((t) => (t.groupId ?? undefined) === groupId && t.id !== excludeId)
    .sort(compareTabs);
}

/**
 * Plan moving `tabId` into `targetGroupId` (null = ungrouped) at `targetIndex`.
 *
 * `targetIndex` is an index into the target folder's tab-only sibling list
 * computed AFTER the dragged tab is removed from it; it is clamped to
 * [0, siblings.length], so stale indices degrade to append rather than fail.
 *
 * Returns the minimal set of contiguous re-number writes for the target list
 * (and, on cross-folder moves, the source list), or null when the request is
 * invalid (unknown tab / non-finite index). Callers must apply all-or-nothing.
 */
export function planMoveTabInNavigation(
  tabs: OrderableTab[],
  tabId: string,
  targetGroupId: string | null,
  targetIndex: number,
): OrderAssignment[] | null {
  const moved = tabs.find((t) => t.id === tabId);
  if (!moved || typeof targetIndex !== 'number' || !Number.isFinite(targetIndex)) {
    return null;
  }
  const target = targetGroupId ?? undefined;
  const source = moved.groupId ?? undefined;

  const targetList = siblingsOf(tabs, target, tabId);
  const insertAt = Math.max(0, Math.min(Math.floor(targetIndex), targetList.length));
  targetList.splice(insertAt, 0, moved);

  const assignments: OrderAssignment[] = [];
  targetList.forEach((tab, index) => {
    const groupChanged = (tab.groupId ?? undefined) !== target;
    if (groupChanged || tab.orderInGroup !== index) {
      assignments.push({ id: tab.id, groupId: target, orderInGroup: index });
    }
  });

  if (source !== target) {
    siblingsOf(tabs, source, tabId).forEach((tab, index) => {
      if (tab.orderInGroup !== index) {
        assignments.push({ id: tab.id, groupId: source, orderInGroup: index });
      }
    });
  }
  return assignments;
}

/**
 * Idempotent cleanup: contiguous 0..n-1 re-numbering of every sibling list.
 * Returns only the writes that actually change something (empty = clean data).
 */
export function planNormalizeAllOrders(tabs: OrderableTab[]): OrderAssignment[] {
  const byGroup = new Map<string | undefined, OrderableTab[]>();
  for (const tab of tabs) {
    const groupId = tab.groupId ?? undefined;
    const list = byGroup.get(groupId) ?? [];
    list.push(tab);
    byGroup.set(groupId, list);
  }
  const assignments: OrderAssignment[] = [];
  for (const [groupId, list] of byGroup) {
    list.sort(compareTabs).forEach((tab, index) => {
      if (tab.orderInGroup !== index) {
        assignments.push({ id: tab.id, groupId, orderInGroup: index });
      }
    });
  }
  return assignments;
}
