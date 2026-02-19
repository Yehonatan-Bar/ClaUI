# ClaUi - Technical Documentation

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

For build instructions, development setup, and contributing: see [DEVELOPMENT.md](DEVELOPMENT.md).

User-facing documentation (features, shortcuts, settings): see [README.md](README.md).

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
|   |   |   +-- ActivitySummarizer.ts     #   Periodic tool activity summary via Haiku
|   |   |   +-- MessageTranslator.ts      #   Translates assistant messages to Hebrew via Sonnet CLI call
|   |   |   +-- FileLogger.ts             #   Per-session file logging with rotation and rename
|   |   |   +-- SessionStore.ts           #   Persists session metadata in globalState
|   |   |   +-- ConversationReader.ts     #   Reads conversation history from Claude's session JSONL files
|   |   |   +-- PromptHistoryStore.ts     #   Persists prompt history (project + global scope)
|   |   |   +-- SessionFork.ts            #   Phase 3 stub (rewind)
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
|       |   +-- useRtlDetection.ts        #   detectRtl() helper for InputArea (messages use dir="auto")
|       |   +-- useFileMention.ts         #   @ file mention trigger detection, debounced search, popup state
|       +-- components/
|       |   +-- ChatView/
|       |   |   +-- MessageList.tsx       #   Scrollable message list
|       |   |   +-- MessageBubble.tsx     #   Single message with content blocks
|       |   |   +-- StreamingText.tsx     #   In-progress text with cursor
|       |   |   +-- ToolUseBlock.tsx      #   Tool use display (collapsible, plan-aware)
|       |   |   +-- PlanApprovalBar.tsx  #   Dual-mode bar: plan approval (Approve/Reject/Feedback) or question UI (option buttons + custom answer)
|       |   |   +-- PromptHistoryPanel.tsx #  3-tab prompt history overlay (session/project/global)
|       |   |   +-- CodeBlock.tsx         #   Syntax block with copy button
|       |   |   +-- MarkdownContent.tsx  #   Markdown rendering with sanitization and link detection
|       |   |   +-- filePathLinks.tsx   #   Clickable file path and URL detection and rendering
|       |   +-- InputArea/
|       |   |   +-- InputArea.tsx         #   Text input with RTL, Ctrl+Enter, clear session, interrupt, image paste, @ file mentions
|       |   |   +-- FileMentionPopup.tsx  #   Autocomplete popup for @ file mentions
|       |   |   +-- GitPushPanel.tsx      #   Config panel for git push (status, ask Claude to configure)
|       |   +-- ModelSelector/
|       |   |   +-- ModelSelector.tsx          #   Model dropdown (Sonnet/Opus/Haiku)
|       |   +-- PermissionModeSelector/
|       |   |   +-- PermissionModeSelector.tsx #   Full Access / Supervised mode toggle
|       |   +-- Vitals/
|       |   |   +-- SessionTimeline.tsx  #   Vertical color-coded turn minimap
|       |   |   +-- WeatherWidget.tsx    #   Animated weather mood icon
|       |   |   +-- CostHeatBar.tsx      #   Cost accumulation gradient bar
|       |   |   +-- VitalsContainer.tsx  #   Conditional wrapper for weather + cost bar
|       |   +-- TextSettingsBar/
|       |       +-- TextSettingsBar.tsx   #   Font size/family/theme controls
|       +-- styles/
|           +-- global.css                #   VS Code theme variables
|           +-- markdown.css              #   Markdown element styles (headers, lists, tables, etc.)
|           +-- rtl.css                   #   RTL-specific overrides (includes Markdown RTL rules)
+-- Kingdom_of_Claudes_Beloved_MDs/       # Detailed component documentation
    +-- ARCHITECTURE.md                   #   Data flow and component interaction
    +-- ACTIVITY_SUMMARIZER.md            #   Periodic activity summary via Haiku
    +-- DRAG_AND_DROP_CHALLENGE.md        #   Why drag-and-drop is blocked, workarounds
    +-- FILE_LOGGER.md                    #   File-based logging with rotation and rename
    +-- FILE_MENTION.md                   #   @ file mention autocomplete feature
    +-- GIT_PUSH_BUTTON.md               #   Git push button and configuration
    +-- MARKDOWN_RENDERING.md            #   Markdown rendering pipeline (marked + DOMPurify)
    +-- MESSAGE_TRANSLATION.md           #   Hebrew translation via Sonnet CLI
    +-- SESSION_NAMER.md                  #   Auto-naming feature (data flow, gotchas, debugging)
    +-- SESSION_VITALS.md                 #   Session health dashboard (timeline, weather, cost bar)
    +-- STREAM_JSON_PROTOCOL.md           #   CLI protocol reference
