# Bug: ExitPlanMode Infinite Loop

## Summary

When the model calls `ExitPlanMode` and the user approves the plan, the system should let the model continue implementing. Instead, multiple code paths can re-trigger the approval bar or send spurious user messages to the CLI, causing the model to call ExitPlanMode again.

**Date First Fixed**: 2026-02-23
**Date Second Fix**: 2026-02-23
**Severity**: Critical (blocks plan mode workflow)
**Files Modified**: `src/extension/webview/MessageHandler.ts`, `src/webview/hooks/useClaudeStream.ts`

---

## Root Cause (Original)

**The extension sent `"Yes, proceed with the plan."` as a user message to the CLI stdin.** This was the fundamental error.

The CLI auto-approves `ExitPlanMode` internally (via `bypassPermissions` or `allowedTools`). Sending a user message creates a spurious conversation turn that causes the model to call ExitPlanMode again.

The original fix removed auto-approve logic and made ExitPlanMode approve actions close the bar without sending text.

---

## Root Causes (Recurrence)

After the original fix, the bug recurred due to **five overlapping issues**:

### 1. Guard reset on `messageStart` (PRIMARY)

When the model started a new turn after ExitPlanMode, the `messageStart` handler unconditionally reset:
- `pendingApprovalTool = null`
- `approvalResponseProcessed = false`

This wiped the protection against re-triggers. Late `assistantMessage` events (which arrive after `messageStart`) could then pass through the guard and re-show the approval bar.

### 2. `assistantMessage` fallback re-trigger

The `assistantMessage` event handler has a fallback detection path:
```typescript
if (!this.pendingApprovalTool && event.message.stop_reason === 'tool_use') {
  // find approval tool in content blocks...
  this.notifyPlanApprovalRequired(approvalToolBlock.name);
}
```

After `messageStart` cleared `pendingApprovalTool`, this fallback could fire from accumulated/replayed content that still contained ExitPlanMode blocks.

### 3. Stale approval bar in webview

`processBusy: false` (sent on result event) did NOT clear `pendingApproval` in the webview. The approval bar remained visible after the CLI had already auto-approved ExitPlanMode and the model started implementing.

### 4. User text routed as feedback

When the user typed text while the stale approval bar was visible, InputArea routed it as a `planApprovalResponse` with `action: 'feedback'`. The feedback handler sent the text via `control.sendText()` -- the exact same "user message to CLI" pattern that caused the original loop.

### 5. No `planModeActive` guard for ExitPlanMode

`notifyPlanApprovalRequired()` had no check for whether plan mode was still active. After ExitPlanMode was processed (`planModeActive = false`), any late event detection could still re-trigger the notification.

### Event flow of the recurrence

```
Model calls ExitPlanMode in message A
    |
    v
messageDelta fires -> approval bar shows in webview
    |
    v
CLI auto-approves ExitPlanMode -> model starts implementing
    |
    v
result event fires -> processBusy: false (bar NOT cleared)
    |
    v
messageStart for message B -> pendingApprovalTool=null, approvalResponseProcessed=false
    |
    v
Model implements (creates files, edits code)
    |
    +-- Path A: Late assistantMessage for message A arrives
    |   -> !pendingApprovalTool (cleared) && stop_reason === 'tool_use'
    |   -> ExitPlanMode found in content -> notifyPlanApprovalRequired fires
    |   -> Approval bar re-shows
    |
    +-- Path B: User sees stale approval bar, types "I approve"
        -> InputArea routes as feedback (pendingApproval was still set)
        -> control.sendText("I approve") -> new user message to CLI
        -> Model gets confused -> may call ExitPlanMode again
```

---

## Fix Applied (Second Round)

### 1. Added `exitPlanModeProcessed` flag

New state variable that tracks whether an ExitPlanMode approval cycle has completed in this session:
- Set to `true` when user responds to ExitPlanMode (any action)
- Reset to `false` when EnterPlanMode is detected (new plan cycle)
- Reset to `false` on editAndResend (session restart)

