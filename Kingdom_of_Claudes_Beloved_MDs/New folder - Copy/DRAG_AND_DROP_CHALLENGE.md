# Drag-and-Drop File Paths into Webview - Technical Deep Dive

## The Goal

Allow users to drag files from Windows Explorer or VS Code's file explorer onto the ClaUi chat panel and have the file's full path pasted into the input textarea. This is how the Claude CLI works in a terminal - you drag a file onto the terminal window and the path appears as text input.

## Resolution Implemented (February 17, 2026)

Direct drag-and-drop onto the editor-area webview remains impossible due to VS Code interception. The extension now ships a reliable replacement workflow:

- Explorer context menu command: `ClaUi: Send Path to Chat`
- Supports single or multi-select files/folders from VS Code Explorer
- Injects selected full paths into the chat input via existing `filePathsPicked` message flow
- Keeps the existing `+` picker as an additional path entry method

The previous drag-detection interception experiment has been removed from runtime code because the webview never receives drag events in this host context.

## What Currently Works

A `+` button next to the textarea opens VS Code's native file picker dialog (`vscode.window.showOpenDialog`) and pastes the selected paths. This works reliably but is not drag-and-drop.

**Relevant code:**
- `src/webview/components/InputArea/InputArea.tsx` - The `+` button, consumes `pendingFilePaths` from store
- `src/extension/webview/MessageHandler.ts` - `handlePickFiles()` method calls `showOpenDialog`
- `src/extension/types/webview-messages.ts` - `PickFilesRequest` / `FilePathsPickedMessage` types
- `src/webview/state/store.ts` - `pendingFilePaths` state field
- `src/webview/hooks/useClaudeStream.ts` - Handles `filePathsPicked` message from extension

## Why Drag-and-Drop Doesn't Work

### The Core Problem

VS Code webview panels live in the **editor area**. The editor area has built-in drag-and-drop handling: when a file is dropped there, VS Code opens it as a new editor tab. This behavior is handled at the VS Code shell level (Electron main/renderer process), **above** the webview iframe. The webview never receives the drag events.

### What Was Tested and Confirmed

| Approach | Result | Evidence |
|----------|--------|----------|
| Element-level drag handlers on the input area div | File opens in editor tab, no events fire in webview | User tested, reported "drag and drop just opens the file" |
| Document-level drag handlers with capture phase (`addEventListener('drop', handler, true)`) | Same - file opens, no events reach webview | User tested after deployment |
| `dragenter` event detection (hoping VS Code only blocks `drop` but not `dragenter`) | **No dragenter fires either.** VS Code blocks ALL drag events from the webview iframe. | Confirmed via output channel logs - no "dragDetected" message ever appears |

### The Electron/VS Code Architecture

```
OS Drag Event (Windows Explorer)
       |
       v
Electron Main Process
       |
       v
VS Code Renderer Process
       |
       +---> VS Code Editor Area Drop Handler
       |         |
       |         +---> Opens file as editor tab
       |         +---> STOPS propagation (event never reaches iframe)
       |
       +---> Webview IFrame (NEVER receives drag events)
```

The webview is a sandboxed iframe inside VS Code's editor area. VS Code's native drag-and-drop handler sits on the editor area container element (a parent of the iframe). It handles the drop event and calls `stopPropagation()` / `preventDefault()`, preventing the event from ever reaching the iframe's document.

This is NOT a configurable behavior. There is no `WebviewOptions` flag, no `WebviewPanelOptions` setting, and no VS Code API to disable the editor area's file-drop handling for specific webview panels.

### VS Code API Limitations (as of VS Code 1.96+)

| API | What It Does | Why It Doesn't Help |
|-----|-------------|---------------------|
| `WebviewPanel` | Creates editor-area webview panel | No drop event, no drop options |
| `WebviewView` | Creates sidebar/panel-area webview | Different location, might still have same issue |
| `DocumentDropEditProvider` | Handles drops onto TEXT editors | Only for `TextEditor`, not webview panels |
| `TreeDragAndDropController` | Handles drag in tree views | For custom tree views, not webviews |
| `CustomEditorProvider` | Custom editor for specific file types | Uses webview internally, same iframe sandbox |
| `vscode.workspace.onDidOpenTextDocument` | Detects when a file is opened | Fires AFTER file is opened, can't distinguish drag from click |

### The "Intercept File Open" Strategy (Attempted, Unreliable)

We tried a two-layer approach:
1. Webview sends `dragDetected` to extension on `dragenter`
2. Extension listens for `onDidOpenTextDocument` within a 2-second window
3. If both happen, assume it was a drag-and-drop, grab the path, close the tab

**Why it failed:** VS Code blocks `dragenter` too. The webview never fires the signal, so the extension has no way to know a drag was happening. Without this signal, `onDidOpenTextDocument` alone can't distinguish "user dragged a file" from "user clicked a file in the explorer" - both produce the same event with no differentiating metadata.

## Potential Solutions to Explore

### 1. VS Code WebviewView (Sidebar/Bottom Panel)

Convert the chat from a `WebviewPanel` (editor area) to a `WebviewView` (sidebar or bottom panel). The editor area has special file-drop behavior, but sidebar/bottom panel areas might not intercept drops the same way.

