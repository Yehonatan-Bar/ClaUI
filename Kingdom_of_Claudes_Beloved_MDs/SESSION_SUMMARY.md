# End-of-Session Summary

A 1-3 sentence AI summary of every session, generated when the CLI process exits and shown on hover in the Sessions TreeView. Stored on the session's `SessionMetadata`.

## Schema

`SessionMetadata` (`SessionStore.ts`) gains three optional fields:

- `summary?: string` — the AI-generated text (capped at 600 chars).
- `summaryGeneratedAt?: number` — `Date.now()` when generated, used for the relative-time hint.
- `summaryProvider?: 'haiku' | 'codex'` — which fallback rung produced the text.

The session-history cap of 100 entries (in `SessionStore`) is unchanged.

## Pipeline (`SessionSummarizer.ts`)

1. **Build transcript.** Claude transcripts are read from `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` via `ConversationReader`. Plain text is extracted from user inputs and assistant text blocks; tool-use noise is skipped. Codex transcripts are not read from disk in this pass — pass `fallbackMessages` if needed.
2. **Skip rule.** Fewer than 2 user messages -> return `null`.
3. **Truncate.** ~4000 chars total, keeping ~30% head (so the first user message is preserved) and the rest from the tail (most informative).
4. **Prompt template.** "Summarize this session in 1-3 sentences for a hover preview. Focus on the topic and outcome. Match the user's language. Reply with ONLY the summary." followed by the truncated transcript.
5. **Primary attempt — Haiku.** Spawn `claude -p --model <claudeMirror.analysisModel>` (default `claude-haiku-4-5-20251001`). 35s timeout. Stdin-piped prompt (no shell escaping). Sanitized like `SessionNamer`.
6. **Fallback — Codex low-reasoning.** On non-zero exit, timeout, or empty stdout, spawn `codex exec --json --sandbox read-only -c model_reasoning_effort=low`. 45s timeout. Final `agent_message` text wins.
7. **Sanitize.** Strip wrapping quotes/backticks, collapse to a 600-char cap.

## Triggers

`SessionTab.maybeRunSummarizer(reason)` is called fire-and-forget from the process-exit handler:

- **Successful exit** branch (after `saveProjectAnalytics()` + `achievementService.onSessionEnd()`).
- **Crash branch** (same, plus `onSessionCrash`).
- The **stop-button** path routes through `processManager.stop()` -> exit event, so it is covered automatically.

A per-tab `summarizerRan` boolean guards against double-fire.

## Setting

```jsonc
"claudeMirror.sessionEndSummary": {
  "type": "boolean",
  "default": true,
  "description": "Generate a 1-3 sentence summary at the end of every session ..."
}
```

Independent of `claudeMirror.activitySummary`. Uses `claudeMirror.analysisModel` for the Haiku model id.

## Display

- **Primary surface:** `TabGroupsTreeProvider.buildTabTooltip()` builds a `vscode.MarkdownString` for each tab leaf:
  - Tab name in bold + provider/session-id meta.
  - Horizontal rule + the summary text + relative-time hint (`generated 5m ago`).
  - Placeholder when no summary exists yet: `_Summary will appear after the session ends._`
- **Refresh trigger:** `SessionTab` -> `callbacks.onSummaryGenerated(sessionId)` -> `TabManager.notifySummaryChanged()` -> `treeChangeEmitter.fire()` -> tree provider refreshes.

## Privacy / Cost

- Same exposure profile as `SessionNamer`: only the transcript is sent.
- ~500-2000 input tokens per session end on Haiku — cheap.
- Codex fallback is the rare path; runs in `read-only` sandbox.
