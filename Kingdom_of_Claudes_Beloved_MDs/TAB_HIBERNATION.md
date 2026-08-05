# Tab Hibernation

Automatically puts long-idle ClaUi tabs to sleep to free CPU and RAM, instead of the user having to close them. **The tab always stays in the tab bar** - hibernation never removes it. Two levels:

| Level | What is freed | What survives | How to wake |
|-------|---------------|---------------|-------------|
| **Light** | The CLI process tree (Claude CLI Node process, typically 150-400MB RSS, plus any MCP server child processes it spawned) | The webview panel, full chat history on screen, all per-tab state | Focus the tab, click the "sleeping" banner, or just type a message |
| **Deep** | Everything light frees, plus the webview content: the React app + chat DOM + store are torn down and replaced by a tiny static placeholder page (the retained webview context shrinks to a few KB) | The tab itself stays in the tab bar with a dimmed "(sleeping)" title; the session id is preserved | Click the tab (or the placeholder page). The real app is rebuilt and the session resumes with full history reload |

Waking either level takes a few seconds (webview rebuild for deep, CLI spawn + `--resume` for both). That latency is expected and acceptable - the tab never disappears.

## Key Files

| File | Role |
|------|------|
| `src/extension/session/hibernation/HibernationPlanner.ts` | Pure eligibility planner (no vscode imports; unit-tested) |
| `src/extension/session/SessionTab.ts` | Light: `hibernate()`, `canHibernate()`, `wakeFromHibernation()`. Deep: `hibernateDeep()`, `wakeFromDeepHibernation()`, `isHibernatedDeep`. Sleeping visuals (dimmed hollow icon + `(sleeping)` title). `postMessage` drops messages while deep (placeholder has no React app) |
| `src/extension/webview/WebviewProvider.ts` | `buildSleepingPlaceholderHtml()` - the static deep-sleep page (click posts `wakeFromDeepHibernation`) |
| `src/extension/session/TabManager.ts` | Sweep timer, `runHibernationSweep()`, `lightHibernateTab()`, `deepHibernateTab()`, activity tracking, `applyEntryConfigToTab()` (shared by restore) |
| `src/extension/session/OpenTabsSnapshot.ts` | `lastActivityAt`, `hibernated`, `hibernatedAt` fields on `OpenTabSnapshotEntry` |
| `src/extension/views/TabGroupsTreeProvider.ts` | Sleeping tabs render as normal tab leaves with a "sleeping" description (they are still live tabs) |
| `src/extension/commands/tabGroupCommands.ts` | `claudeMirror.hibernateTab`, `claudeMirror.hibernateTabDeep` |
| `src/webview/components/InputArea/InputArea.tsx` | Light-sleep banner (click posts `wakeFromHibernation`) |
| `src/webview/App.tsx` | Vertical rail: dimmed `zZ` indicator on sleeping tabs (`sleepState`) |
| `tests/hibernation/hibernationPlanner.test.ts` | Planner unit tests (`npm run test:hibernation`) |

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `claudeMirror.hibernation.enabled` | `true` | Master switch for the automatic sweep |
| `claudeMirror.hibernation.idleHours` | `12` | Idle hours before light hibernation |
| `claudeMirror.hibernation.deepIdleHours` | `24` | Idle hours before deep hibernation; `0` disables deep. Effective threshold is never below `idleHours` |

Config is re-read on every sweep, so changes apply without a reload.

## Idle Clock

`OpenTabSnapshotEntry.lastActivityAt` is updated on tab focus (`handleTabFocused`) and on every busy-state change (`onBusyStateChanged` callback -> `touchTabActivity`). Fallback order when reading: `lastActivityAt` -> `lastFocusedAt` -> `savedAt` -> "now". The value is persisted in the workspace snapshot, so the idle clock survives window reloads.

## Sweep

`TabManager` runs `runHibernationSweep()` every 10 minutes (first run 2 minutes after activation). Each run builds a `HibernationCandidate` per live tab and delegates the decision to the pure `planHibernation()`:

- Skipped always: busy tabs, visible panels, tabs without a session id, tabs with background work (review loop, merge assistant, btw session, turn capture, in-flight resume), multi-participant tabs.
- **Light** (`claude`-kind only, i.e. `SessionTab` incl. Happy/bridge): CLI running, not already sleeping, idle past `idleHours`.
- **Deep** (`claude`-kind only): idle past `deepIdleHours`, not already deep-sleeping. Applies to awake and light-sleeping tabs alike (a tab light-hibernated at 12h is upgraded to deep at 24h). Codex and Search tabs never deep-hibernate (Codex spawns per-turn processes; Search tabs re-spawn fresh).

## Light Hibernation Mechanics

