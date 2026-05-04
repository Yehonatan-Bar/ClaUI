# Tab Layout (Horizontal / Vertical)

Controls how open ClaUi tabs are navigated.

- **Horizontal** (default): all ClaUi tabs are collapsed into one editor group and use VS Code's native top tab strip.
- **Vertical**: all ClaUi tabs stay in one full-height editor group, and the active webview renders a left-side vertical tab rail for navigation.
- The toggle does not open, close, or switch the VS Code sidebar.

Setting: `claudeMirror.tabs.layout` (`horizontal` | `vertical`, global).

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
  - `applyTabLayout(mode)` routes horizontal vs vertical behavior.
  - `joinAllEditorGroups()` normalizes stale split/row layouts with `workbench.action.joinAllGroups` before refreshing either layout.
  - `broadcastTabsState()` sends the open tab list and active tab id to every webview as `tabList`.
  - `restoreFromSnapshot()` recreates tabs in one column first, then applies the selected layout after restore.
- `src/extension/commands/tabGroupCommands.ts` - `claudeMirror.tabs.openLayoutMenu` QuickPick plus `claudeMirror.tabs.refreshList` for webview tab-list refresh requests.
- `src/extension/webview/MessageHandler.ts` + `CodexMessageHandler.ts`
  - `setTabLayout` message writes the config key (`ConfigurationTarget.Global`).
  - `sendTabLayoutSetting()` pushes the current value to the webview as `tabLayoutSetting`; called on init and config changes.
- `src/webview/App.tsx` - `VerticalTabRail` renders the left-side in-webview tab navigator when vertical mode is active and more than one tab is open.
- `src/webview/state/store.ts` - `tabLayout`, `openTabs`, `activeTabId`, `setTabLayout()`, and `setOpenTabs()`.
- `src/webview/hooks/useClaudeStream.ts` - handles inbound `tabLayoutSetting` and `tabList`; sends `requestTabList` on webview ready.
- `src/webview/components/StatusBar/StatusBar.tsx` - `viewItems` segmented control. Posts `setTabLayout` and optimistically updates the store.

## Behavior Notes

- Vertical mode intentionally avoids `vscode.setEditorLayout`; stacked editor rows make chat panes too short.
- Clicking an item in the vertical rail posts `focusTab`, which routes through the existing `claudeMirror.tabs.focus` command.
- Both layouts collapse stale editor splits into one editor group so old row layouts are repaired when the user toggles again.
- Horizontal mode no longer calls `workbench.action.closeSidebar`; Explorer/sidebar state is left alone.

## Why a Webview Toggle on Top of the Existing Setting

The Sessions title-bar gear and the Settings UI both require leaving the active chat panel. Putting the toggle inside the View dropdown makes layout switching available in-context; the config listener in `TabManager` keeps behavior identical regardless of which entry point changed the setting.
