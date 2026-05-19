

# Implementation Plan — Tab Folders/Sub-folders + End-of-Session Summary on Hover

## 0. Why these two features ship together

VS Code's native editor-tab strip cannot be nested or carry hover tooltips for `WebviewPanel`s. So:
- **Folders** must surface in a sidebar **TreeView** (`vscode.TreeDataProvider`).
- That same TreeView's `TreeItem.tooltip` is the natural place to show the **session summary on hover**.

Shipping them together avoids building a hover surface twice.

---

## Phase A — Tab Folders / Sub-folders

### A1. Data model

```ts
interface TabGroup {
  id: string;            // 'group-<uuid>'
  parentId?: string;     // null → top-level. Recursion supported (sub-folders).
  label: string;
  color: string;         // hex
  order: number;         // sibling order within parentId
  createdAt: number;
}
```

Storage: `workspaceState` key `claudeMirror.tabGroups`. Extend `OpenTabSnapshotEntry` (`OpenTabsSnapshot.ts:4`) with `groupId?: string` and `orderInGroup?: number`. No migration needed — existing entries appear ungrouped.

### A2. New file — `src/extension/session/TabGroupStore.ts`

Memento-backed CRUD with `onDidChange` event. API:
- `listGroups()`, `getTree()` (render-ready)
- `createGroup({label, parentId?, color?})`, `renameGroup`, `setGroupColor`
- `moveGroup(id, parentId | null)` — validates against cycles
- `deleteGroup(id, mode: 'cascade' | 'reparent')` — cascade closes tabs in the folder; reparent moves children to grandparent
- `reorderWithinParent(parentId | null, orderedIds[])`
- `assignTabToGroup(tabId, groupId | null, orderInGroup?)`

### A3. `TabManager` integration (`TabManager.ts`)

- Inject `TabGroupStore`.
- `createTab(...)` accepts optional `groupId`.
- New: `moveTabToGroup(tabId, groupId | null)`, `getTabGroup(tabId)`.
- `seedSnapshotEntry` / `handleNameChanged` forward `groupId/orderInGroup` to the snapshot.
- Combined `onTreeStateChanged` event the TreeView listens to.

### A4. New file — `src/extension/views/TabGroupsTreeProvider.ts`

Implements `vscode.TreeDataProvider<TreeNode>` (DnD via `TreeDragAndDropController` in a follow-up).

`TreeNode` is a tagged union: `{kind: 'group', group}` (children = sub-groups + tabs) or `{kind: 'tab', tabId}`.

