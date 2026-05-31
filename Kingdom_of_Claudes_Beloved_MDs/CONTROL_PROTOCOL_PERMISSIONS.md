# Control-Protocol Permissions (can_use_tool)

## What this is and why it exists

In **full-access** mode ClaUi routes `AskUserQuestion` and `ExitPlanMode` through the
Claude CLI's `can_use_tool` control protocol. This turns those two tools into a **true
synchronous pause**: the CLI blocks and waits for ClaUi's reply before the model
continues, and the user's real answer is injected back into the tool input.

This replaces the older approach of detecting the tools from the output stream and
showing an approval bar after the fact. Under plain `bypassPermissions`,
`AskUserQuestion`/`ExitPlanMode` always return "ask" from the CLI's `checkPermissions`,
so they used to collapse into an "Answer questions?" error and the model proceeded
without a real answer. The control protocol fixes that at the source.

The legacy stream-detection machinery (documented in
`BUG_EXITPLANMODE_INFINITE_LOOP.md`) still runs, but only for **supervised** mode, where
the control protocol is not enabled. The two never run at once -- see "Gating" below.

## How it is enabled

`ClaudeProcessManager.start()` builds the CLI args by permission mode:

- **full-access**: `--permission-mode bypassPermissions` **and** `--permission-prompt-tool stdio`.
  The `stdio` value makes the CLI emit `can_use_tool` control requests instead of failing
  the always-"ask" tools. Setting this flag flips `controlProtocolEnabled = true`.
- **supervised**: `--allowedTools <read-only list>`. No control protocol.
- An explicit `allowedTools` override (Smart Search) forces the supervised branch and
  leaves the control protocol off.

`controlProtocolEnabled` is reset to `false` at the start of every (re)start and only the
full-access branch re-enables it. The public getter is `controlProtocolActive`.

## The handshake

The CLI only emits `can_use_tool` requests after an `initialize` handshake. Immediately
after spawn (and only when `controlProtocolEnabled`), `sendInitialize()` writes:

```json
{ "type": "control_request", "request_id": "claui-init-<ts>", "request": { "subtype": "initialize", "hooks": {} } }
```

It is sent as the first stdin line so the CLI (which reads stdin FIFO) processes it
before the caller's first user message.

## The round-trip

1. The model calls `AskUserQuestion` or `ExitPlanMode`.
2. The CLI sends a `control_request` with `subtype: "can_use_tool"`, a `request_id`,
   `tool_name`, and the tool `input`. The CLI **blocks** on this request.
3. `ClaudeProcessManager.handleIncomingControlRequest` routes it:
   - `AskUserQuestion` / `ExitPlanMode` -> `emit('permissionRequest', payload)` so the UI
     decides. The CLI stays blocked until ClaUi replies.
   - Any other tool -> auto-allow `{ behavior: 'allow', updatedInput: input }` (under
     `bypassPermissions` only always-"ask" tools reach the host).
   - Unknown subtype -> `deny` with a message, so the CLI is never left hanging.
4. `SessionTab` forwards the `permissionRequest` event to
   `MessageHandler.handlePermissionRequest(req)`.
5. The user interacts with the approval bar / question UI (or types text).
6. `MessageHandler` resolves the decision and calls
   `ClaudeProcessManager.respondPermission(requestId, result)`, which writes:

```json
{ "type": "control_response", "response": { "subtype": "success", "request_id": "<id>", "response": <PermissionResult> } }
```

`PermissionResult` is one of:

- `{ "behavior": "allow", "updatedInput": { ... } }` -- the model continues with the
  (possibly modified) input.
- `{ "behavior": "deny", "message": "..." }` -- the model receives the message as the
  reason and revises instead of proceeding.

## Decision mapping (MessageHandler)

`handlePermissionRequest(req)` stores the pending request, marks the tool pending, posts
`processBusy:false`, and posts `planApprovalRequired` with `planText` set from
`serializeToolInput(req.input)`.

