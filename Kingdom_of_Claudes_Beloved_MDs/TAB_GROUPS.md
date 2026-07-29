# Tab Folders & Sub-folders

Nestable folders for ClaUi session tabs, surfaced in two places:

1. **Sidebar TreeView** (`claudeMirror.sessionsTree`) in the Activity Bar's **ClaUi** view container.
2. **Vertical tab rail** (vertical layout mode) — collapsible folder headers with color swatch, label, subtree tab count, and drag-and-drop of tabs between folders. VS Code's native editor tab strip cannot render grouping, so the rail (ClaUi-owned React UI) is the primary grouped-navigation surface.

## Storage

- **Folders** (`TabGroupStore`) live in `workspaceState` under key `claudeMirror.tabGroups` as an array of `TabGroup` records (`id`, `parentId?`, `label`, `color`, `order`, `createdAt`).
- **Collapse state** lives in `workspaceState` under key `claudeMirror.tabGroupCollapsed` (`string[]` of collapsed folder ids). Loaded by a field initializer (no existence pruning at load; ids are pruned on folder delete, including cascade descendants). `setGroupCollapsed()` no-ops on unknown ids / unchanged state and fires `onDidChange` only on real changes, which drives a single `broadcastTabsState()`.
- **Tab membership** rides on the existing `OpenTabSnapshotEntry` via two optional fields:
  - `groupId?: string` — folder the tab belongs to (`undefined` = top level).
  - `orderInGroup?: number` — sibling order within the folder. **Invariant: contiguous `0..n-1` per sibling list** (folder or ungrouped). `TabManager.normalizeAllOrders()` runs after snapshot restore to migrate legacy (flat/duplicate/undefined) values.

All stores are scoped per workspace, so folders never bleed between projects.

## Grouped Vertical Rail

- The `tabList` broadcast carries `groups: WebviewTabGroup[]` and `collapsedGroupIds: string[]` alongside `tabs` + `activeTabId` (one atomic message; webview consumers default both to `[]` for backward compatibility).
- `src/webview/tabNav.ts` (`buildTabNavTree`) builds the render tree — hardened against duplicate ids (first wins), orphaned/self `parentId` (lifted to top level), and cycles (each group renders exactly once). Tabs with unknown `groupId` fall back to the ungrouped bucket.
- Rail rendering (`VerticalTabRail` in `App.tsx`): ungrouped tabs first (no header), then folder nodes recursively. Header = collapse chevron + color swatch + ellipsized label + subtree tab count; `aria-expanded` + native button keyboard toggle. Visual indent is 11px/level **capped at depth 3** (data model depth is unlimited). Collapse hides only the rows — the panels stay open and sessions keep running; a collapsed header shows contains-active / contains-busy styling and is **not** auto-expanded when an inner tab activates.
- Empty folders render (they are drop targets and organizational objects).
- "+ Folder" button at rail top posts `createTabGroup`, routed to the existing `claudeMirror.groups.create` command (rename/recolor/delete stay in the sidebar for v1).

## Drag & Drop (rail)

- Drop **on a header** (collapsed or expanded) = append to that folder's direct tabs.
- Drop **between tab rows** = that row's folder at that index.
- Drop **on the ungrouped area** = `targetGroupId: null` (a dashed dropzone appears while dragging when no other ungrouped tab exists).
- The webview posts `moveTabInNavigation { tabId, targetGroupId, targetIndex }` where `targetIndex` is counted **with the dragged tab removed** from the target list. Folder headers themselves are not draggable in v1.
- `TabManager.moveTabInNavigation()` validates folder existence + finite index against current truth; invalid/stale requests mutate nothing and re-broadcast. The pure planner (`src/extension/session/tabOrdering.ts`, `planMoveTabInNavigation`) clamps the index and renumbers BOTH affected sibling lists contiguously. Unit tests: `tests/tabs/navigationOrder.test.ts`, `tests/tabs/navTree.test.ts` (`npm run test:tabs`).

## Files

- `src/extension/session/TabGroupStore.ts` — Memento-backed CRUD (`createGroup`, `renameGroup`, `setGroupColor`, `moveGroup`, `deleteGroup`, `reorderWithinParent`) plus an `onDidChange` event. Move validates against cycles by walking the proposed parent chain.
- `src/extension/session/TabManager.ts` — Tracks per-tab slot color, exposes `listTabs()` / `moveTabToGroup()` / `getTabGroup()` / `focusTab()`, and re-skins native tab icons when a tab joins/leaves a folder via each tab's `applyTabColor(color)` method.
- `src/extension/views/TabGroupsTreeProvider.ts` — `vscode.TreeDataProvider<TabGroupTreeNode>` rendering the nested groups + tab leaves. Tab leaves carry a Markdown tooltip (see `SESSION_SUMMARY.md`) and a `claudeMirror.tabs.focus` command.
- `src/extension/commands/tabGroupCommands.ts` — Command handlers for create/rename/recolor/delete/move/remove. All accept a `TabGroupTreeNode` from the right-click menu **or** fall back to a QuickPick when launched from the Command Palette.

## Commands

| Command | Purpose |
|---------|---------|
| `claudeMirror.groups.create` | Create a top-level folder. View-title `+` button. |
| `claudeMirror.groups.createSubfolder` | Create a sub-folder inside an existing one. |
| `claudeMirror.groups.rename` | Rename a folder. |
| `claudeMirror.groups.changeColor` | Pick a new color from the preset palette. |
| `claudeMirror.groups.delete` | Delete a folder. Three-way QuickPick: cascade-close all tabs / reparent tabs to grandparent / cancel. |
| `claudeMirror.tabs.moveToGroup` | Move a tab into a folder (or to top level). |
| `claudeMirror.tabs.removeFromGroup` | Lift a tab back to top level. |
| `claudeMirror.tabs.moveInNavigation` | Internal: group-aware move from the rail (`tabId`, `targetGroupId\|null`, `targetIndex`). |
| `claudeMirror.groups.setCollapsed` | Internal: persist a folder's rail collapse state. |
| `claudeMirror.tabs.focus` | Internal: invoked when the user clicks a tab leaf in the tree. |

Right-click menus (`view/item/context`) are filtered with `viewItem == tabGroup` / `viewItem == tabLeaf`.

## Native Tab Icon Color

Each `SessionTab` / `CodexSessionTab` has both a slot color (assigned at creation, cycled through `TAB_COLORS`) and an effective color (group color when assigned, else slot). `TabManager.applyEffectiveTabIcon(tabId)` re-runs the SVG circle generation whenever:

- A tab moves into or out of a folder.
- A folder's color is changed (the `TabGroupStore.onDidChange` listener fans out a refresh to every assigned tab).
- A tab is restored from the snapshot.

## Restore Behavior

`TabManager.restoreFromSnapshot()` rebuilds `snapshotEntries` after the restore loop and copies `groupId` / `orderInGroup` from the **original** snapshot entry by sessionId, so folder assignments survive workspace close/open. Group records themselves persist independently in `workspaceState`.

## Risks Mitigated

- **Cycle in re-parenting** — `TabGroupStore.moveGroup` walks the proposed parent chain before mutating; throws on cycle.
- **Cascade-delete data loss** — Delete always asks the user; default is cascade only when explicitly chosen.
- **Tree-state drift** — Both `TabManager.onTreeStateChanged` (tabs) and `TabGroupStore.onDidChange` (groups) fan out into a single tree refresh.
