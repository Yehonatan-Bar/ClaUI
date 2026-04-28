import * as vscode from 'vscode';

/** A folder (or sub-folder) in the Sessions tree. */
export interface TabGroup {
  id: string;
  /** Undefined = top-level folder. Recursion supported (sub-folders). */
  parentId?: string;
  label: string;
  /** Hex color used for the folder icon and the colored circle on the native tab. */
  color: string;
  /** Sibling order within its parentId. */
  order: number;
  createdAt: number;
}

const STORAGE_KEY = 'claudeMirror.tabGroups';

/** Default palette for newly-created folders, cycling through. */
const DEFAULT_COLORS = [
  '#4A9FD9',
  '#E06C75',
  '#98C379',
  '#D19A66',
  '#C678DD',
  '#56B6C2',
  '#E5C07B',
  '#BE5046',
];

/** Tree shape used by the TreeDataProvider — groups own subgroups. Tab assignments live on the tabs themselves. */
export interface RenderableTreeGroup {
  group: TabGroup;
  children: RenderableTreeGroup[];
}

/**
 * Memento-backed CRUD for tab folders.
 *
 * Group records are persisted to workspaceState; tab→group assignment lives
 * on each OpenTabSnapshotEntry's groupId/orderInGroup so it ships with the
 * tab snapshot and survives restore.
 *
 * Cycle prevention: moveGroup walks the parent chain before mutating.
 * Cascade delete vs reparent is handled by deleteGroup(id, mode).
 */
export class TabGroupStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires whenever any group is created, edited, moved, or deleted. */
  readonly onDidChange = this.emitter.event;

  private cache: TabGroup[];
  private nextColorIdx = 0;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.cache = this.read();
    this.nextColorIdx = this.cache.length % DEFAULT_COLORS.length;
  }

  private read(): TabGroup[] {
    const raw = this.workspaceState.get<TabGroup[]>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((g) => typeof g?.id === 'string' && typeof g?.label === 'string');
  }

  private async write(): Promise<void> {
    await this.workspaceState.update(STORAGE_KEY, this.cache);
    this.emitter.fire();
  }

  listGroups(): TabGroup[] {
    return this.cache.slice();
  }

  getGroup(id: string): TabGroup | undefined {
    return this.cache.find((g) => g.id === id);
  }

  /** Render-ready nested tree of groups. Tab leaves are added by the TreeProvider. */
  getTree(): RenderableTreeGroup[] {
    const byParent = new Map<string | undefined, TabGroup[]>();
    for (const g of this.cache) {
      const key = g.parentId;
      const list = byParent.get(key) ?? [];
      list.push(g);
      byParent.set(key, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.order - b.order);
    }
    const build = (parentId: string | undefined): RenderableTreeGroup[] => {
      return (byParent.get(parentId) ?? []).map((group) => ({
        group,
        children: build(group.id),
      }));
    };
    return build(undefined);
  }

  async createGroup(args: { label: string; parentId?: string; color?: string }): Promise<TabGroup> {
    const label = args.label.trim() || 'New Folder';
    if (args.parentId && !this.getGroup(args.parentId)) {
      throw new Error(`Parent folder ${args.parentId} not found`);
    }
    const color = args.color ?? DEFAULT_COLORS[this.nextColorIdx % DEFAULT_COLORS.length];
    this.nextColorIdx++;
    const siblings = this.cache.filter((g) => g.parentId === args.parentId);
    const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
    const group: TabGroup = {
      id: `group-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      parentId: args.parentId,
      label,
      color,
      order,
      createdAt: Date.now(),
    };
    this.cache.push(group);
    await this.write();
    return group;
  }

  async renameGroup(id: string, label: string): Promise<void> {
    const group = this.getGroup(id);
    if (!group) {
      return;
    }
    const trimmed = label.trim();
    if (!trimmed || trimmed === group.label) {
      return;
    }
    group.label = trimmed;
    await this.write();
  }

  async setGroupColor(id: string, color: string): Promise<void> {
    const group = this.getGroup(id);
    if (!group) {
      return;
    }
    group.color = color;
    await this.write();
  }

  /** Move a folder under a new parent (or to the top level when parentId is null). Refuses cycles. */
  async moveGroup(id: string, parentId: string | null): Promise<void> {
    const group = this.getGroup(id);
    if (!group) {
      return;
    }
    if (parentId === id) {
      throw new Error('A folder cannot be its own parent');
    }
    if (parentId) {
      // Walk up the proposed parent chain — if we encounter `id`, this would cycle.
      let cursor: string | undefined = parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          throw new Error('Cannot move a folder into one of its own descendants');
        }
        if (seen.has(cursor)) {
          break;
        }
        seen.add(cursor);
        const next = this.getGroup(cursor);
        cursor = next?.parentId;
      }
    }
    group.parentId = parentId ?? undefined;
    // Place at the end of its new sibling group.
    const siblings = this.cache.filter((g) => g.parentId === group.parentId && g.id !== id);
    group.order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
    await this.write();
  }

  /**
   * Delete a folder.
   * - `cascade`: also returns the ids of all descendant folders so the caller can close every tab inside.
   * - `reparent`: descendants and assigned tabs lift one level (to the deleted folder's parent).
   *
   * Returns descendant group ids the caller may need to act on.
   */
  async deleteGroup(id: string, mode: 'cascade' | 'reparent'): Promise<{ deletedGroupIds: string[]; reparentedTo?: string | null }> {
    const group = this.getGroup(id);
    if (!group) {
      return { deletedGroupIds: [] };
    }
    const descendants = this.collectDescendantIds(id);
    if (mode === 'cascade') {
      const allToDelete = new Set([id, ...descendants]);
      this.cache = this.cache.filter((g) => !allToDelete.has(g.id));
      await this.write();
      return { deletedGroupIds: Array.from(allToDelete) };
    }
    // reparent: lift direct children to the deleted folder's parent.
    const newParent = group.parentId;
    for (const g of this.cache) {
      if (g.parentId === id) {
        g.parentId = newParent;
      }
    }
    this.cache = this.cache.filter((g) => g.id !== id);
    await this.write();
    return { deletedGroupIds: [id], reparentedTo: newParent ?? null };
  }

  private collectDescendantIds(id: string): string[] {
    const out: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const g of this.cache) {
        if (g.parentId === current) {
          out.push(g.id);
          stack.push(g.id);
        }
      }
    }
    return out;
  }

  async reorderWithinParent(parentId: string | null, orderedIds: string[]): Promise<void> {
    const parent = parentId ?? undefined;
    let mutated = false;
    orderedIds.forEach((groupId, idx) => {
      const group = this.getGroup(groupId);
      if (group && group.parentId === parent && group.order !== idx) {
        group.order = idx;
        mutated = true;
      }
    });
    if (mutated) {
      await this.write();
    }
  }
}
