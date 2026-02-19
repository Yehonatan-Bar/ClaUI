# Message Translation (Hebrew)

Translates assistant message text to Hebrew via a one-shot Claude Sonnet 4.6 CLI call.

## What It Does

A "Translate" button appears on assistant messages (on hover). Clicking it:
1. Extracts text content from the message (strips fenced code blocks)
2. Sends the text to Claude Sonnet 4.6 for Hebrew translation
3. Displays the translated text in place of the original (RTL direction)
4. Caches the result -- subsequent clicks toggle between original and translation instantly

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/session/MessageTranslator.ts` | One-shot CLI translation service (spawns `claude -p --model claude-sonnet-4-6`) |
| `src/extension/webview/MessageHandler.ts` | Handles `translateMessage` request, dispatches to translator, sends `translationResult` back |
| `src/extension/session/SessionTab.ts` | Instantiates `MessageTranslator` and injects it into `MessageHandler` |
| `src/extension/types/webview-messages.ts` | Defines `TranslateMessageRequest` and `TranslationResultMessage` types |
| `src/webview/state/store.ts` | Zustand state: `translations`, `translatingMessageIds`, `showingTranslation` |
| `src/webview/hooks/useClaudeStream.ts` | Handles `translationResult` messages from extension |
| `src/webview/components/ChatView/MessageBubble.tsx` | Translate button UI, toggle logic, translated content rendering |
| `src/webview/styles/global.css` | `.translate-message-btn` styles |

## Data Flow

```
User clicks "Translate"
  -> MessageBubble calls postToExtension({ type: 'translateMessage', messageId, textContent })
  -> MessageHandler receives, calls MessageTranslator.translate(textContent)
  -> MessageTranslator spawns: claude -p --model claude-sonnet-4-6
  -> Pipes translation prompt via stdin, collects stdout
  -> MessageHandler sends: postMessage({ type: 'translationResult', messageId, translatedText, success })
  -> useClaudeStream receives, stores in Zustand via setTranslation()
  -> MessageBubble reads from store, renders translated text with dir="rtl"
```

## MessageTranslator Service

Follows the exact `SessionNamer` pattern:
- Spawns `claude -p --model claude-sonnet-4-6` as a child process
- Pipes the translation prompt via stdin (avoids shell escaping issues)
- Cleans environment (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` deleted)
- 30-second timeout (longer than SessionNamer's 10s since translations can be longer)
- Returns translated text or `null` on failure

### Translation Prompt

```
You are a professional translator. Translate the following text to Hebrew.

RULES:
- Translate ALL text content to Hebrew.
- Preserve all markdown formatting.
- Do NOT translate technical terms, variable names, function names, file paths.
- Do NOT translate text inside inline code (backticks).
- Do NOT add any explanation or notes.
- Output ONLY the translated text.
```

## State Management

Three Zustand store fields:

| Field | Type | Purpose |
|-------|------|---------|
| `translations` | `Record<string, string>` | Cached translated text per message ID |
| `translatingMessageIds` | `Set<string>` | Messages currently being translated (loading state) |
| `showingTranslation` | `Set<string>` | Messages currently displaying translated text |

All three are cleared on `reset()`.

## Button States

| State | Label | Visibility | CSS Class |
|-------|-------|-----------|-----------|
| Default | "Translate" | On hover | `.translate-message-btn` |
| Loading | "Translating..." | Always visible, pulsing | `.translating` |
| Showing translation | "Original" | Always visible, blue accent | `.showing-translation` |
| Has translation, showing original | "Translate" | On hover | (default) |

## What Gets Translated

- Text blocks from assistant messages -- YES
- Fenced code blocks (` ``` `) -- stripped before sending, NOT translated
- Inline code (backticks) -- preserved by the translation prompt
- Technical terms, file paths, variable names -- preserved by the prompt
- Non-text blocks (tool_use, tool_result, images) -- rendered from original, NOT translated

## Interactions with Other Components

- **RTL Detection** (`useRtlDetection.ts`): Exports `detectRtl()` for InputArea. Messages use `dir="auto"` natively. Translated content uses explicit `dir="rtl"` wrapper since we know the output is Hebrew.
- **SessionNamer** (`SessionNamer.ts`): Same CLI spawn pattern, different model (Sonnet vs Haiku) and timeout (30s vs 10s).
- **MessageHandler** (`MessageHandler.ts`): Translation is wired via `setMessageTranslator()` setter, same pattern as `setSessionNamer()` and `setActivitySummarizer()`.
