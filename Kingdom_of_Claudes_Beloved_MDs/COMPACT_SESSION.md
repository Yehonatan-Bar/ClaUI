# Compact Session

## What It Does & Why

"Compact Session" turns a long, token-heavy conversation into a fresh, low-token
one without losing context. On demand it reads the current session, asks a model
to summarize it into a single self-contained continuation prompt, copies that
prompt to the clipboard, and opens a brand-new tab with the prompt pre-filled in
the input box (not auto-sent). The user reviews it and presses Enter to continue
the same task in a new session that starts with a tiny context footprint.

This is distinct from the CLI's in-place `/compact` (see `claudeMirror.compact`),
which compresses the running context window but keeps the same session. Compact
Session instead produces a portable prompt and starts a new session.

## End-to-End Flow

```
InputArea "Compact" button
  -> postMessage { type: 'compactSession' }
  -> MessageHandler / CodexMessageHandler
       -> vscode.commands.executeCommand('claudeMirror.compactSession', { sourceTabId })
  -> commands.ts runCompactSession()
       -> TabManager.compactSession({ sourceTabId })
            -> sourceTab.collectHandoffSnapshot()            (full transcript via ConversationReader)
            -> CompactSessionService.build(snapshot)         (AI summary, heuristic fallback)
            -> vscode.env.clipboard.writeText(prompt)         (clipboard backup)
            -> createTabForProvider(provider)                 (fresh tab, same provider)
            -> targetTab.setForkInit({ promptText: prompt, messages: [] })
            -> targetTab.startSession({ cwd })                (posts forkInit -> input pre-filled)
            -> sourceTab.postMessage({ type: 'compactSessionResult', ... })
  -> useClaudeStream 'compactSessionResult' -> clears button spinner + shows notice toast
```

## Key Files

| File | Role |
|------|------|
| `src/extension/session/CompactSessionService.ts` | Builds the compact prompt: transcript + grounding capsule -> Claude CLI summary, with deterministic fallback. |
| `src/extension/session/TabManager.ts` | `compactSession()` orchestrates snapshot -> build -> clipboard -> new tab -> result. Reuses `handoffLocks`. |
| `src/extension/commands.ts` | `runCompactSession()` + command `claudeMirror.compactSession`. |
| `src/extension/webview/MessageHandler.ts` | Claude `compactSession` case -> forwards to the command; posts failure result on reject. |
| `src/extension/webview/CodexMessageHandler.ts` | Codex `compactSession` case (same forwarding). |
| `src/extension/session/handoff/HandoffContextBuilder.ts` | Reused to build the structured grounding capsule (files, blockers, cwd/branch). |
| `src/extension/session/handoff/HandoffPromptComposer.ts` | Reused as the deterministic fallback prompt. |
| `src/webview/components/InputArea/InputArea.tsx` | The `.compact-session-button` (in `.clear-stack`), `handleCompactSession`, and the result toast. |
| `src/webview/hooks/useClaudeStream.ts` | Handles `compactSessionResult` (clears spinner, sets notice). |
| `src/webview/state/store.ts` | `compactingSession` + `compactSessionNotice` state. |
| `src/webview/styles/global.css` | `.compact-session-button` styling + `compact-spin` keyframes. |
| `src/webview/components/Help/helpContent.ts` | Bilingual Help entry `inputarea-compact-session`. |

## CompactSessionService

`build(snapshot, { claudeConfigDir? })` -> `{ prompt, source: 'ai' | 'heuristic' }`.

1. Builds a `HandoffCapsule` via `HandoffContextBuilder` with a large turn budget
   (60 turns, 1600 chars/turn) — used both for grounding the AI prompt and as the
   fallback (`HandoffPromptComposer.compose`).
2. Builds a plain-text transcript from `snapshot.messages` (USER/ASSISTANT lines;
   `tool_use` blocks reduced to `[used tool: X]`). Truncated to
   `MAX_TRANSCRIPT_CHARS` (24k) keeping head 35% + tail.
3. Sends an instruction prompt to the Claude CLI (`claude -p --model <model>`)
   asking for ONE self-contained handoff prompt organized into 7 sections
   (objective, progress, current state, decisions, environment/files, blockers,
   next steps), in the user's language, output-only.
4. On empty transcript / spawn error / non-zero exit / timeout (90s) it returns
   the deterministic heuristic prompt instead, so the feature never dead-ends.

Model resolution: `claudeMirror.compactSession.model` if set, else
`claudeMirror.analysisModel` (Haiku by default).

## Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `claudeMirror.compactSession.model` | `""` | Model for the summary. Empty = reuse `claudeMirror.analysisModel`. Set a Sonnet id for higher quality. |

## Message Contract

- Webview -> Extension: `CompactSessionRequest` `{ type: 'compactSession' }`.
- Extension -> Webview: `CompactSessionResultMessage`
  `{ type: 'compactSessionResult', success, error?, promptChars?, openedNewTab?, copiedToClipboard?, source? }`.

## UI

- Button lives in `.clear-stack` next to Search and Clear, above the input box.
- Shows a spinning icon while working; disabled when disconnected, during a
  handoff lock, or while already compacting.
- A transient toast (reusing `git-push-toast` styling) reports success/failure
  and auto-dismisses after 6s. A 120s client-side safety timeout clears the
  spinner if no result arrives.

## Known Limitations

- The new session starts fresh: the prompt is context, not a resumed transcript.
  Quality depends on the summarizer model — Haiku is fast/cheap; set a stronger
  model via `compactSession.model` for richer handoffs.
- `CLAUDE_CONFIG_DIR` is passed only for Claude tabs that carry an account
  profile; the summary CLI call otherwise uses the default Claude config/account.
- Available on Claude and Codex tabs; not on Multi-Participant tabs.
