# Slash Commands - Inline Command Autocomplete & Browser

## What It Does

Brings the CLI's `/` slash-command experience into the ClaUi chat input. Typing `/` as the first character of the input opens an inline autocomplete popup (above the input) listing the built-in Claude Code commands, filtered as you type. A dedicated button in the input toolbar opens a full, grouped, searchable browser of every command.

Because ClaUi runs the Claude CLI headless (`-p` + stream-json), the interactive TUI slash layer is not active - a typed `/command` is otherwise handed to the model as plain text. To make the common commands actually work, a small set that ClaUi already implements natively is "smart routed" to its real action on send; everything else passes through to the CLI verbatim.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/data/slashCommands.ts` | Static command catalog (grouped by category), filter/parse/native-route helpers |
| `src/webview/hooks/useSlashCommand.ts` | Hook: `/`-trigger detection, synchronous filtering, popup state, selection logic |
| `src/webview/components/InputArea/SlashCommandPopup.tsx` | Inline autocomplete popup component |
| `src/webview/components/InputArea/SlashCommandBrowser.tsx` | Full-list modal (grouped, searchable); rendered at the App root |
| `src/webview/components/InputArea/InputArea.tsx` | Integration: keyboard intercepts, handleInput notification, send-time routing, popup + toolbar button |
| `src/webview/App.tsx` | Renders `SlashCommandBrowser` gated on `slashBrowserOpen`; selection dispatches `claui-insert-snippet` |
| `src/webview/components/StatusBar/StatusBar.tsx` | "Slash Commands" item in the Tools dropdown -> `setSlashBrowserOpen(true)` |
| `src/webview/state/store.ts` | `slashBrowserOpen` + `setSlashBrowserOpen` (shared open-state for the modal) |
| `src/webview/styles/global.css` | CSS: `.slash-command-popup`, `.slash-command-item`, `.slash-browser-*` |

No extension-host or `webview-messages.ts` changes: routing reuses existing message types (`clearSession`, `compact`, `setModel`) and store actions (`setContextWidgetVisible`, `setSlashBrowserOpen`).

## Data Flow (inline autocomplete)

```
User types '/comp'
  -> handleInput calls slash.handleTextChange(text, cursorPos)
  -> useSlashCommand scans back from the caret, finds '/' at input start or after whitespace
  -> query = 'comp', filterSlashCommands('comp') ranks the catalog (synchronous)
  -> SlashCommandPopup renders the filtered list
  -> User presses Enter/Tab or clicks (ArrowUp/Down navigates)
  -> slash.selectCommand(cmd) inserts '/name ' (preserving any typed arguments)
  -> InputArea applies the insertion via applyMentionInsert (shared with @ mentions)
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
| Enter | Insert command | Newline |
| Tab | Insert command | Default |
| Escape | Close popup | Cancel if busy |
| Ctrl+Enter | Send message | Send message |

## Smart Routing (on send)

Handled at the top of `sendMessage` (after the double-fire guard, before ultrathink prefixing, which is skipped for slash text). `resolveNativeRoute(text)` maps a command name/alias to a native action:

| Command (aliases) | Native action |
|-------------------|---------------|
| `/clear` (`/reset`, `/new`) | `useAppStore.reset()` + `postToExtension({ type: 'clearSession' })` |
| `/compact` | `postToExtension({ type: 'compact' })` (in-place CLI compaction via control protocol) |
| `/context` | `setContextWidgetVisible(true)` (reveals the context strip) |
| `/model <id>` | `postToExtension({ type: 'setModel', model: <id> })` (only routes when an id/alias is given) |

Any other slash command falls through and is sent to the CLI as plain text, exactly as before.

## Full-List Browser

`SlashCommandBrowser` is a modal opened from two places, both flipping the shared `slashBrowserOpen` store flag:
- the `.slash-commands-button` (a `/` glyph) in the input `browse-stack` toolbar, and
- the **"Slash Commands"** item in the status-bar **Tools** dropdown.

It is rendered once at the App root (`App.tsx`), alongside the other overlay panels. The modal:
- lists all commands grouped by the CLI categories (sticky group headers),
- has a search box that flattens to a ranked result list (accepts a leading `/`),
- on selection, dispatches a `claui-insert-snippet` CustomEvent with `/name ` (InputArea's existing listener inserts it at the caret) and closes,
- dismisses on Escape or backdrop click.

## Command Catalog

`SLASH_COMMAND_GROUPS` holds the built-in command set grouped by category (Session & context, Model/effort/modes, Reviewing & shipping, Parallel & background, Project setup & memory, Extensions, Platforms & integrations, Terminal appearance & input, Account/usage/diagnostics). Each entry has `name`, optional `argsHint`, optional `aliases`, a `description`, and optional `native` route. Natively-routed commands show a small "ClaUi" badge in both surfaces. The catalog is the source of truth for both the inline popup and the browser modal.

## State Management

The inline autocomplete state is local to the `useSlashCommand` hook (`isOpen`, `results`, `selectedIndex` via `useState`; `currentText`, `triggerActive` via `useRef`) - transient UI state, mirroring the File Mention (@) approach. The full-list modal's open flag (`slashBrowserOpen`) lives in the Zustand store so both the input toolbar button and the status-bar Tools menu can toggle it (the same pattern as the Dashboard/Worktree/Team panels).

## CSS

The inline popup reuses VS Code's `editorSuggestWidget` variables and the same `position: absolute; bottom: 100%` anchoring as `.file-mention-popup` (on `.input-wrapper`, which is `position: relative`). The browser modal uses a `position: fixed` backdrop and `editorWidget` variables. RTL overrides keep both LTR since command names are always LTR.
