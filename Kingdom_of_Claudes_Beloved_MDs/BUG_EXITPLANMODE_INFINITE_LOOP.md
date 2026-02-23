# Bug: ExitPlanMode Infinite Loop

## Summary

When the model called `ExitPlanMode` and the user approved the plan, the system entered an infinite loop: model calls ExitPlanMode, extension sends approval text, model calls ExitPlanMode again, endlessly. The user could never exit plan mode and start implementation.

**Date Fixed**: 2026-02-23
**Severity**: Critical (completely blocked plan mode workflow)
**File Modified**: `src/extension/webview/MessageHandler.ts`

---

## Symptom

User session transcript showed this repeating pattern:

```
Assistant: [creates plan, calls ExitPlanMode]
User: "Yes, proceed with the plan."
Assistant: [calls ExitPlanMode again with identical allowedPrompts]
User: "Yes, proceed with the plan."
Assistant: [calls ExitPlanMode again]
... repeats indefinitely ...
```

At one point, the model managed to read some files (Read tool works in plan mode) but then immediately called ExitPlanMode again. The model itself recognized the problem:

> "I see the system is still in plan mode. The plan is already complete and you've approved it."

But could not break out of the loop.

---

## Root Cause

**The extension sent `"Yes, proceed with the plan."` as a user message to the CLI stdin.** This was the fundamental error.

### Why this is wrong

The CLI is launched with either:
- `--permission-mode bypassPermissions` (full-access mode)
- `--allowedTools ...ExitPlanMode...` (supervised mode)

In both cases, the CLI **auto-approves** `ExitPlanMode` internally. The model calls the tool, the CLI processes it, provides a tool result, and the model continues implementing.

When the extension sent `"Yes, proceed with the plan."` via `control.sendText()`, it wrote:
```json
{ "type": "user", "message": { "role": "user", "content": "Yes, proceed with the plan." } }
```

This is a **new user message**, not a tool approval. The CLI treated it as a new conversation turn. The model received this text and, interpreting it as a signal related to plan mode, called `ExitPlanMode` again.

### The auto-approve amplifier

Two auto-approve paths in `notifyPlanApprovalRequired()` made it worse:

1. **Stale ExitPlanMode path**: If `planModeActive` was `false` (no `EnterPlanMode` seen, e.g. after context compaction), the extension auto-approved by immediately sending the user message. This created a rapid tight loop without any user interaction. Safety valve: show bar after 3 auto-approvals.

2. **User-approved path**: After the user approved once, `autoApproveExitPlanMode` was set to `true`. Subsequent ExitPlanMode calls were auto-approved instantly. Safety valve: show bar after 5 auto-approvals.

Both safety valves had counter resets when the user clicked approve on the bar, so the loop would restart: auto-approve N times, show bar, user approves, counters reset, auto-approve N more times...

### Event flow diagram

```
Model calls ExitPlanMode
    |
    v
CLI auto-approves (bypassPermissions/allowedTools)
    |
    v
CLI provides tool_result -> model continues implementing
    |
    v
Extension detects ExitPlanMode in messageDelta event
    |
    v
notifyPlanApprovalRequired() fires
    |
    +-- Auto-approve path: sends "Yes, proceed" immediately
    |   |
    |   v
    |   CLI receives as NEW user message -> starts new turn
    |   |
    |   v
    |   Model sees "Yes, proceed" -> calls ExitPlanMode again
    |   |
    |   v
    |   LOOP (back to top)
    |
    +-- Manual path: shows approval bar -> user clicks approve
        |
        v
        Extension sends "Yes, proceed" -> same loop as above
```

---

## Fix Applied

### 1. Removed all auto-approve logic

Deleted state variables:
- `autoApproveExitPlanMode: boolean` - flag to auto-approve subsequent calls
- `exitPlanModeAutoApproveCount: number` - counter for user-approved auto-approvals (limit 5)
- `staleExitPlanModeAutoApproveCount: number` - counter for stale auto-approvals (limit 3)

Deleted their usage in:
- `notifyPlanApprovalRequired()` - two auto-approve code paths (~30 lines removed)
- `sendMessage` handler - counter resets
- `sendMessageWithImages` handler - counter resets
- `editAndResend` handler - counter resets
- `planApprovalResponse` handler - counter resets and flag setting
- `result` event handler - note about preserving the flag

### 2. ExitPlanMode approve actions no longer send user messages

In the `planApprovalResponse` handler, when the tool is `ExitPlanMode` and the action is an approve action (`approve`, `approveClearBypass`, `approveManual`):
- **Close the approval bar** (clear tracking state)
- **DO NOT send any text to the CLI** via `control.sendText()`
- **Still apply side effects**: compaction for `approveClearBypass`, permission mode switch for `approveManual`

### 3. Reject/feedback still sends messages

When the user rejects or gives feedback on an ExitPlanMode plan, the extension still sends the text as a user message. This is correct because the user explicitly wants to communicate with the model to revise the plan.

### 4. AskUserQuestion unchanged

`AskUserQuestion` handling is unaffected. For questions, user messages ARE the correct response mechanism - the model is waiting for the user's answer.

---

## Key Code (after fix)

### notifyPlanApprovalRequired (simplified)

```typescript
private notifyPlanApprovalRequired(toolName: string): void {
  if (this.pendingApprovalTool === toolName) return;
  if (this.approvalResponseProcessed) return;

  // Always show the approval bar. Never auto-approve by sending messages.
  this.log(`Plan approval required: tool=${toolName}`);
  this.pendingApprovalTool = toolName;
  this.webview.postMessage({ type: 'planApprovalRequired', toolName });
}
```

### planApprovalResponse handler (ExitPlanMode branch)

```typescript
if (isExitPlanMode && isApproveAction) {
  this.log('ExitPlanMode approved - closing bar without sending user message');
  if (msg.action === 'approveClearBypass') {
    this.control.compact();
  } else if (msg.action === 'approveManual') {
    vscode.workspace.getConfiguration('claudeMirror')
      .update('permissionMode', 'supervised', true);
    this.webview.postMessage({ type: 'permissionModeSetting', mode: 'supervised' });
  }
  // Don't send text - just close the bar
}
```

---

## Remaining Considerations

### Approval bar is now informational for ExitPlanMode

Since the CLI auto-approves ExitPlanMode, the model may already be implementing by the time the user sees the approval bar. Clicking "approve" just dismisses the bar. This is acceptable because:
- The user can still **reject** or **give feedback** to redirect the model
- The bar provides visibility into the plan mode transition
- It prevents the infinite loop that was the critical issue

### AskUserQuestion is NOT affected

The approval bar for `AskUserQuestion` still works as before: user messages are sent to the CLI, because the model is genuinely waiting for the user's answer to continue.

---

## How to Verify the Fix

1. Start a session in ClaUi
2. Give a task that triggers plan mode (e.g., ask Claude to plan a complex feature)
3. When the approval bar appears, click any approve button
4. Verify: the model should continue implementing without looping back to ExitPlanMode
5. Check logs (`Output -> ClaUi`): should see `"ExitPlanMode approved - closing bar without sending user message"` instead of the old `"Auto-approving subsequent ExitPlanMode"` messages
