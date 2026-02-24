# Bug: ExitPlanMode Infinite Loop & Approval Bar Visibility

## Summary

The plan approval bar (4 CLI-matching options) and AskUserQuestion interactive controls must be visible to the user when the model calls `ExitPlanMode` or `AskUserQuestion`. The CLI runs with `bypassPermissions` and auto-approves these tools, so the extension must detect them via stream events and show the UI independently.

**Date First Fixed**: 2026-02-23
**Date Second Fix**: 2026-02-23
**Date Third Fix**: 2026-02-24 (approval bar visibility)
**Severity**: Critical (blocks plan mode workflow)
**Files Modified**: `src/extension/webview/MessageHandler.ts`, `src/webview/hooks/useClaudeStream.ts`, `src/webview/components/InputArea/InputArea.tsx`

---

## Current Architecture

### Why the CLI auto-approves

ClaUI spawns the CLI with permission settings that auto-approve all tools:
- **Full-access mode** (`ClaudeProcessManager.ts:70`): `--permission-mode bypassPermissions`
- **Supervised mode** (`ClaudeProcessManager.ts:73-74`): `--allowedTools` list that includes both `AskUserQuestion` and `ExitPlanMode`

This means the CLI NEVER pauses for plan approval or user questions. The model calls the tool, the CLI auto-approves, and the model continues immediately.

### How ClaUI shows approval UI anyway

The extension detects these tools via CLI stream events and shows its own approval bar:

1. **Detection** (MessageHandler.ts): `messageDelta` with `stopReason === 'tool_use'` checks `currentMessageToolNames` for approval tools. Fallback: `assistantMessage` scans content blocks.
2. **Notification**: Posts `planApprovalRequired` to webview with `toolName`
3. **UI** (PlanApprovalBar.tsx): Shows 4 options for ExitPlanMode, or question options for AskUserQuestion
4. **Response** (MessageHandler.ts): Handles user choice - side effects only for ExitPlanMode, text to CLI for AskUserQuestion

---

## Bug History

### Original Bug (2026-02-23): Infinite Loop

**Cause**: The extension sent `"Yes, proceed with the plan."` as a user message to CLI stdin. Since the CLI had already auto-approved, this created a spurious conversation turn causing the model to call ExitPlanMode again.

**Fix**: Made approve actions close the bar without sending text.

### Recurrence (2026-02-23): Five Overlapping Issues

1. **Guard reset on `messageStart`**: Reset `pendingApprovalTool` and `approvalResponseProcessed`, allowing late events to re-trigger
2. **`assistantMessage` fallback re-trigger**: After guards were cleared, fallback detection re-showed the bar
3. **Stale approval bar**: `processBusy: false` didn't clear bar in webview
4. **User text routed as feedback**: Sent text via `control.sendText()` causing the loop
5. **No `planModeActive` guard**: Re-triggers happened even after ExitPlanMode was processed

**Fix**: Added `exitPlanModeProcessed` flag, cleared bar on `messageStart`, blocked ALL ExitPlanMode text to CLI.

### Third Bug (2026-02-24): Approval Bar Never Visible

**Cause**: The second fix's `messageStart` clearing was too aggressive. The CLI auto-approves ExitPlanMode and immediately starts the next turn. The `messageStart` handler cleared the approval bar before the user could see it:

```
planApprovalRequired -> bar shows -> messageStart (50ms later) -> bar cleared
```

Both ExitPlanMode and AskUserQuestion bars were affected (AskUserQuestion was replaced by ExitPlanMode bar before being cleared).

**Fix**:
1. **Removed `messageStart` clearing** in `useClaudeStream.ts` - approval bars now persist until user interaction
2. **Fixed InputArea text routing** - text typed during ExitPlanMode bar is sent as a regular message (not silently-dropped feedback)

---

## Current Defense Layers

