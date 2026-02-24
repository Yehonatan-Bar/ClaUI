# Analytics Dashboard

## Overview

A full-screen overlay dashboard inside the chat webview with two modes: **Session** (current session analytics) and **Project** (aggregated analytics across all past sessions in the workspace). Opens from the StatusBar "Dashboard" button. A pill toggle in the header switches between modes.

## Architecture

**Overlay, not separate panel.** The Zustand store lives inside the chat webview. The dashboard renders as a `position: fixed` overlay (same pattern as `AchievementPanel`, `PromptHistoryPanel`) at `z-index: 1000` with a dark background (`rgba(13, 17, 23, 0.97)`).

**Session mode data source:** `turnHistory[]` from the Zustand store. Each `TurnRecord` contains per-turn token counts, bash commands, cost, duration, tool names, and optional semantic analysis. The Context tab also reads `messages[]` and `sessionMetadata` from the store.

**Project mode data source:** `projectSessions[]` (array of `SessionSummary`) from the Zustand store. Loaded on demand when switching to Project mode via `getProjectAnalytics` postMessage. Persisted in `ProjectAnalyticsStore` using VS Code `workspaceState` (auto-scoped per workspace).

## Key Files

### Extension-side
- `src/extension/session/TurnAnalyzer.ts` - Spawns one-shot Claude CLI for semantic analysis
- `src/extension/session/TokenUsageRatioTracker.ts` - Global tracker correlating tokens with usage % (see Token-Usage Ratio Tracker section)
- `src/extension/session/ProjectAnalyticsStore.ts` - Persists `SessionSummary[]` in `workspaceState` (200 session cap)
- `src/extension/webview/MessageHandler.ts` - Populates token/command fields, triggers TurnAnalyzer, sends session metadata, accumulates TurnRecords, handles `getProjectAnalytics` and `getTokenRatioData` requests
- `src/extension/session/SessionTab.ts` - Saves `SessionSummary` to `ProjectAnalyticsStore` on session end
- `src/extension/types/webview-messages.ts` - `TurnSemantics`, `TurnRecord`, `SessionSummary`, `SessionMetadataMessage`, `TokenUsageRatioSample`, `TokenRatioBucketSummary`, project analytics messages, token ratio messages

### Webview-side
- `src/webview/components/Dashboard/DashboardPanel.tsx` - Root overlay (Session/Project toggle, tab nav, header, close)
- `src/webview/components/Dashboard/MetricsCards.tsx` - 6-card summary (turns, tools, errors, durations)
- `src/webview/components/Dashboard/TurnTable.tsx` - Sortable paginated table (15 rows/page)
- `src/webview/components/Dashboard/dashboardUtils.ts` - Colors, helpers, command categorization
- `src/webview/components/Dashboard/charts/RechartsWrappers.tsx` - 6 Recharts components
- `src/webview/components/Dashboard/charts/SemanticWidgets.tsx` - MoodTimeline, FrustrationAlert, BugRepeatTracker
- `src/webview/components/Dashboard/tabs/` - Session tabs (8) + Project tabs (4)

## Session Mode (8 Tabs)

### Overview
- 6 metric cards (turns, error rate, total tool uses, top tool, shell commands, avg duration)
- Duration bar per turn (colored by category)
- Tool frequency horizontal bar (top 15)
- Turn category donut chart
- Mood timeline strip (colored dots per turn)
- Frustration alert (3+ consecutive frustrated turns)

### Tokens
- 4 mini stat cards (input, output, cache created, cache read)
- Stacked token bar per turn (input/output/cache create/cache read)

### Tools
- Tool frequency horizontal bar (top 15)
- Turn category donut chart

### Timeline
- Duration bar per turn (colored by category)
- Task type donut + outcome bar (semantic data only)
- Sortable paginated turn table

### Commands
- Category filter chips (git, npm, test, build, deploy, search, file, other)
- Searchable command timeline list
- Bug repeat tracker sidebar (when semantic data shows repeated bugs)

### Context
- Session metadata display (session ID, model, working directory, MCP servers, available tools list)
- Full conversation message inspector (all user and assistant messages)
- Each message expandable to show all content blocks: text, tool_use (with name + input), tool_result (with output + error status), images
- Role-based filter (All / User / Assistant)
- Free-text search across message content, tool names, and tool inputs
- Expand All / Collapse All controls

### Usage
- Fetches live Anthropic API usage data via `UsageFetcher` (OAuth token from `~/.claude/.credentials.json`)
- Displays billing buckets with usage percentage, daily spend, monthly limit, and reset dates
- Auto-refresh toggle with configurable interval

