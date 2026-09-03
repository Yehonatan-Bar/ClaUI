# Project History Tree

## Purpose

A persistent, collapsible sidebar view that lists **all** conversation history on disk for the currently open project, grouped into collapsible date buckets. It replaces the transient two-step QuickPick (`claudeMirror.showHistory`) as the convenient way to browse and resume past conversations without a picker that vanishes on focus loss.

## Key Files

| File | Path |
|------|------|
| ProjectHistoryTreeProvider.ts | `src/extension/views/ProjectHistoryTreeProvider.ts` |
| Wiring (view + view-instance commands) | `src/extension/extension.ts` |
| Resume/fork commands | `src/extension/commands.ts` |
| Data source | `src/extension/session/SessionDiscovery.ts` |

## View

Registered as the `claudeMirror.projectHistory` TreeView in the `claui` Activity Bar container, below the `claudeMirror.sessionsTree` (open tabs) view. Named "History". Created with `showCollapseAll: true`.

The view `description` reflects the active scope: "This project" or "All projects".

## Tree Structure

`ProjectHistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeNode>`, a tagged union:

- `{ kind: 'group'; bucket }` - a collapsible date bucket
- `{ kind: 'session'; session }` - a single conversation leaf
- `{ kind: 'empty'; message }` - shown when no history exists

### Date buckets

Sessions (sorted newest-first by `mtime`) are split by recency, dropping empty buckets:

| Bucket | Range | Default state |
|--------|-------|---------------|
| Today | since local midnight | Expanded |
| Yesterday | previous calendar day | Expanded |
| Last 7 Days | within 7 days | Collapsed |
| Last 30 Days | within 30 days | Collapsed |
| Older | everything else | Collapsed |

### Session leaf

- **Label**: ClaUi session name (from `SessionStore`) -> first prompt -> `Session <id8>` fallback
- **Description**: relative time + file size
- **Tooltip**: markdown with session id, updated time, size, project (all-projects scope only), and the AI summary or first prompt
- **Click** (`item.command`): `claudeMirror.history.resume` with `arguments: [sessionId, provider]`
- **contextValue**: `historySession` (drives the right-click menu)

## Data Flow

`buildRoot()` picks the scope (forced to `all` when no workspace is open), calls `SessionDiscovery.discoverForWorkspace(path)` or `discoverAll()`, enriches each `DiscoveredSession` with `name`/`summary`/`provider` from `SessionStore.getSession()`, then buckets the result. Discovery runs lazily whenever VS Code requests children of a visible view, so the disk scan is only paid when the History view is on screen.

## Commands & Menus

| Command | Where | Action |
|---------|-------|--------|
| `claudeMirror.history.resume` | leaf click + context menu | Resume in a new tab (applies the session's Claude account profile) |
| `claudeMirror.history.fork` | context menu | Resume a fork (`startSession({ resume, fork: true })`), original untouched |
| `claudeMirror.history.revealFile` | context menu | `revealFileInOS` on the `.jsonl` file |
| `claudeMirror.history.delete` | context menu | Modal-confirmed permanent delete of the `.jsonl` file + `SessionStore` entry |
| `claudeMirror.history.refresh` | view title | Force re-scan |
| `claudeMirror.history.toggleScope` | view title | Toggle project / all-projects scope |

`resume`/`fork` live in `registerCommands` (commands.ts) so they can reuse `profileForSession`/`applyProfileToTab`. They accept either `(sessionId, provider)` from a leaf click or the tree node from a context-menu invocation, normalized by `resolveHistorySessionRef`. The view-instance commands (refresh/toggleScope/revealFile/delete) are registered in `extension.ts` where the provider instance and `SessionStore` are in scope; they read the node via the static `ProjectHistoryTreeProvider.sessionRefFromNode` / `filePathFromNode` helpers.

## Auto-Refresh

- A `FileSystemWatcher` on `~/.claude/projects/**/*.jsonl` (base = `provider.projectsDir`) fires create/change/delete into a 500ms debounced `refresh()`.
- `tabManager.onTreeStateChanged` also triggers the debounced refresh (session started/ended inside ClaUi).

## Edge Cases

- No workspace open: scope is forced to `all`.
- Missing `~/.claude/projects/`: `SessionDiscovery` returns empty -> the `empty` node is shown.
- Disk sessions are treated as `claude` provider unless `SessionStore` records otherwise.
- Delete is irreversible and requires a modal confirmation.

## Interaction with Other Components

- **SessionDiscovery** - supplies the on-disk session list (`DiscoveredSession` is exported for this view).
- **SessionStore** - supplies friendly name / summary / provider and is updated on delete.
- **TabManager / SessionTab** - `createTabForProvider` + `startSession` perform the resume/fork.
- Complements the transient `claudeMirror.showHistory` QuickPick and the open-tabs `claudeMirror.sessionsTree`.