```

---

## Component Index

**SessionTab** - Bundles all per-tab resources (process, demux, control, message handler, webview panel) and wires them together. Each tab is fully independent with its own CLI process. Generates a colored SVG icon for the VS Code tab bar and supports tab renaming via a hover button.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TabManager** - Manages all SessionTab instances. Tracks the active (focused) tab, provides create/close/closeAll methods, shares a single status bar item, assigns distinct colors from an 8-color palette, and groups tabs in the same editor column.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ClaudeProcessManager** - Spawns the Claude CLI child process with stream-json flags, handles stdin/stdout piping, process lifecycle, and crash detection. Uses `taskkill /F /T` on Windows to kill the entire process tree (required because `shell: true` creates a cmd.exe wrapper that SIGTERM alone cannot penetrate). Instantiated per-tab by SessionTab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**StreamDemux** - Receives raw CLI JSON events and demultiplexes them into typed, semantic events (textDelta, toolUseStart, messageDelta, assistantMessage, etc.) for UI consumers. Instantiated per-tab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**WebviewProvider / buildWebviewHtml** - `buildWebviewHtml()` is an exported utility that generates CSP-safe HTML for webview panels. WebviewProvider class is retained for backward compatibility. SessionTab uses `buildWebviewHtml()` directly.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**MessageHandler** - Bidirectional bridge translating webview postMessages into CLI commands and StreamDemux events into webview messages. Accepts a `WebviewBridge` interface (implemented by SessionTab). Triggers auto-naming on first user message. Detects plan approval pauses (ExitPlanMode/AskUserQuestion) and forwards approval responses.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionNamer** - Spawns a one-shot `claude -p` process using Haiku to generate a 1-3 word tab name from the user's first message. Matches the language of the message (Hebrew/English). 10-second timeout, sanitized output, all errors silently logged.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_NAMER.md`

**ActivitySummarizer** - Periodically summarizes Claude's tool activity via Haiku. After every N tool uses (configurable, default 3), sends enriched tool names to Haiku for a short label + full summary. Displays a detailed summary panel in the busy indicator (short label + full sentence). Updates status bar tooltip. Does NOT overwrite tab title (session name stays fixed). Debounces rapid tool uses, prevents concurrent calls.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ACTIVITY_SUMMARIZER.md`

**Message Translation** -- Translates assistant message text to Hebrew using a one-shot Claude Sonnet 4.6 CLI call. Triggered by a "Translate" button on each assistant message. Translations are cached per message; toggling between original and translated view is instant after the first translation. Code blocks and technical terms are preserved untranslated.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/MESSAGE_TRANSLATION.md`

**FileLogger** - Writes log lines to disk files alongside the OutputChannel. Each session tab gets its own log file named `<session-name>_<dd-hh-mm>.log`. A global logger captures extension-level messages. Files auto-rotate at 2MB, rename when the session name changes, and new files are created on Reload Window or new session. Configurable via `claudeMirror.enableFileLogging` and `claudeMirror.logDirectory`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_LOGGER.md`

**Stream-JSON Protocol** - Type definitions for the Claude CLI bidirectional JSON line protocol (stdin input, stdout output).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/STREAM_JSON_PROTOCOL.md`

**Markdown Rendering** - Text content in messages is rendered as formatted Markdown using `marked` (parser) and `DOMPurify` (sanitizer). Supports bold, italic, headers, lists, tables, blockquotes, inline code, links, and horizontal rules. Fenced code blocks are extracted first and rendered by `CodeBlock` (with copy/collapse); remaining text segments go through `MarkdownContent`. Bare file paths and URLs in rendered Markdown are linkified via DOM post-processing. Full RTL/Hebrew support with directional overrides for blockquotes, lists, and code.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/MARKDOWN_RENDERING.md`

