# Worktree Support

## What this is and why it exists

A **git worktree** is an isolated checkout of the same repository on its own branch, sharing one repo history. ClaUi lets a user **create, run sessions in, merge, and remove** worktrees, plus a **visual dashboard** that shows every worktree and which sessions run on each. Without this, every ClaUi tab runs in the single workspace root, so concurrent Claude/Codex sessions fight over the same files. Worktrees let several sessions edit code in parallel, each in its own directory and branch, then **merge the finished work back into a target branch** from a guided, fully reversible wizard.

## Launch mechanism (the key decision)

ClaUi runs `git worktree add` **itself** and spawns the session with **`cwd` = the worktree path**, reusing the per-session `cwd` option the process managers already accept. It does **not** rely on the Claude CLI `--worktree` flag. A worktree is just another checkout, so headless `claude -p --output-format stream-json` (and Codex `-C <cwd>`) behave identically regardless of whether `--worktree` is honored in headless mode.

ClaUi mirrors the CLI conventions so CLI- and ClaUi-created worktrees interoperate in the same list:
- Container directory: `.claude/worktrees/<name>/` (configurable)
- Branch name: `worktree-<name>` (configurable prefix)
- Base ref: `origin/HEAD`, falling back to local `HEAD` when unresolved

## Session <-> worktree mapping

The dashboard joins `git worktree list --porcelain` against the live tab list using **realpath-normalized** paths (`fs.realpathSync.native` + strip trailing separators + lowercase on Windows) so the join survives drive-letter case, 8.3 short names, junctions, and trailing slashes. Tabs with no explicit worktree map to the **primary (main)** worktree (the workspace root).

## Persistence and re-spawn threading (critical correctness invariant)

Each tab persists its `worktreePath`. This path must be re-applied on **every** re-spawn path or a session silently jumps back to the main repo. The path is threaded through:

- `SessionTab.getEffectiveCwd()` returns `worktreePath ?? cwdOverride ?? undefined`; used by the initial `startSession()` and the three re-spawn calls (`switchModel` fresh-restart + resume, `beginSilentResume`, `escalateToVisibleCrash`).
- `CodexSessionTab` resolves `sessionCwd` as `options.cwd || worktreePath || cwdOverride || workspaceRoot`; `sessionCwd` then persists across all Codex re-spawns.
- `OpenTabSnapshotEntry.worktreePath` persists across window reloads; `TabManager.restoreFromSnapshot()` re-applies it before resume/lazy-wake so the restored session spawns in the same tree.

## Key files

### Extension (Node.js)

- `src/extension/worktree/worktreeTypes.ts` -- Wire/domain types:
  - `WorktreeInfo` { path, branch, headSha, isMain, isLocked, isPrunable, isDetached, mergeInProgress? }
  - `MergeInProgress` { kind: 'merge'|'squash', conflictedFiles[] } -- a paused merge sitting in a worktree.
  - `MergeStrategy` = `'merge' | 'squash' | 'ff'` (rebase is intentionally excluded).
  - `MergePreview` -- read-only "merge source into target" analysis (ahead/behind, commits, conflict prediction, sourceDirty, alreadyMerged, needsMainSwitch, blockedReason).
  - `MergeResult` { action: 'merge'|'complete'|'abort'|'undo', phase: 'clean'|'conflict'|'error', newSha?, preSha?, strategy?, conflictFiles?, canDiscard?, removed?, pushNote? }.
  - `MergeOptions` { sourcePath, targetBranch, strategy, commitMessage?, allowMainSwitch }.
  - `WorktreeSessionRef` { tabId, tabNumber, displayName, provider, slotColor, isBusy }
  - `WorktreeWithSessions extends WorktreeInfo { sessions: WorktreeSessionRef[] }`
  - `WorktreeActionResult` { success, message, worktreePath?, requiresForce? }