Guard in `notifyPlanApprovalRequired()`:
```typescript
const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
if (isExitPlanMode && this.exitPlanModeProcessed) {
  this.log('Suppressing stale ExitPlanMode notification - already processed');
  return;
}
```

This prevents ALL stale re-triggers from late `assistantMessage` events, replayed sessions, or fallback detection paths.

### 2. Clear ExitPlanMode approval bar from webview on `messageStart`

In `useClaudeStream.ts`, the `messageStart` handler now clears `pendingApproval` if it's for ExitPlanMode (but NOT for AskUserQuestion, which genuinely pauses the CLI):

```typescript
case 'messageStart': {
  const currentApproval = useAppStore.getState().pendingApproval;
  if (currentApproval && currentApproval.toolName !== 'AskUserQuestion') {
    setPendingApproval(null);
  }
  handleMessageStart(msg.messageId, msg.model);
  break;
}
```

This prevents the user from accidentally interacting with a stale approval bar after the model has started implementing.

### 3. ExitPlanMode blocks ALL user messages, not just approves

Previously, only approve actions (`approve`, `approveClearBypass`, `approveManual`) were guarded. Reject and feedback actions still sent text via `control.sendText()`.

Now, ALL ExitPlanMode actions (approve, reject, feedback) close the bar without sending text. The CLI has already auto-approved and moved on -- sending any text creates a spurious user message.

```typescript
if (isExitPlanMode) {
  this.log(`ExitPlanMode ${msg.action} - closing bar without sending user message`);
  // Apply side effects only (compact, permission mode switch)
  // Don't send text - just close the bar
}
```

The user can still redirect the model by typing a new message (regular `sendMessage` path, not the feedback path).

---

## Key Code (current)

### notifyPlanApprovalRequired

```typescript
private notifyPlanApprovalRequired(toolName: string): void {
  if (this.pendingApprovalTool === toolName) return;
  if (this.approvalResponseProcessed) return;

  // Suppress stale ExitPlanMode when already processed in this plan cycle
  const norm = toolName.trim().toLowerCase();
  const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
  if (isExitPlanMode && this.exitPlanModeProcessed) return;

  this.log(`Plan approval required: tool=${toolName}`);
  this.pendingApprovalTool = toolName;
  this.webview.postMessage({ type: 'planApprovalRequired', toolName });
}
```

### planApprovalResponse handler

```typescript
if (isExitPlanMode) {
  this.planModeActive = false;
  this.exitPlanModeProcessed = true;
}

if (isExitPlanMode) {
  // ALL actions: close bar without sending text. CLI already auto-approved.
  if (msg.action === 'approveClearBypass') this.control.compact();
  else if (msg.action === 'approveManual') { /* switch permission mode */ }
}
```

---

## Defense in Depth

The bug is now blocked by three independent layers:

| Layer | Location | What it prevents |
|-------|----------|------------------|
| `exitPlanModeProcessed` flag | MessageHandler.ts `notifyPlanApprovalRequired` | Stale re-triggers from late events/replays |
| Clear approval bar on `messageStart` | useClaudeStream.ts | User interacting with stale bar |
| Block ALL ExitPlanMode text to CLI | MessageHandler.ts `planApprovalResponse` | Spurious user messages even if bar somehow appears |

---

## AskUserQuestion is NOT affected

All three fixes are specifically guarded to NOT affect AskUserQuestion:
- `exitPlanModeProcessed` only checks ExitPlanMode tool name
- `messageStart` only clears non-AskUserQuestion approval bars
- The text-blocking guard only applies when `isExitPlanMode` is true

---

## How to Verify

1. Start a session in ClaUi
2. Give a task that triggers plan mode (e.g., ask Claude to plan a complex feature)
3. When the approval bar appears, click any approve button
4. Verify: the model continues implementing without the approval bar re-appearing
5. Check logs (`Output -> ClaUi`): should see `"ExitPlanMode approved - closing bar without sending user message"` and any suppressed notifications logged as `"Suppressing stale ExitPlanMode notification"`
6. Test AskUserQuestion separately: verify the approval bar works normally for questions (user can type answers)
