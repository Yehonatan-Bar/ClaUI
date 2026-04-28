# Tab Folders & Sub-folders

Sidebar TreeView (`claudeMirror.sessionsTree`) that organizes ClaUi session tabs into nestable folders. VS Code's native editor tab strip cannot be nested, so folders surface in the Activity Bar's **ClaUi** view container alongside the existing sidebar launcher.

## Storage

- **Folders** (`TabGroupStore`) live in `workspaceState` under key `claudeMirror.tabGroups` as an array of `TabGroup` records (`id`, `parentId?`, `label`, `color`, `order`, `createdAt`).
- **Tab membership** rides on the existing `OpenTabSnapshotEntry` via two new optional fields:
  - `groupId?: string` — folder the tab belongs to (`undefined` = top level).
  - `orderInGroup?: number` — sibling order within the folder.

Both stores are scoped per workspace, so folders never bleed between projects.

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
