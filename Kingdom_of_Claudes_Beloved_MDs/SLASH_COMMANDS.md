# Slash Commands - Inline Command Autocomplete & Browser

## What It Does

Brings the CLI's `/` slash-command experience into the ClaUi chat input. Typing `/` as the first character of the input opens an inline autocomplete popup (above the input) listing the built-in Claude Code commands, filtered as you type. A dedicated button in the input toolbar opens a full, grouped, searchable browser of every command.

Because ClaUi runs the Claude CLI headless (`-p` + stream-json), the interactive TUI slash layer is not active - a typed `/command` is otherwise handed to the model as plain text. To make the common commands actually work, a small set that ClaUi already implements natively is "smart routed" to its real action on send; everything else passes through to the CLI verbatim.

**Picking a command runs it (like the CLI).** Selecting a command - by clicking it in either surface, or pressing Enter in the inline popup - runs it immediately, with no separate Send step. Two exceptions: commands that need a value are inserted into the input (focused, trailing space) so the user can supply the argument; and commands with no headless support are greyed and non-runnable (see *Unavailable Commands*). "Needs a value" is decided by `slashCommandNeedsArg` (the `needsValue` flag - `/model`, `/effort`, `/goal` - or a required `<...>` argument). Commands with only an optional `[...]` hint (`/clear`, `/compact`, `/context`, ...) run on pick.

**Value-taking commands offer their options (stage 2).** When a command has enumerable values (e.g. `/effort` -> low/medium/high/xhigh/max, `/model` -> the model list), picking it opens a second autocomplete stage listing those values, filtered as you type - so the user is never stranded with a bare `/effort ` and no idea what to type. Picking a value runs `/name value` immediately (see *Argument Autocomplete*). Free-value commands (like `/goal`) have no option list; they just insert for free-text entry.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/data/slashCommands.ts` | Static command catalog (grouped by category), filter/parse/native-route helpers, `slashCommandNeedsArg` (run-vs-insert decision) |
| `src/webview/hooks/useSlashCommand.ts` | Two-stage hook: `/`-trigger detection, command filtering, and the argument-value stage (`mode`, `argResults`, `selectArg`/`confirmArg`) |
| `src/webview/components/InputArea/SlashCommandPopup.tsx` | Inline autocomplete popup - renders the command list or (in `arg` mode) the command's value list |
| `src/webview/components/InputArea/SlashCommandBrowser.tsx` | Full-list modal (grouped, searchable); rendered at the App root |
| `src/webview/components/InputArea/InputArea.tsx` | Integration: keyboard intercepts, handleInput notification, send-time routing, `runSlashCommand` (run-on-pick), `claui-slash-command-selected` listener, popup + toolbar button |
| `src/webview/App.tsx` | Renders `SlashCommandBrowser` gated on `slashBrowserOpen`; selection dispatches `claui-slash-command-selected` (InputArea decides run-vs-insert) |
| `src/webview/components/StatusBar/StatusBar.tsx` | "Slash Commands" item in the Tools dropdown -> `setSlashBrowserOpen(true)`; "Compact Context" item -> runs `/compact` |
| `src/webview/state/store.ts` | `slashBrowserOpen` + `setSlashBrowserOpen` (shared open-state for the modal) |
| `src/webview/styles/global.css` | CSS: `.slash-command-popup`, `.slash-command-item`, `.slash-browser-*` |

The slash-command *routing* itself needs no extension-host or `webview-messages.ts` changes: it reuses existing message types (`clearSession`, `compact`, `setModel`) and store actions (`setContextWidgetVisible`, `setSlashBrowserOpen`). (The separate "context compacted" divider — see "Compaction feedback" below — adds the `compactBoundary` / `compactFailed` messages and new store state.)

## Data Flow (inline autocomplete)

```
User types '/comp'
  -> handleInput calls slash.handleTextChange(text, cursorPos)
  -> useSlashCommand scans back from the caret, finds '/' at input start or after whitespace
  -> query = 'comp', filterSlashCommands('comp') ranks the catalog (synchronous)
  -> SlashCommandPopup renders the filtered list
  -> User presses Enter or clicks (ArrowUp/Down navigates, Tab completes the token)
  -> InputArea checks slashCommandNeedsArg + whether the command is the whole input:
       needs no value & whole input -> runSlashCommand(name) runs it now
       otherwise                    -> slash.selectCommand(cmd) inserts '/name ' for editing