> **Timing note:** the `can_use_tool` request arrives **after** `message_stop`, which has
> already cleared the webview's `streamingBlocks`. The plan/question detail must therefore
> be passed explicitly via `planText` on the `planApprovalRequired` message -- it cannot be
> re-extracted from `streamingBlocks` on the webview side. `planText` is only set on this
> control-protocol path.

Two resolvers translate UI events into a `PermissionResult`:

**`resolvePermissionFromApproval(msg)`** -- button clicks (`planApprovalResponse`):

| Action | Result |
|--------|--------|
| `approve` (default) | `allow` with original input |
| `approveClearBypass` | `allow` + request context compaction |
| `approveManual` | `allow` + switch setting to supervised mode |
| `questionAnswer` | `allow` with `updatedInput.answers` built from `selectedOptions` |
| `feedback` | `deny` with the feedback text |
| `reject` | `deny` with a "revise the plan" message |

**`resolvePermissionFromText(text)`** -- the user types into the input box while a request
is pending (so a plain message can't silently leave the CLI blocked). The typed text is
posted as a user message, then:

- `AskUserQuestion` -> `allow` with `updatedInput.answers` built from the typed text.
- `ExitPlanMode` / other -> `deny` with the typed text as the revision instruction.

Both resolvers return `true` only when a request was pending, so the normal
`sendMessage` / `planApprovalResponse` handling is skipped just in that case.

**`buildQuestionAnswers(input, selected, fallback)`** -- builds the
`{ [questionText]: answerLabel }` map the CLI expects. The first question gets the chosen
answer (selected options joined, or the fallback text); any further questions default to
their first option's label.

**`finishPermission(result, isExitPlanMode)`** -- clears the pending state, calls
`clearApprovalTracking()`, sends the `control_response` via `respondPermission`, and posts
`processBusy:true`. On a send failure it surfaces an error to the webview so the user is
never left silently stuck.

## Gating against the legacy path

`notifyPlanApprovalRequired` (the legacy stream-detection trigger) returns immediately when
`controlProtocolActive` is `true`. So in full-access mode the control protocol is the only
thing that shows the approval bar; in supervised mode the legacy detection + nudge
machinery (see `BUG_EXITPLANMODE_INFINITE_LOOP.md`) is what runs. They never fight over the
bar or its suppression flags.

## Key files

- `src/extension/process/ClaudeProcessManager.ts` -- arg building + `controlProtocolEnabled`,
  `sendInitialize()`, `handleIncomingControlRequest()`, `respondPermission()`,
  `controlProtocolActive` getter, `permissionRequest` event, `PermissionRequestPayload`.
- `src/extension/types/stream-json.ts` -- `PermissionResult`, control request/response types.
- `src/extension/session/SessionTab.ts` -- forwards `permissionRequest` to the handler.
- `src/extension/webview/MessageHandler.ts` -- `handlePermissionRequest`,
  `resolvePermissionFromApproval`, `resolvePermissionFromText`, `buildQuestionAnswers`,
  `finishPermission`; gating in `notifyPlanApprovalRequired`.
- `src/extension/types/webview-messages.ts` -- `planText?: string` on `PlanApprovalRequiredMessage`.
- `src/webview/hooks/useClaudeStream.ts` -- prefers `msg.planText` for the approval bar.
- `src/webview/components/ChatView/PlanApprovalBar.tsx`,
  `src/webview/components/InputArea/InputArea.tsx` -- the approval / question UI and typed-text routing.

## How to verify

1. Start a full-access session and give a task that triggers `AskUserQuestion`.
2. The question UI appears and the model **stops** -- nothing proceeds until you answer.
3. Pick an option (or type a custom answer). The model continues using the answer you gave
   (not a guessed default).
4. Trigger plan mode (`ExitPlanMode`). Approve -> the model exits plan mode and continues.
   Reject / feedback -> the model revises the plan instead of proceeding.
5. Confirm the `Output -> ClaUi` log shows `Control protocol: sent initialize handshake`
   and `[Permission] can_use_tool received` / `[Permission] responded ... behavior=...`.
