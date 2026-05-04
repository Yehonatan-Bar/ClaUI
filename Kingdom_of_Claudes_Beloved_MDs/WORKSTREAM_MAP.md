# Workstream Map

Subway-map style visualization that groups sessions into logical workstreams -- coherent threads of work with a goal, status, and history. Surfaces project structure, progress, and recommended next actions.

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| `Kingdom_of_Claudes_Beloved_MDs/WORKSTREAM_MAP_PLAN_REWRITE.md` | Full product specification and development plan (English, 51KB). Detailed principles, subway-map metaphor, success criteria, all 10 implementation phases |
| `Kingdom_of_Claudes_Beloved_MDs/WORKSTREAM_MAP_PLAN.md` | Original development plan draft (English, 28KB). Architecture overview and phase breakdown |
| `Kingdom_of_Claudes_Beloved_MDs/workstream_map_rewritten_plan.md` | Hebrew product/development plan for stakeholder reference |
| `Kingdom_of_Claudes_Beloved_MDs/html/workstream-map-feature-doc.html` | Visual HTML feature documentation (Hebrew, dark-themed, formatted for presentation) |

---

## Architecture

```
Extension Host (Node.js)                         Webview (React/Browser)
+------------------------------+                 +---------------------------+
| WorkstreamManager            |  postMessage    | WorkstreamMapView         |
|  +-- WorkstreamClassifier    | <------------>  |  +-- ProjectMapView (SVG) |
|  +-- StationExtractor        |                 |  +-- Detail panels        |
|  +-- CurrentStateSynthesizer |                 |  +-- ResolveToolbar       |
|  +-- ResumeStateBuilder      |                 |  +-- NLCommandBar         |
|  +-- PlanRealityAnalyzer     |                 +---------------------------+
|  +-- WorkstreamNLEditor      |
|  +-- WorkstreamStore         |
|  +-- WorkstreamSnapshotStore |
+------------------------------+
```

### Wiring Chain

```
extension.ts
  -> creates WorkstreamManager
  -> sets tabManager.workstreamManager = workstreamManager

TabManager.createTab()
  -> tab.setWorkstreamManager(this.workstreamManager)
  -> tab.setSessionStore(this.sessionStore)
  -> tab.setOpenTabSessionIdsGetter(() => this.getOpenTabSessionIds())

SessionTab
  -> forwards all three to MessageHandler via setters

MessageHandler (case 'workstreamMapReclassify')
  -> scopes sessions (open tabs + recent 3 days)
  -> calls workstreamManager.classifyProject(...)
  -> posts results back to webview
```

---

## Data Model

Core types defined in `src/extension/types/workstreamTypes.ts`.

### Workstream
Primary object -- a coherent thread of work spanning one or more sessions.
- `id`, `name`, `type` (feature/bugfix/refactor/research/maintenance/infrastructure/unknown)
- `status` (active/completed/abandoned/blocked/uncertain)
- `sessionIds[]` -- sessions belonging to this workstream
- `visual` -- rendering state (lane, color, collapsed, opacity, pinned)
- `currentState` -- AI-synthesized summary, blockers, recommended next action
- `metrics` -- session count, total cost, total duration, file counts

### Station
Meaningful event within a session (milestone, decision, blocker, discovery, error, merge, deployment).
- `id`, `label`, `description`, `type`, `status`
- `sessionId` -- owning session
- `workstreamId` -- parent workstream
- `visibleInProjectMap` -- importance-based visibility flag
- `evidence[]` -- supporting data

### ProjectMapState
Top-level container persisted in `workspaceState`.
- `workstreams[]`, `stations[]`, `splits[]`, `merges[]`
- `currentState` -- project-level synthesis
- `userEdits[]` -- manual corrections (protected from AI overwrite)
- `schemaVersion` -- for migration

---

## Session Scoping

The classification does NOT analyze all historical sessions. It filters to a relevant subset:

