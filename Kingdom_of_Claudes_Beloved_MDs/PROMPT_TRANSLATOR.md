# Prompt Translator

Translates user prompts to native English before sending them to Claude. Uses a one-shot CLI call with a system prompt that rewrites text as a native English-speaking software engineer would naturally phrase it, preserving original intent, technical meaning, structure, and detail level. Hardcoded to Sonnet 4.6 (not configurable).

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/session/PromptTranslator.ts` | Backend service - spawns one-shot `claude -p` CLI process with Sonnet 4.6 |
| `src/extension/webview/MessageHandler.ts` | Routes `translatePrompt` / `setPromptTranslationEnabled` / `setAutoTranslate` messages |
| `src/extension/session/SessionTab.ts` | Wires PromptTranslator into the per-tab MessageHandler |
| `src/webview/components/InputArea/InputArea.tsx` | UI: Send button group with gear popover, translate toggle, auto-translate toggle |
| `src/webview/hooks/useClaudeStream.ts` | Dispatches `translatePromptResult` and `promptTranslatorSettings` to store |
| `src/webview/state/store.ts` | Zustand state: `isTranslatingPrompt`, `promptTranslateEnabled`, `autoTranslateEnabled`, `sendSettingsPopoverOpen` |
| `src/webview/styles/global.css` | CSS for `.send-button-group`, `.send-gear-button`, `.send-settings-popover`, `.textarea-container.translating` |
| `src/extension/types/webview-messages.ts` | 5 message types (3 webview->ext, 2 ext->webview) |

## Architecture

Follows the same one-shot CLI pattern as `PromptEnhancer`, `SessionNamer`, `MessageTranslator`, and `TurnAnalyzer`:

```
InputArea (click Send / auto)
  -> postToExtension({ type: 'translatePrompt', text })
  -> MessageHandler routes to PromptTranslator.translate()
  -> PromptTranslator spawns `claude -p --model claude-sonnet-4-6`
  -> Pipes system prompt + user text to stdin
  -> Returns translated text via postMessage({ type: 'translatePromptResult' })
  -> useClaudeStream dispatches CustomEvent('prompt-translated')
  -> InputArea listener places translated text in input (or auto-sends if auto mode)
```

## Translation System Prompt

The system prompt instructs Claude to:
1. Rewrite text in English as a native English-speaking software engineer would phrase it
2. Preserve original intent, technical meaning, structure, and level of detail
3. Improve clarity, fluency, and terminology where appropriate
4. Not summarize, expand, omit, or add new information
5. Output only the rewritten text -- no explanations, comments, notes, labels, formatting, or quotation marks

Input is truncated to 3000 characters (with `[...truncated]` marker). Backend timeout is 60 seconds. Client-side safety timeout is 65 seconds (resets `isTranslatingPrompt` if backend result never arrives).

## UX Flows

### Manual Translation (translate=ON, auto-send=OFF)
1. User types prompt in any language
2. Send button label changes to "Translate"
3. User clicks "Translate" (or presses the send shortcut)
4. Textarea dims with "Translating..." overlay, button shows spinner
5. Translated English text is placed back in the input box for review
6. User reviews, optionally edits, then clicks Send (which now sends normally since text is already translated)

### Auto Translation (translate=ON, auto-send=ON)
1. User types prompt in any language, clicks Send
2. Text is translated to English automatically
3. Translated text is auto-sent immediately after translation completes
4. If translation fails, the original text is sent as fallback

### Enhance + Translate Pipeline
When both Prompt Enhancer and Prompt Translator are enabled:
1. Enhance runs first on the original text
2. Translation runs on the enhanced output
3. Result is placed in input (manual) or auto-sent (auto mode)

### Send Button Gear Popover
- Click gear icon on the Send button group -> popover appears above button group
- Toggle: "Translate to English" on/off switch (persisted to VS Code settings)
- Toggle: "Auto-send" on/off switch (persisted to VS Code settings, only visible when translate is enabled)
- Click outside -> popover dismisses

## Message Protocol

### Webview -> Extension
- `translatePrompt` - `{ text: string }` - triggers translation
- `setPromptTranslationEnabled` - `{ enabled: boolean }` - persists translate toggle to config
- `setAutoTranslate` - `{ enabled: boolean }` - persists auto-send toggle to config

### Extension -> Webview
- `translatePromptResult` - `{ translatedText: string | null, success: boolean, error?: string }`
- `promptTranslatorSettings` - `{ translateEnabled: boolean, autoTranslate: boolean }` - sent on ready + config change

## Zustand State

| Field | Type | Default | Persists across reset? |
|-------|------|---------|----------------------|
| `isTranslatingPrompt` | boolean | false | No (cleared on reset) |
| `promptTranslateEnabled` | boolean | false | Yes |
| `autoTranslateEnabled` | boolean | false | Yes |
| `sendSettingsPopoverOpen` | boolean | false | No (cleared on reset) |

## VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMirror.promptTranslator.enabled` | boolean | false | Translate prompts to English before sending them to Claude |
| `claudeMirror.promptTranslator.autoTranslate` | boolean | false | Automatically send the translated prompt (requires translation enabled) |

## Differences from Prompt Enhancer

| Aspect | Prompt Enhancer | Prompt Translator |
|--------|----------------|------------------|
| Purpose | Improve prompt quality (scaffolding, structure) | Translate to native English |
| Model | Configurable (Haiku/Sonnet/Opus) | Hardcoded Sonnet 4.6 |
| Manual result | Comparison panel (original vs enhanced) | Places translated text in input for review |
| Send button label | Unchanged | Changes to "Translate" |
| UI location | Separate sparkles button + gear | Gear popover on Send button group |
| Keyboard shortcut | Ctrl+Shift+E | None (uses Send shortcut) |
| Language preservation | Preserves original language | Always outputs English |

## Reliability Safeguards

### Client-Side Safety Timeout
A 65-second timeout in InputArea resets `isTranslatingPrompt` to false if the backend never sends `translatePromptResult`. This prevents the UI from getting permanently stuck in "Translating..." state. Both the `prompt-translated` and `prompt-translate-failed` event handlers clear the timeout.

### Stdin Backpressure Handling
The stdin write to the child process checks the return value of `write()`. If the buffer is full (`false` return), it waits for the `drain` event before calling `end()`. This prevents data loss on Windows with large prompts containing multi-byte characters.

### Windows Process Kill
On Windows with `shell: true`, `child.kill('SIGTERM')` only kills the `cmd.exe` wrapper. PromptTranslator uses `taskkill /F /T /PID` (same pattern as PromptEnhancer and ClaudeProcessManager) to kill the entire process tree on timeout.

### Error Feedback
- Auto-send failure: falls back to sending the original text
- Manual translate failure: fires `prompt-translate-failed` CustomEvent, UI resets from "Translating..." state

## CSS Components

- `.send-button-group` - flex container for Send button + gear icon
- `.send-gear-button` - gear icon, opens the settings popover
- `.send-settings-popover` - absolute-positioned settings panel above Send button group
- `.textarea-container.translating` - dims textarea, shows pulsing border + overlay during translation
