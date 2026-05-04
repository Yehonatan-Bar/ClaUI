# Workstream Map

Subway-map style visualization that groups sessions into logical workstreams -- coherent threads of work with a goal, status, and history. Surfaces project structure, progress, and recommended next actions.

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

## Classification Pipeline

Triggered by `WorkstreamManager.classifyProject()`:

1. **Enrich** -- `SessionBackfiller` adds file lists, git info, first prompt, task type to `SessionSummary`
2. **Pre-cluster** -- `WorkstreamClassifier.heuristicPreCluster()` groups by git branch, file overlap (Jaccard), temporal proximity
3. **Classify** -- Sonnet AI classifies clusters into workstreams (respects existing user edits)
4. **Extract stations** -- `StationExtractor` extracts 1-5 stations per session via Sonnet (batched)
5. **Synthesize** -- `CurrentStateSynthesizer` generates project + per-workstream current state
6. **Score** -- `WorkstreamImportanceScorer` computes importance/attention scores
7. **Save** -- `WorkstreamStore` persists to `workspaceState`, captures snapshot

Classification is debounced to 5 minutes minimum between full runs.

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

## Message Protocol

### Webview -> Extension
| Message | Purpose |
|---------|---------|
| `workstreamMapOpen` | Map panel opened |
| `workstreamMapRequestData` | Request current map state |
| `workstreamMapReclassify` | Trigger (re)classification |
| `workstreamMapApplyEdit` | Apply a structured user edit |
| `workstreamMapNaturalLanguageEdit` | Process NL editing command |
| `workstreamMapOpenSession` | Navigate to a session |
| `workstreamMapDismissResumeView` | Dismiss resume overlay |
| `workstreamMapSaveSnapshot` | Capture a snapshot |

### Extension -> Webview
| Message | Purpose |
|---------|---------|
| `workstreamMapData` | Full map state payload |
| `workstreamMapClassifying` | Progress updates during classification |
| `workstreamMapError` | Error message |
| `workstreamMapResumeState` | Resume state for returning users |
| `toggleWorkstreamMap` | Open/close the map panel |

## Key Files

### Extension Services (`src/extension/workstream/`)
- `WorkstreamManager.ts` -- Orchestrator, instantiates all services, runs pipeline
- `WorkstreamStore.ts` -- workspaceState persistence, schema migration, cap limits (50 workstreams, 500 stations)
- `WorkstreamSnapshotStore.ts` -- SHA-256 snapshot capture/diff (max 20)
- `WorkstreamClassifier.ts` -- Heuristic + Sonnet two-phase classification
- `StationExtractor.ts` -- Sonnet station extraction (1-5 per session, batched)
- `CurrentStateSynthesizer.ts` -- Project + workstream current state via Sonnet
- `ResumeStateBuilder.ts` -- Snapshot diff for returning users (24h threshold)
- `PlanRealityAnalyzer.ts` -- Plan candidate detection + step comparison
- `WorkstreamNLEditor.ts` -- Pattern matching + Sonnet fallback for NL edits
- `WorkstreamImportanceScorer.ts` -- Weighted composite scoring (recency, volume, blockers)
- `SessionBackfiller.ts` -- Enriches session summaries with file/git data
- `FileTracker.ts` -- Tracks file reads/writes from tool events

### Types (`src/extension/types/`)
- `workstreamTypes.ts` -- All enums, interfaces, constants

### Webview Components (`src/webview/components/WorkstreamMap/`)
- `WorkstreamMapView.tsx` -- Top-level container
- `ProjectMapView.tsx` -- SVG canvas with all layers
- `WorkstreamLine.tsx` / `StationNode.tsx` -- SVG primitives
- `CurrentStateLayer.tsx` / `ResumeViewLayer.tsx` -- Overlay layers
- `MapHeader.tsx` / `MapControls.tsx` / `MapLegend.tsx` / `MapTooltip.tsx` -- Chrome
- `WorkstreamDetailPanel.tsx` / `StationDetailView.tsx` -- Side panels
- `ResolveToolbar.tsx` / `NLCommandBar.tsx` -- Editing controls
- `layout.ts` / `visualEncoding.ts` / `animations.ts` -- Utilities

### Wiring
- `extension.ts` -- Creates `WorkstreamManager`, registers command, injects into `TabManager`
- `TabManager.ts` -- Forwards `workstreamManager` to each new `SessionTab`
- `SessionTab.ts` -- Forwards to `MessageHandler` via `setWorkstreamManager()`
- `MessageHandler.ts` -- Handles all 8 webview message types
- `store.ts` -- Zustand state slice for map UI state
- `useClaudeStream.ts` -- Dispatches extension-to-webview messages to store
- `App.tsx` -- Renders `WorkstreamMapView` when `workstreamMapOpen` is true

## Command

`claudeMirror.openWorkstreamMap` -- Opens the active tab and toggles the workstream map view.

## User Edits

All manual changes (rename, status change, session reassignment) are stored as `UserEdit` entries in `ProjectMapState.userEdits[]`. The classification pipeline reads these edits and protects them from AI overwrite. The NL editor requires confirmation when confidence is low (<0.75) or when operations affect multiple workstreams.

## Model Tier Strategy

| Task | Model |
|------|-------|
| Classification | Sonnet |
| Station extraction | Sonnet |
| Current state synthesis | Sonnet |
| Resume summary | Sonnet (fallback: local) |
| Plan comparison | Sonnet |
| NL editing | Pattern match first, Sonnet fallback |
| Importance scoring | Local heuristics |

## Persistence

- Map state: `workspaceState` key `workstreamMap.current.{projectId}`
- Archived: `workspaceState` key `workstreamMap.archived.{projectId}`
- Snapshots: `workspaceState` key `workstreamMap.snapshots.{projectId}`
- Schema version: `1` (with migration support)
- Auto-archive: completed workstreams after 90 days (never if blocked or pinned)
- Cap limits: 50 workstreams, 500 stations per project