**React Chat UI** - React 18 components for message display, streaming text, tool use blocks, code blocks, image display, and RTL-aware input. The input area supports sending prompts while Claude is busy (interrupt), matching Claude Code CLI behavior. Ctrl+V pastes images from clipboard as base64 attachments (shown as thumbnails above the input, removable before sending). Both Send and Cancel buttons are visible during processing; Escape cancels the current response.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TextSettingsBar** - In-webview UI for adjusting chat text font size, font family, and typing personality theme. Supports Hebrew-friendly font presets and three rendering themes: Terminal Hacker, Retro, and Zen. Settings are stored in Zustand and synced from VS Code configuration on startup and on change.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ModelSelector** - Dropdown in the status bar for choosing the Claude model (Sonnet 4.6, Sonnet 4.5, Opus 4.6, Haiku 4.5, or CLI default). Selection is persisted to VS Code settings (`claudeMirror.model`) and synced back to the webview on startup and on change. Shows the currently active model label when connected.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PermissionModeSelector** - Dropdown in the status bar for choosing between "Full Access" (all tools auto-approved, default) and "Supervised" (only read-only tools allowed, write tools denied). Selection is persisted to VS Code settings (`claudeMirror.permissionMode`). In supervised mode, `--allowedTools` is passed to the CLI to restrict to read-only tools. Changes take effect on next session start.

**GitPushButton** - One-click git add/commit/push via the `scripts/git-push.ps1` PowerShell script. The "Git" button in InputArea executes the script with the session tab name as commit message. A companion gear button opens a configuration panel where users can ask Claude to set up or modify the git push settings (`claudeMirror.gitPush.*`). If not configured (enabled=false), clicking the Git button opens the config panel instead. Results appear as auto-dismissing toast notifications.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/GIT_PUSH_BUTTON.md`
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Clear Session** - Button in the input area that resets all UI state (messages, cost, streaming) and restarts the CLI process. Sends `clearSession` message to the extension, which stops the current process and spawns a new one.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionStore** - Persists session metadata (ID, name, model, timestamps, first prompt) in VS Code `globalState`. Used by the Conversation History QuickPick command to list and resume past sessions. Shows session name, model, relative time, and first prompt line. Preserves existing names when sessions are resumed. Capped at 100 entries, sorted by most recently active.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ConversationReader** - Reads full conversation history from Claude Code's local session storage (`~/.claude/projects/<project-hash>/<session-id>.jsonl`). When resuming a session, the CLI in pipe mode waits for user input before replaying messages. ConversationReader bypasses this by reading the JSONL file directly, merging partial assistant entries by message ID, filtering out tool_result and thinking blocks, and sending the conversation to the webview for immediate display. Used by `SessionTab.startSession()` during resume (not fork).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PromptHistoryStore** - Persists user prompts at two scopes: project (`workspaceState`) and global (`globalState`). Prompts are saved on every `sendMessage`/`sendMessageWithImages`. Deduplicates consecutive entries, capped at 200 per scope. The webview requests history via `getPromptHistory` message and receives it via `promptHistoryResponse`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Prompt History Panel** - Modal overlay with 3 tabs (Session / Project / Global) showing prompt history. Session tab uses in-memory `promptHistory` from the Zustand store. Project and Global tabs fetch from `PromptHistoryStore` via extension messaging. Includes text filter and click-to-insert into the input textarea. Opened via the "H" button in the input area.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**File Mention (@)** - Inline autocomplete triggered by typing `@` in the chat textarea. Searches workspace files via `vscode.workspace.findFiles()` with 150ms debounce, showing results in a popup above the input. Navigate with ArrowUp/Down, select with Enter/Tab/click. Replaces `@query` with the relative file path. Uses custom DOM events for extension-to-webview communication (same pattern as prompt history). All state is local to the `useFileMention` hook (not in Zustand).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_MENTION.md`