```

## Trigger Detection Logic

Mirrors the `@` file-mention backward scan, so the menu still opens when the input already holds text, a leading space, or an earlier line:

1. Scan backward from the caret for a `/`.
2. The `/` must be at position 0 or directly preceded by whitespace (this is what stops `src/webview` style paths from opening the menu).
3. Whitespace encountered before any `/` means the caret is not inside a command token - dismiss.
4. Query = text between the slash and the caret; a space in the query means the user moved on to arguments - dismiss.
5. Filtering is local and synchronous (static catalog) - no debounce, no extension round-trip.

Note that send-time smart routing is stricter: `resolveNativeRoute` only fires when the trimmed message *starts* with `/`, so a mid-sentence slash is never routed to a native action.

A `slashTyped` UiDebug entry is emitted on every typed `/` (visible in `Output -> ClaUi`), recording caret position and the preceding character, so trigger failures are diagnosable without a rebuild.

## Keyboard Behavior

The slash block sits right after the file-mention block in `handleKeyDown`; the two are mutually exclusive (`/` at index 0 vs `@` preceded by whitespace).

| Key | Popup Open | Popup Closed |
|-----|-----------|--------------|
| ArrowUp/Down | Navigate results | Prompt history |
| Enter | Run command (insert if it needs a value) | Newline |
| Tab | Complete the token (always inserts) | Default |
| Escape | Close popup | Cancel if busy |
| Ctrl+Enter | Send message | Send message |

A mouse click in the popup behaves like Enter. Enter/click only run when the selected command needs no value **and** the slash token is the whole input; a slash typed mid-message is inserted (never run) so surrounding text is preserved. In the value stage (`mode: 'arg'`), ArrowUp/Down move through the values and Enter/Tab/click pick one and run `/name value` (see *Argument Autocomplete*).

## Smart Routing (on send)

Handled at the top of `sendMessage` (after the double-fire guard, before ultrathink prefixing, which is skipped for slash text). `resolveNativeRoute(text)` maps a command name/alias to a native action:

The `switch` lives in one place, `applyNativeRoute(native)`, shared by both `sendMessage` (typed `/name` + Send) and `runSlashCommand` (menu pick), so the two paths never drift:

| Command (aliases) | Native action |
|-------------------|---------------|
| `/clear` (`/reset`, `/new`) | `useAppStore.reset()` + `postToExtension({ type: 'clearSession' })` -> `MessageHandler.clearAndRestartSession` -> `SessionTab.restartFresh` (fresh session on the tab's own model, cwd/worktree, account and bridge backend; the old process's exit is suppressed; display settings are re-sent after the webview reset) |
| `/compact [instructions]` | `beginManualCompact()` (live "Compacting context…" divider) + `postToExtension({ type: 'compact', instructions })` (in-place CLI compaction; see "In-place compaction" below). Providers without `supportsCompact` (Codex) skip the divider and get the handler's "not supported" error |
| `/context` | `setContextWidgetVisible(true)` (reveals the context strip) |
| `/model <id>` | `postToExtension({ type: 'setModel', model: <id> })` (only routes when an id/alias is given) |
| `/effort <level>` | `setSelectedClaudeEffort` + `postToExtension({ type: 'setClaudeEffort' })` (only for a native level: low/medium/high/xhigh/max; `auto`/`status`/`ultracode` fall through to the CLI) |
| `/usage` (`/cost`, `/stats`) | reveal the usage widget (`setUsageWidgetEnabled(true)` + `requestUsage`) |
| `/resume` (`/continue`) | `postToExtension({ type: 'showHistory' })` (opens ClaUi's session picker) |

Any other slash command falls through and is sent to the CLI as plain text, exactly as before.

## In-place compaction (`/compact`)

**Entry points** (all end in `MessageHandler.requestCompact(instructions?)`):
- `/compact [instructions]` typed + Send, or picked in the popup / browser.
- Status bar **Tools > Compact Context** (shown when `providerCapabilities.supportsCompact`); it dispatches `claui-slash-command-selected` with `compact`, so it runs through `runSlashCommand` exactly like a browser pick.
- Command palette `ClaUi: Compact Context` (`claudeMirror.compact`, `Ctrl+Alt+K`) -> `SessionTab.compact()`. This path shows no pending spinner; the done divider still appears.

**Transport.** `ClaudeProcessManager.sendCompact` posts `/compact [instructions]` as a plain user message. The CLI has no `compact` control request (it replies "Unsupported control request subtype: compact"); `/compact` is a local command that headless mode runs when it arrives as text. Posted during a running turn, the CLI queues it and compacts right after that turn. Event sequence: `Kingdom_of_Claudes_Beloved_MDs/STREAM_JSON_PROTOCOL.md` ("Compact context").

**Extension side (`MessageHandler`).**
- `requestCompact` sends the command and sets `compactPending` (ExitPlanMode guard reset on the next messageStart). A send failure posts `compactFailed` + an `error`. Bridge tabs (`isBridgeCliCommand(cliPathOverride)`: Grok / Antigravity / OpenAI-compatible / Council) share the Claude capability set but their runtime has no compaction (a posted `/compact` would reach the bridge model as a prompt), so they get `compactFailed` + an explanatory `error` and nothing is sent.
- `handleCompactBoundary` (called from `SessionTab.wireProcessEvents` on `system/compact_boundary`): posts `compactBoundary`; for `trigger: "manual"` it also opens the closing window (`manualCompactClosing = true`) and keeps `post_tokens`.
- While the window is open, the demux `userMessage` listener drops the CLI's summary envelope and the `<local-command-stdout>Compacted</local-command-stdout>` envelope (they would otherwise render as "YOU").
- `handleResultEvent` consumes the closing `result` (`num_turns: 0`) via `finishManualCompact`: no turn record, checkpoint or turn analysis; it posts `costUpdate` with the compacted context size (`post_tokens`) and `processBusy: false`. Like every result, it arrives twice (direct + demux path); the generic `lastHandledResultEvent` guard skips the second copy.
- `handleCompactFailed` (from `system/status` with `compact_result: "failed"`, e.g. "Not enough messages to compact.") posts `compactFailed`. The CLI explains the reason in a synthetic assistant reply, which renders normally.
- A `messageStart` inside the window closes it (guards against a lost result).

The plan-approval option "Yes, clear context and bypass permissions" does not use `/compact` (a posted command would only run after the implementation turn); it starts a fresh session seeded with the plan instead (see `ARCHITECTURE.md`, Plan Approval Options).

## Compaction feedback (the "context compacted" divider)

In-place compaction (the manual `/compact` and the CLI's own automatic compaction when the window fills) is surfaced as an inline divider.

Flow:

1. Manual `/compact` -> `applyNativeRoute` calls `beginManualCompact()`, which appends a `pending` marker to `compactBoundaries` (store) anchored below the last message, then posts `{ type: 'compact', instructions }`. A 5-minute safety timeout calls `dropPendingCompact()` if neither a boundary nor a failure arrives (the CLI may queue `/compact` behind a running turn, and summarizing a large context can take minutes).
2. The CLI emits `system/compact_boundary` (with `compact_metadata.trigger`, `pre_tokens`, `post_tokens`). `SessionTab` detects it in `wireProcessEvents` and calls `MessageHandler.handleCompactBoundary`, which posts `{ type: 'compactBoundary', trigger, preTokens }` to the webview.
3. `useClaudeStream` handles `compactBoundary` -> `resolveCompactBoundary`: flips the pending marker to `done` (manual), or, when there is no pending marker (auto-compact, command-palette compact), appends a fresh `done` marker anchored at the current end. `compactFailed` -> `dropPendingCompact()`.
4. `MessageList` renders `compactBoundaries` interleaved after their anchor message using `CompactDivider` (spinner + "Compacting context…" while pending; "Context compacted · summarized ~Nk tokens · <trigger>" when done).

`compactBoundaries` is kept separate from `messages` so it never affects turn history, fork, or the timeline. Markers whose anchor is truncated away are pruned in `truncateFromMessage`; all are cleared on `reset`.

Key files: `src/webview/components/ChatView/CompactDivider.tsx`, `MessageList.tsx`; `src/webview/state/store.ts` (`compactBoundaries`, `beginManualCompact`, `resolveCompactBoundary`, `dropPendingCompact`); `src/webview/components/StatusBar/StatusBar.tsx` (Tools > Compact Context); `src/extension/process/ClaudeProcessManager.ts` (`sendCompact`); `src/extension/session/SessionTab.ts`; `src/extension/webview/MessageHandler.ts` (`requestCompact`, `handleCompactBoundary`, `handleCompactFailed`, `finishManualCompact`); `src/extension/types/webview-messages.ts` (`CompactBoundaryMessage`, `CompactFailedMessage`); `src/extension/types/stream-json.ts` (`SystemInitEvent.compact_metadata`, `compact_result`).

## Run on Pick

`runSlashCommand(name)` (in `InputArea`) is the path used when a command is picked from either surface and needs no value. It applies the same native routing as send-time (`resolveNativeRoute` -> clear/compact/context/model), and for non-native commands posts `sendMessage` with `/name` verbatim. It intentionally bypasses the enhance / translate / schedule / usage-queue paths (a picked command is an action, not a prompt), records the command in prompt history, clears the input, and dismisses the popup.

`slashCommandNeedsArg(cmd)` (in `slashCommands.ts`) is the single source of truth for run-vs-insert: it returns `true` (insert) when the command is flagged `needsValue` (`/model`, `/effort`, `/goal`) or declares a required `<...>` argument; all other commands run. Both surfaces and the keyboard path consult it, so the behavior stays consistent.

## Argument Autocomplete (stage 2)

`useSlashCommand` is a two-stage hook. Stage 1 completes the command name; stage 2 completes its argument value. After the leading `/`, the trigger scan crosses spaces (unlike `@` mentions) so it can see `/command <partial-value>`; the popup then switches to `mode: 'arg'` when the command name resolves (via `findSlashCommand`, name or alias) to one that offers options.

- **Where the options come from:** the hook takes a `getArgOptions(cmd)` resolver, supplied by `InputArea`. It returns the command's static `argOptions` (e.g. the five effort levels in the catalog) or a dynamic list - for `/model` it builds `CLAUDE_MODEL_OPTIONS` + the store's `bridgeModelOptions` (dropping the empty "Default", since a switch needs an explicit id). `filterArgOptions(options, query)` ranks them as the user types.
- **Rendering:** `SlashCommandPopup` renders a small header (`/name` + argsHint) and the filtered value list, each showing `label ?? value` plus an optional `description`.
- **Selecting a value:** `selectArg`/`confirmArg` return `{ text, cursor, name, value }`. If the completed `/name value` is the whole input it runs immediately (`runSlashCommand(name, value)`); otherwise (a slash mid-message) it is inserted so surrounding text is preserved.
- **Opening stage 2 after a pick:** because programmatic inserts do not fire the textarea `onChange`, `InputArea` calls `slash.handleTextChange(text, cursor)` right after inserting a value-taking command (in the popup `onSelect`, the keyboard path, and the browser listener) so the value list opens without waiting for a keystroke.

Commands whose value is free text (`/goal`) have no `argOptions` and no resolver entry, so they simply insert for typing.

## Unavailable Commands (headless)

ClaUi runs the CLI headless, so purely interactive/TUI/environment commands with no native equivalent cannot work - the CLI returns "isn't available in this environment". These are flagged `unavailable: true` in the catalog (e.g. `/fork`, `/branch`, `/rewind`, `/export`, `/copy`, `/theme`, `/login`, the whole *Terminal appearance* and *Platforms & integrations* groups, and interactive account items). They stay visible in both surfaces but are rendered greyed with a Hebrew "לא זמין" tag and cannot be run: `disabled` on the button, plus a guard in the popup `onSelect`, the Enter/Tab keyboard path, and the browser's `claui-slash-command-selected` listener. This classification is a curated best-effort list (based on each command's nature plus confirmed CLI responses), easy to adjust as behavior is observed.

## Full-List Browser

`SlashCommandBrowser` is a modal opened from two places, both flipping the shared `slashBrowserOpen` store flag:
- the `.slash-commands-button` (a `/` glyph) in the input `browse-stack` toolbar, and
- the **"Slash Commands"** item in the status-bar **Tools** dropdown.

It is rendered once at the App root (`App.tsx`), alongside the other overlay panels. The modal:
- lists all commands grouped by the CLI categories (sticky group headers),
- has a search box that flattens to a ranked result list (accepts a leading `/`),
- on selection, dispatches a `claui-slash-command-selected` CustomEvent with the command `name` and closes; `InputArea`'s listener decides run-vs-insert (`runSlashCommand(name)`, or a `claui-insert-snippet` re-dispatch with `/name ` when the command needs a value),
- dismisses on Escape or backdrop click.

## Command Catalog

`SLASH_COMMAND_GROUPS` holds the built-in command set grouped by category (Session & context, Model/effort/modes, Reviewing & shipping, Parallel & background, Project setup & memory, Extensions, Platforms & integrations, Terminal appearance & input, Account/usage/diagnostics). Each entry has `name`, optional `argsHint`, optional `aliases`, a `description`, an optional `native` route, an optional `needsValue` flag (insert-on-pick, for commands that need an argument), and an optional `unavailable` flag (greyed "לא זמין", not runnable headless). Natively-routed commands show a small "ClaUi" badge in both surfaces. The catalog is the source of truth for both the inline popup and the browser modal.

## State Management

The inline autocomplete state is local to the `useSlashCommand` hook (`isOpen`, `results`, `selectedIndex` via `useState`; `currentText`, `triggerActive` via `useRef`) - transient UI state, mirroring the File Mention (@) approach. The full-list modal's open flag (`slashBrowserOpen`) lives in the Zustand store so both the input toolbar button and the status-bar Tools menu can toggle it (the same pattern as the Dashboard/Worktree/Team panels).

## CSS

The inline popup reuses VS Code's `editorSuggestWidget` variables and the same `position: absolute; bottom: 100%` anchoring as `.file-mention-popup` (on `.input-wrapper`, which is `position: relative`). The browser modal uses a `position: fixed` backdrop and `editorWidget` variables. RTL overrides keep both LTR since command names are always LTR.
