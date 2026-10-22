# File Drag-and-Drop into the Chat (Shift+drag)

## What It Does

Users attach files to the chat by holding **Shift** while dragging them onto a ClaUi chat panel. The chat input receives the files' **original** paths whenever they exist on disk:

| Drag source | Result |
|-------------|--------|
| VS Code Explorer (files and folders), editor tabs, Open Editors | Original paths inserted (the drag payload carries them) |
| Windows File Explorer (any view: folders, search results, Home/Quick Access, Libraries, tabs) or the Desktop, files and folders | Original paths inserted, found through the Explorer selection (see below) |
| Items with no location on disk (Outlook attachments, browser drags, archive members) or with no unique match | Fallback: PNG/JPEG/GIF/WebP images up to ~3.75 MB attach inline (provider must support images); other files are copied to `%TEMP%\claui-dropped-files\<drop-folder>\<original name>` and the copy's path is inserted; folders show a notice |
| macOS / Linux file managers | Same fallback (the Explorer lookup is Windows-only) |

The whole panel is the drop zone. During a file drag a dashed "Drop to attach to the message" overlay covers the input area. Paths are appended to the input one per line, like the `+` picker.

## Why Shift Is Required

The chat is a `WebviewPanel` (sandboxed iframe in the editor area). VS Code's webview drag monitor (`WebviewWindowDragMonitor` in the workbench, plus `handleInnerDragStartEvent` / `handleInnerDragEvent` in the webview host `pre/index.html`) sets `pointer-events: none` on the webview iframe on every `dragstart` / `drag` / `dragover` **without** Shift, so the editor area takes the drop and opens the file. When `shiftKey` is set it restores `pointer-events: auto`, and the drag events reach the webview. There is no API to change this; Shift is the official VS Code mechanism (the Anthropic Claude Code extension uses the same one).

Consequences:
- Without Shift, drags from the VS Code Explorer never reach the webview at all (blocked from `dragstart`), so ClaUi cannot react. Discoverability therefore comes from static UI:
  - **Shift tip bar** above the input (`.shift-drag-hint`): a keyboard-key "Shift" plus "+ drag files into the chat to attach them" in 15px semi-bold, dashed accent border. Shown until the user closes it with its x; the choice is stored in webview `localStorage` under `claui-shift-drag-hint-dismissed` (VS Code keeps webview origins stable per extension + view type, so it persists across panels and restarts).
  - The input placeholder (`Shift+drag files to attach`) and the `+` button tooltip.
- When an OS drag enters the panel without Shift and vanishes within 600 ms (VS Code took it away), the tip bar switches to its alert state (`.shift-drag-hint-alert`, shown even if the tip was closed): 18px bold "Hold Shift while dragging to attach files to the chat", larger key, solid accent border, 3 pulses. It stays until its x, the next successful drop, or 20 s, so it is still visible when the user returns after VS Code opened the file in front of the chat.
- The reminder is deliberately anchored above the input, never centered: during any drag over the editor area VS Code paints `#monaco-workbench-editor-drop-overlay` (z-index 10000) above the webview, which dims the panel and centers its own "Hold Shift to drop into editor" label (`.editor-group-overlay-drop-into-prompt`). The webview cannot hide or draw above it.

## Why OS Drops Need the Explorer Lookup

Chromium never exposes the filesystem path of an OS-dropped file to web content (only name, size, `lastModified`, contents). Electron's non-standard `File.path` was removed in Electron 32 (VS Code 1.142 runs Electron 43), and `webUtils.getPathForFile` exists only in privileged preloads, not in webviews. `webkitGetAsEntry().fullPath` is a virtual `/name` path and `getAsFileSystemHandle()` is an opaque handle.

