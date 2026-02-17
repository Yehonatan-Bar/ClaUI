# Architecture - Claude Code Mirror

## Data Flow

Each tab follows a unidirectional pipeline. All components below are instantiated per-tab inside `SessionTab`:

```
[User types in Webview Panel]
      |
      v  (postMessage via WebviewBridge)
[MessageHandler]  ------>  [ControlProtocol]  ------>  [ClaudeProcessManager]
                                                              |
                                                              | stdin: JSON line
                                                              v
                                                        [Claude CLI Process]
                                                              |
                                                              | stdout: JSON lines
                                                              v
                                                    [ClaudeProcessManager]
                                                              |
                                                              | 'event' emitter
                                                              v
                                                        [StreamDemux]
                                                              |
                                                    typed event emitters
                                                    (textDelta, toolUseStart,
                                                     assistantMessage, etc.)
                                                              |
                                                              v
                                                      [MessageHandler]
                                                              |
                                                              | postMessage via WebviewBridge
                                                              v
                                                    [React Webview Store]
                                                              |
                                                              v
                                                      [React Components]
```

**Multi-tab coordination:**
```
TabManager  ---manages--->  SessionTab 1  (own process, demux, panel)
            ---manages--->  SessionTab 2  (own process, demux, panel)
            ---manages--->  SessionTab N  ...
            ---tracks---->  activeTabId   (updated on panel focus)
```

---

## Extension Host Components

### ClaudeProcessManager (`process/ClaudeProcessManager.ts`)

Spawns and manages the Claude CLI child process.

**CLI command constructed:**
```
claude -p --verbose
  --output-format stream-json
  --input-format stream-json
  --include-partial-messages
  --replay-user-messages
```

**Key behaviors:**
- Uses `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']`
- Unsets the `CLAUDECODE` environment variable to prevent nested-session detection
- Parses stdout as newline-delimited JSON, buffering incomplete lines
- Non-JSON lines emitted as `'raw'` events (progress indicators, etc.)
- Supports `--resume <session-id>` and `--fork-session` flags for session management

**Events emitted:**
| Event | Payload | When |
|-------|---------|------|
| `event` | `CliOutputEvent` | Parsed JSON line from stdout |
| `raw` | `string` | Non-JSON stdout line |
| `stderr` | `string` | Stderr output |
| `exit` | `{ code, signal }` | Process exited |
| `error` | `Error` | Spawn or runtime error |

**Methods:**
| Method | Description |
|--------|-------------|
| `start(options?)` | Spawn CLI process. Options: resume, fork, cwd |
| `send(message)` | Write JSON line to stdin |
| `sendUserMessage(text)` | Send user text message |
| `sendCompact(instructions?)` | Request context compaction |
| `sendCancel()` | Cancel current request |
| `stop()` | SIGTERM the process |

---

### StreamDemux (`process/StreamDemux.ts`)

Demultiplexes raw `CliOutputEvent` objects into typed, semantic events.

**Event routing:**

| Input Event | Demux Output | Payload |
|-------------|-------------|---------|
| `system` (subtype: init) | `init` | `{ session_id, model, tools }` |
| `stream_event` -> message_start | `messageStart` | `{ messageId, model }` |
| `stream_event` -> content_block_delta (text) | `textDelta` | `{ messageId, blockIndex, text }` |
| `stream_event` -> content_block_start (tool_use) | `toolUseStart` | `{ messageId, blockIndex, toolName, toolId }` |
| `stream_event` -> content_block_delta (json) | `toolUseDelta` | `{ messageId, blockIndex, partialJson }` |
| `stream_event` -> content_block_stop | `blockStop` | `{ blockIndex }` |
| `stream_event` -> message_stop | `messageStop` | (none) |
| `assistant` | `assistantMessage` | Full `AssistantMessage` |
| `user` | `userMessage` | Full `UserMessage` |
| `result` | `result` | `ResultSuccess` or `ResultError` |

---

### ControlProtocol (`process/ControlProtocol.ts`)

Convenience wrapper over ClaudeProcessManager for sending commands.

- `sendText(text)` - Send plain text user message
- `sendWithImages(text, images)` - Send message with base64 image content blocks
- `compact(instructions?)` - Send compact control request
- `cancel()` - Send cancel control request

---

### WebviewProvider / buildWebviewHtml (`webview/WebviewProvider.ts`)

`buildWebviewHtml(webview, context)` is an exported utility function that generates CSP-safe HTML for any webview panel. SessionTab uses it directly when creating panels.

The `WebviewProvider` class is retained for backward compatibility but is no longer used by the main multi-tab flow.

**Security:** Strict Content Security Policy with nonce-based script loading:
```
default-src 'none';
style-src ${cspSource} 'unsafe-inline';
script-src 'nonce-${nonce}';
img-src ${cspSource} data:;
```

**Panel Configuration (applied by SessionTab):**
- `enableScripts: true` - Required for React
- `retainContextWhenHidden: true` - Preserves state when tab is not visible
- `localResourceRoots` - Restricted to `dist/` directory

