# Bug Report Feature - Full Diagnostics + AI-Assisted Reporting

## Purpose

Comprehensive in-extension bug reporting. Users can submit detailed bug reports with auto-collected diagnostics, optional AI-assisted diagnosis, and script execution. Report data is sent as readable text via Formspree (with ZIP file attachment on paid plans). On free Formspree plans, falls back to text-only submission containing all report sections inline.

The same reporting flow now also supports feature-specific entry points. The MCP panel opens the existing bug report overlay with MCP-focused prefill text and an attached MCP state snapshot.

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

MCP-specific entry:

```
User clicks "Report MCP issue" inside McpPanel ->
  McpPanel seeds bugReportContext in Zustand ->
    BugReportPanel opens with MCP-focused title/prefill ->
      bugReportInit carries BugReportContext ->
        BugReportService attaches MCP snapshot to preview, AI diagnosis, ZIP, and final Formspree payload
```

## Two Modes

### Quick Report
- Required text description in a textarea
- Auto-collected diagnostics included automatically
- No AI interaction needed
- Feature-specific entry points can prefill the textarea with a targeted template

### AI-Assisted Report
- Chat interface with Claude Sonnet 4.6 (via `ClaudeCliCaller` one-shot calls)
- AI asks structured diagnostic questions
- AI can suggest diagnostic scripts (fenced code blocks) -- user must approve
- Full conversation history saved in `conversation.json`
- Feature-specific context is injected into the AI prompt before the conversation history

## Message Types

### Webview -> Extension (6 types)
- `bugReportInit` -- start diagnostics collection, create service, optional feature-specific context
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
| `mcp-context.txt` / `feature-context.txt` | Both when present | Feature-specific snapshot supplied by the launching UI |

## AI System Prompt

Dynamic `buildSystemPrompt()` in `BugReportService.ts` -- injects OS info at runtime. The AI:
- Asks focused questions (one at a time)
- Collects: description, provider (Claude/Codex), reproduction steps, expected vs actual, onset timing, frequency
- Knows about ClaUi's dual-provider architecture (Claude + Codex)
- Can suggest diagnostic commands in fenced code blocks
- On Windows: instructed to use CMD commands only (dir, type, findstr, etc.) -- NOT PowerShell cmdlets
- On macOS/Linux: uses bash commands
- Responds in the user's language

## Report Size Management -- Chunked Multi-Part Sending

Formspree free-tier rejects payloads over ~100 KB (HTTP 413). Instead of truncating the report body, the submission pipeline splits large reports into multiple smaller submissions sent sequentially.

### How it works

