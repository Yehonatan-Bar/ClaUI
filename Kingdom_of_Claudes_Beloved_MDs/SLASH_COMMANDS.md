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
| `src/webview/components/InputArea/SlashCommandBrowser.tsx` | Full-list modal (grouped, searchable) opened from the toolbar |
| `src/webview/components/InputArea/InputArea.tsx` | Integration: keyboard intercepts, handleInput notification, send-time routing, popup/modal/button JSX |
| `src/webview/styles/global.css` | CSS: `.slash-command-popup`, `.slash-command-item`, `.slash-browser-*` |

No extension-host or `webview-messages.ts` changes: routing reuses existing message types (`clearSession`, `compact`, `setModel`) and one local store action (`setContextWidgetVisible`).

## Data Flow (inline autocomplete)

```
User types '/comp' as the first character
  -> handleInput calls slash.handleTextChange(text, cursorPos)
  -> useSlashCommand: text[0] === '/', caret still inside the command token
  -> query = 'comp', filterSlashCommands('comp') ranks the catalog (synchronous)
  -> SlashCommandPopup renders the filtered list
  -> User presses Enter/Tab or clicks (ArrowUp/Down navigates)
  -> slash.selectCommand(cmd) inserts '/name ' (preserving any typed arguments)
  -> InputArea applies the insertion via applyMentionInsert (shared with @ mentions)
```

## Trigger Detection Logic

1. The `/` must be the very first character of the input (matching how the CLI recognises slash commands).
2. The command token runs from the slash to the first whitespace.
3. Once the caret moves past that token (into arguments), the popup dismisses.
4. Filtering is local and synchronous (static catalog) - no debounce, no extension round-trip.

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

The `.slash-commands-button` (a `/` glyph) in the `browse-stack` toolbar toggles `SlashCommandBrowser`, a modal that:
- lists all commands grouped by the CLI categories (sticky group headers),
- has a search box that flattens to a ranked result list (accepts a leading `/`),
- inserts `/name ` at the caret on selection and closes,
- dismisses on Escape or backdrop click.

## Command Catalog

`SLASH_COMMAND_GROUPS` holds the built-in command set grouped by category (Session & context, Model/effort/modes, Reviewing & shipping, Parallel & background, Project setup & memory, Extensions, Platforms & integrations, Terminal appearance & input, Account/usage/diagnostics). Each entry has `name`, optional `argsHint`, optional `aliases`, a `description`, and optional `native` route. Natively-routed commands show a small "ClaUi" badge in both surfaces. The catalog is the source of truth for both the inline popup and the browser modal.

## State Management

All state is local to the `useSlashCommand` hook (`isOpen`, `results`, `selectedIndex` via `useState`; `currentText`, `triggerActive` via `useRef`) plus a `slashBrowserOpen` `useState` in `InputArea` for the modal. Nothing lives in Zustand - it is transient autocomplete/UI state. This mirrors the File Mention (@) approach.

## CSS

The inline popup reuses VS Code's `editorSuggestWidget` variables and the same `position: absolute; bottom: 100%` anchoring as `.file-mention-popup` (on `.input-wrapper`, which is `position: relative`). The browser modal uses a `position: fixed` backdrop and `editorWidget` variables. RTL overrides keep both LTR since command names are always LTR.