---

### MessageHandler (`webview/MessageHandler.ts`)

Bidirectional bridge between the webview and the CLI process. Accepts a `WebviewBridge` interface instead of a concrete class.

**Webview -> Extension direction:**
| Webview Message | Action |
|-----------------|--------|
| `sendMessage` | Calls `control.sendText()` |
| `sendMessageWithImages` | Calls `control.sendWithImages()` |
| `cancelRequest` | Calls `control.cancel()` |
| `compact` | Calls `control.compact()` |
| `startSession` | Calls `processManager.start()` |
| `stopSession` | Calls `processManager.stop()` |
| `resumeSession` | Calls `processManager.start({ resume })` |
| `forkSession` | Calls `processManager.start({ resume, fork: true })` |

**Extension -> Webview direction:**
StreamDemux events are translated to `ExtensionToWebviewMessage` types and sent via `webview.postMessage()`.

---

## Webview Components

### Zustand Store (`state/store.ts`)

Central state for the React UI:

| State | Type | Purpose |
|-------|------|---------|
| `sessionId` | `string | null` | Active session ID |
| `model` | `string | null` | Active model name |
| `isConnected` | `boolean` | Session active flag |
| `isBusy` | `boolean` | Request in flight |
| `messages` | `ChatMessage[]` | Completed messages |
| `streamingMessageId` | `string | null` | Currently streaming message |
| `streamingBlocks` | `StreamingBlock[]` | In-progress content blocks |
| `cost` | `CostInfo` | Token and cost tracking |

### useClaudeStream Hook (`hooks/useClaudeStream.ts`)

Listens for `window.message` events (postMessages from extension host) and dispatches them to the Zustand store. Also exports `postToExtension()` for sending messages back.

### useRtlDetection Hook (`hooks/useRtlDetection.ts`)

Detects Hebrew (U+0590-U+05FF) and Arabic (U+0600-U+06FF) characters in text. Returns `direction: 'rtl' | 'ltr' | 'auto'` for use in `dir` attributes.

### React Components

**MessageList** - Scrollable container with auto-scroll. Pauses auto-scroll when user scrolls up (>100px from bottom). Renders completed messages and streaming blocks.

