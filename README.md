# Claude Code Mirror

A VS Code extension that gives Claude Code a rich chat UI - multiple tabs, model selection, file sending, image paste, and more.

---

## Installation (Fresh Machine)

Follow these steps to go from zero to a working Claude Code chat session.

### Step 1: Prerequisites

Install these before anything else:

| Requirement | Minimum Version | How to verify |
|-------------|-----------------|---------------|
| **Node.js** | 18+ | `node --version` |
| **npm** | (comes with Node) | `npm --version` |
| **VS Code** | 1.85+ | `code --version` |
| **Claude CLI** | latest | `claude --version` |

> **Claude CLI**: If `claude --version` fails, install it first:
> `npm install -g @anthropic-ai/claude-code`
> Then run `claude` once to authenticate with your Anthropic account.
>
> **VS Code CLI (`code`)**: If `code --version` fails, the `code` command is not on PATH yet.
> - **Windows**: reinstall/update VS Code with "Add to PATH" enabled, then reopen terminal.
> - **macOS**: run `Shell Command: Install 'code' command in PATH` from Command Palette.
> - **Linux**: ensure the `code` binary is on PATH.

### Step 2: Clone and install dependencies

```bash
git clone <repository-url> C:\projects\claude-code-mirror
cd C:\projects\claude-code-mirror
npm install
```

### Step 3: Build, package, and install the extension

One command does everything:

```bash
npm run deploy:local
```

This runs: `npm run build` -> `vsce package` -> `code --install-extension` -> verification.

### Step 4: Reload VS Code

Press `Ctrl+Shift+P`, type `Reload Window`, and select **Developer: Reload Window**.

### Step 5: Start using it

Press **`Ctrl+Shift+C`** - a Claude Code chat panel opens. Type a message, press **`Ctrl+Enter`** to send.

That's it. The extension is now installed globally - it works in any VS Code project.

### Step 6 (Recommended): Verify the main shortcut once

This ensures the next `Ctrl+Shift+C` opens Claude Mirror immediately on this machine:

1. Open Keyboard Shortcuts: `Ctrl+K` then `Ctrl+S`.
2. Search for `claudeMirror.startSession`.
3. Confirm it is bound to **`Ctrl+Shift+C`**.
4. Press **`Ctrl+Shift+C`** and verify a Claude Mirror chat tab opens.
5. If it does not open, run `Ctrl+Shift+P` -> **Claude Mirror: Start New Session** once, then rebind `Ctrl+Shift+C` to `claudeMirror.startSession`.

---

## Keyboard Shortcuts

These are the shortcuts you need to know:

| Shortcut | What it does |
|----------|-------------|
| **`Ctrl+Shift+C`** | Open a new Claude session (the main shortcut) |
| **`Ctrl+Enter`** | Send your message |
| **`Enter`** | New line in the input (does NOT send) |
| **`Escape`** | Cancel / pause the current response |
| **`Ctrl+Shift+H`** | Open conversation history (resume past sessions) |
| **`Ctrl+Shift+M`** | Toggle between chat and terminal view |
| **`Ctrl+Alt+Shift+C`** | Send the current file's path to the chat |
| **`Ctrl+V`** | Paste an image from clipboard into the chat |

> **Mac users**: Replace `Ctrl` with `Cmd` for all shortcuts above.
>
> To customize shortcuts, open Keyboard Shortcuts (`Ctrl+K`, `Ctrl+S`) and search for `Claude Mirror` or `claudeMirror.*`.

---

## Sending Files to the Chat

Three ways to reference files in your messages:

1. **Right-click in Explorer** - Right-click any file or folder in the sidebar, select **"Claude Mirror: Send Path to Chat"**. Works with multiple selected files.

2. **The "+" button** - Click the **+** button next to the chat input. A file picker opens.

3. **Keyboard shortcut** - While editing a file, press **`Ctrl+Alt+Shift+C`** to send its path.

The path is inserted into the input box so you can add context before sending (e.g., "Fix the bug in `<path>`").

You can also **paste images** directly with **`Ctrl+V`** - they appear as thumbnails above the input.

---

## Updating After Code Changes

When you pull new code or make changes to the extension source:

```bash
cd C:\projects\claude-code-mirror
npm run deploy:local
```

Then reload VS Code: `Ctrl+Shift+P` -> **Developer: Reload Window**.

> **Why not just `npm run build`?** VS Code runs extensions from `~/.vscode/extensions/`, not from your local `dist/` folder. `deploy:local` builds, packages into a `.vsix`, and installs it where VS Code actually reads it.

---

## Development Mode (F5)

