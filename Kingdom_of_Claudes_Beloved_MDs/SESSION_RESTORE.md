# Session Restore on VS Code Startup

## What this component does

When the user closes VS Code with open ClaUi tabs (Claude, Codex, or Happy/remote), the extension can automatically reopen and resume those same tabs the next time the workspace is opened. Each restored tab reconnects to its original CLI session using the persistent `session_id` (Claude / remote) or `threadId` (Codex) captured during the original run, so transcripts, context, and tab names are preserved.

The feature is gated by the setting `claudeMirror.restoreSessionsOnStartup` (default `true`). It is a per-workspace feature: each VS Code window restores only the tabs that belonged to its own workspace.

The toggle is surfaced in two places:
1. **VS Code Settings editor** — `File → Preferences → Settings` → search `restoreSessionsOnStartup`
2. **In-app gear panel** — click the ⚙ cog in the StatusBar at the bottom of any chat tab → row labeled "Restore Last Sessions"

Both paths read and write the same global setting; flipping one updates the other immediately via the `onDidChangeConfiguration` watcher.

## Key files

| File | Purpose |
|------|---------|
| `src/extension/session/OpenTabsSnapshot.ts` | `OpenTabsSnapshotStore` — reads/writes the snapshot to `workspaceState` |
| `src/extension/session/TabManager.ts` | Debounced snapshot persistence + `restoreFromSnapshot()` |
| `src/extension/session/SessionTab.ts` | Fires `onSessionIdAssigned` and `onNameChanged` hooks into TabManager |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | In-app "Restore Last Sessions" toggle row |
| `src/webview/state/store.ts` | `restoreSessionsEnabled` state mirror |
| `src/webview/hooks/useClaudeStream.ts` | Receives `restoreSessionsSetting` hydration + config-change updates |
| `src/extension/webview/MessageHandler.ts` | `setRestoreSessionsEnabled` handler; `sendRestoreSessionsSetting()` |
| `src/extension/session/CodexSessionTab.ts` | Same hooks for Codex tabs (uses `threadId` as the session id) |
| `src/extension/extension.ts` | Calls `tabManager.restoreFromSnapshot()` during `activate()` |
| `package.json` | Declares `claudeMirror.restoreSessionsOnStartup` |

## Data shape (stored in `workspaceState` under key `claudeMirror.openTabsSnapshot`)

```ts
interface OpenTabSnapshotEntry {
  tabNumber: number;
  provider: 'claude' | 'codex' | 'remote';
  sessionId: string;            // required; Claude session_id or Codex threadId
  customName?: string;          // if the tab was auto-named or renamed
  cliPathOverride?: string;     // set for remote (Happy) tabs
  workspacePath?: string;       // used to filter cross-workspace leaks
  savedAt: string;              // ISO
}

interface OpenTabsSnapshot {
  version: 1;
  entries: OpenTabSnapshotEntry[];
  activeSessionId?: string;     // the tab that was focused at save time
}
```

## Flow

### Writing the snapshot (during normal use)

1. `TabManager.createClaudeTab` / `createCodexTab` / `createRemoteTab` seed a fresh entry keyed by `tabId` via `seedSnapshotEntry(tab)`.
2. When the CLI emits the initial system event, `SessionTab` fires `callbacks.onSessionIdAssigned(tabId, sessionId)`. `TabManager.handleSessionIdAssigned` writes the id into the entry.
3. When the tab name changes (auto-name from Haiku, user rename, restored name from SessionStore), `setTabName` fires `callbacks.onNameChanged(tabId, name)`. Default placeholder names (`ClaUi N`, `Codex N`, `Session N`) are skipped.
4. On every write, focus, or close, `schedulePersistSnapshot()` runs a 500 ms debounce before flushing to `workspaceState`. Debouncing lets bursty edits coalesce while still surviving crashes better than a deactivate-only write.
5. `closeAllTabs()` (called from `deactivate`) sets a `isShuttingDown` guard, cancels the debounce timer, captures the final snapshot **before** disposing tabs, then `await`s the Memento write. The guard prevents `panel.onDidDispose → onClosed → handleTabClosed` from mutating `snapshotEntries` (or scheduling a new write) once shutdown is in progress, so the captured-and-saved snapshot cannot be wiped to `[]` by the disposal cascade. `deactivate` itself is `async` and returns the promise, so VS Code holds the extension host alive until the disk write lands.

### Restoring on startup

`TabManager.restoreFromSnapshot()` is invoked from `extension.ts` `activate()` only when the setting is `true`. It runs after `cleanupOrphanedProcesses(log)` so it can reclaim any CLI ports or locks the previous session held.

