# Tab Layout (Horizontal / Vertical)

Controls how open ClaUi tabs are navigated.

- **Horizontal** (default): all ClaUi tabs are collapsed into one editor group and use VS Code's native top tab strip. Folder membership shows only as icon color + optional title prefix (platform limit — no headers possible in the native strip).
- **Vertical**: all ClaUi tabs stay in one full-height editor group, and the active webview renders a left-side vertical tab rail for navigation. VS Code's native horizontal tabs are hidden automatically. The rail groups tabs under collapsible folder headers (see `TAB_GROUPS.md` for the full grouped-rail + drag-and-drop spec) and shows even with a single open tab when folders exist.
- The toggle does not open, close, or switch the VS Code sidebar.

Setting: `claudeMirror.tabs.layout` (`horizontal` | `vertical`), **per-window**: all toggles funnel through the `claudeMirror.tabs.setLayout` command, which writes the **workspace scope** (falling back to global only in empty windows with no workspace settings). Switching to vertical in one VS Code window does not affect other windows. A one-time migration in `TabManager` lifts leftover global values (layout + `workbench.editor.showTabs: none`) written by older builds into the current window's workspace scope and clears the global slots.

## Entry Points

- **In-tab View dropdown** - bottom toolbar -> View -> "Tab layout" segmented control (Horizontal | Vertical). Lives in `StatusBar.tsx` `viewItems`. Available on Claude, Happy, and Codex tabs.
- **Sessions title-bar gear** - `claudeMirror.tabs.openLayoutMenu` command shows a QuickPick.
- **Settings UI** - search `claudeMirror.tabs.layout`.

All three entry points write the same config key. `TabManager` listens for that setting and reflows existing tabs through `applyTabLayout()`.

## Files

- `src/extension/session/TabManager.ts`
  - `getTabLayout()` reads the setting.
  - `resolveViewColumnForNewTab()` chooses the initial column for a new panel.
  - `maybeApplyVerticalLayoutAfterCreate()` collapses stale editor splits and refreshes the vertical tab rail after a new tab is created.
  - `applyTabLayout(mode)` routes horizontal vs vertical behavior and calls `syncNativeTabVisibility()`.
  - `syncNativeTabVisibility(mode)` hides VS Code's native editor tabs (`workbench.editor.showTabs` -> `'none'`, **workspace scope — this window only**) when entering vertical mode and restores the previous workspace-level value (usually unset) when switching back to horizontal. Saved/restored on extension shutdown; a leftover workspace `'none'` found while capturing is treated as ours (crash remnant) and restored to unset.
  - `migratePerWindowLayoutSettings()` runs once at construction: lifts legacy global layout / hidden-tabs values into this window's workspace scope, clears the globals, and removes a stale workspace `showTabs: 'none'` when the window is horizontal.
  - `joinAllEditorGroups()` normalizes stale split/row layouts with `workbench.action.joinAllGroups` before refreshing either layout.
  - `broadcastTabsState()` sends the open tab list and active tab id to every webview as `tabList`.
  - `restoreFromSnapshot()` recreates tabs in one column first, then applies the selected layout after restore.
- `src/extension/commands/tabGroupCommands.ts` - `claudeMirror.tabs.openLayoutMenu` QuickPick plus `claudeMirror.tabs.refreshList` (internal command, not in package.json contributes), `claudeMirror.tabs.close`, and `claudeMirror.tabs.reorder` commands.
- `src/extension/webview/MessageHandler.ts` + `CodexMessageHandler.ts` + `MultiParticipantSessionTab.ts`
  - `setTabLayout` message routes to the `claudeMirror.tabs.setLayout` command (workspace-scope write for this window).
  - `sendTabLayoutSetting()` pushes the current effective value to the webview as `tabLayoutSetting`; called on init and config changes.
- `src/webview/App.tsx`
  - `VerticalTabRail` renders the left-side in-webview tab navigator when vertical mode is active and there is more than one tab OR any folder exists. Includes a draggable resize handle on the right edge (80px-300px, double-click to reset). Tabs render grouped under collapsible folder headers (built by `src/webview/tabNav.ts`); ungrouped tabs list first without a header. Tab drag-and-drop posts `moveTabInNavigation` (target folder + index); header click posts `setGroupCollapsed`; the "+ Folder" button posts `createTabGroup`. The provider letter (C/X/H) becomes a red close button on hover.
  - The `App` component wraps all tab kinds (chat, search, multiparticipant) with `wrapWithRail()`, so the vertical rail appears regardless of which tab kind is active.