`SessionTab.hibernate()`:
1. Saves project analytics (the `analyticsSaved` guard resets on the next `system/init`, so post-wake turns still save).
2. Sets `suppressNextExit` and calls `processManager.stop()` (Windows: `taskkill /F /T` kills the whole tree including MCP servers).
3. Re-enters the armed silent-resume state (`silentResumeArmedFlag` + `pendingResumeSessionId` + re-seeded session id), so a typed message is deferred through the existing crash-resume pipeline (`MessageHandler` -> `enqueueSilentResume`).
4. Posts `hibernationState {hibernated:true}` (webview banner) and applies sleeping visuals.

Waking (`wakeFromHibernation`, triggered by focus / banner click / deferred message) mirrors `restartWithCurrentSession()`: `processManager.start({resume, skipReplay:true, ...})` + `seedSessionId`. `start()` resolving counts as success - no init handshake, no crash timers - because the webview history is intact. Deferred messages are flushed after the spawn; a spawn failure escalates through `escalateToVisibleCrash('spawn-error')`, which restores queued text to the input.

`beginSilentResume()` routes to `wakeFromHibernation` when the light flag is set, so all wake paths converge. `startSession()`, `restartWithCurrentSession()` and the review-loop resume branch call `clearHibernationMarkers()` so a parallel lifecycle path never leaves stale sleeping state.

## Deep Hibernation Mechanics

`SessionTab.hibernateDeep({ armWake })`:
1. If the CLI is running, runs the light phase first (`hibernate()` - stop process, arm resume, sleeping visuals).
2. Resolves the resume session id (`pendingResumeSessionId ?? currentSessionId ?? lastKnownSessionId`).
3. Sets `deepHibernatedFlag`, resets `isWebviewReady`/`pendingMessages`, and replaces `panel.webview.html` with `buildSleepingPlaceholderHtml(name)` - a tiny static page (its own CSP, one inline click handler). This tears down the React app, chat DOM and Zustand store; the retained Chromium context shrinks to a few KB. **The tab stays in the tab bar.**
4. `armWake` gates focus-wake: `true` for sweep/command (immediate), `false` during restore (armed later by `armLazyWake`, so the view-state churn of panel recreation cannot wake it).

While deep-hibernated, `postMessage` drops all messages (the placeholder has no listener; the wake path rebuilds everything from scratch).

`wakeFromDeepHibernation(trigger)` (focus on the tab, or a click on the placeholder page):
1. Clears every sleep flag, resets webview-ready state.
2. Rebuilds the real app: `panel.webview.html = buildWebviewHtml(...)`.
3. Restores normal visuals and calls `startSession({ resume: sid })` - full CLI spawn + conversation history reload, exactly like a boot-time lazy wake. Messages posted before the fresh webview's `ready` queue and flush normally.

## Interaction with Restore-on-Startup

- `buildSnapshot()` mirrors each live tab's `isHibernatedDeep` into `entry.hibernated`, so a window reload knows which tabs to bring back asleep.
- On restore, a `hibernated` entry becomes a live placeholder tab: `prepareForLazyResume(...)` then `hibernateDeep({ armWake:false })`. It sits in the tab bar as a sleeping placeholder (no CLI, no React app) until the user focuses it - even cheaper than a normal lazy-restored tab, which loads the full app up-front.
- Restore truncation (`restoreSessionsMaxTabs`) is unchanged: overflow tabs remain plain `preserved-<sessionId>` entries, reopenable from Conversation History.

## UI Surfaces

- **Native tab (light + deep)**: title gets a `(sleeping)` suffix; the colored circle icon is redrawn as a faded hollow circle (`tab-icon-<n>-sleeping.svg`). The tab never leaves the tab bar. A group recolor while sleeping keeps the dimmed look and applies the new color on wake.
- **Deep placeholder page**: centered "zZ / <session name> / This session is sleeping to save CPU and RAM / Click anywhere to wake". Clicking posts `wakeFromDeepHibernation`.
- **Input area (light only)**: clickable banner "This session is sleeping to save CPU and RAM - click to wake (or just type)".
- **Vertical tab rail**: sleeping tabs are dimmed/italic with a small `zZ` glyph (`sleepState` on `WebviewTabSummary`); clicking focuses the tab, which wakes it.
- **Sessions TreeView**: sleeping tabs are ordinary tab leaves with a "sleeping" description; clicking focuses (and thereby wakes) them.

## Known Limitations

- Hibernation applies only to `SessionTab` (Claude/Happy/bridge). Codex tabs spawn one process per turn, so there is no idle CLI to kill, and deep-sleep's webview swap is Claude-`SessionTab`-only; they are skipped entirely.
- Waking (either level) takes a few seconds (CLI spawn + `--resume`, plus webview rebuild for deep).
