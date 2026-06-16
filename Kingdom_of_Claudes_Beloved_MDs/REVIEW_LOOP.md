# Review Loop (Automatic Claude + Codex Review)

## What It Does

After a development turn, the user can run an automatic review loop on the active
tab. Claude (the developer) writes a clean handover document; a persistent,
read-only Codex session (the reviewer) examines the actual code in the workspace
and returns an opinion; a lightweight Claude (Haiku) classifier decides whether
the verdict is an approval or a request for changes. If changes are requested,
the feedback is sent back to the developer and the cycle repeats until Codex
approves or a round cap is reached. The whole run is shown live in a panel and
can be stopped at any time.

## Roles

| Role | Backed by | Notes |
|------|-----------|-------|
| Developer | The live `SessionTab` (Claude) | Injected prompts; the final turn text is captured |
| Reviewer | `CodexReviewerSession` (native `codex exec`) | Persistent thread across rounds, `--sandbox read-only`, whole workspace |
| Classifier | `ReviewVerdictClassifier` (one-shot Haiku) | Deterministic verdict-line parse first, model fallback |
| Orchestrator | `ReviewLoopOrchestrator` | State machine, round counter, stop, transcript events |

The reviewer is a first-class Codex process (not the MCP "Consult Codex" path) so
it keeps review context between rounds and inspects the code directly.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/review-loop/ReviewLoopOrchestrator.ts` | State machine and round control |
| `src/extension/review-loop/CodexReviewerSession.ts` | Read-only Codex reviewer with a persistent thread |
| `src/extension/review-loop/ReviewVerdictClassifier.ts` | Two-layer verdict classifier (regex + Haiku) |
| `src/extension/review-loop/reviewLoopPrompts.ts` | Prompt templates, handover extraction, verdict parsing |
| `src/extension/review-loop/reviewLoopTypes.ts` | Config and developer-adapter types |
| `src/extension/review-loop/index.ts` | Barrel exports |
| `src/webview/components/ReviewLoop/ReviewLoopPanel.tsx` | Live transcript panel + Stop button |

Integration points: `SessionTab` (capture mechanism + lifecycle), `MessageHandler`
(start/stop dispatch + user-activity stop), `webview-messages.ts` (message
contract), `store.ts` + `useClaudeStream.ts` (webview state + event handling),
`StatusBar.tsx` (the "Review Loop" button), `global.css` (`.review-loop-*`).

## State Machine

```
Round 1: AWAIT_DEV_HANDOVER  -> developer writes the handover (work already done)
loop:
  REVIEWING                  -> CodexReviewerSession.review(handover)
  CLASSIFYING                -> ReviewVerdictClassifier.classify(review)
    approved                 -> DONE (approved)
    round >= maxRounds       -> DONE (max-rounds, open feedback shown)
    changes                  -> AWAIT_DEV_FIX: developer fixes + re-emits handover, round++ -> REVIEWING