For debugging the extension source code itself:

1. Open `C:\projects\claude-code-mirror` in VS Code
2. Press **F5** to launch the Extension Development Host
3. Run `npm run watch` in a terminal for auto-rebuild on changes

---

## Overview

**Architecture**: Each tab creates its own CLI process (`claude -p --output-format stream-json`), stream parser, and React webview panel. A `TabManager` coordinates multiple independent sessions running in parallel.

```
                   TabManager
                      |
           +----------+----------+
           |                     |
      SessionTab 1          SessionTab 2         ...
      +-----------+         +-----------+
      | Process   |         | Process   |
      | Demux     |         | Demux     |
      | Control   |         | Control   |
      | MsgHandler|         | MsgHandler|
      | Panel     |         | Panel     |
      +-----------+         +-----------+
```

---

## Directory Structure

```
claude-code-mirror/
+-- package.json                          # Extension manifest, commands, settings
+-- tsconfig.json                         # TypeScript config (ES2022, JSX)
+-- webpack.config.js                     # Dual-target: extension (Node) + webview (browser)
+-- .vscodeignore
+-- scripts/
|   +-- deploy-local.ps1                  # Build + package + install (npm run deploy:local)
|   +-- verify-installed.ps1              # Verify extension installed correctly
|   +-- git-push.ps1                      # Stage + commit + push helper
+-- dist/                                 # Build output
|   +-- extension.js                      #   Extension host bundle
|   +-- webview.js                        #   React webview bundle
+-- src/
|   +-- extension/                        # Extension host code (Node.js context)
|   |   +-- extension.ts                  #   Activation, creates TabManager, registers commands
|   |   +-- commands.ts                   #   VS Code command handlers (routes via TabManager)
|   |   +-- process/
|   |   |   +-- ClaudeProcessManager.ts   #   Spawns and manages CLI process
|   |   |   +-- StreamDemux.ts            #   Parses JSON lines, routes events
|   |   |   +-- ControlProtocol.ts        #   Higher-level command API
|   |   +-- webview/
|   |   |   +-- WebviewProvider.ts        #   buildWebviewHtml() utility + legacy class
|   |   |   +-- MessageHandler.ts         #   postMessage bridge (uses WebviewBridge interface)
|   |   +-- session/
|   |   |   +-- SessionTab.ts             #   Per-tab bundle (process+demux+panel+handler)
|   |   |   +-- TabManager.ts             #   Manages all tabs, tracks active tab
|   |   |   +-- SessionNamer.ts           #   Auto-generates tab names via Haiku
|   |   |   +-- ActivitySummarizer.ts     #   Periodic tool-activity summaries via Haiku
|   |   |   +-- FileLogger.ts             #   Per-session log files on disk (2 MB rotation)
|   |   |   +-- SessionStore.ts           #   Persists session metadata in globalState
|   |   |   +-- PromptHistoryStore.ts     #   Persists user prompts (project + global scope)
|   |   |   +-- SessionFork.ts            #   Phase 3 stub (fork/rewind)
|   |   +-- terminal/                     #   Phase 2 stubs
|   |   +-- auth/                         #   Phase 5 stub
|   |   +-- types/
|   |       +-- stream-json.ts            #   CLI protocol type definitions
|   |       +-- webview-messages.ts       #   postMessage contract
|   +-- webview/                          # React webview code (browser context)
|       +-- index.tsx                     #   React entry point + ErrorBoundary
|       +-- App.tsx                       #   Main app with welcome/chat/status
|       +-- state/store.ts               #   Zustand state management
|       +-- hooks/
|       |   +-- useClaudeStream.ts        #   postMessage event dispatcher
|       |   +-- useRtlDetection.ts        #   Hebrew/Arabic RTL detection
|       +-- components/
|       |   +-- ChatView/
|       |   |   +-- MessageList.tsx       #   Scrollable message list
|       |   |   +-- MessageBubble.tsx     #   Single message with content blocks
|       |   |   +-- StreamingText.tsx     #   In-progress text with cursor
|       |   |   +-- ToolUseBlock.tsx      #   Tool use display (collapsible)
|       |   |   +-- CodeBlock.tsx         #   Syntax block with copy button
|       |   |   +-- PlanApprovalBar.tsx   #   Plan approval + question UI
|       |   |   +-- PromptHistoryPanel.tsx#   Browse past prompts (session/project/global)
|       |   |   +-- filePathLinks.tsx     #   Clickable file paths and URLs in messages
|       |   +-- InputArea/
|       |   |   +-- InputArea.tsx         #   Text input with RTL, Ctrl+Enter, image paste
|       |   +-- ModelSelector/
|       |   |   +-- ModelSelector.tsx     #   Model dropdown (Sonnet/Opus/Haiku)
|       |   +-- PermissionModeSelector/
|       |   |   +-- PermissionModeSelector.tsx  # Full Access / Supervised toggle
|       |   +-- TextSettingsBar/
|       |       +-- TextSettingsBar.tsx   #   Font size/family controls
|       +-- styles/
|           +-- global.css                #   VS Code theme variables
|           +-- rtl.css                   #   RTL-specific overrides
+-- Kingdom_of_Claudes_Beloved_MDs/       # Detailed component documentation
    +-- ARCHITECTURE.md                   #   Data flow and component interaction
    +-- SESSION_NAMER.md                  #   Auto-naming feature
    +-- ACTIVITY_SUMMARIZER.md            #   Activity summary feature
    +-- FILE_LOGGER.md                    #   File logging architecture
    +-- STREAM_JSON_PROTOCOL.md           #   CLI protocol reference
    +-- DRAG_AND_DROP_CHALLENGE.md        #   Why drag-and-drop isn't supported
```