- `src/extension/worktree/WorktreeService.ts` -- All git work via `execFile('git', [args], { cwd })` (injection-safe; never shell strings). Methods:
  - `getRepoRoot()` -- `git rev-parse --show-toplevel`.
  - `listWorktrees()` -- `git worktree list --porcelain`, parsed to `WorktreeInfo[]` (records split on blank lines; index 0 and not bare = main), then augments each with `mergeInProgress` (see merge engine below).
  - `createWorktree(name, baseBranchOverride?)` -- serialized via an in-flight op lock; sanitizes the name, ensures `.claude/worktrees/` is in `.gitignore`, resolves the base ref, runs `git worktree add <dir> -b <prefix><name> <base>`, copies `.worktreeinclude` entries, maps collision errors to friendly messages.
  - `removeWorktree(path, { force })` -- guards the main worktree; detects dirty/untracked and returns `requiresForce` instead of destroying changes unless `force` is set.
  - `resolveRealPath(p)` -- realpath normalization used by the join.
  - **Merge engine** (all mutations serialized through the same op lock): `getBranches()`, `getMergePreview(sourcePath, target?)`, `commitAll(path, message)`, `pushTarget(path)`, `merge(opts)`, `abortMerge(path, {squash})`, `completeMerge(path, {squash, message?, preSha?})`, `undoMerge(path, {mode, strategy, newSha, preSha?})`. See "Merge flow" below for the exact git commands.
- `src/extension/worktree/WorktreeSettings.ts` -- `getWorktreeSettings()` + `onWorktreeSettingsChanged()` reading `claudeMirror.worktree.*`; `sanitizeDir()` keeps the directory relative and traversal-free.
- `src/extension/worktree/WorktreeController.ts` -- Bridges `WorktreeService` with the live tab list. Owns the worktree<->session join and all mutations so a per-tab message handler stays thin. Talks to `TabManager` through a small `WorktreeTabHost` slice (`listTabs`, `createWorktreeTab`, `focusTab`, `closeTab`, `broadcastTabsState`). Methods: `buildList()`, `create()`, `createSession()`, `remove()` (closes owning tabs before `git worktree remove`), `openFolder()`, `focusSession()`. Merge methods: `listBranches()`, `previewMerge()` (attaches the settings-driven `defaultStrategy`/`removeAfterDefault`/`confirmIntoProtected`), `commitSource()`, `performMerge()` (on a clean result reuses `pushTarget` when "push after" is set and the close-tabs-before-remove path when "remove after" is set), `abortMerge()`, `completeMerge()`, `undoMerge()`, `openConflictFiles()` (opens each conflicted file in the editor).

### Wiring

- `src/extension/session/TabManager.ts` -- Instantiates one `WorktreeController` in the constructor and injects it into every tab via `tab.setWorktreeController(...)` in `createClaudeTab`/`createCodexTab` (and therefore `createRemoteTab` and restore, which route through them). Exposes `createWorktreeTab(worktreePath, provider?, viewColumnOverride?)`, persists `worktreePath` on the snapshot, then `startSession({ cwd: worktreePath })`. `listTabs()` and `seedSnapshotEntry()` carry `worktreePath`. Also exposes `prepareSessionMove()` / `moveActiveSessionToWorktree(targetPath)` for relocating an existing Claude session into a worktree (see below).
- `src/extension/session/SessionTab.ts` / `CodexSessionTab.ts` -- `setWorktreePath()`/`getWorktreePath()`, `getEffectiveCwd()` (Claude) / `sessionCwd` resolution (Codex), and `setWorktreeController()` forwarders to their message handler.
- `src/extension/webview/MessageHandler.ts` and `CodexMessageHandler.ts` -- `setWorktreeController()` + handlers (`handleGetWorktreeList`, `handleCreateWorktree`, `handleCreateWorktreeSession`, `handleRemoveWorktree`) plus the merge handlers (`handleListBranches`, `handleGetMergePreview`, `handleCommitWorktree`, `handlePerformMerge`, `handleAbortMerge`, `handleCompleteMerge`, `handleUndoMerge`, `handleOpenConflictFiles`) and their switch cases; mutations re-post the list to refresh the dashboard, and a successful commit also re-posts a fresh merge preview.
- `src/extension/commands.ts` -- `claudeMirror.openWorktreePanel` (reveals the active tab and posts `openWorktreePanel`), `claudeMirror.createWorktreeSession` (launches directly when given a path arg, else opens the panel), and `claudeMirror.moveSessionToWorktree` (QuickPick of target worktrees -> `tabManager.moveActiveSessionToWorktree`).
- `src/extension/session/sessionPathResolver.ts` -- `findSessionJsonlPath()` plus the move helpers `claudeProjectDirName()` and `relocateSessionTranscript()` (see "Move an existing session into a worktree" below).

