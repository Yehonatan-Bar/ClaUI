# Analytics Dashboard — Developer Implementation Plan

## Overview

Build a native analytics dashboard panel inside the existing chat webview.
Opens as a full-screen overlay (same pattern as `AchievementPanel`) triggered by a new StatusBar button.
Reads exclusively from the existing Zustand store — no new IPC, no new WebviewPanel, no external server.
- Also provide a disabled-state variant when semantic analysis is turned off by setting.

---

## Architecture Decision: Overlay, Not Separate Panel

**Why overlay:** The Zustand store lives inside the chat webview. A separate VS Code WebviewPanel would need its own data channel (extension sends all turn data again via postMessage). An overlay reads directly from the store — zero duplication, instant reactivity, consistent with existing patterns (`AchievementPanel`, `PromptHistoryPanel`, `VitalsInfoPanel`).

**Trade-off:** Hides chat while open. Acceptable — user chose to open the dashboard.

---

## Plan Review — Applied Upgrades

### Round 1 (original revision)
This revision keeps the original direction, but fixes several implementation risks:

1. Split delivery into **MVP dashboard (existing turn data)** and **Phase 2 semantic analyzer** to reduce scope risk.
2. Add **cost/perf controls** for semantic analysis (enable flag, queueing, per-session cap, timeout).
3. Fix a `MessageHandler` sequencing pitfall: **snapshot Bash commands before clearing per-turn state**.
4. Fix the `useClaudeStream` example to call the store action correctly (`applyTurnSemantics(...)`).
5. Add a merge strategy for async semantics when they arrive before/after turn creation (resume/fork/history timing).
6. Require lazy-loading for the dashboard/charts to avoid unnecessary webview bundle growth.

### Round 2 (post-codebase validation)
After cross-referencing every plan step against the actual codebase, the following fixes were applied:

7. **Fixed wrong variable name** in Step 2b: `accumulatedJson` -> `rawInput` (from `toolBlockContexts.get()`).
8. **Fixed wrong reset location**: `currentBashCommands` must reset in `messageStart` handler (where per-message state is cleared), NOT in `clearApprovalTracking()` (which is approval-specific).
9. **Added `extractTextFromContent` utility definition**: The plan referenced it without defining it. Now includes implementation that handles both string and ContentBlock[] formats (CLI data format gotcha).
10. **Fixed messageId snapshot**: TurnAnalyzer trigger now snapshots `this.lastMessageId` before async fire (same pattern as `toolNamesSnapshot`).
11. **Removed all emoji characters**: MoodTimeline now uses CSS-styled text labels/dots instead of emoji, per project encoding rules (Hebrew UTF-8 conflicts).
12. **Fixed Recharts bundle size estimate**: 180KB -> 300KB+ (includes D3 sub-dependencies).
13. **Added CSP and webpack guidance for lazy loading**: `React.lazy()` creates code-split chunks that need CSP allowance in the webview. Documented the options and fallback strategy.
14. **Consolidated file structure**: 22 new files -> 13 new files. Merged 7 chart components into `RechartsWrappers.tsx`, 3 semantic widgets into `SemanticWidgets.tsx`, extracted shared utils to `dashboardUtils.ts`.
15. **Replaced SettingsSidebar with settings link**: A read-only sidebar duplicating VS Code Settings is fragile (pricing changes, model updates). Now uses a gear icon that opens VS Code Settings filtered to `claudeMirror`.
16. **Added `(success as any)` note for token fields**: The `usage` field is not typed in `stream-json.ts`. Documents the existing `as any` pattern and shows how to add proper types later.
17. **Added turnIndex reset asymmetry warning**: `MessageHandler.turnIndex` never resets on clearSession. Dashboard should use array position, not raw turnIndex.
18. **Added light theme recommendation**: Keep dark overlay for MVP (it controls its own background). Document as follow-up.
19. **Enhanced post-implementation checklist**: Added ESC close, clear-session reset, 50+ turn performance, and settings link verification.

---

## Scope of Work — All Features

| # | Feature | What It Is |
|---|---------|------------|
| A | Token data per turn | Extend `TurnRecord` with per-turn token counts |
| B | Analysis model setting | VS Code config for which model runs Haiku-style analysis |
| C | Bash command history | Capture + visualize every shell command Claude ran |
| D | Semantic turn analyzer (Phase 2, optional/flagged) | LLM-powered per-turn signals: mood, task type, bug repeat, outcome |
| E | Dashboard UI | 5-tab overlay; MVP works from existing `turnHistory` and progressively enhances when semantic data arrives |

---

## Part 1 — Data Foundation

### Step 1 — Extend TurnRecord interface

**File:** `src/extension/types/webview-messages.ts`
**Lines:** 470–485 (TurnRecord interface)

```typescript
export interface TurnSemantics {
  /** User's inferred emotional state this turn */
  userMood: 'frustrated' | 'satisfied' | 'confused' | 'excited' | 'neutral' | 'urgent';
  /** Whether the stated task appears to be resolved */
  taskOutcome: 'success' | 'partial' | 'failed' | 'in-progress' | 'unknown';
  /** Classification of the task the user is working on */
  taskType: TaskType;
  /** Is this a repeated mention of the same bug? */
  bugRepeat: 'none' | 'first' | 'second' | 'third-plus';
  /** Model's confidence in these signals (0–1) */
  confidence: number;
}

export type TaskType =
  | 'bug-fix'         // Fixing specific broken behavior
  | 'feature-small'   // New capability, likely completable this session
  | 'feature-large'   // Multi-session or complex new feature
  | 'exploration'     // Understanding codebase, reading, investigating
  | 'refactor'        // Restructuring without new behavior
  | 'new-app'         // Building a project from scratch
  | 'planning'        // Architecture discussion, task breakdown
  | 'code-review'     // Reviewing existing code
  | 'debugging'       // Tracing and investigating non-obvious issues
  | 'testing'         // Writing or fixing tests
  | 'documentation'   // Docs, comments, README
  | 'devops'          // Deployment, CI, environment setup
  | 'question'        // Asking for explanation, no code change needed
  | 'configuration'   // Config files, settings, env vars
  | 'unknown';

export interface TurnRecord {
  turnIndex: number;
  toolNames: string[];
  toolCount: number;
  durationMs: number;
  costUsd: number;
  totalCostUsd: number;
  isError: boolean;
  category: TurnCategory;
  timestamp: number;
  messageId: string;
  adventureArtifacts?: string[];
  adventureIndicators?: string[];
  adventureCommandTags?: string[];
  // NEW — per-turn token breakdown
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  // NEW — actual Bash command strings run this turn
  bashCommands?: string[];
  // NEW — async semantic analysis (arrives after turnComplete)
  semantics?: TurnSemantics;
}
```

