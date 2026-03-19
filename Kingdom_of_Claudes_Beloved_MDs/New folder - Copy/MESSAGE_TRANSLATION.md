# Message Translation

Translates assistant message text to a configurable target language via a one-shot Claude Sonnet 4.6 CLI call.

## What It Does

A button showing the selected language name (e.g. "Hebrew", "Spanish") appears on assistant messages (on hover). Clicking it:
1. Extracts text content from the message (strips fenced code blocks)
2. Sends the text to Claude Sonnet 4.6 for translation to the selected target language
3. Displays the translated text in place of the original (RTL direction for Hebrew/Arabic, auto for others)
4. Caches the result -- subsequent clicks toggle between original and translation instantly

## Language Selection

The target language is configurable via:
- **Vitals gear icon panel** (`VitalsInfoPanel.tsx`): "Translate to" dropdown in the gear icon panel next to the Vitals button in the status bar
- **VS Code setting** (`claudeMirror.translationLanguage`): Configurable in VS Code settings

Supported languages: Hebrew (default), Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean.

RTL languages (Hebrew, Arabic) automatically set `dir="rtl"` on translated content. All other languages use `dir="auto"`.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/session/MessageTranslator.ts` | One-shot CLI translation service (spawns `claude -p --model claude-sonnet-4-6`). Accepts target language parameter. Exports `RTL_LANGUAGES` set. |
| `src/extension/webview/MessageHandler.ts` | Handles `translateMessage` and `setTranslationLanguage` requests. Reads language from config, passes to translator. Sends `translationLanguageSetting` to webview on startup and config change. |
| `src/extension/session/SessionTab.ts` | Instantiates `MessageTranslator` and injects it into `MessageHandler` |
| `src/extension/types/webview-messages.ts` | Defines `TranslateMessageRequest`, `TranslationResultMessage`, `TranslationLanguageSettingMessage`, `SetTranslationLanguageRequest` types |
| `src/webview/state/store.ts` | Zustand state: `translationLanguage`, `translations`, `translatingMessageIds`, `showingTranslation` |
| `src/webview/hooks/useClaudeStream.ts` | Handles `translationResult` and `translationLanguageSetting` messages from extension |
| `src/webview/components/ChatView/MessageBubble.tsx` | Translate button UI (shows language name), toggle logic, translated content rendering with dynamic RTL |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Language dropdown in the gear icon settings panel |
| `src/webview/styles/global.css` | `.translate-message-btn` and `.vitals-info-language-select` styles |
| `package.json` | `claudeMirror.translationLanguage` setting definition |

## Data Flow

```
User clicks language button (e.g. "Hebrew")
  -> MessageBubble calls postToExtension({ type: 'translateMessage', messageId, textContent })
  -> MessageHandler reads claudeMirror.translationLanguage from config
  -> MessageHandler calls MessageTranslator.translate(textContent, targetLang)
  -> MessageTranslator spawns: claude -p --model claude-sonnet-4-6
  -> Pipes translation prompt (with target language) via stdin, collects stdout
  -> MessageHandler sends: postMessage({ type: 'translationResult', messageId, translatedText, success })
  -> useClaudeStream receives, stores in Zustand via setTranslation()
  -> MessageBubble reads from store, renders translated text with dir="rtl" or dir="auto"

Language change:
  -> VitalsInfoPanel dropdown onChange
  -> postToExtension({ type: 'setTranslationLanguage', language })
  -> MessageHandler updates claudeMirror.translationLanguage in VS Code config
  -> Config change triggers sendTranslationLanguageSetting() to webview
  -> Store updates translationLanguage, button text updates immediately
```

## MessageTranslator Service

Follows the exact `SessionNamer` pattern:
- Spawns `claude -p --model claude-sonnet-4-6` as a child process
- Pipes the translation prompt via stdin (avoids shell escaping issues)
- Cleans environment (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` deleted)
- 30-second timeout (longer than SessionNamer's 10s since translations can be longer)
- Accepts optional `language` parameter (defaults to config setting, then "Hebrew")
- Returns translated text or `null` on failure

### Translation Prompt

```
You are a professional translator. Translate the following text to {targetLanguage}.

RULES:
- Translate ALL text content to {targetLanguage}.
- Preserve all markdown formatting.
- Do NOT translate technical terms, variable names, function names, file paths.
- Do NOT translate text inside inline code (backticks).
- Do NOT add any explanation or notes.
- Output ONLY the translated text.
```

## State Management

Zustand store fields:

| Field | Type | Purpose |
|-------|------|---------|
| `translationLanguage` | `string` | Selected target language (default: "Hebrew") |
| `translations` | `Record<string, string>` | Cached translated text per message ID |
| `translatingMessageIds` | `Set<string>` | Messages currently being translated (loading state) |
| `showingTranslation` | `Set<string>` | Messages currently displaying translated text |

`translations`, `translatingMessageIds`, and `showingTranslation` are cleared on `reset()`. `translationLanguage` persists across session resets (it's a setting).

## Button States

| State | Label | Visibility | CSS Class |
|-------|-------|-----------|-----------|
| Default | Language name (e.g. "Hebrew") | On hover | `.translate-message-btn` |
| Loading | "Translating..." | Always visible, pulsing | `.translating` |
| Showing translation | "Original" | Always visible, blue accent | `.showing-translation` |
| Has translation, showing original | Language name | On hover | (default) |

## What Gets Translated

- Text blocks from assistant messages -- YES
- Fenced code blocks (` ``` `) -- stripped before sending, NOT translated
- Inline code (backticks) -- preserved by the translation prompt
- Technical terms, file paths, variable names -- preserved by the prompt
- Non-text blocks (tool_use, tool_result, images) -- rendered from original, NOT translated

## Interactions with Other Components

- **RTL Detection** (`useRtlDetection.ts`): Exports `detectRtl()` for InputArea. Messages use `dir="auto"` natively. Translated content uses `dir="rtl"` for Hebrew/Arabic, `dir="auto"` for all other languages.
- **SessionNamer** (`SessionNamer.ts`): Same CLI spawn pattern, different model (Sonnet vs Haiku) and timeout (30s vs 10s).
- **MessageHandler** (`MessageHandler.ts`): Translation is wired via `setMessageTranslator()` setter, same pattern as `setSessionNamer()` and `setActivitySummarizer()`.
- **VitalsInfoPanel** (`VitalsInfoPanel.tsx`): Houses the language selection dropdown alongside other settings toggles.