### Scope Rules
1. **Open tab sessions** -- Any session that has a currently open tab in ClaUi (even if the session has ended and is inactive -- as long as the user hasn't closed the tab)
2. **Recent sessions** -- Sessions from `ProjectAnalyticsStore` that ran within the last 3 days (based on `endedAt` or `startedAt`)

### Data Sources
| Source | Scope | Cap | Used For |
|--------|-------|-----|----------|
| `ProjectAnalyticsStore` (workspaceState) | This workspace/project only | 200 sessions | Primary session summaries (rich: cost, turns, errors, files, git info) |
| `SessionStore` (globalState) | All workspaces (global) | 100 sessions | Supplementary metadata only (fills missing `firstPrompt` and `summary`) |
| `TabManager.getOpenTabSessionIds()` | Currently open tabs | Unbounded | Session IDs for the "open tab" filter |

### Filtering Flow (MessageHandler)
```typescript
const allSummaries = this.projectAnalyticsStore.getSummaries();
const openTabIds = new Set(this.openTabSessionIdsGetter?.() ?? []);
const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
const summaries = allSummaries.filter(s => {
  if (openTabIds.has(s.sessionId)) return true;
  const ts = s.endedAt ?? s.startedAt;
  if (ts && new Date(ts).getTime() > threeDaysAgo) return true;
  return false;
});
```

Log output: `Scoped N total summaries -> M (openTabs=X, recentCutoff=3d)`

---

## Classification Pipeline

Triggered by `WorkstreamManager.classifyProject()`:

1. **Enrich** -- `SessionBackfiller` merges `SessionSummary` with `SessionMetadata`. Adds file lists, git info, first prompt, task type. Filter: must have (`firstPrompt` OR `summary`) AND `startedAt`
2. **Pre-cluster** -- `WorkstreamClassifier.heuristicPreCluster()` groups by:
   - Git branch (same non-main branch, 2+ sessions)
   - File overlap (Jaccard > 0.3 on modified files)
   - Temporal proximity (sessions within 2 hours with >30% word overlap in prompts)
3. **Classify** -- Sonnet AI classifies sessions into workstreams via CLI call. Respects existing user edits via protected assignments
4. **Extract stations** -- `StationExtractor` extracts 1-5 stations per session via Sonnet (batched)
5. **Synthesize** -- `CurrentStateSynthesizer` generates project + per-workstream current state
6. **Score** -- `WorkstreamImportanceScorer` computes importance/attention scores
7. **Save** -- `WorkstreamStore` persists to `workspaceState`, captures snapshot

Classification is debounced to 5 minutes minimum between full runs.

### CLI Invocation

All workstream services spawn one-shot Claude CLI processes and **pipe prompts via stdin** (not as command-line arguments, to avoid the Windows ~8,191 char limit):

```typescript
const args = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-4-6'];
const proc = spawn(cliPath, args, {
  cwd: workspacePath,
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});
proc.stdin?.write(prompt, 'utf-8');
proc.stdin?.end();
```

- Timeout: 90s (classifier), 60s (synthesizer), 45s (stations, plan), 30s (NL editor, resume)
- **CLI envelope unwrapping**: `--output-format json` wraps the model response in `{"type":"result","result":"..."}`. All services parse this envelope first and extract the `result` field before searching for the inner JSON
- Output parsing: regex `/{[\s\S]*}/` extracts JSON from the unwrapped result text
- Error handling: settled-state guard prevents double-resolve on timeout + close race
- Logging: each service receives a logger function from `WorkstreamManager` and logs spawn details, exit code, stdout/stderr lengths, and parse results to `Output -> ClaUi`

### Classification Prompt Structure

Built by `buildClassificationPrompt()`. Contains:
- Serialized sessions (truncated: firstPrompt 200 chars, summary 300 chars, filesModified 20, filesRead 10)
- Heuristic pre-clusters (as suggestions, not binding)
- Existing workstreams (if reclassifying -- preserve IDs)
- Protected user assignments (MUST be respected)
- Schema for expected JSON output

---

## SVG Layout

Deterministic lane-based algorithm in `src/webview/components/WorkstreamMap/layout.ts`:

- Workstreams sorted by priority (blocked > active > uncertain > completed > abandoned)
- Horizontal lanes, 60px spacing, max 7 visible lanes
- Stations positioned along workstream paths at evenly-spaced intervals
- Smooth cubic bezier SVG paths

## Visual Encoding

Defined in `src/webview/components/WorkstreamMap/visualEncoding.ts`:

| Signal | Encoding |
|--------|----------|
| Workstream status | Line color (blue=active, red=blocked, green=completed, amber=uncertain, gray=abandoned) |
| Confidence | Line texture (solid >= 0.7, dashed < 0.7) |
| Station type | Shape (circle=milestone, diamond=decision, square=blocker, triangle=discovery) |
| Activity recency | Glow filter intensity |
| Importance | Station size (small/medium/large) |

## Layers

- **Current State Layer** -- Resume point marker (pulsing circle + "RESUME HERE"), blocker attention markers, enlarged last station on active workstreams
- **Resume View Layer** -- Shows after inactivity (24h threshold). Compares current state against last snapshot, highlights new/changed workstreams and stations
- **Plan Overlay** -- Compares planned steps against actual stations (detected from planning sessions)
- **Resolve Mode** -- Interactive editing: rename, mark complete/abandoned, pin/unpin, hide station, natural language commands

---

## Message Protocol

### Webview -> Extension
| Message | Purpose |
|---------|---------|
| `workstreamMapOpen` | Map panel opened |
| `workstreamMapRequestData` | Request current map state |
| `workstreamMapReclassify` | Trigger (re)classification (with `force` flag) |
| `workstreamMapApplyEdit` | Apply a structured user edit |
| `workstreamMapNaturalLanguageEdit` | Process NL editing command |
| `workstreamMapOpenSession` | Navigate to a session |
| `workstreamMapDismissResumeView` | Dismiss resume overlay |
| `workstreamMapSaveSnapshot` | Capture a snapshot |

### Extension -> Webview
| Message | Purpose |
|---------|---------|
| `workstreamMapData` | Full map state payload |
| `workstreamMapClassifying` | Progress updates during classification (`progress`, `phase`) |
| `workstreamMapError` | Error message string |
| `workstreamMapResumeState` | Resume state for returning users |
| `toggleWorkstreamMap` | Open/close the map panel |

---

## Key Files

### Extension Services (`src/extension/workstream/`)
| File | Role |
|------|------|
| `WorkstreamManager.ts` | Orchestrator. Instantiates all services, runs pipeline, emits progress |
| `WorkstreamStore.ts` | workspaceState persistence, schema migration, cap limits (50 workstreams, 500 stations) |
| `WorkstreamSnapshotStore.ts` | SHA-256 snapshot capture/diff (max 20) |
| `WorkstreamClassifier.ts` | Heuristic pre-clustering + Sonnet two-phase classification. Pipes prompt via stdin |
| `StationExtractor.ts` | Sonnet station extraction (1-5 per session, batched) |
| `CurrentStateSynthesizer.ts` | Project + workstream current state via Sonnet |
| `ResumeStateBuilder.ts` | Snapshot diff for returning users (24h threshold) |
| `PlanRealityAnalyzer.ts` | Plan candidate detection + step comparison |
| `WorkstreamNLEditor.ts` | Pattern matching + Sonnet fallback for NL edits |
| `WorkstreamImportanceScorer.ts` | Weighted composite scoring (recency, volume, blockers) |
| `SessionBackfiller.ts` | Enriches session summaries with metadata (files, git, prompts) |
| `FileTracker.ts` | Tracks file reads/writes from tool events |

### Types (`src/extension/types/`)
- `workstreamTypes.ts` -- All enums, interfaces, constants (`Workstream`, `Station`, `ProjectMapState`, `EnrichedSessionData`, `ClassificationOutput`, `UserEdit`, etc.)

### Webview Components (`src/webview/components/WorkstreamMap/`)
| File | Role |
|------|------|
| `WorkstreamMapView.tsx` | Top-level container. Handles loading/error/empty states, triggers reclassify |
| `ProjectMapView.tsx` | SVG canvas with all layers |
| `WorkstreamLine.tsx` | SVG path for one workstream |
| `StationNode.tsx` | SVG shape for one station |
| `CurrentStateLayer.tsx` | Resume point + blocker overlays |
| `ResumeViewLayer.tsx` | Change summary after inactivity |
| `MapHeader.tsx` | Title bar |
| `MapControls.tsx` | Toolbar (zoom, reclassify button, view toggles) |
| `MapLegend.tsx` | Color/shape legend |
| `MapTooltip.tsx` | Hover tooltips |
| `WorkstreamDetailPanel.tsx` | Side panel with workstream details |
| `StationDetailView.tsx` | Station detail popup |
| `ResolveToolbar.tsx` | Edit mode toolbar |
| `NLCommandBar.tsx` | Natural language command input |
| `layout.ts` | Lane assignment, station positioning |
| `visualEncoding.ts` | Color, shape, texture mappings |
| `animations.ts` | CSS/SVG animation utilities |

### Integration Points
| File | Role |
|------|------|
| `extension.ts` | Creates `WorkstreamManager`, registers `claudeMirror.openWorkstreamMap` command, injects into `TabManager` |
| `TabManager.ts` | Forwards `workstreamManager`, `sessionStore`, and `openTabSessionIdsGetter` to each new `SessionTab` |
| `SessionTab.ts` | Forwards all three to `MessageHandler` via setter methods |
| `MessageHandler.ts` | Handles all 8 webview message types, applies session scoping filter |
| `store.ts` (webview Zustand) | State slice for map UI state |
| `useClaudeStream.ts` | Dispatches extension-to-webview messages to Zustand store |
| `App.tsx` | Renders `WorkstreamMapView` when `workstreamMapOpen` is true |

---

## Command

`claudeMirror.openWorkstreamMap` -- Opens the active tab and toggles the workstream map view.

UI entry points:
- Map Controls toolbar "Reclassify" button (`MapControls.tsx`)
- "Build Map" button in empty state (`WorkstreamMapView.tsx`)
- "Retry" button in error state (`WorkstreamMapView.tsx`)

---

## User Edits

All manual changes (rename, status change, session reassignment) are stored as `UserEdit` entries in `ProjectMapState.userEdits[]`. The classification pipeline reads these edits and protects them from AI overwrite (`protectedFromAiOverwrite` flag). The NL editor requires confirmation when confidence is low (<0.75) or when operations affect multiple workstreams.

---

## Model Tier Strategy

| Task | Model | Method |
|------|-------|--------|
| Classification | claude-sonnet-4-6 | CLI `-p` via stdin, `--output-format json` |
| Station extraction | claude-sonnet-4-6 | Batched CLI calls via stdin |
| Current state synthesis | claude-sonnet-4-6 | CLI call via stdin |
| Resume summary | claude-sonnet-4-6 (fallback: local) | CLI call via stdin, `--output-format text` |
| Plan comparison | claude-sonnet-4-6 | CLI call via stdin |
| NL editing | Pattern match first, claude-sonnet-4-6 fallback | Local regex, then CLI |
| Importance scoring | Local heuristics | No LLM |

---

## Persistence

| Key Pattern | Content |
|-------------|---------|
| `workstreamMap.current.{projectId}` | Active map state (`ProjectMapState`) |
| `workstreamMap.archived.{projectId}` | Archived workstreams |
| `workstreamMap.snapshots.{projectId}` | SHA-256 snapshot history (max 20) |

- Storage: VS Code `workspaceState` (per-workspace)
- Schema version: `1` (with migration support)
- Auto-archive: completed workstreams after 90 days (never if blocked or pinned)
- Cap limits: 50 workstreams, 500 stations per project

---

## Known Issues and Historical Fixes

### Fixed: CLI result envelope not unwrapped (May 2026)
**Root cause**: `--output-format json` wraps CLI output in a result envelope (`{"type":"result","result":"```json\n{...}\n```"}`). The JSON extraction regex `/{[\s\S]*}/` matched the outer envelope (which has no `workstreams` field) instead of the inner model response. Classification always returned 0 workstreams.
**Fix**: All 6 workstream services now parse the CLI envelope first, extract the `result` field, then search for JSON within the unwrapped text.

### Fixed: Invalid CLI flag `-m` (May 2026)
**Root cause**: All workstream services used `-m sonnet` to select the model. The Claude CLI does not support `-m` (only `--model`), causing immediate exit code 1: `error: unknown option '-m'`.
**Fix**: Changed to `--model claude-sonnet-4-6` in all 6 services (WorkstreamClassifier, StationExtractor, CurrentStateSynthesizer, PlanRealityAnalyzer, WorkstreamNLEditor, ResumeStateBuilder).

### Fixed: "No JSON found in classification output" (May 2026)
**Root cause**: The classification prompt (30,000-50,000+ chars with many sessions) was passed as a `-p <prompt>` command-line argument. On Windows with `shell: true`, `cmd.exe` has an ~8,191 character limit, causing prompt truncation.
**Fix**: Changed all services to stdin piping (same pattern as `ClaudeCliCaller.ts`). Prompt is written to `proc.stdin` instead of passed as argument.

### Fixed: Classification analyzing entire workspace history (May 2026)
**Root cause**: All sessions from `ProjectAnalyticsStore` (up to 200) were sent to classification, regardless of relevance.
**Fix**: Session scoping filter -- only open-tab sessions + last-3-days sessions are classified.
