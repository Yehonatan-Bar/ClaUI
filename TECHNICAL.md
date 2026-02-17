# Claude Code Mirror - Technical Documentation

## Overview

A VS Code extension that provides a rich chat interface for Claude Code. The extension owns the Claude CLI process and distributes its output to a React-based webview chat UI (Phase 2 will add terminal mirroring).

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

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Claude CLI** installed and accessible as `claude` in PATH
- **VS Code** 1.85+

### Install (use in any project)

```bash
cd C:\projects\claude-code-mirror
npm install
npm run build
npx vsce package --allow-missing-repository
code --install-extension claude-code-mirror-0.1.0.vsix
```

After installation, the extension is available globally in VS Code - open any project and use it.

### Update after code changes

Preferred (single command):

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

Then **reload VS Code** (Ctrl+Shift+P -> `Developer: Reload Window`).

### Use the extension

1. Open any project in VS Code
2. Press **Ctrl+Shift+C** to start a Claude session (opens a new tab each time)
   - Or: **Ctrl+Shift+P** -> `Claude Mirror: Start New Session`
3. The chat panel opens. Type a message and press **Ctrl+Enter** to send
4. Press **Ctrl+Shift+C** again to open additional parallel sessions in separate tabs

### Development mode (F5)

For debugging the extension itself:

1. Open `C:\projects\claude-code-mirror` in VS Code
2. Press **F5** to launch the Extension Development Host
3. Changes rebuild automatically with `npm run watch`

### Keybindings

| Shortcut | Command |
|----------|---------|
| Ctrl+Shift+C | Start New Session |
| Ctrl+Shift+M | Toggle Chat/Terminal View |
| Ctrl+Alt+Shift+C | Send active file path to chat |
| Ctrl+Shift+H | Conversation History |
| Ctrl+Enter | Send message (in chat input, works even while Claude is busy) |
| Enter | New line (in chat input) |
| Escape | Cancel/pause current response (works when Claude Mirror panel is active) |

---

## Directory Structure

```
claude-code-mirror/
+-- package.json                          # Extension manifest, commands, settings
+-- tsconfig.json                         # TypeScript config (ES2022, JSX)
+-- webpack.config.js                     # Dual-target: extension (Node) + webview (browser)
+-- .vscodeignore
+-- dist/                                 # Build output
|   +-- extension.js                      #   Extension host bundle (15 KB)
|   +-- webview.js                        #   React webview bundle (170 KB)
+-- src/
|   +-- extension/                        # Extension host code (Node.js context)
|   |   +-- extension.ts                  #   Activation, creates TabManager
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
|   |   |   +-- SessionStore.ts           #   Persists session metadata in globalState
|   |   |   +-- SessionFork.ts            #   Phase 3 stub (fork/rewind)
|   |   +-- terminal/                     #   Phase 2 stubs
|   |   +-- auth/                         #   Phase 5 stub
|   |   +-- types/
|   |       +-- stream-json.ts            #   CLI protocol type definitions
|   |       +-- webview-messages.ts       #   postMessage contract
|   +-- webview/                          # React webview code (browser context)
|       +-- index.tsx                     #   React entry point
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
|       |   +-- InputArea/
|       |   |   +-- InputArea.tsx         #   Text input with RTL, Ctrl+Enter, clear session, interrupt, image paste
|       |   +-- ModelSelector/
|       |   |   +-- ModelSelector.tsx     #   Model dropdown (Sonnet/Opus/Haiku)
|       |   +-- TextSettingsBar/
|       |       +-- TextSettingsBar.tsx   #   Font size/family controls
|       +-- styles/
|           +-- global.css                #   VS Code theme variables
|           +-- rtl.css                   #   RTL-specific overrides
+-- Kingdom_of_Claudes_Beloved_MDs/       # Detailed component documentation
    +-- ARCHITECTURE.md                   #   Data flow and component interaction
    +-- SESSION_NAMER.md                  #   Auto-naming feature (data flow, gotchas, debugging)
    +-- STREAM_JSON_PROTOCOL.md           #   CLI protocol reference
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

**Stream-JSON Protocol** - Type definitions for the Claude CLI bidirectional JSON line protocol (stdin input, stdout output).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/STREAM_JSON_PROTOCOL.md`

**React Chat UI** - React 18 components for message display, streaming text, tool use blocks, code blocks, image display, and RTL-aware input. The input area supports sending prompts while Claude is busy (interrupt), matching Claude Code CLI behavior. Ctrl+V pastes images from clipboard as base64 attachments (shown as thumbnails above the input, removable before sending). Both Send and Cancel buttons are visible during processing; Escape cancels the current response.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TextSettingsBar** - In-webview UI for adjusting chat text font size and font family. Supports Hebrew-friendly font presets. Settings are stored in Zustand and synced from VS Code configuration on startup and on change.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ModelSelector** - Dropdown in the status bar for choosing the Claude model (Sonnet 4.5, Opus 4.6, Haiku 4.5, or CLI default). Selection is persisted to VS Code settings (`claudeMirror.model`) and synced back to the webview on startup and on change.
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

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.cliPath` | `"claude"` | Path to Claude CLI executable |
| `claudeMirror.useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `claudeMirror.autoRestart` | `true` | Auto-restart process on crash |
| `claudeMirror.chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `claudeMirror.chatFontFamily` | `""` | Font family for chat messages (empty = VS Code default) |
| `claudeMirror.autoNameSessions` | `true` | Auto-generate tab names from first message using Haiku |
| `claudeMirror.model` | `""` | Claude model to use for new sessions (empty = CLI default) |

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
