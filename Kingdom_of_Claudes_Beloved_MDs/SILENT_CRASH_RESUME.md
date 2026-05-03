# Silent Crash Resume

When a CLI subprocess (Claude or Codex) exits with a non-zero code, the tab does not surface the legacy "process exited - Restart?" toast or `sessionEnded` UI. Instead the tab arms a lazy-resume; on the next user-sent message (or panel focus, for Claude), the extension transparently respawns the CLI with `--resume <sessionId>` (Claude) / `codex exec resume <threadId>` (Codex), flushes any queued prompts, and streams responses normally. The user perceives only a small startup delay (typically 2-5 s).

## What this does NOT solve

The upstream CLI crash itself. Silent resume is recovery, not prevention. STATUS_BREAKPOINT (exit code `2147483651` / `0x80000003`) recurrences are tagged in telemetry so they remain easy to monitor.

## Eligibility classifier

A crash falls into the silent path when **all** of these are true:

1. `info.code !== 0 && info.code !== null` (genuine crash, not a graceful exit).
2. Not `cancelledByUser` (user-cancel auto-resume already exists; that path is left unchanged).
3. Not `suppressNextExit` (deliberate stop+restart, e.g. edit-and-resend).
4. Not `claudeCliMissingDetected` / `happyAuthDetected` (install / auth guidance must surface).
5. Not `resumeTargetMissingDetected` (CLI rejected our `--resume <sid>` because the session JSONL no longer exists on disk; retrying would loop forever).
6. The tab has a `currentSessionId` to resume.
7. `silentResumeAttempts < silentCrashResume.maxAttempts` (cap; default 2).
8. `silentCrashResume.enabled === true` (default).

If any check fails, the existing visible UX runs unchanged. The exit-handler ordering puts `resumeTargetMissingDetected` highest priority, then in-flight escalation, then the classifier — so a stale resume target always surfaces a clean single-toast error and never re-arms.

### `resumeTargetMissingDetected` lifecycle

- **Set** in the stderr handler when the CLI emits `No conversation found with session ID: <uuid>`.
- **Cleared** at the top of every spawn (`startSession` and `beginSilentResume`) so a stale flag from a prior cycle cannot poison the next attempt.
- **Consumed and cleared** in the exit handler when the highest-priority branch fires.

### Attempts counter lifecycle

- **Incremented** in `armSilentResume` each time the classifier eligibility passes.
- **Reset to 0** when a `result/success` event is observed (clean turn → session is healthy again, future legitimate crash gets the full retry budget).
- **Reset to 0** in `handleSilentResumeReady` (resumed CLI emitted `system/init`).
- **Forced to `maxAttempts`** at the end of `escalateToVisibleCrash`, locking out further silent attempts until a clean turn happens. This breaks loops where the resumed CLI keeps failing fast.

### Idempotency

`escalateToVisibleCrash` is idempotent: an early-return guards against repeated calls within the same crash cycle (e.g. one path detects the failure via `result/error_during_execution` and a sibling path detects it via the subsequent `exit` event). The guard checks `!silentResumeArmedFlag && !silentResumeInFlight && silentResumeQueue.length === 0`. The Restart prompt is also suppressed when `reason === 'fresh-session'` because the on-disk JSONL is missing — restarting with the same `--resume <sid>` would just re-trigger the same error.

## State machine (Claude)

```
                       ┌─────────────────────────────┐
                       │   normal (CLI running)      │
                       └─────────────┬───────────────┘
                                     │ exit code != 0 && eligible
                                     v
                  ┌──────────────────────────────────────┐
                  │   armed (silentResumeArmedFlag=true) │
                  │   - postMessage interruptedAssistant │
                  │     Message (if streaming)            │
                  │   - postMessage processBusy=false     │
                  │   - NO sessionEnded                  │
                  │   - NO error toast                   │
                  └──────┬─────────────────┬─────────────┘
                         │ user sends OR panel becomes active
                         v
                  ┌──────────────────────────────────────┐
                  │   in-flight (silentResumeInFlight)   │
                  │   - processManager.start({           │
                  │       resume, skipReplay: true })    │
                  │   - hint timer (4 s default)         │
                  │   - hard timeout (15 s default)      │
                  └──────┬───────┬───────┬───────────────┘
                         │       │       │
              system/init│       │timeout│ spawn-error / exit
                         v       v       v
              ┌──────────────┐ ┌─────────────────────────┐
              │ ready: flush │ │ escalate to visible UX  │
              │ queued msgs  │ │ - sessionEnded crashed   │
              │ - busy=true  │ │ - error toast           │
              │ - reset      │ │ - messageDeferredFailed │
              │   attempts=0 │ │   per queued item       │
              └──────────────┘ └─────────────────────────┘
```

Codex is spawn-per-turn, so the equivalent state machine is degenerate: a crashed turn arms the tab, the next `sendTurn` naturally passes `--resume <threadId>`, and a clean `turnCompleted` event resets `silentResumeAttempts` to 0.