---

## Component Index

**SessionTab** - Bundles all per-tab resources (process, demux, control, message handler, webview panel) and wires them together. Each tab is fully independent with its own CLI process. Generates a colored SVG icon for the VS Code tab bar and supports tab renaming via a hover button.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TabManager** - Manages all SessionTab instances. Tracks the active (focused) tab, provides create/close/closeAll methods, shares a single status bar item, assigns distinct colors from an 8-color palette, and groups tabs in the same editor column.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ClaudeProcessManager** - Spawns the Claude CLI child process with stream-json flags, handles stdin/stdout piping, process lifecycle, and crash detection. Instantiated per-tab by SessionTab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**StreamDemux** - Receives raw CLI JSON events and demultiplexes them into typed, semantic events (textDelta, toolUseStart, assistantMessage, etc.) for UI consumers. Instantiated per-tab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**WebviewProvider / buildWebviewHtml** - `buildWebviewHtml()` is an exported utility that generates CSP-safe HTML for webview panels. WebviewProvider class is retained for backward compatibility. SessionTab uses `buildWebviewHtml()` directly.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**MessageHandler** - Bidirectional bridge translating webview postMessages into CLI commands and StreamDemux events into webview messages. Accepts a `WebviewBridge` interface (implemented by SessionTab). Triggers auto-naming on first user message.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionNamer** - Spawns a one-shot `claude -p` process using Haiku to generate a 1-3 word tab name from the user's first message. Matches the language of the message (Hebrew/English). 10-second timeout, sanitized output, all errors silently logged.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_NAMER.md`

**ActivitySummarizer** - After N tool uses (configurable), spawns a Haiku call to summarize what Claude is doing. Updates tab title with a short label and shows a detailed summary in the status bar tooltip.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ACTIVITY_SUMMARIZER.md`

**FileLogger** - Writes per-session log files to disk. Auto-rotates at 2 MB. Files named `<session-name>_<dd-hh-mm>.log`. Renames when session is renamed. Controlled by `enableFileLogging` and `logDirectory` settings.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_LOGGER.md`