**MessageBubble** - Renders a completed message. Parses text content to extract fenced code blocks (``` delimiters). Applies RTL detection. Renders tool_use, tool_result, and image content blocks inline. Image blocks display as responsive thumbnails with rounded borders.

**StreamingText** - Renders in-progress text with a blinking cursor animation at the end.

**ToolUseBlock** - Collapsible panel showing tool name and input JSON. Shows "running..." indicator during streaming.

**CodeBlock** - Fenced code block with language label and copy-to-clipboard button. Uses VS Code theme variables for styling.

**InputArea** - Auto-growing textarea with RTL auto-detection. Ctrl+Enter sends, Enter adds newline. Shows Cancel button when busy. Browse button (folder icon) opens VS Code's native file picker dialog and pastes selected file paths into the input. Ctrl+V with an image in the clipboard attaches it as a base64 thumbnail preview above the input; multiple images can be queued and individually removed. When images are pending, the message is sent via `sendMessageWithImages` which encodes them as Anthropic image content blocks.

---

## Multi-Session Tab Architecture

### SessionTab (`session/SessionTab.ts`)

Bundles all resources for one Claude session tab:
- Creates its own `ClaudeProcessManager`, `StreamDemux`, `ControlProtocol`, `MessageHandler`
- Creates its own `vscode.WebviewPanel` using `buildWebviewHtml()`
- Implements `WebviewBridge` interface for MessageHandler
- Wires all events (process -> demux -> handler -> webview) internally
- Panel title: starts as `"Claude Mirror N"`, auto-renamed by SessionNamer after first user message
- Tab icon: colored SVG circle generated per-tab and set via `panel.iconPath` so all tab colors are visible in the VS Code tab bar simultaneously
- Rename: floating pencil button in the webview (appears on hover) triggers a VS Code input box to rename the tab
- Log prefix: `[Tab N]` on the shared output channel

**Public API:**
| Method | Description |
|--------|-------------|
| `startSession(options?)` | Start CLI process in this tab |
| `stopSession()` | Kill CLI process |
| `sendText(text)` | Send user message to CLI |
| `compact(instructions?)` | Request context compaction |
| `reveal()` | Focus this tab's panel |
| `dispose()` | Clean up all resources |

### SessionNamer (`session/SessionNamer.ts`)

Spawns a lightweight one-shot `claude -p` process (plain text, no stream-json) using Haiku to generate a 1-3 word session name from the user's first message. The name matches the language of the prompt (Hebrew or English).

**Flow:**
1. On first `sendMessage` or `sendMessageWithImages`, MessageHandler calls `sessionNamer.generateName(text)`
2. SessionNamer spawns `claude -p "<naming prompt>" --model claude-haiku-4-5-20251001`
3. Output is sanitized (stripped quotes/punctuation, rejected if empty, >40 chars, or >5 words)
4. On success, the callback updates `panel.title` with the generated name
5. On failure (timeout, bad output, CLI error), the default title is kept

**Safeguards:**
- 10-second timeout with SIGTERM
- Cleans `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` from environment
- User message truncated to 200 chars
- Configurable via `claudeMirror.autoNameSessions` setting (default: true)
- All errors silently logged, never surfaced to user

### SessionStore (`session/SessionStore.ts`)

Persists session metadata in VS Code's `globalState` for the Conversation History feature.

**Interface:**
```typescript
interface SessionMetadata {
  sessionId: string;   // CLI session ID
  name: string;        // Auto-generated or fallback "Session N"
  model: string;       // Model used (e.g., "claude-sonnet-4-5-20250929")
  startedAt: string;   // ISO date string
  lastActiveAt: string; // ISO date string
}
```

**Methods:**
- `getSessions()` - Returns all sessions sorted by `lastActiveAt` descending
- `saveSession(metadata)` - Upserts by `sessionId`, caps at 100, auto-sorts
- `removeSession(sessionId)` - Deletes a single session
- `clearAll()` - Wipes all stored sessions

**Integration points:**
- Created in `extension.ts activate()`, passed to `TabManager` and `registerCommands()`
- `TabManager` passes it to each `SessionTab`
- `SessionTab` saves metadata on `demux.init` (captures sessionId + model) and on session name generation
- `commands.ts showHistory` reads sessions and shows a VS Code QuickPick for resuming

**Keybinding:** `Ctrl+Shift+H` opens the history QuickPick.

### TabManager (`session/TabManager.ts`)

Manages `Map<string, SessionTab>`:
- `createTab()` - Creates new SessionTab with next color from palette, sets as active
- `getActiveTab()` - Returns focused tab (or null)
- `getOrCreateTab()` - Returns active tab or creates one
- `closeTab(tabId)` - Disposes a specific tab
- `closeAllTabs()` - Cleanup for deactivate
- Active tab tracking via `onFocused` callback
- Single shared status bar item across all tabs
- Tab color palette: 8 distinct colors (blue, coral, green, orange, purple, cyan, gold, brick) cycling across tabs
- Tab grouping: first tab opens `ViewColumn.Beside`, subsequent tabs reuse the same column

### WebviewBridge Interface (`webview/MessageHandler.ts`)

Decouples MessageHandler from the concrete WebviewProvider class:
```typescript
interface WebviewBridge {
  postMessage(msg: ExtensionToWebviewMessage): void;
  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void;
}
```
SessionTab implements this interface, allowing each tab to provide its own panel-based bridge.

---

## Extension Lifecycle

### Activation
1. `extension.ts:activate()` creates `TabManager` with shared output channel
2. Commands registered via `registerCommands(context, tabManager, log)`
3. No CLI process or webview is created until user triggers a command

### Tab Creation (per session)
1. `TabManager.createTab()` instantiates a new `SessionTab`
2. SessionTab creates its own process, demux, control, handler, and webview panel
3. SessionNamer is wired into MessageHandler to auto-name the tab on first message
4. All event wiring happens inside SessionTab constructor
5. Panel callbacks (`onClosed`, `onFocused`) feed back to TabManager

### Command Routing
All commands (start, stop, send, compact, resume, sendFilePath, openPlanDocs) route through TabManager to the active (focused) tab. `startSession` and `resumeSession` always create a new tab. `openPlanDocs` is independent of tabs - it scans `Kingdom_of_Claudes_Beloved_MDs/` for `.html` files and opens the selected one in the default browser via `vscode.env.openExternal()`.

### Open Plan Docs (`commands.ts`)
The `claudeMirror.openPlanDocs` command opens HTML plan documents in the default browser:
1. Webview sends `openPlanDocs` message -> MessageHandler delegates to command
2. Command reads workspace `Kingdom_of_Claudes_Beloved_MDs/` directory
3. Filters for `.html` files, sorts by modification time (newest first)
4. Single file: opens directly. Multiple files: shows QuickPick with relative timestamps
5. Opens via `vscode.env.openExternal(vscode.Uri.file(path))`
6. Also accessible from Command Palette: "Claude Mirror: Open Plan Document"

**UI**: "Plans" button in the status bar (next to "History"), styled identically.

### Process Crash Recovery (per-tab)
1. SessionTab's process emits `'exit'` with non-zero code
2. Tab posts `sessionEnded: 'crashed'` to its own webview
3. If `autoRestart` is true, prompts user to restart (notification includes tab number)
4. Restart uses `--resume <session-id>` to continue

### Tab Closure
1. User closes the webview panel tab
2. `onDidDispose` fires -> process killed -> TabManager removes tab
3. TabManager selects next most recently created tab as active

### Deactivation
1. `deactivate()` calls `tabManager.closeAllTabs()`
2. Each tab disposes its process and panel
