# File Mention (@) - Inline File Autocomplete

## What It Does

Allows users to type `@` in the chat textarea to search and insert workspace file paths inline. As characters are typed after `@`, matching files appear in a popup above the input area. Users can navigate with keyboard or mouse to select a file, which replaces `@query` with the file's relative path.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/hooks/useFileMention.ts` | Hook: trigger detection, debounced search, popup state, selection logic |
| `src/webview/components/InputArea/FileMentionPopup.tsx` | Popup component: renders file result list |
| `src/webview/components/InputArea/InputArea.tsx` | Integration: keyboard intercepts, handleInput notification, popup JSX |
| `src/extension/webview/MessageHandler.ts` | Extension handler: `handleFileSearch()` using `vscode.workspace.findFiles()` |
| `src/extension/types/webview-messages.ts` | Message types: `FileSearchRequest`, `FileSearchResultMessage` |
| `src/webview/hooks/useClaudeStream.ts` | Event dispatch: `fileSearchResults` -> custom DOM event |
| `src/webview/styles/global.css` | CSS: `.file-mention-popup`, `.file-mention-item`, etc. |

## Data Flow

```
User types '@inp' in textarea
  -> handleInput calls fileMention.handleTextChange(text, cursorPos)
  -> useFileMention detects '@' trigger, extracts query 'inp'
  -> 150ms debounce -> postToExtension({ type: 'fileSearch', query: 'inp', requestId: N })
  -> MessageHandler.handleFileSearch() runs vscode.workspace.findFiles('**/*inp*', excludes, 50)
  -> Results sorted (filename matches first) and sent back via 'fileSearchResults' message
  -> useClaudeStream dispatches CustomEvent('file-search-results', { detail: msg })
  -> useFileMention event listener receives results, updates state
  -> FileMentionPopup renders the results list
  -> User presses Enter/Tab or clicks
  -> fileMention.confirmSelection() replaces '@inp' with selected relativePath + space
  -> InputArea updates text state and cursor position
```

## Trigger Detection Logic

1. Scan backward from cursor to find `@`
2. `@` must be at position 0 or preceded by whitespace (avoids `email@domain`)
3. Query = text between `@+1` and cursor
4. If query contains whitespace -> dismiss popup
5. Newline before `@` stops backward scan

## Keyboard Behavior

When popup is open, keys are intercepted BEFORE existing handlers:

| Key | Popup Open | Popup Closed |
|-----|-----------|--------------|
| ArrowUp/Down | Navigate results | Prompt history |
| Enter | Insert file path | Newline |
| Tab | Insert file path | Default |
| Escape | Close popup | Cancel if busy |
| Ctrl+Enter | Send message | Send message |

## Extension-Side Search

- Uses `vscode.workspace.findFiles(glob, excludePattern, 50)`
- Glob pattern: `**/*{query}*` with case-insensitive character classes (e.g., `inp` -> `[iI][nN][pP]`)
- Excludes: `node_modules`, `.git`, `dist`, `.vscode`
- Results capped at 50
- Sorted: filename matches first, then alphabetical by relative path
- Returns `{ relativePath, fileName }` pairs

## State Management

All state is local to the `useFileMention` hook via `useState`/`useRef`:
- `isOpen`, `results`, `selectedIndex`, `isLoading` (useState)
- `triggerIndex`, `currentText`, `currentQuery`, `requestCounter`, `debounceTimer` (useRef)

This is intentionally NOT in the Zustand store since it's transient autocomplete UI state.

## Staleness Prevention

Each search request gets a monotonically incrementing `requestId`. When results arrive, they are discarded if `requestId` doesn't match the latest sent request. This prevents stale results from overwriting newer ones during fast typing.

## CSS

The popup uses VS Code's `editorSuggestWidget` CSS variables to match native autocomplete appearance. Positioned via `position: absolute; bottom: 100%` on `.input-wrapper` (which has `position: relative`). RTL override keeps the popup LTR since file paths are always LTR.
