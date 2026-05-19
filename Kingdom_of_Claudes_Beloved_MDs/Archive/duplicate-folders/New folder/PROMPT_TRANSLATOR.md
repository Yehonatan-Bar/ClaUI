# Babel Fish (Unified Translation Layer)

Babel Fish is a unified bi-directional translation feature that lets users work in their native language while Claude Code exclusively receives and responds in English. When enabled, user prompts are auto-translated to English before sending, and Claude's responses are auto-translated back to the user's chosen language.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/BabelFish/BabelFishPanel.tsx` | Settings panel: master toggle, language selector, info (!) button |
| `src/extension/session/PromptTranslator.ts` | Backend: translates user prompts to English (outbound) |
| `src/extension/session/MessageTranslator.ts` | Backend: translates assistant responses to target language (inbound) |
| `src/extension/webview/MessageHandler.ts` | Routes all translation messages; auto-translates each assistant message (intermediate + final) |
| `src/extension/session/SessionTab.ts` | Wires both translators into the per-tab MessageHandler |
| `src/webview/components/StatusBar/StatusBar.tsx` | Renders "Babel Fish" control across responsive status-bar stages |
| `src/webview/components/InputArea/InputArea.tsx` | Prompt translation intercept logic in `sendMessage()` |
| `src/webview/hooks/useClaudeStream.ts` | Dispatches `babelFishSettings`, `autoTranslateStarted`, translation results |
| `src/webview/state/store.ts` | Zustand state: `babelFishEnabled` + existing translation states |
| `src/webview/styles/global.css` | CSS: `.babel-fish-panel`, `.babel-fish-*` classes |
| `src/extension/types/webview-messages.ts` | Message types: `SetBabelFishEnabledRequest`, `BabelFishSettingsMessage`, `AutoTranslateStartedMessage` |

## Architecture

### Outbound (User -> English)
```
User types in native language
  -> InputArea.sendMessage() intercepts (promptTranslateEnabled + autoTranslateEnabled)
  -> postToExtension({ type: 'translatePrompt', text })
  -> MessageHandler -> PromptTranslator.translate()
  -> Spawns `claude -p --model claude-sonnet-4-6`
  -> Returns translatePromptResult -> auto-sends translated text
```

### Inbound (English -> User Language)
```
Claude responds in English (each API call in the agentic loop)
  -> StreamDemux emits 'assistantMessage' (with unique message.id per API call)
  -> MessageHandler checks babelFishEnabled + dedup (babelFishTranslatedIds Set)
  -> If not yet translated for this ID:
     -> Adds message.id to dedup set
     -> Strips code blocks from text content
     -> Posts autoTranslateStarted to webview (shows "Translating..." indicator)
     -> Calls MessageTranslator.translate(text, targetLang)
     -> Posts translationResult to webview
     -> Zustand auto-adds to showingTranslation set -> UI shows translated text
  -> On 'result' event: dedup set is cleared for next turn

This means ALL intermediate text blocks between tool calls are translated,
not just the final response. Each API call in a multi-tool turn gets its
own translation (e.g., "I'll help you...", "Let me search...", "Based on my analysis...").
```

## Babel Fish Toggle Behavior

When enabled:
- Sets `babelFishEnabled: true` in store
- Sets `promptTranslateEnabled: true` and `autoTranslateEnabled: true` (enables outbound)
- Auto-translates every assistant response (inbound)
- Hides per-message manual "Translate" button
- Shows "Original" / language toggle on translated messages

When disabled:
- All three flags reset to false
- Per-message manual translate button reappears
- No auto-translation in either direction

## Settings Panel (BabelFishPanel)

Accessible via the "Babel Fish" control in the status bar (placement depends on responsive stage). Contains:
- Master toggle: Enable/disable Babel Fish
- Language selector: 10 supported languages (Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean)
- Info (!) button: Shows explanation callout when clicked
- Status indicator: Green/gray dot with active direction summary

## Translation Models

Both PromptTranslator and MessageTranslator are hardcoded to `claude-sonnet-4-6`. The outbound system prompt instructs the model to rewrite text as a native English-speaking software engineer would phrase it, preserving intent and technical meaning. The inbound system prompt translates to the target language while preserving markdown formatting and not translating technical terms.

## Message Protocol

### Webview -> Extension
- `setBabelFishEnabled` - `{ enabled: boolean }` - master toggle
- `translatePrompt` - `{ text: string }` - outbound translation request
- `setTranslationLanguage` - `{ language: string }` - change target language

### Extension -> Webview
- `babelFishSettings` - `{ enabled: boolean, language: string }` - sent on ready + config change
- `autoTranslateStarted` - `{ messageId: string }` - signals inbound translation in progress
- `translationResult` - `{ messageId, translatedText, success, error }` - inbound translation result
- `translatePromptResult` - `{ translatedText, success, error }` - outbound translation result

## VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMirror.babelFish.enabled` | boolean | false | Master toggle for Babel Fish |
| `claudeMirror.translationLanguage` | string | "Hebrew" | Target language for translations |
| `claudeMirror.promptTranslator.enabled` | boolean | false | Outbound translation (synced by Babel Fish) |
| `claudeMirror.promptTranslator.autoTranslate` | boolean | false | Auto-send translated prompts (synced by Babel Fish) |

## Zustand State

| Field | Type | Default | Persists across reset? |
|-------|------|---------|----------------------|
| `babelFishEnabled` | boolean | false | Yes |
| `isTranslatingPrompt` | boolean | false | No |
| `promptTranslateEnabled` | boolean | false | Yes |
| `autoTranslateEnabled` | boolean | false | Yes |
| `translationLanguage` | string | "Hebrew" | Yes |
| `translations` | Record<string, string> | {} | No |
| `translatingMessageIds` | Set<string> | empty | No |
| `showingTranslation` | Set<string> | empty | No |

## Settings Sync Design

Babel Fish acts as a **master switch** that controls both `promptTranslator.enabled` and `promptTranslator.autoTranslate`. The sync is enforced at three levels:

1. **Panel toggle** (`setBabelFishEnabled` handler): Sends explicit values directly to the webview instead of reading from config, avoiding a race condition where async config updates haven't applied yet.

2. **VS Code Settings UI** (config change handler): When `babelFish.enabled` is turned off, the handler also sets `promptTranslator.enabled` and `promptTranslator.autoTranslate` to `false` in VS Code config, preventing stale `true` values from re-enabling prompt translation on reload.

3. **Initialization** (`sendBabelFishSettings`): When Babel Fish is off, the method also sends `promptTranslatorSettings` with `false` to ensure the webview state is consistent regardless of what the individual `promptTranslator` configs say.

## Important Notes

- Auto-translation triggers on each `assistantMessage` event (intermediate + final), with deduplication via `babelFishTranslatedIds` Set to prevent re-translating when `--include-partial-messages` fires duplicate events for the same message ID
- The dedup set is cleared on the `result` event (end of turn), ready for the next turn
- Code blocks (fenced ```) are stripped from the text before translation
- MessageTranslator has a 30-second timeout; PromptTranslator has a 60-second timeout
- Both translators use `buildClaudeCliEnv(apiKey)` from `envUtils.ts` for API key injection
- Windows process tree kill uses `taskkill /F /T /PID` pattern (PromptTranslator only; MessageTranslator uses `child.kill('SIGTERM')`)

---

# Merged from MESSAGE_TRANSLATION.md

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