Also add a new webview message type for the async semantics update:

```typescript
export interface TurnSemanticsMessage {
  type: 'turnSemantics';
  messageId: string;
  semantics: TurnSemantics;
}
// Add to ExtensionToWebviewMessage union
```

---

### Step 2 — Populate token + command fields in MessageHandler

**File:** `src/extension/webview/MessageHandler.ts`

**2a — Token fields** (lines 1118–1133, inside `'result'` handler, `successTurn` object):

```typescript
inputTokens: (success as any).usage?.input_tokens ?? 0,
outputTokens: (success as any).usage?.output_tokens ?? 0,
cacheCreationTokens: (success as any).usage?.cache_creation_input_tokens ?? 0,
cacheReadTokens: (success as any).usage?.cache_read_input_tokens ?? 0,
```

**NOTE:** The `success` object's `usage` field is not currently typed in `stream-json.ts`. The existing code already uses `(success as any).duration_ms` for the duration field. Follow the same `as any` pattern for `usage` until the types are updated. If you want to add proper types later, extend the `ResultSuccess` interface in `src/extension/types/stream-json.ts` with:

```typescript
usage?: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
```

**2b — Bash command extraction**

Add a new private field to `MessageHandler`:

```typescript
/** Bash command strings seen in the current assistant message */
private currentBashCommands: string[] = [];
```

When a `Bash` tool block completes (in `blockStop` handler), extract the `command` field from the accumulated tool input stored in `toolBlockContexts`:

```typescript
// In the blockStop handler, after existing enrichment logic:
// NOTE: the variable is `rawInput` from `this.toolBlockContexts.get(data.blockIndex)`
if (toolName === 'Bash') {
  try {
    const parsed = JSON.parse(rawInput);
    if (parsed.command && typeof parsed.command === 'string') {
      this.currentBashCommands.push(parsed.command.trim());
    }
  } catch {
    // ignore malformed JSON — rawInput may be partial
  }
}
```

Then in the `result` handler, snapshot BEFORE building `successTurn`:

```typescript
// Snapshot BEFORE any reset/clear logic — same pattern as toolNamesSnapshot
const bashCommandsSnapshot = [...this.currentBashCommands];
// ...inside successTurn object:
bashCommands: bashCommandsSnapshot,
```

Reset in the `messageStart` handler (lines 1058-1079), alongside the other per-message state clears (NOT in `clearApprovalTracking`, which is approval-specific):

```typescript
// In messageStart handler, add alongside existing clears:
this.currentBashCommands = [];
```

Important: `clearApprovalTracking()` only resets `currentMessageToolNames` and `pendingApprovalTool`. Per-message state like bash commands MUST be reset in `messageStart`, which is where `toolBlockNames`, `toolBlockContexts`, adventure sets, and other per-message state are cleared.

Also mirror this extraction in any assistant-message fallback tool parser (if the codebase uses one), and dedupe repeated command strings within the same turn.

**2c — Trigger TurnAnalyzer** (after the `postMessage({ type: 'turnComplete' })` call):

```typescript
// IMPORTANT: use snapshotted messageId, not the live this.lastMessageId
// (same reason toolNamesSnapshot exists — messageStart may clear it before async fires)
const messageIdSnapshot = this.lastMessageId;
if (this.turnAnalyzer) {
  // fire-and-forget; result arrives via async callback
  void this.turnAnalyzer.analyze({
    messageId: messageIdSnapshot,
    userMessage: this.lastUserMessageText,
    toolNames: toolNamesSnapshot,
    bashCommands: bashCommandsSnapshot,
    isError: false,
    recentUserMessages: this.recentUserMessages.slice(-3),
  });
}
```

Add two new private fields to `MessageHandler`:

```typescript
/** Last user message text (for TurnAnalyzer context) */
private lastUserMessageText = '';
/** Ring buffer of last 5 user message texts (for bug-repeat detection) */
private recentUserMessages: string[] = [];
```

Populate them in the `'userMessage'` event handler:

```typescript
this.lastUserMessageText = extractTextFromContent(event.message.content).slice(0, 600);
this.recentUserMessages = [...this.recentUserMessages.slice(-4), this.lastUserMessageText];
```

**Helper utility — `extractTextFromContent`:** The CLI's `content` field may be a plain string OR a `ContentBlock[]` array (see CLI Data Format Gotchas in CLAUDE.md). This utility must handle both:

```typescript
function extractTextFromContent(content: string | ContentBlock[] | unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  }
  return String(content ?? '');
}
```

Place this in `MessageHandler.ts` as a private method or top-level helper (it parallels the content normalization already done in `addUserMessage` in the store).

---

### Step 3 — Add VS Code setting: Analysis Model

**File:** `package.json` (contributes.configuration.properties)

