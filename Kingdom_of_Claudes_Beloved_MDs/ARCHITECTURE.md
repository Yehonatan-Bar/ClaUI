# Architecture - ClaUi

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
- Exit/error handlers are guarded against stale process references: during rapid stop()+start() (e.g. edit-and-resend), the old process's async exit handler will NOT null-out the newly spawned process reference

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
| `sendCancel()` | Cancel: kills the process (polite cancel is unreliable). SessionTab auto-resumes. |
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
| `stream_event` -> message_delta | `messageDelta` | `{ stopReason }` |
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
- `cancel()` - Kill the CLI process (auto-resumed by SessionTab exit handler)

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
| `planApprovalResponse` | Sends approve/reject/feedback text via `control.sendText()` |
| `openFile` | Opens a file in VS Code editor via `vscode.commands.executeCommand('vscode.open', uri)` |
| `openUrl` | Opens a URL in the default browser via `vscode.env.openExternal()` (http/https only) |
| `switchToSonnet` | Calls `SessionTab.switchModel('claude-sonnet-4-6')` -- stops process and resumes with new model |

**Extension -> Webview direction:**
StreamDemux events are translated to `ExtensionToWebviewMessage` types and sent via `webview.postMessage()`.

**Plan Approval Detection:**
MessageHandler tracks tool names during streaming (`currentMessageToolNames`). When `messageDelta` fires with `stopReason === 'tool_use'` and one of the tools is `ExitPlanMode` or `AskUserQuestion`, it sends a `planApprovalRequired` message to the webview with the `toolName`. The user's response is sent back as a plain text message to the CLI via stdin. For plan approvals: approve/reject/feedback text. For questions: the selected option label(s) or a custom text answer.

**Stale Plan Mode Detection (post-compaction):**
After context compaction, the Claude model may call `ExitPlanMode` as a stale artifact (the compacted context mentions plan mode, but no real plan exists). MessageHandler tracks a `planModeActive` flag:
- Set to `true` when `EnterPlanMode` tool is seen in `toolUseStart`
- Set to `false` when the user responds to an ExitPlanMode approval (approve/reject/feedback)
- When `ExitPlanMode` is detected but `planModeActive` is `false`, the extension auto-approves silently (`"Yes, proceed with the plan."`) instead of showing the approval bar. This prevents the user from getting stuck on a "Plan Ready for Review" prompt with no actual plan to review.

**Plan Approval Cleanup (multiple safety nets):**
The `pendingApproval` state is cleared in several places to prevent the approval bar from lingering:
1. **Button click**: PlanApprovalBar handlers call `setPendingApproval(null)` immediately on approve/reject/feedback.
2. **Text input**: InputArea detects `pendingApproval` and routes typed messages as `planApprovalResponse` (feedback or questionAnswer), clearing the state.
3. **processBusy: true**: useClaudeStream clears `pendingApproval` when the CLI becomes busy again (sent when user sends a message or approval response).
4. **Session end**: `endSession` in the store resets `pendingApproval` to null.

**Important**: `messageStart` does NOT clear `pendingApproval`. After ExitPlanMode, the CLI can emit additional empty message turns before `result/success`, which would prematurely hide the approval bar before the user interacts with it. Similarly, `costUpdate` does NOT clear `pendingApproval` since newer CLI flows may emit result/cost updates before the user responds.

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
| `pendingApproval` | `{ toolName, planText } | null` | Plan approval waiting state |

### useClaudeStream Hook (`hooks/useClaudeStream.ts`)

Listens for `window.message` events (postMessages from extension host) and dispatches them to the Zustand store. Also exports `postToExtension()` for sending messages back.

### RTL Detection (`hooks/useRtlDetection.ts`)

Exports `detectRtl(text)` which checks for Hebrew (U+0590-U+05FF) and Arabic (U+0600-U+06FF) characters. Used only by InputArea for per-keystroke textarea direction. Message bubbles and streaming text use the browser's native `dir="auto"` (first-strong-character algorithm) instead, so a mostly-English message containing a few Hebrew words stays LTR. MarkdownContent applies `dir="auto"` to each block-level element (p, li, headings, td) for per-paragraph direction detection.

### React Components

**MessageList** - Scrollable container with auto-scroll. Pauses auto-scroll when user scrolls up (>100px from bottom). Shows a floating "scroll to bottom" arrow button when the user has scrolled up; clicking it smooth-scrolls back to the latest message. Renders completed messages and streaming blocks.