The files a user drags out of File Explorer are always that window's **selected items**. So the extension asks Explorer for the selection of every open window/tab and of the Desktop (`Shell.Application` COM) and matches the dropped items against that short list. No filesystem search is involved.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/hooks/useFileDrop.ts` | Window-level (capture phase) drag listeners, overlay state, blocked-drag hint, `onOsFileDragEnter` (fires once per OS drag), payload extraction, `readFileAsBase64()` |
| `src/webview/components/InputArea/InputArea.tsx` | `handleFileDrop()` routing, pending OS drops (`pendingOsDropsRef`), `claui-os-drop-resolved` listener, `attachOsItemsWithoutPath()` fallback, `appendPathsToInput()`, `queueImageFile()` (shared with Ctrl+V paste); overlay, hint and notice rendering |
| `src/extension/webview/explorerSelection.ts` | PowerShell `Shell.Application` selection query (`EXPLORER_SELECTION_QUERY`), prefetch on drag start, snapshot hand-off per drop, output parser. Windows only |
| `src/extension/webview/droppedFiles.ts` | `processFileDropRequest()` (shared by Claude and Codex handlers), `matchDroppedItemsToSelection()`, VS Code URI-to-path resolution, temp-copy saving, pruning. No `vscode` import (unit-testable) |
| `src/extension/webview/MessageHandler.ts` / `CodexMessageHandler.ts` | `resolveDroppedFiles`, `saveDroppedFiles`, `osFileDragStarted`, `resolveOsDroppedFiles` cases call `processFileDropRequest()` |
| `src/webview/hooks/useClaudeStream.ts` | Forwards `osDroppedFilesResolved` as the `claui-os-drop-resolved` window event |
| `src/extension/types/webview-messages.ts` | `ResolveDroppedFilesRequest`, `SaveDroppedFilesRequest`, `DroppedFileContent`, `OsFileDragStartedRequest`, `DroppedOsItemMeta`, `ResolveOsDroppedFilesRequest`, `OsDroppedFilesResolvedMessage` |
| `src/webview/styles/global.css` | `.file-drop-overlay`, `.file-drop-overlay-text`, `.shift-drag-key`, `.shift-drag-hint*` (incl. `.shift-drag-hint-alert` + `shiftDragHintPulse`), `.git-push-toast.info` (drop notices) |
| `tests/unit/droppedFiles.test.ts` | Unit tests (`npm run test:file-drop`) |

## Data Flow

```
OS drag enters the panel (Shift held)
  -> useFileDrop.trackDrag (depth 0 -> 1, types has 'files', no VS Code types)
  -> onOsFileDragEnter -> postToExtension({ type: 'osFileDragStarted' })
  -> extension prefetchExplorerSelection(): one powershell.exe run (~0.4 s), hidden behind the drag

Shift+drop on panel
  -> useFileDrop drop listener (window, capture) -> preventDefault + stopPropagation
  -> extractDropPayload(dataTransfer)   [synchronous: items expire after the event]
       CodeFiles      -> vscodePaths (JSON array of fsPaths, includes folders)
       ResourceURLs   -> vscodeUris  (JSON array of URI strings, files only)
       text/uri-list  -> vscodeUris  (only read when resourceurls/codeeditors present)
       Files          -> osFiles / osFolderNames (webkitGetAsEntry().isDirectory)
  -> InputArea.handleFileDrop(payload)
       VS Code items -> postToExtension({ type: 'resolveDroppedFiles', paths, uris })
                        -> resolveDroppedPaths() -> filePathsPicked
       OS items      -> keep File objects in pendingOsDropsRef[dropId] (8 s fallback timer)
                        -> postToExtension({ type: 'resolveOsDroppedFiles', dropId,
                                             items: [...files, ...folders] as {name, size, lastModified, isDirectory} })
                        -> extension: takeExplorerSelectionForDrop() (prefetched snapshot or fresh query)
                           -> matchDroppedItemsToSelection(); if the mid-drag snapshot missed items, one fresh query and retry
                           -> osDroppedFilesResolved { dropId, paths: (string | null)[] } (same order as items)
                        -> webview: resolved paths -> appendPathsToInput()
                                    unresolved     -> attachOsItemsWithoutPath() (inline image / saveDroppedFiles copy / folder notice)
```

## Explorer Lookup Details

`EXPLORER_SELECTION_QUERY` (inline `-Command` script, `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ...])`, 5 s timeout, `windowsHide`):
- Iterates `Shell.Application.Windows()`; for each window with a folder view (`Document.Folder`), adds `Document.SelectedItems()` entries where `IsFileSystem` is true.
- Adds the Desktop selection via `Windows().FindWindowSW(0, $null, 8 /*SWC_DESKTOP*/, [ref]$hwnd, 1)`.
- Prints a JSON array of paths with every non-ASCII character escaped as `\uXXXX`, so Hebrew paths survive any console code page.

Snapshot lifecycle (`explorerSelection.ts`): `osFileDragStarted` starts a query unless one started under 1.5 s ago; `resolveOsDroppedFiles` takes the latest snapshot if it is under 60 s old (otherwise queries now). Each snapshot serves one drop. Measured on Windows 11: ~0.3-0.5 s per cold query, so the result is usually ready before the drop.