### Token Ratio
- Correlates token consumption with usage percentage changes over time
- Summary cards: one per billing bucket showing latest tokensPerPercent, trend arrow, sample count
- Global stats bar: total turns tracked, cumulative token breakdown (input/output/cache creation/cache read)
- Trend line chart (Recharts LineChart): tokensPerPercent over time, one colored line per bucket
- Samples table: last 50 samples (Date, Bucket, Usage%, Delta Tokens, Delta Usage%, Tokens/1%)
- Clear Data button to reset all stored samples
- Shows "Waiting for data..." when fewer than 5 turns have been tracked

## Project Mode (4 Tabs)

### Project Overview
- 6 aggregated metric cards (total sessions, total turns, total tool uses, overall error rate, most used model, avg session duration)
- Turns per session bar chart
- Aggregated tool frequency horizontal bar (top 15, all sessions combined)
- Aggregated category distribution donut (all sessions combined)
- Model usage horizontal bar chart

### Project Sessions
- Text search filter on session name
- Sortable table: Name, Date, Model, Turns, Errors, Duration, Top Tool
- Default sort: date descending (most recent first)
- Expandable rows showing: token breakdown, tool frequency list, category distribution

### Project Tokens
- 4 summary cards (total input, total output, total cache created, cache read + hit rate)
- Stacked bar chart: per-session token breakdown (input/output/cache creation/cache read)

### Project Tools
- Aggregated tool frequency horizontal bar (all sessions, top 15)
- Aggregated category distribution donut
- Task type distribution bar chart (all sessions combined)

## Project Analytics Persistence

### SessionSummary

Pre-aggregated session analytics (~500 bytes per session) stored in `ProjectAnalyticsStore`.

**Fields:** sessionId, sessionName, model, startedAt, endedAt, durationMs, totalTurns, totalErrors, totalToolUses, totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens, totalBashCommands, toolFrequency, categoryDistribution, taskTypeDistribution, avgDurationMs, errorRate.

### Data Flow

```
Session runtime:
  MessageHandler accumulates TurnRecord[] (extension-side copy)

Session ends (any exit path):
  SessionTab.saveProjectAnalytics()
    -> MessageHandler.flushTurnRecords() (atomic get + clear)
    -> Builds SessionSummary from flushed TurnRecords
    -> ProjectAnalyticsStore.saveSummary()
    -> Persisted in workspaceState (auto-scoped per workspace)
    -> analyticsSaved flag prevents duplicate saves

Analytics save is triggered from ALL exit paths:
  1. Normal process exit (exit handler)
  2. Process crash (exit handler)
  3. Tab close / panel dispose (onDidDispose handler)
  4. Extension deactivate (dispose() method)
  5. Session clear (MessageHandler calls saveProjectAnalyticsNow before clearing)
  6. Edit-and-resend (MessageHandler calls saveProjectAnalyticsNow before clearing)

Dashboard opens in Project mode:
  DashboardPanel sends postMessage({ type: 'getProjectAnalytics' })
    -> MessageHandler reads ProjectAnalyticsStore.getSummaries()
    -> postMessage({ type: 'projectAnalyticsData', sessions })
    -> Zustand setProjectSessions()
    -> Project tabs render reactively
```

### Storage Details
- **Storage key:** `claudeMirror.projectAnalytics`
- **Backend:** VS Code `workspaceState` (Memento API)
- **Scope:** Automatically per-workspace (= per project)
- **Capacity:** 200 sessions max, sorted by endedAt descending
- **Persistence:** Survives VS Code restarts, persisted by VS Code

## TurnAnalyzer

Background semantic analysis engine that spawns after each turn completes.

**Flow:**
1. `MessageHandler` triggers `TurnAnalyzer.analyze()` after `turnComplete`
2. TurnAnalyzer spawns `claude -p --model <analysisModel>` with a structured prompt
3. Claude returns JSON with `userMood`, `taskOutcome`, `taskType`, `bugRepeat`, `confidence`
4. TurnAnalyzer parses and validates the response
5. Callback fires; MessageHandler sends `turnSemantics` postMessage to webview
6. Zustand store merges semantics into the matching `TurnRecord`