### Webview (browser)

- `src/webview/components/Worktree/WorktreePanel.tsx` -- Full-screen overlay (GitHub-dark, Esc-to-close, Refresh). Header with counts; one card per worktree (main first) showing branch badge, HEAD sha, lock/missing state, path, the sessions running on it (slot-color dot + provider badge + busy/idle + Open), and card actions (New session here, Open folder, **Merge** on non-main/non-detached cards, Remove). A persistent amber **merge-in-progress bar** appears on any card whose worktree has `mergeInProgress` (and as a strip at the top of the body), each offering **Resolve** (reopens the wizard in the conflict stage) and **Abort**. Mounts `<MergeWizard>` when a card's Merge/Resolve is clicked; Esc closes the wizard before the panel. Footer create form: name input, base-branch field, "start a session here" checkbox. Inputs are RTL-aware via `detectRtl()`.
- `src/webview/components/Worktree/MergeWizard.tsx` -- The staged merge modal (overlay at zIndex 1100). **Stage A (Review):** visual source-chip -> target-branch dropdown header with ahead/behind, auto conflict-prediction status card (green clean / amber conflicts + file list / grey unavailable), collapsible commit list, amber warning rows (uncommitted changes with inline "Commit them first"; main-checkout switch with an allow checkbox; already-merged disables Merge; behind > 0 disables fast-forward), three visual strategy cards (Merge commit / Squash with a message field / Fast-forward), after-merge checkboxes (remove worktree / push target), and an adaptive primary button ("Merge" / "Squash & merge" / "Fast-forward", amber "Merge & resolve conflicts" when conflicts are predicted). Merging into a protected branch opens a confirm modal (no `window.confirm`, which is blocked in the webview). **Stage B (Conflict):** Open conflicted files / Abort / Complete. **Stage C (Result):** success with new commit sha, "Undo merge" (revert by default; a guarded "Discard (rewrite history)" appears only when the commit is provably unpushed), and Done; errors show a red card with Back/Close. The wizard never runs git itself -- it posts requests and renders the `MergePreview`/`MergeResult` the extension returns.
- `src/webview/components/Worktree/worktreeColors.ts` -- Palette (`amber` added for merge warnings) + `providerBadgeColor()` / `providerLabel()`.
- `src/webview/components/Worktree/index.ts` -- Re-export.
- `src/webview/state/store.ts` -- `worktreePanelOpen`, `worktreeList`, `worktreeIsGitRepo`, `worktreeActionResult`, `mergeBranches`, `mergePreview`, `mergeResult`, `mergeDefaults` + setters; all reset on session switch.
- `src/webview/hooks/useClaudeStream.ts` -- Cases `openWorktreePanel`, `worktreeList`, `worktreeActionResult`, `branchList`, `mergePreview` (stores the preview and the settings-driven defaults), `mergeResult`.
- `src/webview/App.tsx` -- Mounts `{worktreePanelOpen && <WorktreePanel />}`.
- `src/webview/components/StatusBar/StatusBar.tsx` -- "Worktrees" button in the Session dropdown.

## Message protocol

Inbound (webview -> extension): `getWorktreeList`, `createWorktree{name, baseBranch?, startSession}`, `createWorktreeSession{worktreePath}`, `removeWorktree{worktreePath, force?}`, `openWorktreeFolder{worktreePath}`, `focusWorktreeSession{tabId}`, `listBranches`, `getMergePreview{sourcePath, targetBranch?}`, `commitWorktree{worktreePath, message, targetBranch?}`, `performMerge{sourcePath, targetBranch, strategy, commitMessage?, allowMainSwitch, removeAfter, pushAfter}`, `abortMerge{targetPath, squash}`, `completeMerge{targetPath, squash, message?, preSha?}`, `undoMerge{targetPath, mode, strategy, newSha, preSha?}`, `openConflictFiles{targetPath, files}`.