- `src/webview/tabNav.ts` - pure `buildTabNavTree()` (hardened against duplicate/orphan/cyclic folder records; unit-tested in `tests/tabs/navTree.test.ts`).
- `src/webview/state/store.ts` - `tabLayout`, `verticalTabRailWidth`, `openTabs`, `activeTabId`, `tabGroups`, `collapsedGroupIds`, `setTabLayout()`, `setVerticalTabRailWidth()`, and `setOpenTabs()` (now also carries groups + collapse state).
- `src/webview/hooks/useClaudeStream.ts` - handles inbound `tabLayoutSetting` and `tabList` (tabs + groups + collapsedGroupIds); sends `requestTabList` on webview ready.
- `src/webview/components/StatusBar/StatusBar.tsx` - `viewItems` segmented control. Posts `setTabLayout` and optimistically updates the store.
- `src/webview/styles/global.css` - `.app-vertical-rail-wrapper` provides the outer flex container; `.vertical-tab-resize-handle` styles the drag handle.

## Behavior Notes

- Vertical mode intentionally avoids `vscode.setEditorLayout`; stacked editor rows make chat panes too short.
- Vertical mode hides VS Code's native horizontal tab strip via `workbench.editor.showTabs = 'none'`. The original value is saved and restored when switching back to horizontal or on extension shutdown.
- **Opening a file stays vertical, with the rail visible.** The rail renders inside the active ClaUi webview, so a file opened into the panels' editor group would cover it. The `onDidChangeActiveTextEditor` listener therefore (1) keeps the native tab strip hidden, and (2) when the focused text editor shares the ClaUi panels' view column (`getPanelsViewColumn()`), moves it to a side editor group via `workbench.action.moveEditorToRightGroup` — file and vertical rail show side by side. Closing the file collapses the empty side group automatically. To get native file tabs back, switch the layout to horizontal (View menu or Sessions gear).
- **Open documents are first-class rail rows.** With the native strip hidden, open documents have no close button — so the rail lists them as regular tab rows (same style as session tabs, gray accent border, "F" badge that turns into the red close X on hover), rendered right after the ungrouped session tabs. `TabManager.listOpenDocuments()` enumerates `vscode.window.tabGroups` (text, diff, notebook, custom inputs; ClaUi webviews excluded) into the `tabList` broadcast as `openDocuments`; `onDidChangeTabs`/`onDidChangeTabGroups` re-broadcast on every open/close/dirty change. Click posts `focusDocument` (routes to `claudeMirror.docs.focus` -> `vscode.open` in the document's own column); the X posts `closeDocument` (routes to `claudeMirror.docs.close` -> `vscode.window.tabGroups.close`). Dirty documents show a `*` prefix. Open documents also count toward showing the rail (so a single session tab + one file still gets a rail). Documents are not draggable into folders. Keyboard `Ctrl+W` still closes the active editor as usual.
- The vertical rail width is resizable by dragging the handle on its right edge. Double-click resets to the CSS default (`clamp(96px, 28vw, 132px)`). Width is stored in Zustand state (`verticalTabRailWidth`) and applied as a CSS variable override.
- Clicking an item in the vertical rail posts `focusTab`, which routes through the existing `claudeMirror.tabs.focus` command.
- Hovering over the provider letter (C/X/H) on a tab item turns it into a red X close button. Clicking it sends `closeTab` -> `claudeMirror.tabs.close`.
- Tabs can be reordered by dragging them up/down. A blue drop indicator shows the target position. On drop, `reorderTabs` -> `claudeMirror.tabs.reorder` updates `orderInGroup` on each snapshot entry and persists the new order.
- Both layouts collapse stale editor splits into one editor group so old row layouts are repaired when the user toggles again.
- Horizontal mode no longer calls `workbench.action.closeSidebar`; Explorer/sidebar state is left alone.

## Why a Webview Toggle on Top of the Existing Setting

The Sessions title-bar gear and the Settings UI both require leaving the active chat panel. Putting the toggle inside the View dropdown makes layout switching available in-context; the config listener in `TabManager` keeps behavior identical regardless of which entry point changed the setting.
