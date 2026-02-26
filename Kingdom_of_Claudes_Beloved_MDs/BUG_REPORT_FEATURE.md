# Bug Report Feature - Full Diagnostics + AI-Assisted Reporting

## Purpose

Comprehensive in-extension bug reporting. Users can submit detailed bug reports with auto-collected diagnostics, optional AI-assisted diagnosis, and script execution. Report data is sent as readable text via Formspree (with ZIP file attachment on paid plans). On free Formspree plans, falls back to text-only submission containing all report sections inline.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/feedback/BugReportService.ts` | Orchestrator: auto-collection, AI chat, script exec, ZIP packaging, submission |
| `src/extension/feedback/DiagnosticsCollector.ts` | Collects system info, VS Code environment, recent logs |
| `src/extension/feedback/BugReportTypes.ts` | Shared `WebviewBridge` interface (avoids circular imports) |
| `src/webview/components/BugReport/BugReportPanel.tsx` | Full-screen overlay UI panel |
| `src/webview/components/BugReport/index.ts` | Barrel export |

## Architecture

```
User clicks Feedback -> "Full Bug Report" ->
  commands.ts sends bugReportOpen to webview ->
    BugReportPanel opens as overlay ->
      Panel sends bugReportInit to extension ->
        MessageHandler creates BugReportService ->
          DiagnosticsCollector runs (auto-collection) ->
            User fills in report (Quick or AI mode) ->
              BugReportService packages ZIP ->
                FormspreeService submits to developer's email
```

## Two Modes

### Quick Report
- Required text description in a textarea
- Auto-collected diagnostics included automatically
- No AI interaction needed

### AI-Assisted Report
- Chat interface with Claude Sonnet 4.6 (via `ClaudeCliCaller` one-shot calls)
- AI asks structured diagnostic questions
- AI can suggest diagnostic scripts (fenced code blocks) -- user must approve
- Full conversation history saved in `conversation.json`

## Message Types

### Webview -> Extension (6 types)
- `bugReportInit` -- start diagnostics collection, create service
- `bugReportChat` -- send user message to AI
- `bugReportApproveScript` -- approve a suggested script for execution
- `bugReportSubmit` -- package and send the report
- `bugReportGetPreview` -- request list of files that will be sent
- `bugReportClose` -- dispose service and reset

### Extension -> Webview (6 types)
- `bugReportOpen` -- tell webview to show the panel
- `bugReportStatus` -- collection/sending phase updates with optional summary
- `bugReportChatResponse` -- AI response text + extracted script suggestions
- `bugReportScriptResult` -- output from an approved script execution
- `bugReportPreview` -- file list with sizes for transparency
- `bugReportSubmitResult` -- success/failure of submission

## Auto-Collected Data

| Data | Source |
|------|--------|
| OS + architecture | `process.platform`, `os.release()`, `os.arch()` |
| VS Code version | `vscode.version` |
| Extension version | `context.extension.packageJSON.version` |
| Node.js version | `process.version` |
| Claude CLI version | `execFile('claude', ['--version'])` with 5s timeout |
| Codex CLI version | `execFile('codex', ['--version'])` with 5s timeout |
| ClaUi settings | Key settings from `claudeMirror.*` configuration |
| Recent logs | `.log` files modified in last 30 min from logDir, capped at 500KB |

## ZIP Contents

| File | Mode | Content |
|------|------|---------|
| `diagnostics.txt` | Both | Formatted system/environment info |
| `logs.txt` | Both | Recent log files concatenated |
| `description.txt` | Quick | User's bug description |
| `conversation.json` | AI | Full AI conversation history |
| `script_output_N.txt` | AI | Output from approved scripts |

## AI System Prompt

Dynamic `buildSystemPrompt()` in `BugReportService.ts` -- injects OS info at runtime. The AI:
- Asks focused questions (one at a time)
- Collects: description, provider (Claude/Codex), reproduction steps, expected vs actual, onset timing, frequency
- Knows about ClaUi's dual-provider architecture (Claude + Codex)
- Can suggest diagnostic commands in fenced code blocks
- On Windows: instructed to use CMD commands only (dir, type, findstr, etc.) -- NOT PowerShell cmdlets
- On macOS/Linux: uses bash commands
- Responds in the user's language

## Script Execution Flow

When the AI suggests a diagnostic command:
1. AI response parsed for fenced code blocks (regex: `` ```cmd`` / `` ```bash`` etc.)
2. Webview shows Approve/Reject buttons for each script
3. On approve: `BugReportService.executeScript()` runs via `child_process.exec()` (CMD on Windows, shell default on others)
4. Script output sent to webview as `bugReportScriptResult`
5. **Auto-analysis**: AI is automatically called with the script output appended to conversation history -- no user action needed
6. AI sees the result and can analyze it, suggest corrections if the command failed, or ask follow-up questions
7. Webview shows "Thinking..." while AI processes the output

## RTL Support

Chat messages, quick-mode textarea, and chat input detect Hebrew/Arabic via `detectRtl()` and set `dir="rtl"` accordingly.

## Privacy Controls

- "Nothing will be sent until you click Send" notice always visible
- "What info will be sent to the developer?" expandable section shows file list with full paths + sizes
- Scripts require explicit approval before execution
- Large red "SEND BUG REPORT" button is the only way to submit

## Dependencies

- `adm-zip` -- in-memory ZIP creation (new dependency added for this feature)
- `FormspreeService` -- existing module for form submission
- `ClaudeCliCaller` -- existing module for one-shot Claude CLI calls

## Store State (Zustand)

| Field | Type | Default |
|-------|------|---------|
| `bugReportPanelOpen` | `boolean` | `false` |
| `bugReportMode` | `'quick' \| 'ai'` | `'quick'` |
| `bugReportPhase` | `'idle' \| 'collecting' \| 'ready' \| 'sending' \| 'sent' \| 'error'` | `'idle'` |
| `bugReportDiagSummary` | `DiagnosticsSummary \| null` | `null` |
| `bugReportChatMessages` | `Array<{role, content, scripts?}>` | `[]` |
| `bugReportChatLoading` | `boolean` | `false` |
| `bugReportPreviewFiles` | `Array<{name, sizeBytes, preview?}>` | `[]` |
| `bugReportError` | `string \| null` | `null` |