Outbound (extension -> webview): `worktreeList{worktrees, isGitRepo}`, `worktreeActionResult{success, message, action: 'create'|'remove'|'commit', worktreePath?, requiresForce?}`, `openWorktreePanel`, `branchList{branches}`, `mergePreview{preview, defaultStrategy, removeAfterDefault, confirmIntoProtected}`, `mergeResult{result}`.

## Remove safety

Remove is disabled in the UI for the main worktree and for any card with a live session (close the session first; disposing the tab kills its CLI process tree). For a dirty/untracked worktree, the service returns `requiresForce`, the panel shows a confirm dialog, and confirming re-issues `removeWorktree` with `force: true`.

## Merge flow (the git engine)

The wizard merges a worktree's branch (**source**) into a **target** branch. All commands run via `execFile('git', [args], { cwd })` and are serialized through the same in-flight op lock as create/remove. **Rebase is intentionally not offered** -- it would rewrite the source branch while a live session may be committing in that worktree.

- **Where the merge runs (`locateTargetCwd`)** -- the merge executes in whatever checkout has the target branch. If a worktree already has the target checked out, that is the cwd. Otherwise, if the main checkout is clean and the user approved it (`allowMainSwitch`), main is switched to the target (`git switch --no-guess <target>`) and used. Otherwise the merge is blocked (surfaced as `needsMainSwitch` in the preview).
- **Preview (`getMergePreview`, read-only)** -- resolves the source branch (`symbolic-ref --short HEAD`), ahead/behind (`rev-list --left-right --count <target>...<source>`), the commit list (`log --format=%h%x09%s <target>..<source>`), source dirtiness (`status --porcelain`), and a conflict prediction via `git merge-tree --write-tree --name-only -z <target> <source>` (git >= 2.38; exit 0 = clean, 1 = conflicts with the file list, otherwise `'unknown'`). Computes `alreadyMerged`, `needsMainSwitch`, and `blockedReason` (detached target, unrelated histories, or an in-progress git state).
- **Strategies** -- merge commit: `git merge --no-ff --no-edit <sourceSha>`; fast-forward: `git merge --ff-only <sourceSha>` (disabled when behind > 0); squash: `git merge --squash <sourceSha>` then `git commit -m <message>` (a squash writes no MERGE_HEAD). The merge operates on a **captured source sha** so a concurrent session commit cannot change what is merged mid-flight.
- **Conflict (`phase: 'conflict'`)** -- left in place for the user to resolve in the editor. `openConflictFiles` opens each unmerged path; `completeMerge` first re-checks `git ls-files -u` is empty, then commits (`--no-edit` for a merge, `-m <message>` for a squash).
- **Abort (real cancel)** -- a normal merge: `git merge --abort`; a squash: `git reset --hard HEAD` (a squash never advanced HEAD, so HEAD is still the pre-merge commit). Either restores the target exactly.
- **Undo a completed merge** -- default is the non-destructive `git revert` (`-m 1` for a merge commit), which adds an inverse commit. A destructive `git reset --keep <preSha>` is offered **only** when the commit is provably unpushed: resolve `@{upstream}`, `git fetch`, then `git merge-base --is-ancestor <newSha> @{upstream}` must exit 1 (`canDiscard`). No upstream => discard is hidden.
- **In-progress detection (`mergeInProgress`)** -- `listWorktrees` flags each worktree: a present `MERGE_HEAD` => `'merge'`; unmerged files with no `MERGE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD`/rebase dir => `'squash'`. This drives the persistent in-progress bar so a paused merge can always be resumed or aborted, even after a window reload.

## Move an existing session into a worktree (prototype)

A running **Claude** session can be relocated into another worktree without losing its conversation: ClaUi copies the session transcript into the target tree's CLI project folder, then kills and `--resume`s the CLI with that worktree as its new `cwd`. From that point on, every change the session makes lands in that worktree.

