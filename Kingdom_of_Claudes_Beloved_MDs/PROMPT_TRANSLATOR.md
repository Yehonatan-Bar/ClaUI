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
| `src/webview/components/StatusBar/StatusBar.tsx` | Renders "Babel Fish" button next to Vitals |
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

Accessible via "Babel Fish" button in the status bar (next to Vitals). Contains:
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