**MessageBubble** - Renders a completed message. Parses text content to extract fenced code blocks (``` delimiters). Uses `dir="auto"` for automatic bidi direction. Renders tool_use, tool_result, and image content blocks inline. Tool result blocks are rendered with a collapsible panel (collapsed by default) to keep the chat clean - file paths inside tool results are also clickable. Image blocks display as responsive thumbnails with rounded borders. File paths in plain text segments are detected and rendered as clickable links via `renderTextWithFileLinks()`. A **Copy button** appears on hover in the message role header for both user and assistant messages, copying the full text content to the clipboard (uses Clipboard API with `execCommand` fallback). Shows "Copied!" confirmation for 2 seconds.

**StreamingText** - Renders in-progress text with a blinking cursor animation at the end.

**ToolUseBlock** - Collapsible panel showing tool name and input JSON, **collapsed by default** with a disclosure triangle to expand. Shows "running..." indicator during streaming. Plan tools (`ExitPlanMode`, `AskUserQuestion`) get distinct blue styling, friendly labels ("Plan" / "Question"), and display extracted plan text instead of raw JSON. File paths inside tool content are rendered as clickable links.

**PlanApprovalBar** - Dual-mode action bar shown when `pendingApproval` is set in the store. Renders different UI based on `toolName`:
- **ExitPlanMode**: Displays "Plan Ready for Review" with three buttons: Approve, Reject, and Give Feedback. Feedback mode expands a textarea.
- **AskUserQuestion**: Displays the question text and clickable option buttons parsed from the tool's JSON input (`planText`). Supports single-select (click sends immediately) and multi-select (checkboxes with a Submit button). Includes a "Custom answer..." fallback for free-text responses.
Each action sends a `planApprovalResponse` message (with action `approve`/`reject`/`feedback`/`questionAnswer`) to the extension and clears the approval state. Replaces the busy indicator when active. Users can also type directly in the InputArea while the approval bar is visible - this routes through `planApprovalResponse` as feedback/answer rather than creating a new conversation turn.

**CodeBlock** - Fenced code block with language label and copy-to-clipboard button. Uses VS Code theme variables for styling. File paths inside code blocks are also rendered as clickable links.

**filePathLinks** (`ChatView/filePathLinks.tsx`) - Utility that detects file paths and URLs in text using regex and replaces them with clickable `<span>` elements. Supports two link types:
- **File paths**: Windows absolute (`C:\...`), Unix absolute (`/...`), and relative paths (`src/...`, `./...`). Paths with `:line` or `:line:col` suffixes are also matched (e.g., `file.ts:42`). Uses **Ctrl+Click** (Cmd+Click on Mac) to open, matching VS Code's link convention. Sends an `openFile` message to the extension host, which resolves relative paths against the workspace root and opens the file at the correct position.
- **URLs**: `http://` and `https://` URLs are detected and rendered as clickable links (single-click to open). Sends an `openUrl` message to the extension host, which opens the URL in the user's default browser via `vscode.env.openExternal()`. Overlap resolution ensures file paths and URLs don't conflict when both regexes could match.

**InputArea** - Auto-growing textarea with RTL auto-detection. Ctrl+Enter sends, Enter adds newline. Shows Cancel button when busy. Browse button (folder icon) opens VS Code's native file picker dialog and pastes selected file paths into the input. Ctrl+V with an image in the clipboard attaches it as a base64 thumbnail preview above the input; multiple images can be queued and individually removed. When images are pending, the message is sent via `sendMessageWithImages` which encodes them as Anthropic image content blocks. When a plan approval bar is active (`pendingApproval` is set), typed messages are routed as `planApprovalResponse` feedback/answers instead of `sendMessage`, and the placeholder text changes to indicate the approval context.

---

## Multi-Session Tab Architecture

### SessionTab (`session/SessionTab.ts`)

Bundles all resources for one Claude session tab:
- Creates its own `ClaudeProcessManager`, `StreamDemux`, `ControlProtocol`, `MessageHandler`
- Creates its own `vscode.WebviewPanel` using `buildWebviewHtml()`
- Implements `WebviewBridge` interface for MessageHandler
- Wires all events (process -> demux -> handler -> webview) internally
- Panel title: starts as `"ClaUi N"`, auto-renamed by SessionNamer after first user message. An animated braille spinner is appended to the title while Claude is processing (busy state)
- Tab icon: colored SVG circle generated per-tab and set via `panel.iconPath` so all tab colors are visible in the VS Code tab bar simultaneously
- Busy indicator: `postMessage` intercepts `processBusy` messages and calls `setBusy()` which starts/stops an animated spinner (`setInterval` cycling through braille frames every 120ms). The base title (without indicator) is stored in `baseTitle` so toggling is clean. Timer is cleaned up on dispose.
- Rename: floating pencil button in the webview (appears on hover) triggers a VS Code input box to rename the tab
- Log prefix: `[Tab N]` on the shared output channel

**Public API:**
| Method | Description |
|--------|-------------|
| `startSession(options?)` | Start CLI process in this tab |
| `stopSession()` | Kill CLI process |
| `sendText(text)` | Send user message to CLI |
| `compact(instructions?)` | Request context compaction |
| `setBusy(busy)` | Toggle thinking indicator on tab title |
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
  sessionId: string;    // CLI session ID
  name: string;         // Auto-generated or fallback "Session N"
  model: string;        // Model used (e.g., "claude-sonnet-4-5-20250929")
  startedAt: string;    // ISO date string
  lastActiveAt: string; // ISO date string
  firstPrompt?: string; // First line of the user's first message (max 120 chars)
}
```

**Methods:**
- `getSessions()` - Returns all sessions sorted by `lastActiveAt` descending
- `getSession(sessionId)` - Returns a single session by ID, or undefined
- `saveSession(metadata)` - Upserts by `sessionId`, caps at 100, auto-sorts
- `removeSession(sessionId)` - Deletes a single session
- `clearAll()` - Wipes all stored sessions

**Integration points:**
- Created in `extension.ts activate()`, passed to `TabManager` and `registerCommands()`
- `TabManager` passes it to each `SessionTab`
- `SessionTab` saves metadata on `demux.init` (preserves existing name/firstPrompt for resumed sessions), on session name generation, and on first prompt capture
- `commands.ts showHistory` reads sessions and shows a VS Code QuickPick displaying the session name (label), model + relative time (description), and first prompt (detail)

**Keybinding:** `Ctrl+Shift+H` opens the history QuickPick.

### ConversationReader (`session/ConversationReader.ts`)

Reads full conversation history from Claude Code's local session JSONL files when resuming a session.

**Why this exists:** The Claude CLI in pipe mode (`-p`) waits for stdin input before emitting `system/init` and any message events. The `--replay-user-messages` flag only echoes new messages back on stdout; it does not replay conversation history. This means resumed sessions would show a blank webview until the user types something. ConversationReader solves this by reading the JSONL file directly from disk.

**How it works:**
1. Locates the JSONL file at `~/.claude/projects/<project-hash>/<session-id>.jsonl`
2. Project hash is derived from the workspace path (`:`, `\`, `/` replaced with `-`)
3. Falls back to scanning all project directories if the expected path doesn't match
4. Parses each line: collects `user` messages and `assistant` messages
5. Merges partial assistant entries by message ID (each JSONL entry has one content block)
6. Filters out `tool_result` user messages and `thinking` assistant blocks
7. Returns `SerializedChatMessage[]` ready for the webview

**Integration:**
- Called by `SessionTab.startSession()` when `options.resume` is set (not for forks)
- Sends a `conversationHistory` postMessage to the webview
- The webview `useClaudeStream` handler populates the messages array and clears `isResuming`

### PromptHistoryStore (`session/PromptHistoryStore.ts`)

Persists user prompts at two scopes for the Prompt History Panel feature.

**Scopes:**
- **Project** (`workspaceState`, key `claudeMirror.promptHistory.project`) - prompts from all sessions in the current workspace
- **Global** (`globalState`, key `claudeMirror.promptHistory.global`) - prompts across all workspaces

**Methods:**
- `getProjectHistory()` - Returns project-scoped prompts (most recent last)
- `getGlobalHistory()` - Returns global prompts (most recent last)
- `addPrompt(prompt)` - Appends to both scopes, skips consecutive duplicates, caps at 200

**Integration points:**
- Created in `extension.ts activate()`, passed through `TabManager` -> `SessionTab` -> `MessageHandler`
- `MessageHandler.sendMessage` and `sendMessageWithImages` call `addPrompt()` on every user message
- `MessageHandler.getPromptHistory` responds with stored prompts when the webview requests them

### Prompt History Panel (`components/ChatView/PromptHistoryPanel.tsx`)

Modal overlay component with 3 tabs for browsing prompt history:

| Tab | Source | Storage |
|-----|--------|---------|
| **Session** | `store.promptHistory` (Zustand) | In-memory, current session only |
| **Project** | `PromptHistoryStore.getProjectHistory()` | VS Code `workspaceState` |
| **Global** | `PromptHistoryStore.getGlobalHistory()` | VS Code `globalState` |

**Features:**
- Text filter input for searching prompts
- Click-to-insert: dispatches a `prompt-history-select` CustomEvent that `InputArea` listens for
- Close on Escape key or clicking the overlay backdrop
- Prompts shown newest-first (reversed from storage order)

**Message flow:**
1. User clicks "H" button in InputArea -> sets `promptHistoryPanelOpen = true` in store
2. Panel renders, tab switch triggers `postToExtension({ type: 'getPromptHistory', scope })`
3. Extension responds with `promptHistoryResponse` containing the prompt array
4. User clicks a prompt -> CustomEvent dispatched -> InputArea inserts text

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
6. Also accessible from Command Palette: "ClaUi: Open Plan Document"

**Plans Feature Activation** - When no HTML plan documents exist (folder missing or empty), the command offers to activate the Plans feature:
1. Shows an information message explaining the feature and asking if the user wants to enable it
2. If yes, asks the user to choose a language (Hebrew or English) via QuickPick
3. Injects a "Plan mode" prompt into the project's `CLAUDE.md` file (appends if file exists, creates if not)
4. The prompt instructs Claude Code to generate a manager-friendly HTML plan document in the chosen language whenever it enters plan mode
5. Checks for existing "Plan mode -" text to avoid duplicate injection

**UI**: "Plans" button in the status bar (next to "History"), styled identically.

### Editable Prompts (edit-and-resend)

Users can edit a previously sent message and resend it, discarding everything after the edit point.

**Flow:**
1. User hovers over a user message -> "Edit" button appears in the role header
2. Click "Edit" -> message content switches to an inline textarea pre-filled with the original text
3. User modifies text and clicks "Send" (or Enter)
4. Store's `truncateFromMessage(messageId)` removes the edited message and all messages after it
5. `addUserMessage(newText)` adds the edited message immediately so it's visible in the UI
6. Webview sends `editAndResend` message to extension
7. MessageHandler immediately sets `processBusy: true` to block user input
8. MessageHandler stops the current CLI process (with `setSuppressNextExit` to avoid showing "session ended")
9. A fresh CLI process is spawned via `processManager.start()`
10. Once the process starts, the edited text is sent immediately as the first stdin message
11. The CLI emits `system/init` (which updates session metadata), then responds normally

The edited message is sent **immediately** after process start, without waiting for `system/init`. The CLI in pipe mode only emits `system/init` after receiving its first stdin message, so waiting for init before sending would cause a deadlock.

The edited message is added to the store locally (step 5) rather than waiting for the CLI echo, because the session restart can cause the echo to be delayed or lost. The `addUserMessage` function deduplicates within a 5-second window to prevent a duplicate if the CLI does echo the same text back.

**Key files:**
- `webview-messages.ts` - `EditAndResendRequest` type
- `store.ts` - `truncateFromMessage` action, `addUserMessage` with deduplication
- `MessageBubble.tsx` - Edit button, inline textarea, send/cancel
- `MessageList.tsx` - `handleEditAndResend` callback wiring
- `MessageHandler.ts` - `editAndResend` case: stop process, restart, send edited text immediately
- `global.css` - `.edit-message-*` styles (button fades in on hover)

**Edge cases:**
- Edit button hidden while assistant is busy (`isBusy` prop)
- Only text-only user messages are editable (messages with images skip the edit button)
- Editing the first message clears the entire conversation
- Duplicate user messages with the same text within 5s are deduplicated
- If session already ended, a new one starts automatically

**Tradeoff:** Claude does not "remember" messages before the edited prompt. The new session receives only the edited text. This is the simplest approach since the CLI does not support rewinding mid-conversation.

### Permission Mode

Controls whether Claude has full tool access or is restricted to read-only tools.

**Modes:**
- **Full Access** (default) - CLI runs with `-p` flag, all tools auto-approved
- **Supervised** - CLI runs with `-p --allowedTools Read,Grep,Glob,LS,Task,WebFetch,WebSearch,TodoRead,TodoWrite,AskUserQuestion,ExitPlanMode` restricting to read-only tools. Write tools (Bash, Edit, Write) are denied by the CLI.

**Data flow (same pattern as ModelSelector):**
1. User selects mode in `PermissionModeSelector` dropdown (status bar)
2. `setPermissionMode` updates Zustand store + sends `setPermissionMode` message to extension
3. Extension persists to VS Code config (`claudeMirror.permissionMode`)
4. On next session start, `ClaudeProcessManager.start()` reads the config and conditionally adds `--allowedTools`
5. On webview ready, extension sends `permissionModeSetting` message to sync the dropdown

**Key files:**
- `ClaudeProcessManager.ts` - `--allowedTools` injection in `start()` when `supervised`
- `webview-messages.ts` - `SetPermissionModeRequest`, `PermissionModeSettingMessage`
- `MessageHandler.ts` - `setPermissionMode` handler, `sendPermissionModeSetting()`
- `store.ts` - `permissionMode` state, `setPermissionMode` action
- `useClaudeStream.ts` - `permissionModeSetting` case
- `PermissionModeSelector.tsx` - UI dropdown component

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
