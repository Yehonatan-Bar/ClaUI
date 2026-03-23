# Codex Consultation Feature

## What It Does

Allows users to consult an external GPT expert (Codex) directly from the ClaUi chat interface. The user's question is enriched with system context by Claude before being sent to the Codex MCP tool, and the response flows back into the chat for Claude to act upon.

## How It Works

1. User clicks "Consult" button in StatusBar
2. A panel opens above the InputArea with a textarea
3. User types their consultation question and submits
4. The extension sends a structured prompt to the running Claude CLI session
5. Claude enriches the question with codebase/conversation context
6. Claude calls `mcp__codex__codex` MCP tool with the enriched prompt
7. The Codex response streams back into the chat
8. Claude analyzes the response and continues development

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/InputArea/CodexConsultPanel.tsx` | React component: input panel with textarea + submit button |
| `src/webview/components/StatusBar/StatusBar.tsx` | "Consult" button in both expanded and collapsed modes |
| `src/webview/App.tsx` | Conditional rendering of CodexConsultPanel |
| `src/webview/state/store.ts` | `codexConsultPanelOpen` state + action |
| `src/extension/types/webview-messages.ts` | `CodexConsultRequest` message type |
| `src/extension/webview/MessageHandler.ts` | Handles `codexConsult` message, builds structured prompt, sends to CLI |
| `src/webview/styles/global.css` | Panel and button styles (`.codex-consult-*`, `.status-bar-consult-btn`) |

## Message Flow

```
Webview                          Extension                        Claude CLI
   |                                |                                |
   |-- codexConsult {question} ---->|                                |
   |                                |-- sendText(structured prompt)->|
   |                                |<-- processBusy(true) -------->|
   |                                |                                |-- calls mcp__codex__codex
   |<-- streamingText --------------|<-- stream events --------------|
   |<-- assistantMessage ---------- |<-- result --------------------|
   |<-- costUpdate, processBusy --- |                                |
```

## Prompt Template

The structured prompt sent to Claude CLI:

```
[Codex Consultation Request]
The user wants to consult with the Codex GPT expert about the following question.

INSTRUCTIONS:
1. Formulate a SHORT and CONCISE consultation prompt:
   - Keep the total prompt under 200 words
   - Include only the essential context needed to answer the question
   - Do NOT dump full code snippets, file contents, or architecture descriptions
   - One clear question, minimal background - the expert is smart, give just enough context
   - NEVER send multiple parallel codex calls - one call at a time
2. Call the mcp__codex__codex tool with this focused prompt.
   CRITICAL: You MUST pass these parameters to prevent the Codex session from hanging:
   - "approval-policy": "never"  (there is no interactive user to approve shell commands)
   - "sandbox": "read-only"  (consultation is read-only analysis, not implementation)
3. Present the Codex response clearly to the user
4. Then analyze the response and continue with implementation based on the advice

IMPORTANT: Long prompts cause Codex to take 5-10+ minutes and risk timeout.
A focused 100-word prompt gets the same quality answer as a 500-word one.

USER'S QUESTION:
{question}
```

## Prompt Length Guidelines

**Root cause of past failures**: Claude was told to make "comprehensive" prompts with full context, resulting in 400+ word prompts with detailed code snippets, architecture descriptions, and multiple evaluation criteria. These caused Codex to take 5-10+ minutes, often exceeding the timeout or causing session termination.

**Rules for prompt construction**:
- **Under 200 words** total prompt to Codex
- **One focused question** per call - don't ask Codex to evaluate 7 options in one prompt
- **Essential context only** - the expert model is capable; it doesn't need every detail
- **No parallel calls** - send one codex call, wait for result, then send another if needed
- **Read-only sandbox** - consultations are for advice, not implementation

## Timeout Protection

Consultations have a **120-second timeout** to prevent indefinite hangs. If the Codex MCP session does not return a result within 2 minutes, the extension automatically:

1. Cancels the in-flight request via `control.cancel()`
2. Clears the `processBusy` state
3. Shows an error message to the user explaining the timeout

The timeout is cleared when:
- A result is received from the CLI (normal completion)
- The user sends a new message (overrides the consultation)
- The user manually cancels the request

### Why This Is Needed

The Codex MCP server (`@openai/codex`) runs GPT models that can dispatch `shell_command` function calls. When running as an MCP server (non-interactive), there is no user to approve these commands. With `approval_policy: "on-request"`, commands hang forever waiting for approval that never comes. The prompt now instructs Claude to pass `approval-policy: "never"` to prevent this deadlock.

## UI Behavior

- **Consult button**: Visible only when a session is connected (`isConnected === true`)
- **Panel**: Opens above InputArea. Auto-focuses textarea. Closes on submit or Escape
- **Submit**: Ctrl+Enter or click "Consult" button. Disabled when busy or empty
- **StatusBar expanded mode**: Direct button between Feedback and Git
- **StatusBar collapsed mode**: Inside "More" dropdown after Dashboard

## Dependencies

- Requires `mcp__codex__codex` MCP tool to be available in the Claude CLI environment
- If the tool is not configured, Claude will report this in the chat response