**Plan Approval UI** - When Claude calls `ExitPlanMode` or `AskUserQuestion`, the CLI pauses waiting for stdin input. The extension detects this via the `messageDelta` event with `stop_reason: 'tool_use'`, shows an approval bar with Approve/Reject/Feedback buttons, and sends the user's response back to the CLI. Plan tool blocks render with distinct blue styling and show extracted plan text instead of raw JSON.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Open Plan Docs** - "Plans" button in the status bar that opens HTML plan documents from `Kingdom_of_Claudes_Beloved_MDs/` in the default browser. Single file opens directly; multiple files show a QuickPick sorted by modification time. When no plan documents exist, offers to activate the Plans feature by injecting a "Plan mode" prompt into the project's `CLAUDE.md` (with Hebrew or English language choice). Also available via Command Palette (`claudeMirror.openPlanDocs`).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Editable Prompts** - Users can edit previously sent messages by hovering over a user message and clicking "Edit". The message content switches to an inline textarea. On send, all messages from the edit point onward are removed from the UI, the current CLI session is stopped, a new session starts, and the edited prompt is sent as the first message. Only text-only user messages are editable (not images). The edit button is hidden while the assistant is busy.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Fork Conversation** - Users can fork the conversation from any user message by hovering and clicking "Fork". This opens a new tab that uses `--resume <sessionId> --fork-session` to create a branched CLI session with full conversation context. After the CLI replays all messages, the webview truncates messages at the fork point (keeping only history before the forked message) and places the forked message's text into the input area. The user can then edit and re-send, getting a different response branch. Uses a 500ms debounced timer to detect replay completion. Key files: `MessageBubble.tsx` (Fork button), `MessageList.tsx` (handler), `MessageHandler.ts` (`forkFromMessage`), `commands.ts` (`claudeMirror.forkFromMessage`), `SessionTab.ts` (`setForkInit`), `App.tsx` (fork completion logic), `InputArea.tsx` (`fork-set-input` listener).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Session Vitals** - Visual session health dashboard with 5 components: Session Timeline (vertical color-coded minimap alongside messages, click-to-jump), Weather Widget (animated mood icon reflecting error/success patterns), Cost Heat Bar (gradient strip showing cost accumulation), Turn Intensity Borders (colored left border on assistant messages based on tool activity), and a Vitals toggle button in the StatusBar. Data pipeline: `MessageHandler` builds `TurnRecord` on each CLI result event, sends to webview via `turnComplete` postMessage, stored in Zustand (`turnHistory[]`, `turnByMessageId{}`). Weather mood recalculated on each turn via sliding window algorithm. All components hidden when vitals disabled.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_VITALS.md`