| Layer | Location | What it prevents |
|-------|----------|------------------|
| `exitPlanModeProcessed` flag | MessageHandler.ts `notifyPlanApprovalRequired` | Stale re-triggers from late events/replays |
| Block ALL ExitPlanMode text to CLI | MessageHandler.ts `planApprovalResponse` | Spurious user messages even if bar somehow appears |
| InputArea sends regular message (not feedback) | InputArea.tsx `sendMessage` | Text typed during ExitPlanMode goes as new user message, not dropped |

The `messageStart` clearing was **removed** as a defense layer because it made the approval bar invisible.

---

## Key Code

### notifyPlanApprovalRequired (MessageHandler.ts)

```typescript
private notifyPlanApprovalRequired(toolName: string): void {
  if (this.pendingApprovalTool === toolName) return;
  if (this.approvalResponseProcessed) return;

  const norm = toolName.trim().toLowerCase();
  const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
  if (isExitPlanMode && this.exitPlanModeProcessed) return;

  this.log(`Plan approval required: tool=${toolName}`);
  this.pendingApprovalTool = toolName;
  this.webview.postMessage({ type: 'planApprovalRequired', toolName });
}
```

### messageStart handler (useClaudeStream.ts)

```typescript
case 'messageStart': {
  // Do NOT clear approval bars here. Both ExitPlanMode and AskUserQuestion
  // bars should persist until user interaction. The infinite loop is prevented
  // by exitPlanModeProcessed flag and blocking all ExitPlanMode text to CLI.
  handleMessageStart(msg.messageId, msg.model);
  break;
}
```

### InputArea text routing (InputArea.tsx)

```typescript
// AskUserQuestion: route as answer
if (pendingApproval.toolName === 'AskUserQuestion') {
  postToExtension({ type: 'planApprovalResponse', action: 'questionAnswer', ... });
}
// ExitPlanMode: clear bar, send as regular message
else if (pendingApproval) {
  setPendingApproval(null);
  postToExtension({ type: 'sendMessage', text: trimmed });
}
```

### planApprovalResponse handler (MessageHandler.ts)

```typescript
if (isExitPlanMode) {
  this.planModeActive = false;
  this.exitPlanModeProcessed = true;
  // ALL actions: close bar without sending text. CLI already auto-approved.
  if (msg.action === 'approveClearBypass') this.control.compact();
  else if (msg.action === 'approveManual') { /* switch permission mode */ }
}
```

---

## Bar Lifecycle

The approval bar is cleared when:
1. **User clicks a button** -> `planApprovalResponse` -> `processBusy: true` -> bar cleared
2. **User sends a regular message** -> `sendMessage` -> `processBusy: true` -> bar cleared
3. **New `planApprovalRequired` replaces it** (e.g., AskUserQuestion replaced by ExitPlanMode)
4. **Session resets**

The bar is NOT cleared on:
- `messageStart` (removed - caused bar to be invisible)
- `processBusy: false` (result event - bar should persist)
- `costUpdate` (intentionally preserved)

---

## Known Limitation: AskUserQuestion + ExitPlanMode Overlap

If the model calls AskUserQuestion and then ExitPlanMode in quick succession (common when CLI auto-approves AskUserQuestion), the ExitPlanMode bar replaces the AskUserQuestion bar. The user only sees ExitPlanMode options.

**Root cause**: The CLI auto-approves AskUserQuestion (via `bypassPermissions`), so the model doesn't wait for the answer and immediately proceeds to ExitPlanMode.

**Potential future fix**: Change `full-access` mode to use `--allowedTools` (listing all tools except AskUserQuestion/ExitPlanMode) instead of `--permission-mode bypassPermissions`. This would make the CLI pause on both tools.

---

## How to Verify

1. Start a session in ClaUi
2. Give a task that triggers plan mode (e.g., ask Claude to plan a complex feature)
3. When the approval bar appears with 4 options, verify it stays visible
4. Click any approve button -> verify model continues without bar re-appearing
5. Test typing text while bar is visible -> verify it sends as regular message (not dropped)
6. Check logs (`Output -> ClaUi`): should see `"ExitPlanMode approved - closing bar without sending user message"`
7. Test AskUserQuestion: give a task that triggers a question, verify option buttons appear