**Safeguards:**
- Enabled by default (`claudeMirror.turnAnalysis.enabled = true`)
- Per-session cap (`claudeMirror.turnAnalysis.maxPerSession = 30`)
- Timeout (`claudeMirror.turnAnalysis.timeoutMs = 30000`)
- Queue (max 20, drops oldest on overflow)
- One analysis at a time per tab
- User messages < 5 chars are skipped
- Clean environment (deletes CLAUDECODE + CLAUDE_CODE_ENTRYPOINT)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.analysisModel` | `claude-haiku-4-5-20251001` | Model for all background analysis |
| `claudeMirror.turnAnalysis.enabled` | `true` | Enable semantic analysis |
| `claudeMirror.turnAnalysis.maxPerSession` | `30` | Cap per session tab |
| `claudeMirror.turnAnalysis.timeoutMs` | `30000` | Analysis timeout |

**Configuration UI:** These settings are configurable in two places:
1. **VS Code Settings** (`Ctrl+,` -> search "claudeMirror")
2. **Vitals gear button** in the StatusBar (near the Vitals button) - provides inline toggle for Semantic Analysis and a dropdown for Analysis Model. Changes sync bidirectionally with VS Code settings.

## Session Metadata

Captured from the CLI `system/init` event and stored in the Zustand store as `sessionMetadata`.

**Available fields:**
- `tools: string[]` - List of tool names available to the model
- `model: string` - Active model name
- `cwd: string` - Working directory
- `mcpServers: string[]` - Connected MCP server names

**Not available:** System prompt (not exposed by the CLI stream-json protocol).

## TurnRecord Extensions

Fields added to `TurnRecord` for the dashboard:
- `inputTokens?: number` - Input tokens this turn
- `outputTokens?: number` - Output tokens this turn
- `cacheCreationTokens?: number` - Cache creation tokens
- `cacheReadTokens?: number` - Cache read tokens
- `bashCommands?: string[]` - Shell commands run this turn
- `semantics?: TurnSemantics` - Async semantic analysis

## Commands Tab Data Sources

The Commands tab shows bash commands from two sources:

1. **Live streaming** (`MessageHandler.ts`): During an active session, `blockStop` events trigger JSON parsing of Bash tool input, collecting commands into `currentBashCommands[]`. These are included in the `turnComplete` message sent to the webview.

2. **Rebuilt turn history** (`turnVitals.ts`): When turn history is reconstructed from stored messages (e.g., after VS Code reload, session restore, vitals enable), `deriveTurnFromAssistantMessage()` extracts bash commands from `tool_use` content blocks where `name === 'Bash'` and `input.command` is a string.

Both paths feed into `flattenCommands()` in `dashboardUtils.ts`, which iterates `turnHistory[].bashCommands` and categorizes each command (git, npm, test, build, deploy, search, file, other).

## Token-Usage Ratio Tracker

Correlates two independent data streams -- token counts (from CLI result events) and usage percentage (from Anthropic OAuth API) -- to answer: "how many tokens equal 1% of usage?"

### Core Module: `TokenUsageRatioTracker`

**File:** `src/extension/session/TokenUsageRatioTracker.ts`

**Global singleton** -- instantiated once in `extension.ts` with `context.globalState`, injected through TabManager -> SessionTab -> MessageHandler via optional constructor parameters and a setter method.

**Key API:**
- `recordTurn(tokens)` - Increments global turn counter and cumulative token totals. Returns `true` every 5 turns (sample is due).
- `createSamples(usageStats)` - Called when sample is due. Fetches current usage %, computes delta tokens and delta usage % since last sample, calculates `tokensPerPercent = deltaTokens / deltaUsagePercent`. Handles edge cases: usage reset (negative delta -> null ratio), no change (zero delta -> null), first sample (baseline only, no ratio).
- `getHistory()` - Returns all stored samples (up to 500, FIFO eviction).
- `computeSummaries()` - Groups samples by billing bucket, computes per-bucket: avgTokensPerPercent, latestTokensPerPercent, trend (increasing/decreasing/stable/insufficient-data).
- `clearAll()` - Resets all stored data.

**Persistence:** Samples stored in VS Code `globalState` under key `claudeMirror.tokenUsageRatio`. Uses `enqueueWrite()` to serialize all writes, preventing race conditions when multiple tabs record turns simultaneously.

### Data Flow

```
CLI result event completes (success or error):
  MessageHandler extracts token counts
    -> tracker.recordTurn({ input, output, cacheCreation, cacheRead })
    -> Returns true every 5 turns

When sample is due:
  MessageHandler.sampleTokenUsageRatio() (fire-and-forget)
    -> Creates UsageFetcher (dynamic import)
    -> Fetches usage stats from api.anthropic.com/api/oauth/usage
    -> tracker.createSamples(usageStats)
    -> sendTokenRatioData() pushes tokenRatioData message to webview

Dashboard TokenRatioTab mounts:
  -> postToExtension({ type: 'getTokenRatioData' })
  -> MessageHandler reads tracker.getHistory() + computeSummaries()
  -> Sends tokenRatioData message to webview
  -> Zustand store updates, tab renders reactively
```

### Message Types
- `GetTokenRatioDataRequest` - Webview requests current data
- `ClearTokenRatioDataRequest` - Webview requests data wipe
- `TokenRatioDataMessage` - Extension sends samples, summaries, globalTurnCount, cumulativeTokens

## Known Limitations

- Bundle size increased (~991 KB total webview) due to Recharts + D3. Lazy-loading is a follow-up.
- Dark theme only (the overlay controls its own background). Light theme support is a follow-up.
- `turnIndex` from MessageHandler never resets on clearSession; dashboard uses array position instead.
- System prompt is not available in the Context tab (CLI limitation).
