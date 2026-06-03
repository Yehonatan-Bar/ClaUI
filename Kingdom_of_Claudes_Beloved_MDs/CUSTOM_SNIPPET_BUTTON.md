# Custom Snippet Button

A user-configurable text snippet that is inserted into the chat input box at the cursor when clicked. Lives in the status bar `Tools` group next to the Git button.

## What It Does

The user saves any text (characters, a word, several words, or multiple lines). A snippet button in the status bar shows the saved text (truncated). Clicking it injects that text into the input box at the current cursor position. A companion gear button opens a small panel to edit or clear the snippet.

## Key Files

| File | Role |
|------|------|
| `src/webview/components/StatusBar/StatusBar.tsx` | Snippet button group (`snippetGroup`) rendering inside `toolsItems`; `handleInsertSnippet` / `handleToggleSnippetConfig` |
| `src/webview/components/InputArea/CustomSnippetPanel.tsx` | Config panel component (textarea, Save, Clear) |
| `src/webview/components/InputArea/InputArea.tsx` | `claui-insert-snippet` window-event listener (insert at cursor), config panel rendering, settings request on mount |
| `src/extension/webview/MessageHandler.ts` | Claude-tab handler: `sendCustomSnippetSettings()` syncs config; `setCustomSnippet` / `getCustomSnippet` message cases |
| `src/extension/webview/CodexMessageHandler.ts` | Codex-tab handler: mirrors the same `setCustomSnippet` / `getCustomSnippet` cases, `sendCustomSnippetSettings()`, ready-handler send, and config-watcher branch (required so the snippet works in Codex tabs, not just Claude tabs) |
| `src/webview/state/store.ts` | `customSnippetText`, `customSnippetConfigPanelOpen` + setters |
| `src/webview/hooks/useClaudeStream.ts` | `customSnippetSettings` message handler |
| `src/extension/types/webview-messages.ts` | `SetCustomSnippetRequest`, `GetCustomSnippetRequest`, `CustomSnippetSettingsMessage` |
| `package.json` | `claudeMirror.customSnippet.text` setting schema |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.customSnippet.text` | `""` | The snippet text inserted into the input box when the snippet button is clicked |

Persisted as a global VS Code setting, so it is shared across all tabs and survives reloads.

## UI Components

### Snippet Button
- Location: status bar `Tools` group (also appears in the merged `More` / `Menu` dropdowns in compact/minimal layouts), immediately after the Git button
- Label: the saved text with whitespace collapsed and truncated to 16 chars; shows `Snippet` when nothing is configured (dimmed via `not-configured`)
- When configured: clicking dispatches `claui-insert-snippet` to inject the text at the cursor
- When empty: clicking opens the config panel
- Tooltip shows the first 60 chars of the saved snippet

### Gear Toggle
- Small `*` button joined to the right of the snippet button
- Opens/closes the config panel regardless of state

### Config Panel
- Shows above the input area when open
- Multi-line textarea bound to the current snippet
- `Save` persists the text (`setCustomSnippet`); `Clear` empties it; `Ctrl+Enter` saves
- Closes on Save / Clear / close button

## Data Flow

### Insertion
```
Click snippet button
  -> window.dispatchEvent('claui-insert-snippet', { detail: text })
  -> InputArea listener splices text at textarea selectionStart/selectionEnd
  -> setText(next), undo push, textarea re-resized and re-focused, caret after inserted text
```

### Save
```
Type in panel -> Save (or Ctrl+Enter)
  -> postToExtension({ type: 'setCustomSnippet', text })
  -> active tab's handler (MessageHandler for Claude, CodexMessageHandler for Codex)
       updates claudeMirror.customSnippet.text AND immediately echoes
       { type: 'customSnippetSettings', text } back to the webview
       (echoing msg.text directly avoids a race: config.update() is async, so
        re-reading config right after could return the stale old value)
  -> onDidChangeConfiguration later fires in every tab's handler -> sendCustomSnippetSettings()
       (keeps other open tabs in sync since the setting is global)
  -> webview store customSnippetText updated -> button label refreshes and switches to inject mode
```

### Settings Sync
- On webview ready: `sendCustomSnippetSettings()` is called
- On mount: InputArea sends `getCustomSnippet` -> `sendCustomSnippetSettings()` response
- On config change: `watchConfigChanges` detects `claudeMirror.customSnippet` -> auto-sends to webview

## Notes

- Insertion uses the textarea's last selection indices, which persist even when focus moved to the status bar button, so text lands where the caret last was.
- Unlike the Git button, there is no provider capability gate; the snippet works in any mode and regardless of connection state.
- The button only switches from "open config" to "inject text" once `customSnippetText` in the store is non-empty. Both provider handlers (`MessageHandler` and `CodexMessageHandler`) must implement the `setCustomSnippet` / `getCustomSnippet` cases - if a provider handler omits them, the save round-trip is silently dropped and the button stays stuck in config-open mode for that provider's tabs.