```

The developer turn is captured by `SessionTab.captureNextTurn(prompt, timeoutMs)`,
which sends the prompt and resolves with the final (non-`tool_use`) assistant text
of the turn (resolved on the `result` event; mirrors `HeadlessAgentRunner`'s
bucketing). The loop stops on: approval, round cap, the Stop button
(`reviewLoopStop`), the user sending a manual message (`notifyUserActivity`), a
per-turn timeout, or tab disposal.

If the Claude process has already exited (e.g. the session ended), `startReviewLoop()`
resumes it (`--resume`, skip-replay) before injecting the handover, so the loop
never bails with "no active session". The auto-start guard likewise only requires a
known session id, not a live process.

## Clean Handover (Prompt Engineering)

The developer is instructed to output ONLY the document wrapped between
`===CLAUI_HANDOVER_BEGIN===` and `===CLAUI_HANDOVER_END===`. `extractHandover()`
returns only the inner text, so no preamble (e.g. "Here is the handover...") ever
reaches Codex. If a closed marker block is absent, `extractHandover()` returns null
and the orchestrator retries once, then errors — unmarked text is never forwarded to
the reviewer.

The reviewer is scoped to BLOCKING bugs only — defects that break correctness,
crash, lose data, or open a security hole. Style, naming, and non-blocking nits
never trigger a change request; the loop runs until Codex finds no blocking bug.
Before it is sent to Codex, the clean handover is wrapped by `buildReviewerPrompt()`,
which states the reviewer's role explicitly IN THE MESSAGE itself (review the work,
read the real code, judge it, and return a verdict) instead of relying only on the
separate Codex `instructions` channel. The reviewer is told to end with exactly one
line: `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUESTED`. The classifier parses that
line deterministically and only calls the Haiku model when it is missing or
ambiguous. On any classifier failure it defaults to "changes requested" so the
loop never falsely declares success.

## Configuration

All settings under `claudeMirror.reviewLoop.*`:

The loop can always be started from the StatusBar "Review Loop" button. By default
(`autoStart`) it also starts automatically after each user-initiated Claude turn
**that used at least one tool** (i.e. Claude actually did work). Pure text-only
Q&A turns are skipped, so casual chat never triggers a Codex review. Detection:
`SessionTab` sets a per-turn `usedTools` flag on the demux `toolUseStart` event.

| Setting | Default | Description |
|---------|---------|-------------|
| `autoStart` | `true` | Auto-start the loop after each user-initiated Claude turn; set false for manual-only |
| `maxRounds` | `5` | Max review rounds before stopping (clamped 1-20) |
| `reviewerModel` | `gpt-5.5` | Codex model id for the reviewer (empty = fall back to `codex.model`, then Codex default) |
| `reviewerReasoningEffort` | `xhigh` | Reviewer reasoning effort (empty = fall back to `codex.reasoningEffort`) |
| `reviewerServiceTier` | `fast` | Reviewer service tier; `fast` = Codex fast mode (empty = fall back to `codex.serviceTier`) |
| `classifierModel` | `claude-haiku-4-5-20251001` | Claude model for the verdict classifier |
| `turnTimeoutMs` | `300000` | Per-turn timeout for developer and reviewer turns |

The reviewer therefore runs **GPT-5.5, reasoning effort xhigh (extra high), Codex fast mode** by default. Per-turn overrides flow through `CodexExecProcessManager.runTurn` (model / `reasoningEffort` / `serviceTier`), so the reviewer's model and effort are independent of any Codex tab's global settings.

## UI

The primary control is the **"Auto-review"** toggle. A manual **"Run Review Now"**
button lives in the StatusBar Tools group (next to "Consult Codex") but is shown
**only when Auto-review is off** (`isConnected && supportsCodexConsult && !reviewLoopAutoStart`),
since when Auto-review is on the loop already runs after each work turn — so the
manual button would be redundant. Clicking "Run Review Now" resets the transcript,
opens the panel, and posts `reviewLoopStart`. The panel shows the current phase, a
"Round N / M" counter, a Stop button while running, and a transcript: the "Message
to reviewer" entry shows the EXACT prompt sent to Codex (reviewer role + verdict
format + the embedded handover, via `buildReviewerPrompt()`), followed by the
reviewer's review and verdict each round (it also auto-opens whenever a review event arrives).

The **"Auto-review"** sliding toggle switch (a label with a knob
that slides left/right between off and on) flips
`claudeMirror.reviewLoop.autoStart`. It is wired exactly like the `usageWidget`
toggle: `setReviewLoopAutoStart` (webview->extension) updates the config and
echoes back `reviewLoopAutoStartSetting`, which the extension also pushes once on
the webview `ready` burst so the toggle reflects the persisted value.

Beside the global toggle, on the same row, is a compact **circle-slash icon button**
(`.status-bar-autoreview-session-btn`, an inline SVG since the webview has no codicons)
— a per-tab override for a simple task that does not need review. It turns amber when
engaged (this session skipped) and carries its own tooltip. It is in-memory and
tab-local: `setReviewLoopSessionEnabled`
(webview->extension) flips `SessionTab.reviewLoopEnabledThisSession`, which
`maybeAutoStartReviewLoop()` checks (auto-review fires only when BOTH the global
`autoStart` is on AND this session flag is true; the deferred 400 ms callback
re-checks both, so flipping the toggle during that window still cancels the
pending start). Turning it off also stops any loop currently running on the tab.
It is NOT persisted and does NOT touch the global setting or other tabs.

The extension is the source of truth for this flag: the flag is changed ONLY by
the user's explicit toggle. On the webview `ready` event `SessionTab` does NOT
reset the flag — it instead PUSHES the current value (`reviewLoopSessionEnabledSetting`)
so the StatusBar toggle reflects reality after a (re)load. (Resetting on `ready`
was a bug: `ready` re-fires mid-session — e.g. on a new session's first turn — and
silently re-enabled a session the user had turned off, so "This session: Off" still
ran the loop. A fresh `SessionTab` still defaults to enabled via its field initializer.)

## Reviewer Scope

The reviewer runs read-only over the whole workspace (worktree root when the tab
runs in a worktree, otherwise the workspace root). It does not modify files.

## Tests

`tests/review-loop/reviewLoopPrompts.test.ts` covers the pure functions: handover
marker enforcement, exact final-verdict-line parsing (including `UNAPPROVED`,
trailing-text-after-verdict, and quoted-verdict-token cases), and conservative
classifier parsing. Run with `npm run test:review-loop` (Node's built-in test
runner via tsx).

## Implementation Note

The Super Particle Accelerator's entropy scanner splits tokens on
`[\s,;:=\[\]{}"'`<>()]` (note: `.` is not a delimiter) and flags any token of 16+
characters whose Shannon entropy exceeds the configured threshold. Avoid writing
`LONG_CONSTANT.length`-style expressions on long identifiers in this module; use
an intermediate local or string operations instead, or the write may be blocked
as a false-positive secret.