```json
"claudeMirror.analysisModel": {
  "type": "string",
  "default": "claude-haiku-4-5-20251001",
  "enum": [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-opus-4-6"
  ],
  "enumDescriptions": [
    "Haiku — fastest and cheapest, good for quick summaries (recommended)",
    "Sonnet — higher quality analysis, moderate cost",
    "Opus — highest quality, slower and more expensive"
  ],
  "description": "Model used for background analysis: session naming, activity summaries, and semantic turn analysis"
}
```

**File:** `src/extension/session/ActivitySummarizer.ts`
**Line 160** — change hardcoded model:

```typescript
// Before:
const args = ['-p', '--model', 'claude-haiku-4-5-20251001'];

// After:
const analysisModel = config.get<string>('analysisModel', 'claude-haiku-4-5-20251001');
const args = ['-p', '--model', analysisModel];
```

**File:** `src/extension/session/SessionNamer.ts`
Same change — replace hardcoded `'claude-haiku-4-5-20251001'` with `config.get<string>('analysisModel', 'claude-haiku-4-5-20251001')`.

**Dashboard setting display:** The dashboard Settings panel shows the current value of `claudeMirror.analysisModel` alongside cost implications per model. It does NOT allow changing it in-dashboard (that's a VS Code setting, use the Settings UI). Just informational.

**Recommended companion settings (for rollout safety):**

```json
"claudeMirror.turnAnalysis.enabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable background semantic analysis for dashboard insights (adds extra Claude calls)"
},
"claudeMirror.turnAnalysis.maxPerSession": {
  "type": "number",
  "default": 30,
  "minimum": 0,
  "description": "Maximum number of semantic analysis calls per session tab"
},
"claudeMirror.turnAnalysis.timeoutMs": {
  "type": "number",
  "default": 30000,
  "minimum": 5000,
  "description": "Timeout for a single semantic analysis call"
}
```

---

## Part 2 — Semantic Turn Analyzer

### Step 4 — New TurnAnalyzer class

**File:** `src/extension/session/TurnAnalyzer.ts` (new file)

**Purpose:** After each turn completes, spawn a Claude CLI process (using the configured analysis model) to infer semantic signals from the conversation context. Fires a callback with `TurnSemantics`; `MessageHandler` forwards it to the webview as a `turnSemantics` message.

#### Constructor + public interface

```typescript
export interface TurnAnalysisInput {
  messageId: string;
  userMessage: string;          // current turn user message (up to 600 chars)
  toolNames: string[];          // tools used this turn
  bashCommands: string[];       // bash commands run this turn
  isError: boolean;             // did the turn end in error
  recentUserMessages: string[]; // last 2-3 user messages before this one (for repeat detection)
}

export class TurnAnalyzer {
  private log: (msg: string) => void = () => {};
  private timeoutMs = 30_000;
  private inFlight = false;
  private queue: TurnAnalysisInput[] = [];
  private maxQueueSize = 20;
  private analysesCompleted = 0;
  private maxPerSession = 30;
  private callback: ((messageId: string, semantics: TurnSemantics) => void) | null = null;

  setLogger(logger: (msg: string) => void): void { ... }
  onAnalysisComplete(cb: (messageId: string, semantics: TurnSemantics) => void): void { ... }
  async analyze(input: TurnAnalysisInput): Promise<void> { ... }
  reset(): void { ... }
}
```

#### The prompt

The prompt is structured to elicit a machine-parseable JSON response:

```
You are analyzing a single turn in a software development conversation between a developer and Claude Code (an AI coding assistant).

CURRENT TURN:
User message: "<userMessage>"
Tools Claude used: <toolNames as comma-separated list, or "none">
Commands Claude ran: <bashCommands as list, or "none">
Turn ended in error: <true|false>

RECENT PRIOR USER MESSAGES (oldest first):
<recentUserMessages, each prefixed with "- ">

TASK:
Analyze the CURRENT TURN and return a JSON object. Respond with ONLY valid JSON — no markdown fences, no explanation, nothing else.

FIELD DEFINITIONS:

userMood — The developer's inferred emotional state in their current message:
  "frustrated"  = complaints, "still broken", "again", "why isn't this working", repeated requests, impatience
  "satisfied"   = "thanks", "perfect", "it works", "great", approval
  "confused"    = "I don't understand", "what does X mean", unclear requests
  "excited"     = enthusiasm, "amazing", "this is great", positive breakthrough
  "urgent"      = deadlines, "ASAP", production issues, critical bugs
  "neutral"     = factual, matter-of-fact request with no emotional cue

taskOutcome — Did the stated task appear to be resolved this turn:
  "success"     = task clearly completed, Claude produced working output
  "partial"     = some progress but explicitly incomplete, more work needed
  "failed"      = Claude was unable to complete the task, error or blocker
  "in-progress" = multi-step workflow clearly mid-flow
  "unknown"     = not determinable from this turn alone

taskType — The nature of what the developer is working on:
  "bug-fix"       = fixing specific broken behavior (not just investigating)
  "feature-small" = adding new capability, likely done within this session
  "feature-large" = complex new feature spanning multiple sessions
  "exploration"   = understanding codebase, reading code, learning how something works
  "refactor"      = restructuring code without changing external behavior
  "new-app"       = building a project or significant module from scratch
  "planning"      = discussing architecture, task decomposition, design decisions
  "code-review"   = reviewing someone else's (or AI-generated) code
  "debugging"     = investigating non-obvious root causes (stack traces, logs, unexpected behavior)
  "testing"       = writing, running, or fixing tests
  "documentation" = writing docs, comments, README
  "devops"        = deployment, CI/CD, Docker, env setup, server config
  "question"      = asking for an explanation, no code change expected
  "configuration" = config files, settings, environment variables
  "unknown"       = none of the above applies

bugRepeat — Is this a repeated mention of a bug already reported earlier in this session:
  "none"        = this turn is not a bug report
  "first"       = first time this bug or failure is mentioned
  "second"      = clearly the same bug mentioned a second time
  "third-plus"  = same bug mentioned 3 or more times (use recent prior messages as evidence)

confidence — Your confidence in the overall analysis (0.0 to 1.0)

RETURN EXACTLY THIS JSON STRUCTURE:
{
  "userMood": "<one of the values above>",
  "taskOutcome": "<one of the values above>",
  "taskType": "<one of the values above>",
  "bugRepeat": "<one of the values above>",
  "confidence": <number between 0 and 1>
}
```

#### JSON parsing + validation

```typescript
private parseResponse(raw: string): TurnSemantics | null {
  // Strip possible markdown fences
  const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const validMoods = ['frustrated','satisfied','confused','excited','neutral','urgent'];
    const validOutcomes = ['success','partial','failed','in-progress','unknown'];
    const validTypes = ['bug-fix','feature-small','feature-large','exploration','refactor',
                        'new-app','planning','code-review','debugging','testing',
                        'documentation','devops','question','configuration','unknown'];
    const validRepeats = ['none','first','second','third-plus'];

    if (!validMoods.includes(obj.userMood)) return null;
    if (!validOutcomes.includes(obj.taskOutcome)) return null;
    if (!validTypes.includes(obj.taskType)) return null;
    if (!validRepeats.includes(obj.bugRepeat)) return null;
    if (typeof obj.confidence !== 'number') return null;

    return {
      userMood: obj.userMood,
      taskOutcome: obj.taskOutcome,
      taskType: obj.taskType,
      bugRepeat: obj.bugRepeat,
      confidence: Math.max(0, Math.min(1, obj.confidence)),
    };
  } catch {
    return null;
  }
}
```

#### Safeguards (same pattern as ActivitySummarizer, plus queue/cost controls)

- 30s timeout: kill process, return null
- Non-zero exit: return null
- Empty user message (< 5 chars): skip analysis entirely
- One analysis process at a time per session tab (`inFlight`)
- Bounded queue (e.g. 20). If full, drop oldest pending item and log it
- Per-session cap (from `claudeMirror.turnAnalysis.maxPerSession`)
- Config flag to disable semantics entirely (`claudeMirror.turnAnalysis.enabled`)
- Env cleanup: delete `CLAUDECODE` + `CLAUDE_CODE_ENTRYPOINT` from spawned env
- All errors logged to output channel, never surfaced to user
- Do not block `turnComplete`; semantics is best-effort async enrichment only

---

### Step 5 — Wire TurnAnalyzer into MessageHandler + SessionTab

**File:** `src/extension/session/SessionTab.ts`

- Instantiate `TurnAnalyzer` alongside `ActivitySummarizer` and `SessionNamer`
- Wire its callback: when analysis completes, call `webview.postMessage({ type: 'turnSemantics', messageId, semantics })`
- Inject into `MessageHandler` via a setter: `handler.setTurnAnalyzer(analyzer)`

**File:** `src/extension/webview/MessageHandler.ts`

Add:

```typescript
private turnAnalyzer: TurnAnalyzer | null = null;

setTurnAnalyzer(analyzer: TurnAnalyzer): void {
  this.turnAnalyzer = analyzer;
  analyzer.onAnalysisComplete((messageId, semantics) => {
    this.webview.postMessage({ type: 'turnSemantics', messageId, semantics });
  });
}
```

---

### Step 6 — Zustand store: handle turnSemantics message

**File:** `src/webview/state/store.ts`

Add action `applyTurnSemantics`:

```typescript
// Recommended (to handle async timing gaps / resume/fork ordering):
pendingTurnSemanticsByMessageId: Record<string, TurnSemantics>;

applyTurnSemantics: (messageId: string, semantics: TurnSemantics) =>
  set(s => ({
    turnHistory: s.turnHistory.map(t =>
      t.messageId === messageId ? { ...t, semantics } : t
    ),
    turnByMessageId: {
      ...s.turnByMessageId,
      ...(s.turnByMessageId[messageId]
        ? { [messageId]: { ...s.turnByMessageId[messageId], semantics } }
        : {}),
    },
    pendingTurnSemanticsByMessageId: {
      ...s.pendingTurnSemanticsByMessageId,
      [messageId]: semantics,
    },
  })),
```

Also merge pending semantics in `addTurnRecord` (and any turn-history backfill path) so late/early async results still attach to the correct turn.

**File:** `src/webview/hooks/useClaudeStream.ts`

Add case for `'turnSemantics'`:

```typescript
case 'turnSemantics':
  applyTurnSemantics(msg.messageId, msg.semantics);
  break;
```

---

## Part 3 — Dashboard UI

### Step 7 — Add dashboard state to Zustand store

**File:** `src/webview/state/store.ts`

```typescript
// In AppState:
dashboardOpen: boolean;

// Initial state:
dashboardOpen: false,

// Actions:
toggleDashboard: () => set(s => ({ dashboardOpen: !s.dashboardOpen })),
setDashboardOpen: (open: boolean) => set({ dashboardOpen: open }),
```

---

### Step 8 — Install Recharts

```bash
npm install recharts
```

Recharts is a D3-backed React chart library. Pure React, tree-shakeable, dark-theme friendly via inline color props. Adds ~300KB+ minified (including D3 sub-dependencies: d3-scale, d3-shape, d3-interpolate, etc.) — acceptable for a dev tool but must be lazy-loaded.

---

### Lazy-loading: CSP and Webpack considerations

Implementation requirement: lazy-load the dashboard (or at minimum the chart-heavy tabs) so the default chat webview path does not pay the chart bundle cost on every session open.

**Critical: VS Code webview CSP restriction.** `React.lazy()` + dynamic `import()` creates code-split chunks (separate `.js` files). The webview's Content Security Policy in `buildWebviewHtml()` must be updated to allow loading these additional script chunks. Specifically:

1. **Webpack config** (`webpack.config.js`): Configure `output.chunkFilename` for the webview target to output chunks alongside `webview.js` (e.g., `dist/webview-[name].chunk.js`).

2. **CSP update** (`WebviewProvider.ts` → `buildWebviewHtml()`): The `script-src` directive already allows the webview's local resource URI via nonce. Dynamic chunks should be served from the same origin, so this should work — but **verify** that chunks loaded via `import()` inherit the nonce. If not, use a `script-src` with the webview resource URI instead of nonce-only.

3. **Alternative approach**: If CSP issues prove difficult, bundle the dashboard as a single entry but behind a conditional `require()` or use `React.lazy` with a Suspense boundary that catches CSP errors gracefully.

**Fallback**: If code splitting is too complex for the first iteration, accept the larger initial bundle and add a TODO to split later. The chat webview already bundles ~170KB; adding ~300KB is noticeable but not catastrophic for a dev tool.

### Step 9 — Dashboard component architecture

**New directory:** `src/webview/components/Dashboard/`

#### File structure (consolidated — 13 new files instead of 22)

```
src/webview/components/Dashboard/
├── DashboardPanel.tsx          # Root overlay — tab nav, close button, Esc handler
├── tabs/
│   ├── OverviewTab.tsx         # Metric cards + cost chart + mood strip + frustration alert
│   ├── TokensTab.tsx           # Stacked token bar + cache efficiency cards
│   ├── ToolsTab.tsx            # Tool frequency bar + category donut
│   ├── TimelineTab.tsx         # Duration bar + semantic charts + sortable turn table
│   └── CommandsTab.tsx         # Bash command timeline + bug repeat sidebar
├── charts/
│   ├── RechartsWrappers.tsx    # All Recharts chart components in one file:
│   │                           #   CostAreaChart, TokenStackedBar, DurationBar,
│   │                           #   ToolFrequencyBar, CategoryDonut, TaskTypeDonut, OutcomeBar
│   └── SemanticWidgets.tsx     # MoodTimeline strip, FrustrationAlert, BugRepeatTracker
├── MetricsCards.tsx            # 8-card summary row
├── TurnTable.tsx               # Sortable paginated turn table with optional semantic columns
├── dashboardUtils.ts           # Shared types, color constants, categorizeCommand(), helpers
└── index.ts                    # Re-exports DashboardPanel (lazy-loadable)
```

**Rationale for consolidation:**
- **`RechartsWrappers.tsx`**: All chart components share the same Recharts imports (BarChart, PieChart, ComposedChart, etc.). Splitting each into its own file means 7 files that all import the same library. One file = one import tree, simpler maintenance.
- **`SemanticWidgets.tsx`**: MoodTimeline, FrustrationAlert, and BugRepeatTracker are small, tightly related, and only rendered when semantic data exists. They can share state derivation logic.
- **`dashboardUtils.ts`**: Color constants, `categorizeCommand()`, shared types (CommandEntry, etc.) extracted to avoid duplication across tabs.
- **SettingsSidebar removed**: The original was read-only info that duplicates what VS Code Settings already shows. A "Settings" link in the dashboard header that opens `vscode.commands.executeCommand('workbench.action.openSettings', 'claudeMirror')` is simpler and always up-to-date.

---

#### DashboardPanel.tsx — layout

```
+----------------------------------------------------------------------+
|  ClaUi Analytics Dashboard    [analysis: haiku] [gear] [x] close     |
|  ================================================================    |
|  [ Overview ] [ Tokens ] [ Tools ] [ Timeline ] [ Commands ]         |
|  --------------------------------------------------------------------+
|  <active tab content, scrollable>                                    |
+----------------------------------------------------------------------+
```

- Full-screen overlay: `position: fixed; inset: 0; z-index: 1000`
- Background: `rgba(13, 17, 23, 0.97)` (always dark, even in light VS Code theme)
- Header: title left, optional inline badge showing current analysis model + enabled status, gear icon (opens VS Code Settings filtered to `claudeMirror`) + close (x) right
- Tab bar: 5 tabs with active indicator
- Content area: scrollable, padded
- ESC key closes the dashboard (same pattern as `PromptHistoryPanel` — `useEffect` with `keydown` listener)

---

#### OverviewTab.tsx

**Row 1:** `<MetricsCards />` — 8 summary cards:

| Card | Value | Source |
|------|-------|--------|
| Total Cost | `$X.XXXX` | `cost.totalCostUsd` |
| Total Turns | `N` | `turnHistory.length` |
| Avg Turn Cost | `$X.XXXX` | total / turns |
| Error Rate | `N%` | errors / turns |
| Total Input Tokens | `N,NNN` | sum `inputTokens` |
| Total Output Tokens | `N,NNN` | sum `outputTokens` |
| Cache Hit Rate | `N%` | sumCacheRead / sumInput |
| Avg API Duration | `Xs` | avg `durationMs` |

**Row 2 (2 columns):**
- Left: `<CostAreaChart />` — cumulative + per-turn cost
- Right: `<MoodTimeline />` — horizontal strip of emoji per turn (only turns with `semantics`)

**Row 3:** `<FrustrationAlert />` — conditionally rendered if ≥ 3 consecutive `frustrated` turns detected.

---

#### TokensTab.tsx

Top row: 4 mini stat cards (total input, total output, cache created, cache read + hit rate %)

Below: `<TokenStackedBar />` — stacked bar per turn:
- Blue: input (non-cached)
- Green: output
- Amber: cache creation
- Teal: cache read

Data:
```typescript
type TokenPoint = {
  turn: number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};
```

---

#### ToolsTab.tsx

Left half: `<ToolFrequencyBar />` — horizontal bar, top 15 tools by usage count
Right half: `<CategoryDonut />` — TurnCategory distribution

Data derivation for tool frequency:
```typescript
const toolFreq = turnHistory.reduce((acc, t) => {
  t.toolNames.forEach(name => {
    const base = name.includes('__') ? name.split('__').pop()! : name;
    acc[base] = (acc[base] ?? 0) + 1;
  });
  return acc;
}, {} as Record<string, number>);
const sorted = Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 15);
```

Category colors:
- `success` → `#3fb950`
- `discussion` → `#58a6ff`
- `code-write` → `#bc8cff`
- `research` → `#e3b341`
- `command` → `#39d353`
- `error` → `#f85149`

---

#### TimelineTab.tsx

**Top:** `<DurationBar />` — bar per turn, height = `durationMs`, colored by `TurnCategory`

**Middle (2 columns, only if semantics data exists):**
- Left: `<TaskTypeDonut />` — donut of task type distribution
- Right: `<OutcomeBar />` — stacked bar: success/partial/failed/unknown per turn

**Bottom:** `<TurnTable />` — sortable table

Columns:
| # | Time | Category | Task Type | Mood | Outcome | Tools | Duration | Cost | Tokens In | Tokens Out | Cache |
|---|------|----------|-----------|------|---------|-------|----------|------|-----------|------------|-------|

- Task Type and Mood columns only shown if ≥ 1 turn has `semantics`
- Mood rendered as colored text label with icon
- Click header to sort ascending/descending
- Paginated: 15 rows per page

---

#### CommandsTab.tsx

Visualizes every shell command Claude ran during the session.

**Data source:** `turnHistory[].bashCommands` — array of command strings per turn.

**Flattened and enriched:**
```typescript
type CommandEntry = {
  turnIndex: number;
  timestamp: number;
  command: string;
  category: CommandCategory; // derived from command text
};

type CommandCategory =
  | 'git'     // starts with "git"
  | 'npm'     // npm / npx / yarn / pnpm
  | 'test'    // jest / pytest / cargo test / go test / vitest
  | 'build'   // webpack / tsc / vite / make / cargo build
  | 'deploy'  // docker / kubectl / ssh / rsync / scp
  | 'search'  // grep / rg / find / fd
  | 'file'    // ls / cp / mv / rm / mkdir / cat
  | 'other';  // everything else
```

**Category detection (simple prefix/substring matching):**
```typescript
function categorizeCommand(cmd: string): CommandCategory {
  const c = cmd.trim().toLowerCase();
  if (c.startsWith('git ')) return 'git';
  if (/^(npm|npx|yarn|pnpm) /.test(c)) return 'npm';
  if (/\b(jest|vitest|pytest|cargo test|go test|dotnet test|rspec)\b/.test(c)) return 'test';
  if (/\b(webpack|tsc|vite|rollup|esbuild|make|cargo build|go build)\b/.test(c)) return 'build';
  if (/^(docker|kubectl|ssh|rsync|scp|helm) /.test(c)) return 'deploy';
  if (/^(grep|rg|find|fd) /.test(c)) return 'search';
  if (/^(ls|cp|mv|rm|mkdir|cat|touch|chmod|chown) /.test(c)) return 'file';
  return 'other';
}
```

**Layout:**

Top: 7 category filter chips (click to toggle visibility)

Below: Command timeline list — each row:
```
[Turn #3] [git]  git add . && git commit -m "fix auth bug"     14:23:05
[Turn #5] [npm]  npm run build                                  14:28:11
[Turn #5] [test] npm test -- --testPathPattern=auth             14:29:44
```

- Monospace font for command text
- Category chip colored (git=orange, npm=red, test=green, build=purple, deploy=teal, search=blue, file=gray)
- Turn number links to the matching row in TimelineTab (visual highlight)
- Search bar to filter commands by text
- Commands truncated at 120 chars with hover tooltip showing full text
- `<BugRepeatTracker />` sidebar panel if any turns have `bugRepeat !== 'none'`

---

#### MoodTimeline.tsx

A horizontal strip below the cost chart in OverviewTab.
One colored dot or icon per turn that has `semantics`.

Mood indicator + color (use CSS-styled text labels or inline SVG icons — NO emojis to avoid Hebrew UTF-8 encoding conflicts):

| Mood | Label | Color | CSS dot/icon |
|------|-------|-------|-------------|
| `frustrated` | FRS | `#f85149` (red) | Filled circle with `!` |
| `satisfied` | OK | `#3fb950` (green) | Filled circle with checkmark |
| `confused` | `?` | `#e3b341` (amber) | Filled circle with `?` |
| `excited` | `++` | `#58a6ff` (blue) | Filled circle with `^` arrow |
| `urgent` | URG | `#f0883e` (orange) | Filled circle with `!!` |
| `neutral` | `-` | `#8b949e` (muted) | Hollow circle |

Implementation: use `<span>` with `border-radius: 50%`, `background-color`, and a single-character inner text. Avoid emoji characters entirely per project encoding rules.

Turns without semantics: small gray hollow dot (`border: 1px solid #8b949e`).

Hovering shows tooltip: `Turn N | <taskType> | <outcome> | confidence: X%`

---

#### FrustrationAlert.tsx

Conditionally rendered when any 3 consecutive turns share `userMood === 'frustrated'`.

```
+-----------------------------------------------------------+
|  [!] Frustration pattern detected                         |
|  Turns 4, 5, 6 all indicate frustrated user mood.         |
|  Consider checking: same bug repeated? blocking issue?    |
+-----------------------------------------------------------+
```

Red border, amber background at 10% opacity.

---

#### BugRepeatTracker.tsx

Shows a list of bug-repeat events:

```
Bug Repeat Events
─────────────────
Turn 3  → First report: "the auth redirect is broken"
Turn 7  → Second mention of same issue
Turn 12 → Third+ mention — still unresolved
```

Colored by severity: amber (second), red (third+).

---

#### Settings link (replaces SettingsSidebar)

Instead of a full sidebar panel, add a gear icon in the dashboard header that opens VS Code Settings filtered to `claudeMirror`:

```typescript
onClick={() => vscodeApi.postMessage({
  type: 'openSettings',
  query: 'claudeMirror'
})}
// Extension side: vscode.commands.executeCommand('workbench.action.openSettings', 'claudeMirror')
```

**Rationale:** A read-only sidebar duplicating VS Code Settings adds maintenance burden (must track setting changes, model pricing changes, etc.). Linking directly to the actual settings is always accurate and reduces new-file count.

The dashboard header can optionally show the current analysis model name and `turnAnalysis.enabled` status as inline badges — derived from extension config sent via a `dashboardConfig` postMessage on dashboard open.

---

### Step 10 — Wire into App.tsx

**File:** `src/webview/App.tsx`

```typescript
import { DashboardPanel } from './components/Dashboard';
// ...
const { ..., dashboardOpen, toggleDashboard } = useAppStore();
// ...
{dashboardOpen && <DashboardPanel />}
```

**StatusBar button** (add near achievements button):
```tsx
<button
  className="status-bar-dashboard-btn"
  title="Analytics Dashboard"
  aria-label="Open analytics dashboard"
  onClick={toggleDashboard}
>
  <span className="codicon codicon-graph" />
</button>
```

Notes:
- Prefer existing status-bar naming/styling patterns (`status-bar-*`) for consistency.
- Add `Esc` close handling in `DashboardPanel` (same pattern as existing overlays).

---

### Step 11 — Styling

**Color palette:**
```css
--dash-bg:            #0d1117;
--dash-card-bg:       #161b22;
--dash-border:        #30363d;
--dash-text:          #e6edf3;
--dash-text-muted:    #8b949e;
--dash-accent-green:  #3fb950;
--dash-accent-blue:   #58a6ff;
--dash-accent-purple: #bc8cff;
--dash-accent-amber:  #e3b341;
--dash-accent-red:    #f85149;
--dash-accent-orange: #f0883e;
--dash-accent-teal:   #39d353;
```

**Metrics grid:**
```css
.metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
```

**Tab bar:**
```css
.dash-tab-bar { display: flex; gap: 2px; border-bottom: 1px solid var(--dash-border); }
.dash-tab { padding: 8px 16px; cursor: pointer; color: var(--dash-text-muted); }
.dash-tab.active { color: var(--dash-accent-blue); border-bottom: 2px solid var(--dash-accent-blue); }
```

---

## Empty States

Every chart handles `turnHistory.length === 0`:
- Centered muted text: `"No turns yet — start a session to see analytics"`

Semantic charts additionally handle `turnHistory.filter(t => t.semantics).length === 0`:
- Text: `"Semantic analysis pending — will appear after first turn completes"`

---

## Reactivity

- Charts reading `turnHistory` update automatically on every `turnComplete`
- Semantic charts update when `applyTurnSemantics` fires (async, arrives seconds after `turnComplete`)
- Resume/fork/history sessions should render immediately from available turn data, then progressively enrich
- No polling, no manual refresh

---

## Risks & Mitigations

1. **Cost blow-up (semantic analyzer):** Keep `turnAnalysis.enabled=false` by default, add per-session cap and timeout.
2. **Bundle growth / slower webview startup:** Lazy-load dashboard or chart-heavy tabs; avoid loading charts on normal chat open. See CSP considerations above.
3. **Race conditions (async semantics vs turn creation):** Persist pending semantics by `messageId` and merge during turn insertion/backfill.
4. **Command capture gaps:** Extract commands from both standard tool-finalization and fallback assistant parsing paths; dedupe per turn.
5. **History/resume variance:** Dashboard must tolerate missing `durationMs`, token fields, or commands on older turns.
6. **turnIndex asymmetry:** `MessageHandler.turnIndex` is never reset on `clearSession` or `editAndResend` — it only resets when a new MessageHandler is constructed. The webview store's `reset()` clears `turnHistory` though. This means after a clear-session, extension-side turn indices start from where they left off while the webview starts fresh. The dashboard should use the webview's `turnHistory` array index (position), not the raw `turnIndex` field, for display ordering. Consider adding `this.turnIndex = 0` in the MessageHandler's clearSession path.
7. **Light theme support:** The color palette is designed for dark themes. If VS Code is using a light theme, the dashboard should either (a) always use dark background (current design — `rgba(13, 17, 23, 0.97)` overlay), or (b) detect `document.body.classList` for `vscode-light` and swap to a light palette. **Recommendation:** Keep the dark overlay (option a) for MVP — it's a full-screen overlay that controls its own background, so light-theme users still get readable charts. Add light theme support in a follow-up if requested.

---

## Acceptance Criteria (Add Before Implementation Complete)

1. Dashboard opens/closes reliably from the status bar without affecting the active Claude session.
2. Overview/Tools/Timeline tabs work using existing `turnHistory` only (semantic analyzer disabled).
3. Tokens/Commands tabs degrade gracefully when token/command fields are missing for historical turns.
4. Semantic widgets show a clean empty/disabled state when `turnAnalysis.enabled=false`.
5. Late semantic updates attach to the correct turn by `messageId` (no cross-turn leakage).
6. Resume/fork/history sessions render without waiting for a new turn and without console errors.
7. UI remains responsive with ~200 turns and long command lists.

---

## File Change Summary (Revised — Consolidated)

| File | Type | Description |
|------|------|-------------|
| `src/extension/types/webview-messages.ts` | Edit | Add `TurnSemantics`, `TaskType`, token+command+semantics fields to `TurnRecord`, add `TurnSemanticsMessage` to union |
| `src/extension/webview/MessageHandler.ts` | Edit | Token fields, Bash command extraction in `blockStop`, `extractTextFromContent`, `lastUserMessageText` + `recentUserMessages`, snapshot+trigger `TurnAnalyzer`, reset `currentBashCommands` in `messageStart` |
| `src/extension/session/ActivitySummarizer.ts` | Edit | Read `analysisModel` setting instead of hardcoded Haiku (line 160) |
| `src/extension/session/SessionNamer.ts` | Edit | Read `analysisModel` setting instead of hardcoded Haiku (line 36) |
| `src/extension/session/SessionTab.ts` | Edit | Instantiate `TurnAnalyzer` (local const, same pattern as sessionNamer), wire callback, inject into `MessageHandler` |
| `package.json` | Edit | Add `claudeMirror.analysisModel` plus `turnAnalysis.*` safety settings |
| `src/webview/state/store.ts` | Edit | Add `dashboardOpen` + `toggleDashboard`, `applyTurnSemantics`, `pendingTurnSemanticsByMessageId`, merge logic in `addTurnRecord` |
| `src/webview/hooks/useClaudeStream.ts` | Edit | Handle `'turnSemantics'` message case |
| `src/webview/App.tsx` | Edit | Import + render `DashboardPanel` (lazy-loaded), add status-bar dashboard button |
| `src/extension/session/TurnAnalyzer.ts` | **New** | Per-turn semantic LLM analysis (prompt, parse, spawn, queue, caps, timeout) |
| `src/webview/components/Dashboard/DashboardPanel.tsx` | **New** | Root overlay — tab nav, close button, ESC handler, settings link |
| `src/webview/components/Dashboard/tabs/OverviewTab.tsx` | **New** | Metric cards + cost chart + mood strip + frustration alert |
| `src/webview/components/Dashboard/tabs/TokensTab.tsx` | **New** | Mini stat cards + stacked token bar |
| `src/webview/components/Dashboard/tabs/ToolsTab.tsx` | **New** | Tool frequency bar + category donut |
| `src/webview/components/Dashboard/tabs/TimelineTab.tsx` | **New** | Duration bar + semantic charts + sortable turn table |
| `src/webview/components/Dashboard/tabs/CommandsTab.tsx` | **New** | Command timeline + category filters + bug repeat tracker |
| `src/webview/components/Dashboard/charts/RechartsWrappers.tsx` | **New** | All 7 Recharts chart components (CostArea, TokenStacked, Duration, ToolFreq, CategoryDonut, TaskTypeDonut, OutcomeBar) |
| `src/webview/components/Dashboard/charts/SemanticWidgets.tsx` | **New** | MoodTimeline strip, FrustrationAlert card, BugRepeatTracker list |
| `src/webview/components/Dashboard/MetricsCards.tsx` | **New** | 8-card summary row |
| `src/webview/components/Dashboard/TurnTable.tsx` | **New** | Sortable paginated turn table with optional semantic columns |
| `src/webview/components/Dashboard/dashboardUtils.ts` | **New** | Color palette, `categorizeCommand()`, shared types, helper functions |
| `src/webview/components/Dashboard/index.ts` | **New** | Re-exports DashboardPanel |

**Total:** ~9 edited files, ~13 new files (down from 22 — consolidated charts, semantics, and removed SettingsSidebar)

---

## Effort Estimate (Revised)

| Phase | Work |
|-------|------|
| Data types + TurnRecord extension + `extractTextFromContent` | ~30 min |
| `TurnAnalyzer` class (prompt + parse + spawn + queue/caps) | ~3 hours |
| `ActivitySummarizer` + `SessionNamer` model setting | ~30 min |
| `package.json` settings + store actions + stream hook + CSP | ~1 hour |
| Dashboard UI: DashboardPanel + Overview + Tokens + Tools tabs | ~3.5 hours |
| Dashboard UI: Timeline tab + TurnTable (paginated, sortable) | ~2 hours |
| Dashboard UI: Commands tab + dashboardUtils | ~1.5 hours |
| RechartsWrappers + SemanticWidgets (consolidated) | ~2.5 hours |
| Styling, empty states, responsive grid, lazy-load wiring | ~1.5 hours |
| Integration testing (resume/fork/history + async semantics races) | ~2 hours |
| **Total** | **~3 development days** |

Consolidation saves ~0.5-1 day vs. original estimate by reducing file count and eliminating the SettingsSidebar.

---

## Post-Implementation Checklist

1. `npm run deploy:local` + reload VS Code
2. Open a session, run several prompts (with tool use and Bash commands)
3. Click the "Dashboard" button -> verify panel opens and closes cleanly (including ESC key)
4. Verify all 5 tabs render correctly (with and without semantic data)
5. Verify `turnSemantics` arrives (check Output -> ClaUi for `[TurnAnalyzer]` logs)
6. Verify Bash commands appear in Commands tab and are linked to the correct turns
7. Disable `claudeMirror.turnAnalysis.enabled` -> verify semantic widgets show disabled/pending states without errors
8. Resume an old session + fork a session -> verify dashboard renders without waiting for new turns
9. Change `claudeMirror.analysisModel` to Sonnet -> verify session namer and activity summarizer pick it up
10. Verify empty states show before any turns
11. Verify gear icon in dashboard header opens VS Code Settings filtered to `claudeMirror`
12. Clear session -> open dashboard -> verify turnHistory is reset (no stale data from previous session)
13. Test with ~50+ turns to verify no rendering lag (especially TurnTable pagination and chart responsiveness)
14. `npm run verify:installed`