`getTreeItem` sets `iconPath` (folder icon w/ group color, chat icon w/ slot color), `command` (focus the panel for tab leaves), `tooltip` (Phase B's session summary), and `contextValue` (`'tabGroup'` or `'tabLeaf'`) for menu `when` clauses.

### A5. `extension.ts` wiring

- Construct `TabGroupStore`, pass into `TabManager`.
- `vscode.window.createTreeView('claudeMirror.sessionsTree', { treeDataProvider })`.
- Forward `onTreeStateChanged` → `treeProvider._onDidChangeTreeData.fire()`.

### A6. `package.json` contributions

```jsonc
"viewsContainers": { "activitybar": [{
  "id": "claudeMirrorSessions", "title": "ClaUi Sessions", "icon": "media/sessions.svg"
}] },
"views": { "claudeMirrorSessions": [{
  "id": "claudeMirror.sessionsTree", "name": "Sessions"
}] },
"commands": [
  { "command": "claudeMirror.groups.create",          "title": "ClaUi: New Folder" },
  { "command": "claudeMirror.groups.createSubfolder", "title": "ClaUi: New Sub-folder" },
  { "command": "claudeMirror.groups.rename",          "title": "ClaUi: Rename Folder" },
  { "command": "claudeMirror.groups.changeColor",     "title": "ClaUi: Change Folder Color" },
  { "command": "claudeMirror.groups.delete",          "title": "ClaUi: Delete Folder" },
  { "command": "claudeMirror.tabs.moveToGroup",       "title": "ClaUi: Move Tab to Folder" },
  { "command": "claudeMirror.tabs.removeFromGroup",   "title": "ClaUi: Remove Tab from Folder" }
]
```

`Delete Folder` opens a quick-pick: **Close all tabs inside / Move tabs to parent / Cancel**.

### A7. Visual indicator on native tabs (Option B — secondary)

When a tab has a `groupId`, regenerate its tab icon via the existing `SessionTab.setTabIcon` (lines 936–947) using the **group's color** instead of the slot color. Optional title prefix `▌` gated by setting `claudeMirror.tabs.indicateGroupOnTitle` (default `false`).

### A8. Persistence + restore

`OpenTabsSnapshotStore` already debounces writes; `groupId/orderInGroup` ride along. `TabGroupStore` writes are similarly debounced. `TabManager.restoreFromSnapshot` reads both — restored tabs slot back into their folders.

---

## Phase B — End-of-Session Summary on Hover

### B1. Schema additions — `SessionStore.ts`

Add to `SessionMetadata`: `summary?: string`, `summaryGeneratedAt?: number`, `summaryProvider?: 'haiku' | 'codex'`. (`globalState` key `claudeMirror.sessionHistory`, capped at 100 — already in place.)

### B2. New file — `src/extension/session/SessionSummarizer.ts`

Reuses the proven spawn pattern of `SessionNamer.ts` (Claude `-p` over stdin) and `CodexSessionNamer.ts` (Codex `exec --json`).

```ts
async summarizeSession(args: {
  sessionId: string;
  provider: 'claude' | 'codex';
  cliPath?: string;
}): Promise<{text: string; source: 'haiku' | 'codex'} | null>
```

**Pipeline:**

1. **Build transcript.**
   - Claude: read CLI JSONL at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Extract `{role, text}` from user inputs and final assistant text blocks; skip tool-use noise.
   - Codex: equivalent transcript path used by Codex.
   - Fallback: in-memory message buffer from `MessageHandler` if JSONL not yet flushed.
   - Truncate to ~4000 chars, keeping **first user message + tail of conversation** (most informative for a hover preview).
   - **Skip rule:** fewer than 2 user messages → return `null`.

2. **Prompt template:**
   > "Summarize this session in 1–3 sentences for a hover preview. Focus on the topic and outcome. Match the user's language. Reply with ONLY the summary."
   followed by the truncated transcript.

3. **Primary attempt — Haiku.** Spawn `claude -p --model <claudeMirror.analysisModel>` (default `claude-haiku-4-5-20251001`). **35s** timeout. Sanitize output (same hygiene as `SessionNamer`).

4. **Fallback — Codex low.** On non-zero exit, timeout, or empty stdout, spawn:
   ```
   codex exec --json --sandbox read-only -c model_reasoning_effort=low
   ```
   Stream `codex_event` JSON, take the final assistant message. **45s** timeout.

5. Return `{text, source}` or `null`.

This is exactly the existing primitive the user pointed at — `SessionNamer`'s Haiku spawn is reused; Codex fallback rung is new but already has a sibling pattern in `CodexSessionNamer`.

### B3. Trigger sites

A single helper on `SessionTab` and `CodexSessionTab`:

```ts
private async maybeRunSummarizer(reason: 'completed'|'crashed'|'stopped'): Promise<void>
```

Called fire-and-forget from:
- **`SessionTab.ts:1232–1237`** — successful exit branch
- **`SessionTab.ts:1170–1198`** — crash branch (still useful for debugging-hover)
- **`MessageHandler.ts:1518–1528`** — stop button path (verify it routes through the exit handler so we don't double-fire)
- **`CodexSessionTab.ts:1113`** — Codex equivalent

Order inside the exit handler: after `saveProjectAnalytics()` and `achievementService.onSessionEnd(this.id)`, before posting `sessionEnded`:

```ts
this.maybeRunSummarizer(reason).catch(err => this.log.warn('summarizer failed', err));
```

On success:

```ts
this.sessionStore.saveSession({
  ...existing,
  summary: text,
  summaryGeneratedAt: Date.now(),
  summaryProvider: source,
});
this.tabGroupBus.emitSummaryChanged(this.id);   // TreeView refreshes the tooltip
```

### B4. Setting

```jsonc
"claudeMirror.sessionEndSummary": {
  "type": "boolean",
  "default": true,
  "description": "Generate a 1–3 sentence summary at the end of every session (Haiku, with Codex low-reasoning fallback). Stored on the session and shown on hover. Independent of activitySummary."
}
```

**Per the explicit user request:** runs even if `claudeMirror.activitySummary` is off — the two are decoupled. `claudeMirror.analysisModel` (already exists) drives the Haiku model id.

### B5. Display surfaces

1. **Primary — TreeView tooltip.** In `TabGroupsTreeProvider.getTreeItem` for tab leaves:
   ```ts
   const md = new vscode.MarkdownString();
   md.appendMarkdown(`**${tab.displayName}**\n\n`);
   md.appendMarkdown(meta.summary ?? '*Summary will appear after the session ends.*');
   item.tooltip = md;
   ```
2. **Secondary — webview chrome.** The rename-pencil header (`WebviewProvider.ts:50–90`) gains an info icon next to the name; click shows the summary in a small in-webview popover. Useful when the user is focused on the panel, not the sidebar.
3. **Tertiary — session-history quick-pick** (if/when "Resume past session" exists): append summary to `description`.

### B6. Privacy + cost

- Same exposure profile as `SessionNamer` (transcript only, no files/secrets).
- ~500–2000 input tokens to Haiku per session end → cheap.
- Codex fallback is the rare path.

---

## Phase C — Tests, Docs, Deployment

### C1. Tests
- **Unit:** `TabGroupStore` (cascade vs reparent delete, cycle prevention).
- **Unit:** `SessionSummarizer` transcript builder + truncation.
- **Manual:** end session → tooltip shows summary; create folder → drag (or "Move to...") a tab in; reload → folders + summaries restore; bogus `analysisModel` → verify Codex fallback.

### C2. Docs (project two-tier system)
- New detail docs: `Kingdom_of_Claudes_Beloved_MDs/TAB_GROUPS.md`, `SESSION_SUMMARY.md`.
- Update `TECHNICAL.md` index — two new component entries + new view container.

### C3. Deployment
1. `npm run deploy:local`
2. Reload VS Code
3. `npm run verify:installed` (manifest changed: new commands, view, settings)
4. Smoke test
5. `vsce publish patch`

### C4. SR-PTD
Single SR-PTD doc covering both phases.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| TreeView DnD API edge cases | Ship without DnD first; "Move to..." quick-pick covers it. |
| Summarizer failures degrade UX | Fire-and-forget + null-safe placeholder ("Summary will appear..."). |
| Setting sprawl | Reuse `analysisModel`; add only `sessionEndSummary` + `tabs.indicateGroupOnTitle`. |
| Native tab-strip clutter from prefixes | Default off; opt-in. |
| Cycle in folder re-parenting | Validation in `TabGroupStore.moveGroup`. |
| Cascade-delete data loss | Confirmation modal with three explicit options. |

---

## Suggested merge order

1. **A1+A2+A3** — data + store + TabManager wiring (invisible).
2. **A4+A5+A6** — TreeView + commands + manifest (folders usable).
3. **A7** — group-color icons (polish).
4. **B1+B2** — summarizer infra (no triggers yet).
5. **B3+B4** — wire triggers + setting (summaries start populating).
6. **B5** — display surfaces (TreeView tooltip + webview info icon).
7. **C** — tests, docs, deploy, version bump, SR-PTD.

---

## Files touched

**New (5):**
- `src/extension/session/TabGroupStore.ts`
- `src/extension/views/TabGroupsTreeProvider.ts`
- `src/extension/session/SessionSummarizer.ts`
- `Kingdom_of_Claudes_Beloved_MDs/TAB_GROUPS.md`
- `Kingdom_of_Claudes_Beloved_MDs/SESSION_SUMMARY.md`

**Modified (10):**
- `src/extension/session/OpenTabsSnapshot.ts` — `+groupId, +orderInGroup`
- `src/extension/session/TabManager.ts` — DI store, `moveTabToGroup`, snapshot forwarding
- `src/extension/session/SessionStore.ts` — `+summary, +summaryGeneratedAt, +summaryProvider`
- `src/extension/session/SessionTab.ts` — `maybeRunSummarizer` + 3 trigger sites + icon-color from group
- `src/extension/session/CodexSessionTab.ts` — parallel changes
- `src/extension/session/MessageHandler.ts` — verify stop-button trigger path
- `src/extension/extension.ts` — register TreeView, DI
- `src/extension/webview/WebviewProvider.ts` — info-icon + summary popover in header
- `package.json` — view container, view, commands, menus, 2 new settings
- `TECHNICAL.md` — index update

---