**File Path Insertion** - Drag-and-drop into editor-area webviews is blocked by VS Code, so direct drop is not supported. Supported workflows are: `+` file picker, Explorer context command `ClaUi: Send Path to Chat`, and keyboard shortcut `Ctrl+Alt+Shift+C` (active editor file path).
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
| `claudeMirror.typingTheme` | `"zen"` | Response rendering personality theme: "terminal-hacker", "retro", or "zen" |
| `claudeMirror.autoNameSessions` | `true` | Auto-generate tab names from first message using Haiku |
| `claudeMirror.activitySummary` | `true` | Periodically summarize tool activity in busy indicator via Haiku |
| `claudeMirror.activitySummaryThreshold` | `3` | Tool uses before triggering an activity summary (1-10) |
| `claudeMirror.model` | `""` | Claude model to use for new sessions (empty = CLI default) |
| `claudeMirror.permissionMode` | `"full-access"` | Permission mode: "full-access" (all tools) or "supervised" (read-only tools only) |
| `claudeMirror.enableFileLogging` | `true` | Write logs to disk files in addition to the Output Channel |
| `claudeMirror.logDirectory` | `""` | Directory for log files (empty = extension's default storage) |
| `claudeMirror.sessionVitals` | `true` | Show Session Vitals dashboard (timeline, weather, cost bar, turn borders) |
| `claudeMirror.gitPush.enabled` | `true` | Whether git push is configured and ready to use via the Git button |
| `claudeMirror.gitPush.scriptPath` | `"scripts/git-push.ps1"` | Path to the git push script (relative to workspace root) |
| `claudeMirror.gitPush.commitMessageTemplate` | `"{sessionName}"` | Commit message template ({sessionName} = tab name) |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| react 18 | Webview UI framework |
| react-dom 18 | React DOM renderer |
| zustand 4 | Lightweight state management |
| marked | Markdown-to-HTML parser (GFM support) |
| dompurify | HTML sanitizer for XSS prevention |
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
# Install the VSIX matching the current version in package.json:
code --install-extension claude-code-mirror-*.vsix --force
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
  | Where-Object { $_.Name -like '*claude-code-mirror*' } `
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
4. Check `Output -> ClaUi` for fresh startup timestamps after reload.

### Production build note

`npm run build` (which runs `webpack --mode production`) **strips `console.log` statements** via terser minification. Use `--mode development` when you need diagnostic logging in the webview.

### Debugging the webview

Open `Developer: Open Webview Developer Tools` in VS Code to access the webview's browser console. This shows React errors, state logs, and network issues. The webview runs inside a sandboxed iframe with a strict CSP.

### Blank webview panel (VS Code rendering bug)

The webview panel may open completely blank - no HTML renders at all (not even plain text without JavaScript). This is a **VS Code / Chromium webview rendering bug** where the webview iframe fails to initialize properly. It is NOT a code issue.

**Fix**: Open `Developer: Toggle Developer Tools` (Ctrl+Shift+I). This forces the webview to repaint and content appears. You can close Developer Tools immediately after - the webview will keep working.

**Symptoms**: The Output channel (`ClaUi`) shows `Webview: creating new panel` and `HTML length = ...` but no `Webview: received message type="ready"`. The panel is visible but empty.

**Known triggers**: VS Code reload, VS Code updates, certain window layouts. Observed on VS Code 1.109.0.

---

## Error Boundary

The React app is wrapped in an `ErrorBoundary` component (`index.tsx`) that catches render crashes and displays the error message + stack trace directly in the webview panel, instead of showing a blank screen. This is critical for debugging because webview errors are otherwise silent.

---

## VS Code Marketplace Publishing

### Publisher Info

| Item | Value |
|------|-------|
| Publisher ID | `JhonBar` |
| Publisher Name | Jhon Bar |
| Marketplace Manage | https://marketplace.visualstudio.com/manage/publishers/JhonBar |
| Extension URL | https://marketplace.visualstudio.com/items?itemName=JhonBar.claude-code-mirror |
| Azure DevOps (PAT) | https://dev.azure.com/yonzbar/_usersSettings/tokens |
| Repository | https://github.com/Yehonatan-Bar/ClaUI |

### PAT (Personal Access Token) Requirements

When creating/renewing a PAT at the Azure DevOps link above:
- **Organization**: Must be **"All accessible organizations"** (not a specific org)
- **Scopes**: Custom defined > **Marketplace > Manage**
- PAT expires periodically - renew when `vsce publish` fails with auth errors

### Publishing an Update (Step by Step)

After making code changes and testing locally with `npm run deploy:local`:

```bash
cd C:\projects\claude-code-mirror

# 1. Make sure you're logged in (one-time, or after PAT renewal)
vsce login JhonBar

# 2. Publish with automatic version bump
vsce publish patch
```

**What `vsce publish patch` does automatically:**
1. Bumps `version` in `package.json` (e.g., `0.1.0` -> `0.1.1`)
2. Runs `npm run build` (via the `vscode:prepublish` script)
3. Packages everything into a `.vsix` (respecting `.vscodeignore`)
4. Uploads to the Marketplace
5. Verification runs (usually takes up to 5 minutes)

**Version bump options:**

| Command | Example | Use when |
|---------|---------|----------|
| `vsce publish patch` | 0.1.0 -> 0.1.1 | Bug fixes, small changes |
| `vsce publish minor` | 0.1.1 -> 0.2.0 | New features |
| `vsce publish major` | 0.2.0 -> 1.0.0 | Breaking changes |

**After publishing:**
- Update `CHANGELOG.md` with the new version entry
- Users with auto-update enabled will get the new version automatically
- The Marketplace page (`README.md`) updates within a few minutes

### Publishing via Website (Fallback)

If PAT/CLI issues prevent `vsce publish`:

```bash
# Build the .vsix package only
vsce package
```

Then upload the `.vsix` manually at https://marketplace.visualstudio.com/manage/publishers/JhonBar

Note: Manual upload does NOT auto-bump the version. Update `version` in `package.json` yourself before running `vsce package`.

### Pre-publish Checklist

1. Test locally with `npm run deploy:local` + VS Code reload
2. Ensure `npm run build` succeeds
3. Verify `images/icon.png` exists (copied from `src/logo.png`)

### Key Files for Marketplace

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest (`publisher`, `icon`, `repository`, `license`) |
| `README.md` | Displayed as the extension's Marketplace page |
| `CHANGELOG.md` | Displayed in the "Changelog" tab on Marketplace |
| `LICENSE` | MIT license |
| `images/icon.png` | Extension icon (must NOT be in `src/` - excluded by `.vscodeignore`) |
| `.vscodeignore` | Controls what goes into the `.vsix` package |

### Tool Installation

```bash
npm install -g @vscode/vsce
```

---

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **1. Core Chat** | Done | Process management, stream parsing, React chat UI |
| **1.5 Multi-Tab** | Done | Multiple parallel sessions in separate VS Code tabs (SessionTab + TabManager) |
| **2. Terminal Mirror** | Stub | PseudoTerminal mirroring same session |
| **3. Sessions** | Partial | Multi-tab sessions (done), resume (done), fork from message (done), conversation history (done), rewind (stub) |
| **4. Input** | Partial | File picker + Explorer send-path + keyboard shortcut (done), send-while-busy interrupt (done), image paste via Ctrl+V (done), RTL enhancements (done), editable prompts (done) |
| **5. Accounts** | Stub | Multi-account, compact mode, cost tracking |
| **6. Polish** | Pending | Virtualized scrolling, error recovery, theming |