- **Why a copy + respawn** -- a process's `cwd` is immutable, and the Claude CLI scopes `--resume <id>` lookup to the *current* directory's project folder under `~/.claude/projects/`. So the move first relocates the transcript, then respawns the CLI (the same kill + resume path ClaUi already uses for model-switch, silent-resume, and crash recovery).
- **Transcript relocation (`src/extension/session/sessionPathResolver.ts`)** -- `relocateSessionTranscript(sessionId, targetCwd, sourceWorkspacePath?)` finds the source `.jsonl` (via `findSessionJsonlPath`, which falls back to a global project-folder scan) and copies it to `~/.claude/projects/<encoded-targetCwd>/<id>.jsonl`. The target folder name comes from `claudeProjectDirName()`, which replaces `:` `\` `/` and `.` with `-` -- the CLI's exact encoding (it collapses dots too, unlike the more lenient lookup transform). Copy, not move, so the original survives; an identical source/target path is a no-op.
- **Orchestration (`src/extension/session/TabManager.ts`)** -- `prepareSessionMove()` validates that the active tab is an **idle** Claude `SessionTab` with a real session id, then lists candidate worktrees (`WorktreeController.buildList()` minus the current tree and any detached worktree). `moveActiveSessionToWorktree(targetPath)` re-validates, relocates the transcript, persists the new `worktreePath` on the tab + snapshot entry, then `startSession({ resume: sessionId, cwd: targetPath })`.
- **Scope & guards** -- Claude-only (`instanceof SessionTab`; Codex and multi-participant tabs are excluded, since the move relies on the Claude kill+`--resume` flow); refused while the session is busy (never killed mid-turn); refused if the session has not started yet. Uncommitted changes do **not** follow the move (worktrees keep separate working trees) -- commit or stash first if you need them in the target tree.
- **Entry point** -- the `claudeMirror.moveSessionToWorktree` command (Command Palette: "ClaUi: Move Current Session to Worktree") opens a native VS Code QuickPick of target worktrees (main shown with `$(home)`, others with `$(git-branch)` + branch). No webview surface -- this prototype is command + QuickPick only.

## Settings (`claudeMirror.worktree.*`)

| Setting | Default | Purpose |
|---------|---------|---------|
| `enabled` | `true` | Master switch for the feature |
| `directory` | `.claude/worktrees` | Container dir (relative to repo root) for new worktrees |
| `branchPrefix` | `worktree-` | Branch-name prefix (branch = prefix + name) |
| `baseBranch` | `origin/HEAD` | Default base ref; falls back to current HEAD |
| `copyIncludeFile` | `true` | Copy `.worktreeinclude` entries (e.g. `.env`) into new worktrees |
| `defaultMergeStrategy` | `merge` | Strategy pre-selected in the merge wizard (`merge`/`squash`/`ff`) |
| `removeAfterMerge` | `false` | Default state of "remove worktree after a successful merge" |
| `confirmMergeIntoProtected` | `true` | Extra confirm step when the merge target is `main`/`master` |

## Commands

- `claudeMirror.openWorktreePanel` -- ClaUi: Worktrees Dashboard.
- `claudeMirror.createWorktreeSession` -- ClaUi: New Worktree Session (path arg launches directly; no arg opens the dashboard).
- `claudeMirror.moveSessionToWorktree` -- ClaUi: Move Current Session to Worktree (QuickPick of target worktrees; idle Claude sessions only).

Primary entry point: StatusBar -> Session -> **Worktrees**.

## Known limitations

- `.worktreeinclude` copying is a ClaUi reimplementation of the one real feature lost by not using `--worktree`; entries must be repo-relative (absolute paths, `..`, and drive paths are rejected).
- Worktree creation and every merge operation are serialized (one at a time) to avoid git index races.
- Conflict **resolution** happens in the editor, not in-panel (a dashboard is the wrong place for hunk-level editing); the wizard predicts, runs, and abort/completes around it.
- Conflict **prediction** needs git >= 2.38; older git degrades to "the merge itself will report conflicts."
- A clean prediction can still fail the real merge on Windows (files locked by a live session, case-only collisions); this surfaces as an error with Abort available.
- Push-after-merge uses a plain `git push` of the target checkout; if no upstream/remote is configured the step is a no-op surfaced as a note on the result.
- The dashboard reflects the worktrees of the first workspace folder; multi-root workspaces use folder index 0.
- Moving a session into a worktree relocates only the conversation transcript, not uncommitted working-tree changes (worktrees keep separate working trees); commit or stash before moving if those changes must come along. The move is Claude-only and refused while the session is busy.