**Investigation needed:** Does a `WebviewView` in the sidebar or bottom panel receive HTML5 drag events? The sidebar doesn't have the "open file on drop" behavior, so events might pass through to the webview.

**Tradeoff:** Changes the UX - the panel would be in the sidebar or bottom panel instead of beside the editor. Could be registered as both (sidebar view + editor panel) with drag-and-drop only working in the sidebar version.

**Files to modify:** `WebviewProvider.ts` (register as `WebviewViewProvider`), `package.json` (add `views` contribution point).

### 2. VS Code Terminal as Drop Proxy

VS Code terminals natively support drag-and-drop (file paths are pasted as text). Create a thin terminal alongside or below the webview that acts as a drag-and-drop receiver.

**Approach:**
- Register a `Pseudoterminal` that reads stdin
- When file paths are pasted (via drag-and-drop onto the terminal), extract them
- Send the paths to the webview via the extension

**Tradeoff:** User must drop files on the terminal area, not the webview. Could label the terminal "Drop files here" and make it a thin strip.

**Files to modify:** New `TerminalDropProxy.ts` in `src/extension/terminal/`, wire in `extension.ts`.

### 3. Explorer Context Menu ("Send Path to ClaUi")

Add a right-click context menu item to VS Code's file explorer that sends the file path to the chat input.

**Approach:**
- Register `explorer/context` menu contribution in `package.json`
- Register a command `claudeMirror.sendFilePath` that reads the clicked file's URI
- Send the path to the webview

**Tradeoff:** Not drag-and-drop, but a two-click workflow. Very reliable, no hacking.

**Files to modify:** `package.json` (menus + commands contribution), `commands.ts` (new command handler).

### 4. Keyboard Shortcut to Paste Active File Path

Register a keybinding (e.g., `Ctrl+Shift+P` for path) that takes the currently active editor's file path and pastes it into the chat input.

**Tradeoff:** Requires the user to first open/click the file, then press the shortcut. Not drag-and-drop.

### 5. Electron IPC / Native Module

Access Electron's native drag-and-drop at the main process level. VS Code extensions can sometimes access Electron APIs via `require('electron')`.

**Investigation needed:** Can a VS Code extension register a native drop handler on the webview's parent element? This would bypass VS Code's own handler. Extremely fragile, likely unsupported, may break with VS Code updates. Not recommended unless all other options are exhausted.

### 6. VS Code Feature Request / API Proposal

File a feature request on `microsoft/vscode` for a `WebviewPanel.onDrop` event or a `WebviewPanelOptions.interceptDrop` flag. Reference the use case of chat interfaces that need file path input.

**Related issues to check:**
- Search `microsoft/vscode` issues for: "webview drag drop", "webview panel drop", "file drop webview"
- There may already be an open feature request or API proposal

### 7. Hybrid: Monitor Window Focus + Tab Changes

A heuristic approach:
1. Track when the webview panel is the active editor tab
2. Listen for `vscode.window.onDidChangeActiveTextEditor` (fires when a new tab opens)
3. If the panel was active and a new file tab appears within ~500ms, assume drag-and-drop
4. Grab the path from the new tab, close it, paste the path

**The false positive problem:** This also triggers when the user clicks a file in the explorer while the chat panel is visible. There is no reliable way to distinguish these two actions from the extension API.

**Possible mitigation:** Add a "Drop Mode" toggle button in the input area. When enabled, the extension intercepts file opens. When disabled, normal behavior. This makes the interception explicit and avoids false positives.

## Current Code State

### Removed Experimental Drag Interception

The following non-functional parts were removed from runtime code:

- `src/webview/hooks/useFileDrop.ts`
- Drag overlay rendering in `src/webview/App.tsx`
- Drag interception listener in `src/extension/extension.ts`
- `dragDetected` message type and drag-state methods in message contracts/handler
- `.drop-overlay` styles in `src/webview/styles/global.css`

### Active Path Insertion Flows

| File | What It Does |
|------|-------------|
| `src/webview/components/InputArea/InputArea.tsx` | `+` button triggers file picker and consumes queued paths into textarea |
| `src/extension/webview/MessageHandler.ts` | `handlePickFiles()` calls `vscode.window.showOpenDialog()` and posts `filePathsPicked` |
| `src/extension/commands.ts` | `claudeMirror.sendFilePathToChat` sends selected Explorer paths to the chat input |
| `package.json` | Contributes Explorer context menu item and command palette command |
| `src/webview/state/store.ts` | Stores `pendingFilePaths` until input area consumes them |
| `src/webview/hooks/useClaudeStream.ts` | Routes `filePathsPicked` messages into store |

## Summary

The fundamental blocker is that **VS Code's editor area intercepts all drag events before they reach the webview iframe**. No amount of JavaScript event handling in the webview can work around this. The solution must come from either:

1. A different VS Code view type (`WebviewView` in sidebar) that might not have this interception
2. An extension-level mechanism that doesn't depend on drag events reaching the webview
3. A VS Code API change (feature request)

Implemented practical workaround:

1. Explorer context menu: `ClaUi: Send Path to Chat`
2. `+` button file picker in input area

Direct drag-drop onto the editor-area webview remains blocked by VS Code.