1. Read the snapshot from `workspaceState`.
2. Filter entries: drop those without a `sessionId`, drop those whose `workspacePath` does not match the current workspace, de-duplicate by `sessionId`.
3. Sort by the original `tabNumber` (colors cycle mod the palette, so ordering preserves the visual layout).
4. Truncate to `MAX_RESTORE = 10` tabs; show an information toast if truncated.
5. **Crash-loop check**: if the workspace flag `claudeMirror.restoreInProgress` is still `true` from a previous launch, the previous restore did not complete cleanly. The flag is cleared, auto-restore is skipped, and the user is shown a warning toast with a `Restore now` button that re-invokes `restoreFromSnapshot({ force: true })`.
6. Set `restoreInProgress = true` for the duration of the loop (cleared in `finally`).
7. Inside `vscode.window.withProgress`, restore each entry **serially**:
   - `tabManager.createTabForProvider(entry.provider, restoreColumn)` creates the tab. `restoreColumn` is `undefined` for the first iteration; after the first tab is created, its actual `panel.viewColumn` (or `ViewColumn.Two` if not yet resolved) is captured and reused for every subsequent restore so all panels stack into a single editor column. Without this pin, each `Beside` call would treat the just-created panel as the active editor and split into a new column, scattering the restored tabs across the editor area.
   - For `remote`, the live `claudeMirror.happy.cliPath` setting wins over the snapshot value in case the CLI moved; snapshot value is the fallback.
   - **If the entry matches `snapshot.activeSessionId`** → `await tab.startSession({ resume: entry.sessionId })` (eager spawn so the user lands on a working session).
   - **Otherwise** → `tab.prepareForLazyResume(entry.sessionId)` (lazy: panel is created, tab name is restored, `sessionId` is seeded into the process manager, but the CLI process is **not** spawned). The tab is added to a `lazyTabs` collection.
   - Per-tab failures are caught, logged, and counted but do not abort the batch.
8. If `snapshot.activeSessionId` maps to a restored tab, call `tab.reveal()` to re-focus it.
9. After reveal, schedule `armLazyWake()` on every lazy tab via `setTimeout(0)` so any view-state-active events caused by panel creation and reveal have already flushed before user-driven focus is allowed to wake a lazy tab.
10. Show a warning toast if any entries failed (stale JSONL, session deleted, etc.).

### Lazy resume (per non-active tab)

`SessionTab.prepareForLazyResume(sessionId)` and `CodexSessionTab.prepareForLazyResume(sessionId)`:
- Set `pendingResumeSessionId = sessionId`, `lazyWakeArmed = false`.
- Seed the underlying process manager / `threadId` so `tab.sessionId` returns the correct id even before the CLI spawns (this keeps snapshot persistence accurate).
- Call the existing `restoreSessionName(sessionId)` so the tab title shows the right name immediately.
- Do **not** spawn the CLI process or load conversation history.

`armLazyWake()` flips `lazyWakeArmed = true` if a pending sessionId is set. It is called once by `TabManager.restoreFromSnapshot` after the restore loop and active-tab reveal have completed.

The existing `panel.onDidChangeViewState` handler in both tab classes checks `lazyWakeArmed && pendingResumeSessionId` before calling `startSession({ resume })`. Both flags are cleared synchronously before the await so re-entrant view-state events cannot double-trigger.

### Crash-loop breaker (per launch)

`OpenTabsSnapshotStore.isRestoreInProgress()` and `setRestoreInProgress(value)` read/write the `claudeMirror.restoreInProgress` Memento key in `workspaceState`. The flag is sticky — written before the restore loop and cleared in the `finally`. If activation finds it still set, it means the previous extension host died mid-restore, so auto-restore is skipped this launch and the user is offered a one-click recovery via the warning toast's `Restore now` button.

### Interaction with first-install auto-open

`activate()` decides whether to run the first-install auto-open (`claui.hasLaunched` flag) based on the count returned from `restoreFromSnapshot()`:

- If `restoreEnabled === false` → behaves exactly as before (first-install auto-open fires if `hasLaunched` is false).
- If `restoreEnabled === true` and restoration returns `> 0` tabs → first-install auto-open is skipped.
- If `restoreEnabled === true` and restoration returns `0` tabs (empty snapshot) → first-install auto-open still fires if `hasLaunched` is false.

This prevents double-opening on first install while letting the feature "just work" for returning users.

## Edge cases

| Case | Behavior |
|------|----------|
| Workspace changed since save | Entries with a mismatched `workspacePath` are filtered out |
| Session JSONL deleted from disk | `--resume` errors → caught per-entry; summary toast reports `restored X of Y` |
| More than 10 tabs were open | Hard cap; oldest (lowest `tabNumber`) entries are restored; info toast |
| Duplicate sessionIds | De-duped before spawning |
| Remote (Happy) CLI path changed | Live setting wins over the snapshot value |
| VS Code crash (no graceful shutdown) | Debounced writes already captured recent state |
| Restoration itself errors | `restoreFromSnapshot` is wrapped; first-install check still runs |

## Hooks added to tab classes

`SessionTabCallbacks` in `src/extension/session/SessionTab.ts` gains two optional callbacks:

```ts
onSessionIdAssigned?: (tabId: string, sessionId: string) => void;
onNameChanged?: (tabId: string, name: string) => void;
```

- Fired in `SessionTab.wireDemuxSessionStore` after the `system/init` event assigns `sessionId`.
- Fired in `CodexSessionTab.wireDemuxSessionState` after `threadStarted` assigns `threadId`.
- Fired in both classes' `setTabName` whenever the display name updates.

The callbacks are optional so existing consumers of `SessionTabCallbacks` (outside of `TabManager`) keep working unchanged.

## Diagnostics

`DiagnosticsCollector.ts` includes `restoreSessionsOnStartup` in the `ClaUi Settings` section so bug reports show whether the feature is enabled.

## Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `SNAPSHOT_DEBOUNCE_MS` | 500 | How long tab changes coalesce before writing the snapshot |
| `MAX_RESTORE` | 10 | Hard cap on tabs restored per startup |
| `STORAGE_KEY` | `claudeMirror.openTabsSnapshot` | `workspaceState` Memento key for the snapshot |
| `RESTORE_IN_PROGRESS_KEY` | `claudeMirror.restoreInProgress` | `workspaceState` Memento key for the crash-loop breaker flag |