**PromptHistoryStore** - Persists user prompts at two scopes: project (workspaceState) and global (globalState). Deduplicates consecutive entries. Capped at 200 per scope. Browsed via `PromptHistoryPanel`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Stream-JSON Protocol** - Type definitions for the Claude CLI bidirectional JSON line protocol (stdin input, stdout output).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/STREAM_JSON_PROTOCOL.md`

**React Chat UI** - React 18 components for message display, streaming text, tool use blocks, code blocks, image display, and RTL-aware input. The input area supports sending prompts while Claude is busy (interrupt), matching Claude Code CLI behavior. Ctrl+V pastes images from clipboard as base64 attachments (shown as thumbnails above the input, removable before sending). Both Send and Cancel buttons are visible during processing; Escape cancels the current response.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PlanApprovalBar** - Dual-mode bar shown when Claude pauses for input: plan approval mode (Approve/Reject/Feedback buttons) or question mode (option buttons + custom answer textarea).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PromptHistoryPanel** - Modal overlay with 3 tabs (Session/Project/Global) for browsing and reusing past prompts. Click to insert, text filter, fetches data from extension via messaging.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TextSettingsBar** - In-webview UI for adjusting chat text font size and font family. Supports Hebrew-friendly font presets. Settings are stored in Zustand and synced from VS Code configuration on startup and on change.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ModelSelector** - Dropdown in the status bar for choosing the Claude model (Sonnet 4.5, Opus 4.6, Haiku 4.5, or CLI default). Selection is persisted to VS Code settings (`claudeMirror.model`) and synced back to the webview on startup and on change.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PermissionModeSelector** - Dropdown for choosing permission mode (Full Access or Supervised). Supervised mode restricts Claude to read-only tools. Applied on next session start via `--allowedTools`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Clear Session** - Button in the input area that resets all UI state (messages, cost, streaming) and restarts the CLI process. Sends `clearSession` message to the extension, which stops the current process and spawns a new one.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionStore** - Persists session metadata (ID, name, model, timestamps) in VS Code `globalState`. Used by the Conversation History QuickPick command to list and resume past sessions. Capped at 100 entries, sorted by most recently active.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Open Plan Docs** - "Plans" button in the status bar that opens HTML plan documents from `Kingdom_of_Claudes_Beloved_MDs/` in the default browser. Single file opens directly; multiple files show a QuickPick sorted by modification time. Also available via Command Palette (`claudeMirror.openPlanDocs`).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**File Path Insertion** - Drag-and-drop into editor-area webviews is blocked by VS Code, so direct drop is not supported. Supported workflows are: `+` file picker, Explorer context command `Claude Mirror: Send Path to Chat`, and keyboard shortcut `Ctrl+Alt+Shift+C` (active editor file path).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/DRAG_AND_DROP_CHALLENGE.md`

---

## All Commands (Command Palette)

Press `Ctrl+Shift+P` and type "Claude Mirror" to see all commands:

| Command | What it does |
|---------|-------------|
| **Start New Session** | Open a new Claude chat tab |
| **Stop Session** | Stop the active session's CLI process |
| **Toggle Chat/Terminal View** | Switch between chat UI and terminal mirror |
| **Send Message** | Send the current input (same as Ctrl+Enter) |
| **Compact Context** | Compact the conversation context in the CLI |
| **Resume Session** | Resume a previous session by ID |
| **Send Path to Chat** | Insert a file/folder path into the chat input |
| **Conversation History** | Browse and resume past sessions |
| **Cancel Current Response** | Stop Claude's current response |
| **Open Plan Document** | Open HTML plan docs from the project |
| **Open Log Directory** | Open the folder where session logs are stored |

---

## Configuration

All settings are under `claudeMirror.*` in VS Code Settings (`Ctrl+,`).

| Setting | Default | Description |
|---------|---------|-------------|
| `cliPath` | `"claude"` | Path to Claude CLI executable |
| `useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `autoRestart` | `true` | Auto-restart process on crash |
| `chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `chatFontFamily` | `""` | Font family for chat messages (empty = VS Code default) |
| `autoNameSessions` | `true` | Auto-generate tab names from first message using Haiku |
| `activitySummary` | `true` | Periodically summarize Claude's activity in the tab title |
| `activitySummaryThreshold` | `3` | Number of tool uses before triggering an activity summary (1-10) |
| `model` | `""` | Claude model for new sessions (empty = CLI default) |
| `permissionMode` | `"full-access"` | Permission mode: `full-access` or `supervised` (read-only tools only) |
| `enableFileLogging` | `true` | Write logs to disk files (one per session tab) |
| `logDirectory` | `""` | Directory for log files (empty = extension default storage) |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| react 18 | Webview UI framework |
| react-dom 18 | React DOM renderer |
| zustand 4 | Lightweight state management |
| webpack 5 | Bundling (dual-target) |
| ts-loader | TypeScript compilation in webpack |
| css-loader + style-loader | CSS bundling for webview |

---

## CLI Data Format Gotchas

The Claude CLI's stream-json protocol has several data format inconsistencies that the webview must handle defensively:

### User message content can be a string

With `--replay-user-messages`, the CLI echoes back `user` events. The `content` field may be a **plain string** instead of the expected `ContentBlock[]` array. If you call `.filter()` or `.map()` on it, React crashes and the entire component tree unmounts (text disappears).

**Fix**: Always normalize content before use:
```typescript
const normalized: ContentBlock[] = typeof content === 'string'
  ? [{ type: 'text', text: content }]
  : Array.isArray(content) ? content : [{ type: 'text', text: String(content) }];
```

This normalization is applied in `addUserMessage` (store) and defensively in `MessageBubble`.

### Result event cost fields may be undefined

The `result/success` event's `cost_usd`, `total_cost_usd`, and `usage` fields can be `undefined`. Calling `.toFixed()` on undefined crashes `StatusBar`.