1. The report is assembled as named sections (diagnostics, conversation, scripts, logs) with **no truncation** of conversations or logs.
2. If the total report fits under `MAX_CHUNK_CHARS` (80,000 chars), it is sent as a single submission.
3. If it exceeds the limit, `splitSectionsIntoChunks()` packs sections greedily into chunks that each fit under 80 KB.
4. Each chunk is sent as a separate Formspree submission with subject `"Bug Report (mode) - Part N/M"` and a 1.5 s delay between parts.
5. The ZIP file (full un-truncated data) is attached only to Part 1 (multipart upload, paid plans only).

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_SCRIPT_OUTPUT_CHARS` | 8,000 | Per-script cap applied at capture time. Prevents conversation history bloat. |
| `MAX_CHUNK_CHARS` | 80,000 | Max chars per Formspree submission part |
| `CHUNK_DELAY_MS` | 1,500 | Delay in ms between chunked submissions |

### Splitting rules

- Sections are kept intact when possible (split happens between sections, not mid-text).
- If a single section exceeds the chunk budget, it is truncated (head-kept) to fit alone.
- The header (extension version, timestamp, part label) is prepended to every chunk.
- `FormspreeService.submitChunked()` sends each part sequentially and stops on the first failure.

## Script Execution Flow

When the AI suggests a diagnostic command:
1. AI response parsed for fenced code blocks (regex: `` ```cmd`` / `` ```bash`` etc.)
2. Webview shows Approve/Reject buttons for each script
3. On approve: `BugReportService.executeScript()` runs via `child_process.exec()` (CMD on Windows, shell default on others)
4. Script output sent to webview as `bugReportScriptResult` (full output for UI display)
5. Stored output is truncated to `MAX_SCRIPT_OUTPUT_CHARS` to prevent conversation/report bloat
6. **Auto-analysis**: AI is automatically called with the (truncated) script output appended to conversation history -- no user action needed
7. AI sees the result and can analyze it, suggest corrections if the command failed, or ask follow-up questions
8. Webview shows "Thinking..." while AI processes the output

## RTL Support

Chat messages, quick-mode textarea, and chat input detect Hebrew/Arabic via `detectRtl()` and set `dir="rtl"` accordingly.

## Privacy Controls

- "Nothing will be sent until you click Send" notice always visible
- "What info will be sent to the developer?" expandable section shows file list with full paths + sizes
- Scripts require explicit approval before execution
- Large red "SEND BUG REPORT" button is the only way to submit
- MCP-launched reports explicitly tell the user that the current MCP inventory snapshot will be attached only after they click Send

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

---

# Merged from FORMSPREE_FEEDBACK.md

# FormspreeService - Developer Feedback Module

## Purpose

Allows users to send feedback (text messages + optional file attachments) directly to the developer via Formspree.io. The Formspree endpoint is **write-only**: anyone can submit, only the form owner receives submissions via email. No API keys or secrets are stored in the codebase.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/feedback/FormspreeService.ts` | Service class with `submit()` method |

## Architecture

```
User -> Extension -> FormspreeService.submit() -> POST formspree.io/f/{formId} -> Developer's email
```

The service is used by `BugReportService` for the Full Bug Report feature (ZIP report submission).
> See also: `Kingdom_of_Claudes_Beloved_MDs/BUG_REPORT_FEATURE.md`

## API

### Types

```typescript
interface FeedbackAttachment {
  filename: string;
  content: Buffer;
  contentType?: string; // defaults to 'application/octet-stream'
}

interface FeedbackPayload {
  email?: string;
  message: string;
  subject?: string;
  category?: string;         // 'bug' | 'feature' | 'general'
  extensionVersion?: string;
  attachments?: FeedbackAttachment[];
}

interface FeedbackResult {
  ok: boolean;
  error?: string;
}
```

### Class: `FormspreeService`

| Method | Description |
|--------|-------------|
| `constructor(formId: string)` | Takes the Formspree form ID (e.g. `mreajleg`) |
| `setLogger(log)` | Injects a logging function (follows project pattern) |
| `submit(payload): Promise<FeedbackResult>` | Sends feedback, returns success/error |

## Submission Strategy

1. **Text-only** (no attachments): Uses `application/x-www-form-urlencoded` via `URLSearchParams`
2. **With attachments (paid plan)**: Uses `multipart/form-data` via global `FormData` + `File`
3. **With attachments (free plan fallback)**: If Formspree rejects with "File Uploads Not Permitted", automatically falls back to text-only submission (drops file attachment, keeps message body)

All paths use the global `fetch()` API (Node 18+, available in VS Code's Electron).

## Formspree Limits

| Limit | Value |
|-------|-------|
| Files per submission | 10 |
| Max file size | 25 MB each |
| Total request size | 100 MB |
| File uploads | Paid plan only ($10+/month); free plan uses base64 fallback |

## Error Handling

- 30-second timeout via `AbortController`
- Parses Formspree JSON error responses
- Returns structured `{ ok: false, error: 'message' }` on failure
- All attempts and results are logged via the injected logger

## Form Endpoint

The current form ID is `mreajleg` (endpoint: `https://formspree.io/f/mreajleg`). This is a write-only URL -- exposing it in source code allows anyone to submit feedback, but only the form owner can read submissions. This is the intended design.
