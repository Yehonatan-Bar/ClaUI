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