**Fix**: Use nullish coalescing: `(cost?.costUsd ?? 0).toFixed(4)`

### General rule

**Never trust CLI event field types at runtime.** Always use defensive access (`?.`, `?? default`, `Array.isArray()` checks) for any data coming from the CLI protocol. The TypeScript interfaces describe the *ideal* shape, not the guaranteed runtime shape.

---

## Build & Deploy Workflow

### Critical rule (prevents stale-code bugs)

`npm run build` updates only your workspace `dist/`.
VS Code runs the extension from the installed folder under:

```
%USERPROFILE%\.vscode\extensions\
```

If you skip packaging + install, VS Code may run old code even though local source is updated.

### Canonical update flow (always use this)

Preferred:

```bash
cd C:\projects\claude-code-mirror
npm run deploy:local
```

Manual equivalent:

```bash
cd C:\projects\claude-code-mirror
npm run build
npx vsce package --allow-missing-repository
code --install-extension claude-code-mirror-0.1.0.vsix --force
```

Then run `Developer: Reload Window`.

### Post-install verification checklist (mandatory for new commands/menu/keybindings)

Fast path:

```bash
cd C:\projects\claude-code-mirror
npm run verify:installed
```

Manual checks:

Run these checks after installing:

```powershell
# 1) Verify the latest installed extension folder
$ext = Get-ChildItem -Path "$env:USERPROFILE\.vscode\extensions" -Directory `
  | Where-Object { $_.Name -like 'claude-code-mirror*' } `
  | Sort-Object LastWriteTime -Descending `
  | Select-Object -First 1
$ext.FullName

# 2) Verify installed manifest contains expected contributions
Get-Content -Path (Join-Path $ext.FullName 'package.json') `
  | Select-String -Pattern 'claudeMirror.sendFilePathToChat|keybindings|menus|editor/context|explorer/context'

# 3) Verify installed runtime bundle contains expected command symbol
Select-String -Path (Join-Path $ext.FullName 'dist\extension.js') `
  -Pattern 'sendFilePathToChat' | Select-Object -First 1
```

If any check fails, VS Code is still on stale code. Re-run package/install and reload window.

### Troubleshooting stale installs quickly

1. Confirm extension is installed: `code --list-extensions --show-versions | rg claude-code-mirror`
2. Reinstall with `--force`.
3. Reload window (`Developer: Reload Window`).
4. Check `Output -> Claude Mirror` for fresh startup timestamps after reload.

### Production build note

`npm run build` (which runs `webpack --mode production`) **strips `console.log` statements** via terser minification. Use `--mode development` when you need diagnostic logging in the webview.

### Debugging the webview

Open `Developer: Open Webview Developer Tools` in VS Code to access the webview's browser console. This shows React errors, state logs, and network issues. The webview runs inside a sandboxed iframe with a strict CSP.

### Blank webview panel (VS Code rendering bug)

The webview panel may open completely blank - no HTML renders at all (not even plain text without JavaScript). This is a **VS Code / Chromium webview rendering bug** where the webview iframe fails to initialize properly. It is NOT a code issue.

**Fix**: Open `Developer: Toggle Developer Tools` (Ctrl+Shift+I). This forces the webview to repaint and content appears. You can close Developer Tools immediately after - the webview will keep working.

**Symptoms**: The Output channel (`Claude Mirror`) shows `Webview: creating new panel` and `HTML length = ...` but no `Webview: received message type="ready"`. The panel is visible but empty.

**Known triggers**: VS Code reload, VS Code updates, certain window layouts. Observed on VS Code 1.109.0.

---

## Error Boundary

The React app is wrapped in an `ErrorBoundary` component (`index.tsx`) that catches render crashes and displays the error message + stack trace directly in the webview panel, instead of showing a blank screen. This is critical for debugging because webview errors are otherwise silent.

---

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **1. Core Chat** | Done | Process management, stream parsing, React chat UI |
| **1.5 Multi-Tab** | Done | Multiple parallel sessions in separate VS Code tabs (SessionTab + TabManager) |
| **2. Terminal Mirror** | Stub | PseudoTerminal mirroring same session |
| **3. Sessions** | Partial | Multi-tab sessions (done), resume (done), fork (done), conversation history (done), rewind (stub) |
| **4. Input** | Partial | File picker + Explorer send-path + keyboard shortcut (done), send-while-busy interrupt (done), image paste via Ctrl+V (done), RTL enhancements (done) |
| **5. Accounts** | Stub | Multi-account, compact mode, cost tracking |
| **6. Polish** | Pending | Virtualized scrolling, error recovery, theming |