## Per-tab fields

`SessionTab` (`src/extension/session/SessionTab.ts`):

| Field | Purpose |
|---|---|
| `silentResumeArmedFlag` | Distinguishes mid-session crash recovery from boot-time lazy resume. |
| `silentResumeAttempts` | Consecutive attempts; capped by `maxAttempts`. |
| `silentResumeQueue` | `Array<{ id, text, ts }>` of prompts queued during respawn. |
| `silentResumeInFlight` | Guard between `beginSilentResume()` and ready/escalate. |
| `silentResumeTimer` | Hard timeout (`timeoutMs`). |
| `silentResumeHintTimer` | Delays the "(reconnecting...)" hint (`reconnectingHintDelayMs`). |
| `currentStreamingMessageId`, `currentlyStreaming` | Set on `stream_event/message_start`, cleared on `result` / `message_stop`. Used to decide whether to send `interruptedAssistantMessage` and which message id to finalize. |
| `deferredIdSeq` | Monotonic counter for `messageDeferred` ids. |

`CodexSessionTab` mirrors only `silentResumeAttempts` and `silentResumeArmedFlag`; queue/timers/streaming-id are not needed because Codex is spawn-per-turn (each `sendTurn` already starts a fresh process with `--resume <threadId>`).

## Public methods on SessionTab

| Method | Caller | Purpose |
|---|---|---|
| `isSilentResumeArmed()` | `MessageHandler.case 'sendMessage'` | Test before normal `control.sendText`; if true, defer instead. |
| `enqueueSilentResume(text)` | `MessageHandler.case 'sendMessage'` (when armed) | Allocate a deferred-message id, push onto queue, kick off `beginSilentResume()`. Returns `{ id }`. |

These are declared on the `WebviewBridge` interface (`src/extension/webview/MessageHandler.ts`) as optional, so non-Claude bridges (e.g. Codex) can omit them.

## Wake triggers

1. **User sends a message** (primary). `MessageHandler.case 'sendMessage'` checks `webview.isSilentResumeArmed?.()`. If true, the message is queued via `enqueueSilentResume`, the optimistic user bubble is rendered as normal, a `messageDeferred { id, text }` is sent to the webview for failure-path recovery, and `processBusy: true` is posted.
2. **Tab becomes active** (Claude only, secondary). The `panel.onDidChangeViewState` handler at `SessionTab.ts` calls `beginSilentResume()` directly (no queue contribution). The `silentResumeInFlight` guard makes a subsequent send-driven trigger a no-op.

## Failure paths

`escalateToVisibleCrash(reason)` is called when:

- **timeout**: hard timer (15 s default) fires before the resumed CLI emits `system/init`.
- **spawn-error**: `processManager.start()` rejected (e.g. `claude` not on PATH).
- **exit-while-spawning**: a fresh `exit` event arrives while `silentResumeInFlight` is true.
- **fresh-session**: the resumed CLI emitted `system/init` with a new `session_id` differing from `pendingResumeSessionId` (JSONL was missing or corrupt). This branch surfaces a non-modal warning toast and does **not** discard the new session - the user keeps chatting, just without prior context.
- **cap-exhausted**: `silentResumeAttempts >= maxAttempts` at the start of the next eligible crash.

In each case the extension:

1. Posts `messageDeferredFailed { id, text, reason }` for every queued item. The webview drops the optimistic bubble (matching by recent text) and dispatches a `silent-resume-restore-input` window event so `InputArea` restores the draft.
2. Posts `silentResumeStatus { active: false }` to hide the "(reconnecting...)" hint.
3. Tears down any half-spawned process (`processManager.stop()`).
4. Posts `sessionEnded { reason: 'crashed' }` and an error toast, and shows the legacy Restart prompt with a reason-specific message.

## Configuration

All keys live in `package.json` under `contributes.configuration`:

| Key | Default | Range | Purpose |
|---|---|---|---|
| `claudeMirror.silentCrashResume.enabled` | `true` | bool | Master switch. When `false`, the legacy Restart toast UX runs on every non-zero exit. |
| `claudeMirror.silentCrashResume.maxAttempts` | `2` | 1-5 | Consecutive silent-resume cap per tab. |
| `claudeMirror.silentCrashResume.timeoutMs` | `15000` | 3000-60000 | How long to wait for `system/init` after spawn. |
| `claudeMirror.silentCrashResume.reconnectingHintDelayMs` | `4000` | 1000-30000 | Delay before showing the "(reconnecting...)" hint in the input area. |

Reads happen lazily inside `getSilentResumeConfig()`, so changes take effect on the next crash without restart.

## Webview integration

`src/extension/types/webview-messages.ts` exposes five new postMessage variants:

| Type | Direction | Purpose |
|---|---|---|
| `interruptedAssistantMessage { messageId }` | ext -> webview | Finalize the streaming bubble (or any bubble matching `messageId`) and mark it `interrupted: true`. Webview falls back to `streamingMessageId` if `messageId` is `null`. |
| `messageDeferred { id, text }` | ext -> webview | Webview records `{ id, text, addedAt }` in `deferredMessages` for failure-path correlation. No visible change; the optimistic bubble was already rendered by the normal `userMessage` post. |
| `messageDeferredDelivered { id }` | ext -> webview | Webview drops the deferred record. |
| `messageDeferredFailed { id, text, reason }` | ext -> webview | Webview drops the record AND removes the optimistic user bubble (match by recent text within 30 s window) AND dispatches a `silent-resume-restore-input` window event so `InputArea` restores the draft. |
| `silentResumeStatus { active }` | ext -> webview | Toggles the "(reconnecting...)" hint in `InputArea`. |

`ChatMessage` gains an optional `interrupted?: boolean` flag. `MessageBubble.tsx` renders a muted "(message ended unexpectedly)" footer when set.

## Telemetry

All log lines go to `Output -> ClaUi` and to per-tab files under `globalStorage\...\logs\ClaUiLogs`:

```
[SilentResume] armed code=<exitcode> session=<id> attempts=<n>/<max>
[SilentResume] note: STATUS_BREAKPOINT exit observed (recurrence tracked).
[SilentResume] spawning session=<id> queuedMessages=<n>
[SilentResume] start() resolved in <ms>ms; awaiting system/init
[SilentResume] resumed session=<id> queuedMessages=<n> (under timeout)
[SilentResume] resumed-with-fresh-session expected=<id> got=<id>
[SilentResume] timeout session=<id> after <ms>ms
[SilentResume] spawn error: <message>
[SilentResume] failed reason=<timeout|spawn-error|exit-while-spawning|cap-exhausted|fresh-session> session=<id>
[SilentResume] cap-exhausted session=<id> attempts=<n>/<max>
[SilentResume] turn-completed; clearing armed state (was attempts=<n>).   (Codex)
```

## Manual test plan

After `npm run deploy:local` and a VS Code window reload:

1. **Idle crash**. Open a Claude tab, send a message, wait for the assistant turn to finish. Identify the Claude PID via `Output -> ClaUi`. From a terminal: `taskkill /F /T /PID <pid>`. Observe: NO toast, NO banner, history intact, input enabled. `Output -> ClaUi` shows `[SilentResume] armed code=...`.
2. **Resume on send**. Type a follow-up message and click Send. Observe a 2-5 s delay. The assistant response streams normally. Telemetry: `[SilentResume] spawning -> resumed session=...`.
3. **Mid-turn crash**. Send a long-running prompt; while the assistant is streaming, taskkill its process. The partial bubble gains the "(message ended unexpectedly)" footer. The next user message resumes cleanly.
4. **Cap exhaustion**. Set `silentCrashResume.maxAttempts = 1`. Crash, send (silent resume), crash again. The second crash falls through to the visible Restart UX.
5. **Timeout**. Set `silentCrashResume.timeoutMs = 3000`. Block `claude` on PATH (e.g. rename the executable temporarily) and trigger a crash + send. The "(reconnecting...)" hint appears at 4 s; at 3 s the timeout fires and the visible Restart UX surfaces with the typed text restored to the input area.
6. **Feature off**. Set `silentCrashResume.enabled = false`. Crash an idle tab. Behavior is bit-identical to pre-feature: Restart toast + sessionEnded.
7. **Codex parity**. In a Codex tab, trigger a crash via taskkill mid-turn. The error toast is suppressed. Send a follow-up message - it should `--resume <threadId>` and continue normally. Trigger two consecutive crashes with `maxAttempts = 1` to verify cap-exhausted falls through to the legacy error toast.

## Files

| Layer | File | Surfaces |
|---|---|---|
| Extension (Claude) | `src/extension/session/SessionTab.ts` | Fields, classifier, `armSilentResume`, `beginSilentResume`, `flushSilentResumeQueue`, `escalateToVisibleCrash`, `handleSilentResumeReady`, exit handler, wake-on-focus, dispose cleanup |
| Extension (Codex) | `src/extension/session/CodexSessionTab.ts` | Fields, exit-handler classifier, turn-completed reset |
| Extension (router) | `src/extension/webview/MessageHandler.ts` | `WebviewBridge` interface additions, `case 'sendMessage'` guard |
| Types | `src/extension/types/webview-messages.ts` | 5 new message variants |
| Webview store | `src/webview/state/store.ts` | `interrupted?` flag on `ChatMessage`, `deferredMessages`, `silentResumeActive`, 5 new actions |
| Webview router | `src/webview/hooks/useClaudeStream.ts` | 5 new `case` branches |
| Webview UI | `src/webview/components/ChatView/MessageBubble.tsx` | Interrupted footer |
| Webview UI | `src/webview/components/InputArea/InputArea.tsx` | "(reconnecting...)" hint, `silent-resume-restore-input` event listener |
| Config | `package.json` | 4 new `claudeMirror.silentCrashResume.*` keys |
