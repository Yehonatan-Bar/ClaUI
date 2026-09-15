# Deferred First Spawn

## What this is and why it exists

When the user opens a new interactive session tab, ClaUi does **not** spawn the
provider CLI (`claude` or `happy`) immediately. The spawn is deferred until the
user sends their **first prompt**.

The goal: a missing or misconfigured provider CLI must never block opening the
interface, and no install/auth/fallback prompt may appear before the first
message. Opening a tab always renders a clean, ready chat regardless of whether
Claude, Codex, or Happy is installed. Provider availability only matters once the
user actually tries to use it.

Codex is unaffected by this mechanism because it is already turn-based: its
`startSession` never launches a CLI (the Codex CLI is invoked per turn), so a
missing Codex CLI already surfaces only during a turn, never at tab open.

## Flow

1. **Open (deferred):** the interactive "start session" commands call
   `SessionTab.startSession({ defer: true })`. When `defer` is set and the start
   is not a resume/fork, the tab arms `deferredFirstStartArmed`, stores the
   captured options (`cwd`, `model`), posts a `sessionStarted` message with
   `sessionId: 'pending'` (which the webview treats as a ready session), and
   returns **without spawning**. No process, no possible crash, no error banner.
2. **First prompt:** `MessageHandler` intercepts the first `sendMessage` /
   `sendMessageWithImages`. If `webview.isStartDeferred()` is true it routes to
   `startDeferredThenDispatch(text, images)`, which:
   - `await webview.ensureStarted()` — performs the real
     `SessionTab.startSession()` (eager spawn) with the captured options.
   - then dispatches the message through the normal `dlpScanAndDispatch` path
     (DLP scan, optimistic bubble, `control.sendText` / `sendWithImages`, busy
     state, auto-naming, prompt history).
3. **If the CLI is missing at that point**, the process spawn dies and the
   existing exit/error handlers surface the appropriate UX — Claude install
   guidance, Happy→Claude fallback toast, or Happy auth guidance — **now**, i.e.
   only after the first prompt, which is exactly when it is expected.

## Key code

- `src/extension/session/SessionTab.ts`
  - Fields: `deferredFirstStartArmed`, `deferredStartOptions`,
    `deferredStartPromise`.
  - `startSession({ defer })` — the deferral branch (posts pending
    `sessionStarted`, arms, returns without spawn).
  - `isStartDeferred()` — true while armed (including during the in-flight first
    spawn).
  - `ensureStarted()` — idempotent, concurrency-safe real spawn. Concurrent first
    sends share the single `deferredStartPromise` and dispatch in arrival order;
    the armed flag is cleared only after the spawn settles.
- `src/extension/webview/MessageHandler.ts`
  - `WebviewBridge.isStartDeferred?()` / `ensureStarted?()` hooks.
  - `startDeferredThenDispatch()` — first-send spawn + dispatch.
  - Guards at the top of the `sendMessage` and `sendMessageWithImages` cases.
- `src/extension/commands.ts` — the interactive entry points pass `defer: true`:
  the `claudeMirror.startSession` command and `startClaudeTabWithProfile`.
- `src/extension/session/CodexSessionTab.ts` — accepts `defer` for signature
  parity but ignores it (Codex is inherently deferred).

## Scope (opt-in)

Only interactive "open a new session" flows defer. Resume, fork, worktree move,
Smart Search, review loop, provider handoff, and snapshot restore keep their
eager/lazy-resume spawn behavior — they either need a live process to replay
history or drive the session programmatically, and a missing CLI there is a
legitimate error to show.

## Persistence

A deferred tab that is never prompted has no session id (`sessionId` is `null`),
so it is excluded from the open-tabs snapshot (`buildSnapshot` keeps only entries
with a real session id, plus Smart Search tabs). It is therefore never restored
with a bogus `pending` id after a window reload.

## Known limitations

- If the chosen provider CLI is missing, the very first prompt is consumed by the
  failed spawn (it is shown optimistically in the chat but not delivered). The
  user sees the install/fallback guidance and re-sends after fixing the CLI. This
  only affects users whose selected CLI is not installed.
- The command-palette `ClaUi: Send Message` (`claudeMirror.sendMessage`) still
  guards on `tab.isRunning`, so using it as the very first interaction on a
  deferred tab shows "No active session. Start one first." The webview input (the
  normal path) spawns on send as described above.