Matching (`matchDroppedItemsToSelection`, fail closed):
- Selected paths are deduped (case-insensitive on Windows) and grouped by file name; only candidates whose name matches a dropped item are `fs.stat`'ed (1.5 s timeout per stat, for offline network shares).
- File: same name (case-insensitive on Windows) + exact size + mtime within 2 s of `File.lastModified` (mtime check skipped when `lastModified` is 0).
- Folder: same name + candidate is a directory.
- Exactly one candidate must match, and a path is assigned to at most one dropped item; otherwise the item stays unresolved (a wrong original is worse than a copy).

## Drag Detection Details (`useFileDrop`)

- External file drag = DataTransfer types contain `files`, `codefiles`, `resourceurls` or `codeeditors` (types are lowercase) and no `dragstart` happened inside the webview (tab reordering in the vertical rail and text-selection drags set an internal flag, cleared by `dragend`, any `pointerdown`, or any non-file `drop`).
- `dragenter` / `dragover`: `preventDefault()` (valid drop target, `dropEffect = 'copy'`), propagation is NOT stopped: VS Code's own listener reads `shiftKey` from these events to decide whether to block the iframe.
- Enter depth counter (dragenter +1 per child element, dragleave -1) decides when the drag left the panel; a 1200 ms idle timer resets the state if neither `dragleave` nor `drop` arrives.
- Blocked-drag reminder: drag ended without drop, no event carried Shift, and it lasted under 600 ms. The tip bar's alert state is shown for 20 s; a successful drop clears it.
- When the input is disabled (`!isConnected` or provider handoff in progress) the overlay is hidden, `dropEffect` is `none`, `onOsFileDragEnter` does not fire, and drops are swallowed without attaching.

## Temp-Copy Fallback (`droppedFiles.ts`)

| Function | Behavior |
|----------|----------|
| `saveDroppedFiles(files, rootDir)` | One fresh folder per drop (`YYYYMMDD-HHMMSS-<random>`), original names kept, duplicates become `name (2).ext`. Limits: 25 MB per file, 20 files per drop. Returns `{ dropDir, paths, skipped }` |
| `sanitizeDroppedFileName(name)` | Keeps Unicode (Hebrew), replaces `<>:"|?*` and control chars with `_`, strips trailing dots/spaces, prefixes reserved device names (`CON`, `NUL`, ...), max 180 chars (keeps the extension) |
| `pruneDroppedFiles(rootDir)` | Deletes drop folders older than 7 days; runs after every save; never throws |

The webview shows "No original location for X: attached as a temporary copy." whenever this path is used. Inline images: only for unresolved images (an image dragged from File Explorer is inserted as its original path).

## VS Code Drag Resolution (`droppedFiles.ts`)

| Function | Behavior |
|----------|----------|
| `droppedUriToFsPath(uri)` | `file:` via `url.fileURLToPath` (local and UNC); `vscode-remote:` returns the decoded URI path (drive paths `/c:/x` lose the leading slash); anything else returns null |
| `resolveDroppedPaths(paths, uris, platform)` | CodeFiles paths first, then URI paths; dedupe (case-insensitive on Windows); on Windows only drive-letter or UNC paths are accepted |

## Limits and Constraints

- The Explorer lookup needs Windows PowerShell with `Shell.Application` COM. If PowerShell is blocked (AppLocker, Constrained Language Mode) the query returns nothing and every OS item takes the fallback; the Output channel logs `File drop: Explorer selection query failed ...`.
- Third-party file managers (Total Commander, Directory Opus) are not visible to `Shell.Application`: their drops take the fallback.
- Explorer tab enumeration is tested behavior on Windows 11, not a documented contract.
- Temp copies and originals outside the workspace: with Claude's default permission mode, reading them can trigger a permission prompt; with Workspace Access Guard enabled, their folders must be allowed roots.
- Remote Control: `resolveDroppedFiles`, `saveDroppedFiles`, `osFileDragStarted` and `resolveOsDroppedFiles` are sensitive UI actions (`accessPolicy.ts`).

## Other Path Insertion Flows

| Flow | Where |
|------|-------|
| `+` button file picker (`vscode.window.showOpenDialog`) | `InputArea.handleBrowseFiles` -> `MessageHandler.handlePickFiles` |
| Explorer context menu `ClaUi: Send Path to Chat` | `claudeMirror.sendFilePathToChat` in `src/extension/commands.ts` |
| `@` file mention autocomplete | See `FILE_MENTION.md` |

These end in the `filePathsPicked` message and `pendingFilePaths` store field, consumed by `appendPathsToInput()`.
