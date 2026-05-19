# Workstream Map Development Plan

## Purpose

Build a visual work management feature that turns scattered Claude sessions into a live, readable map of project workstreams.

The feature must not behave like a session list, task list, chat history, or analytics dashboard. Its purpose is to help the user understand the structure and current state of their work within seconds.

The map should answer these questions immediately:

* Where am I now?
* What workstreams exist in this project?
* Which workstream is active?
* Which workstream is blocked?
* Which workstream is finished?
* Which sessions belong together?
* Where did the work split into separate directions?
* Where did separate directions merge?
* Is the actual work following the plan?
* What changed since the user last opened the project?
* What is the most logical next action?

The core product metaphor is a subway map:

* A project is the origin area.
* Each workstream is a colored line.
* Each important event is a station.
* Splits show divergent work paths.
* Merges show converging work paths.
* The current state is visually emphasized.
* A plan, when present, is shown as a planned route overlaid against the actual route.

## Product Standard

This feature is successful only if it reduces cognitive load.

It is not enough to draw a visually attractive graph. The user must be able to open the map after days away from the project and understand the situation without rereading multiple sessions.

The first visual impression must communicate:

* Active work
* Blocked work
* Finished work
* Uncertain work
* Work that changed direction
* Work that deviated from the plan
* The recommended place to resume

## Product Principles

### The workstream is the primary object

A session is not the main unit of the map. A session is evidence.

The main object is the workstream: a coherent thread of work with a goal, status, history, current state, and relationship to other workstreams.

### The map should show meaning, not chronology only

Time matters, but semantic progress matters more.

Station spacing should represent meaningful stages in the work, not only exact timestamps. A short but important session may deserve a large station. A long session with repetitive debugging may be compressed into one or two meaningful stations.

### The map should hide noise by default

The map should not render every detail at the top level.

Default view should show the important structure first:

* Workstream lines
* Current state
* Important stations
* Blockers
* Recent changes
* Plan deviation
* Confidence warnings

Details should appear through zoom, focus, hover, side panel, or explicit expansion.

### The user is the source of truth

AI generated grouping is useful, but user correction must override it permanently.

If the user moves a session, merges lines, splits a workstream, renames a line, or marks a status, future classification must respect that edit unless the user explicitly asks to override manual edits.

### Confidence must be visible

The system must never present uncertain AI classification as fact.

Low confidence workstreams should be visually distinct and easy to resolve.

### Current State must be part of MVP

The map is not complete without a current state layer.

The user should not need to click a button to understand the current state. The default project map must visibly highlight:

* Most recently active workstream
* Last meaningful station per active workstream
* Open blockers
* Pending decisions
* Unfinished work
* Recommended resume point

### Resume View must be part of the first useful release

When the user returns to a project after inactivity, the map should show what changed since the last visit.

This is not a later intelligence feature. It is central to the product value.

## Non Goals

The first implementation should not attempt to become:

* A full project management system
* A replacement for Git history
* A replacement for issue trackers
* A graph of every file and function
* A visual replay of every conversation turn
* A generic mind mapping tool
* A beautiful but unreadable graph

## User Experience Overview

### Entry experience

When the user opens Workstream Map inside a project, the first view is the Project Map.

The Project Map shows all workstreams for the current project as subway lines. The map opens with the Current State layer enabled.

If the user has been away from the project for more than the configured threshold, the map opens with Resume View enabled.

Default threshold:

* 24 hours since last visit

### Primary views

The feature has six visual states:

* User Portfolio (cross-project overview)
* Project Map
* Workstream Focus
* Station Detail
* Plan Overlay
* Resolve Mode

User Portfolio is the top-level view showing all projects. It is built after the single-project experience is complete.

### Project Map

The Project Map shows all workstreams in the current project.

Each workstream is a line. Each important event is a station. The current state is shown directly on the map.

The user should be able to scan this view and understand:

* Which lines exist
* Which lines are active
* Which lines are blocked
* Which lines are done
* Which lines are uncertain
* Which line should be resumed
* Which lines have recent changes
* Which lines have plan deviations

### Workstream Focus

Clicking a line opens Workstream Focus.

In this view:

* The selected line becomes dominant.
* Other lines fade but remain visible for context.
* Station labels become visible.
* The side panel shows the workstream state.
* The user can inspect sessions, files, blockers, decisions, and plan progress.

### Station Detail

Clicking a station opens the Station Detail view.

This view shows:

* Station label
* Station type
* Status
* Why it matters
* Source session
* Relevant files
* Relevant turns or summary excerpts
* Related decisions
* Related blockers
* Next actions if applicable

The user can jump from a station back to the original session.

### Plan Overlay

If a plan exists, the map can show plan versus reality.

The planned route is a thin, muted line. The actual route is the main workstream line.

Where actual work follows the plan, the two paths align. Where the actual work deviates, the actual line visually leaves the plan path.

### Resolve Mode

Resolve Mode is for correcting the map.

The user can edit visually or with natural language.

Examples:

* Merge these two lines because they are both auth work.
* This session belongs to onboarding, not the bug fix.
* Split this line from this station into session cleanup.
* Hide inactive streams.
* Mark this line as completed.
* This station is not important. Hide it from the map.
* Reclassify this workstream as infrastructure.

### User Portfolio View

The User Portfolio is the top-level view that shows all projects the user has worked on across all VS Code workspaces.

#### Purpose

A developer works across multiple projects. When they sit down to code, the first question is often not "what was I doing in this project?" but "which project should I open?" The portfolio answers:

* Which projects have active work?
* Which project has blockers that need attention?
* Which project has stale work I should resume?
* What is the overall shape of my work across projects?
* Where should I pick up next?

#### Visual metaphor

Continuing the subway theme, the portfolio is the **transit system overview** showing all lines (projects) in the user's network. Each project is represented as a simplified card with miniature workstream lines, status indicators, and activity signals.

#### Data architecture

Workstream data is stored per-workspace in `workspaceState`, so cross-project data is not directly accessible from another workspace. The solution is a **publish model**:

* When a project classifies its workstreams, the `WorkstreamManager` publishes a `ProjectSummaryEntry` to `globalState`.
* Each project self-reports its status on every classification run.
* The portfolio view reads all `ProjectSummaryEntry` records from `globalState`.
* Stale projects naturally appear stale based on their `lastActivityAt`.
* `SessionStore` already uses `globalState` and stores `workspacePath` on each session, providing additional cross-project session counts.

This means the portfolio always shows the last-known state of each project, regardless of which workspace is currently open. Only the current workspace has live data; other projects show their last classification snapshot.

#### UI layout

```
+------------------------------------------------------+
|  Your Projects                      [Refresh]   [X]  |
|------------------------------------------------------|
|  > Resume: project-a > Fix auth middleware            |
|------------------------------------------------------|
|                                                       |
|  +--------------------------------------------------+|
|  | * claude-code-mirror     3 active  1 blocked      ||
|  |   --*--*--*--            Session Crash Fix        ||
|  |   --*--*--               Workstream Map Feature   ||
|  |   --*--                               2 days ago  ||
|  +--------------------------------------------------+|
|                                                       |
|  +--------------------------------------------------+|
|  | * food-safety-app        2 active  0 blocked      ||
|  |   --*--*--*--*--         PDF Pipeline Rewrite     ||
|  |   --*--                               5 days ago  ||
|  +--------------------------------------------------+|
|                                                       |
|  +--------------------------------------------------+|
|  | o milgam-dashboard       0 active  0 blocked      ||
|  |   --*--*--                           2 weeks ago  ||
|  +--------------------------------------------------+|
|                                                       |
+------------------------------------------------------+
```

Each project card shows:

* Project name derived from workspace folder name
* Activity indicator: filled dot for recent activity, outlined for stale
* Workstream count badges: active, blocked, completed
* Mini subway lines: simplified colored horizontal lines with station dots for the top workstreams (max 3)
* Top workstream labels
* Last activity timestamp as relative time
* Health glow: green border for healthy, yellow for needs attention, red for blocked, gray for stale

#### Navigation

Clicking a project card:

* If the project is the current workspace, it opens the Project Map with live data
* If the project is a different workspace, it shows the cached project map snapshot with a banner indicating the data may be stale, and offers an "Open Workspace" action

#### Cross-project resume recommendation

The portfolio header shows the single best cross-project recommendation:

* Computed by comparing all `ProjectSummaryEntry` records
* Factors: recency, active blockers resolved, stale active workstreams, importance scores
* Uses local heuristics only (no AI call) to determine which project and workstream to resume
* Example: "Resume: food-safety-app > PDF Pipeline Rewrite"

#### Portfolio entry point

* The map header shows a "All Projects" button when the portfolio has more than one project
* The Back button from Project Map returns to portfolio if the user entered from there
* A new command `claudeMirror.openWorkstreamPortfolio` opens the portfolio directly

## Visual System

### Workstream line meaning

A line represents one coherent thread of work.

Examples:

* Add onboarding flow
* Fix session refresh bug
* Rewrite auth middleware
* Research persistence options
* Refactor dashboard state
* Build initial application shell
* Investigate failing tests

### Station meaning

A station represents a meaningful event inside a workstream.

A station should not be created for every small action.

Good stations include:

* First session in the workstream
* Important decision
* Significant code change
* Bug discovered
* Failure encountered
* Test failure pattern identified
* Blocker created
* Blocker resolved
* Plan created
* Plan step completed
* Direction changed
* Milestone reached
* Workstream completed

### Station density rules

The map must remain readable.

Default extraction rules:

* Always create one station for the session start or session contribution.
* Extract a maximum of five stations per session.
* Collapse repetitive failures into one station when they represent the same problem.
* Collapse small edits into a code change station when they support the same goal.
* Promote only high importance events to labeled stations in Project Map.
* Show low importance stations only in Workstream Focus or Station Detail.

### Visual encodings

Line color represents workstream status.

* Blue: active
* Green: completed
* Red: blocked
* Yellow: uncertain
* Purple: research
* Gray: abandoned
* Light blue: planning

Line thickness represents activity volume.

* Thin line: low number of sessions or small scope
* Medium line: normal active work
* Thick line: high volume, many sessions, many touched files, or high effort

Line texture represents confidence and structure.

* Solid line: high confidence classification
* Dashed line: uncertain classification
* Soft blurred line: unstructured or weakly understood work
* Broken line: blocked, failed, or repeatedly interrupted work

Station shape represents station type.

* Circle: session
* Diamond: decision
* Square: code change
* Triangle: problem or risk
* Star: milestone
* X mark: failure
* Question mark: uncertainty
* Lock: blocker
* Curved arrow: direction change
* Junction: split or merge
* Outlined circle: plan step

Station size represents importance.

* Small: supporting detail
* Medium: meaningful event
* Large: important event that affects current understanding

Station glow represents recency or attention.

* Blue glow: recent activity
* Red glow: unresolved blocker or failure
* Yellow glow: unresolved uncertainty or pending decision
* Green glow: newly completed since last visit

### Current State visual layer

The Current State layer is enabled by default.

It adds the following visual emphasis:

* Resume point marker on the recommended workstream
* Enlarged last meaningful station on each active workstream
* Red attention marker on open blockers
* Yellow attention marker on pending decisions
* Small current state badge on each active line
* Summary chips near the map header

Header chips:

* Active count
* Blocked count
* Completed count
* Uncertain count
* Recommended resume line

### Resume View visual layer

Resume View appears automatically when the user returns after inactivity.

It highlights:

* New workstreams
* New stations
* Newly blocked work
* Newly completed work
* Resolved blockers
* Changed plan status
* Recommended resume point

Resume View should be dismissible but easy to reopen.

### Anti spaghetti rules

Maps with many workstreams can become unreadable. The implementation must include anti clutter behavior from the beginning.

Rules:

* Show a maximum of seven fully visible workstream lines by default.
* Collapse low importance inactive workstreams into an Inactive group.
* Collapse abandoned workstreams unless the user expands them.
* Hide low importance stations in Project Map.
* Use Workstream Focus for dense details.
* Use filters for status, type, recency, and confidence.
* Prioritize active, blocked, and recently changed lines above stale lines.
* Avoid crossing lines where possible.
* If crossings are unavoidable, make one line visually pass under another with reduced opacity at the crossing.

## Data Model

Create a new file:

```typescript
src/extension/types/workstreamTypes.ts
```

### Core enums

```typescript
export type WorkstreamType =
  | 'feature'
  | 'bug_fix'
  | 'research'
  | 'refactor'
  | 'infrastructure'
  | 'experiment'
  | 'abandoned_experiment'
  | 'uncategorized';

export type WorkstreamStatus =
  | 'active'
  | 'completed'
  | 'blocked'
  | 'uncertain'
  | 'research'
  | 'abandoned'
  | 'planning';

export type StationType =
  | 'session'
  | 'decision'
  | 'code_change'
  | 'problem'
  | 'milestone'
  | 'failure'
  | 'uncertainty'
  | 'blocker'
  | 'direction_change'
  | 'merge_point'
  | 'split_point'
  | 'plan_step';

export type StationStatus =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'pending'
  | 'skipped';

export type LineTexture =
  | 'solid'
  | 'dashed'
  | 'blurred'
  | 'broken';

export type ModelTier =
  | 'sonnet'
  | 'haiku'
  | 'local_heuristic';
```

### Workstream

```typescript
export interface Workstream {
  id: string;
  projectId: string;

  label: string;
  goal: string;
  type: WorkstreamType;
  status: WorkstreamStatus;

  sessionIds: string[];
  relatedWorkstreamIds: string[];
  parentWorkstreamId?: string;
  childWorkstreamIds: string[];
  mergedIntoWorkstreamId?: string;

  confidence: number;
  confidenceReasons: string[];
  autoGenerated: boolean;
  userPinned: boolean;

  importanceScore: number;
  attentionScore: number;

  currentState: WorkstreamCurrentState;

  startedAt: string;
  lastActivityAt: string;
  completedAt?: string;
  lastViewedAt?: string;

  planId?: string;
  planReality?: PlanReality;

  metrics: WorkstreamMetrics;

  visual: WorkstreamVisualState;

  order: number;
}
```

### Workstream current state

```typescript
export interface WorkstreamCurrentState {
  phase:
    | 'not_started'
    | 'planning'
    | 'implementation'
    | 'debugging'
    | 'testing'
    | 'review'
    | 'blocked'
    | 'complete'
    | 'abandoned'
    | 'unknown';

  summary: string;
  lastMeaningfulProgress: string;
  nextLikelyAction: string;
  openQuestions: string[];
  blockers: WorkstreamBlocker[];
  pendingDecisions: PendingDecision[];
  evidenceSessionIds: string[];
  evidenceStationIds: string[];
  generatedBy: ModelTier;
  generatedAt: string;
}
```

### Metrics and visual state

```typescript
export interface WorkstreamMetrics {
  totalSessions: number;
  totalTurns: number;
  totalCostUsd: number;
  filesModified: string[];
  filesRead: string[];
  failureCount: number;
  blockerCount: number;
  decisionCount: number;
}

export interface WorkstreamVisualState {
  colorToken: string;
  texture: LineTexture;
  thickness: number;
  opacity: number;
  collapsed: boolean;
  highlighted: boolean;
  needsAttention: boolean;
  resumeRecommended: boolean;
}
```

### Station

```typescript
export interface Station {
  id: string;
  projectId: string;
  workstreamId: string;

  type: StationType;
  status: StationStatus;

  label: string;
  description: string;
  whyItMatters: string;

  sessionId?: string;
  turnIndex?: number;
  sourceFilePaths?: string[];

  order: number;
  timestamp: string;

  importanceScore: number;
  attentionScore: number;
  visibleInProjectMap: boolean;

  splitToWorkstreamIds?: string[];
  mergedFromWorkstreamIds?: string[];

  confidence: number;
  evidence: StationEvidence[];

  visual: StationVisualState;
}

export interface StationEvidence {
  kind: 'session_summary' | 'tool_use' | 'file_change' | 'test_result' | 'user_message' | 'assistant_message';
  sessionId: string;
  turnIndex?: number;
  text?: string;
  filePath?: string;
}

export interface StationVisualState {
  size: 'small' | 'medium' | 'large';
  glow: 'none' | 'recent' | 'attention' | 'resolved' | 'uncertain';
  labelVisible: boolean;
}
```

### Plan reality model

```typescript
export interface PlanReality {
  planId: string;
  planLabel: string;
  planSource: PlanSource;
  steps: PlanStep[];
  overallStatus: 'on_track' | 'deviated' | 'blocked' | 'completed' | 'unknown';
  deviationSummary: string;
  lastComparedAt: string;
  generatedBy: ModelTier;
}

export interface PlanSource {
  kind: 'session' | 'markdown_file' | 'html_plan' | 'user_created';
  sessionId?: string;
  filePath?: string;
}

export interface PlanStep {
  id: string;
  label: string;
  description?: string;
  order: number;
  status: StationStatus;
  linkedStationIds: string[];
  deviationNote?: string;
  confidence: number;
}
```

### Split and merge

```typescript
export interface Split {
  id: string;
  projectId: string;
  fromWorkstreamId: string;
  toWorkstreamIds: string[];
  stationId: string;
  reason: string;
  confidence: number;
  timestamp: string;
}

export interface Merge {
  id: string;
  projectId: string;
  fromWorkstreamIds: string[];
  toWorkstreamId: string;
  stationId: string;
  reason: string;
  confidence: number;
  timestamp: string;
}
```

### User edits

```typescript
export interface UserEdit {
  id: string;
  projectId: string;
  type:
    | 'move_session'
    | 'merge_workstreams'
    | 'split_workstream'
    | 'rename_workstream'
    | 'reclassify_workstream'
    | 'hide_station'
    | 'add_milestone'
    | 'mark_complete'
    | 'mark_abandoned'
    | 'change_status'
    | 'pin_workstream'
    | 'unpin_workstream';

  timestamp: string;
  actor: 'user' | 'ai_assisted_user';
  details: Record<string, unknown>;
  protectedFromAiOverwrite: boolean;
}
```

### Project map state

```typescript
export interface ProjectMapState {
  projectId: string;
  projectLabel: string;
  workspacePath: string;

  workstreams: Workstream[];
  stations: Station[];
  splits: Split[];
  merges: Merge[];

  currentState: ProjectCurrentState;
  resumeState?: ResumeState;

  lastClassifiedAt: string;
  lastOpenedAt?: string;
  lastViewedSnapshotId?: string;

  userEdits: UserEdit[];
  archivedWorkstreamIds: string[];

  modelRunLog: ModelRunLogEntry[];
}

export interface ProjectCurrentState {
  summary: string;
  activeWorkstreamIds: string[];
  blockedWorkstreamIds: string[];
  completedWorkstreamIds: string[];
  uncertainWorkstreamIds: string[];
  recommendedResumeWorkstreamId?: string;
  recommendedResumeStationId?: string;
  recommendedNextAction?: string;
  openQuestions: string[];
  blockers: WorkstreamBlocker[];
  generatedAt: string;
  generatedBy: ModelTier;
}

export interface ResumeState {
  since: string;
  newWorkstreamIds: string[];
  changedWorkstreamIds: string[];
  newStationIds: string[];
  resolvedBlockerIds: string[];
  newBlockerIds: string[];
  newlyCompletedWorkstreamIds: string[];
  summary: string;
  recommendedResumeWorkstreamId?: string;
}
```

### User portfolio state

```typescript
export interface UserPortfolioState {
  projects: ProjectSummaryEntry[];
  crossProjectResume: CrossProjectResumeRecommendation | null;
  lastUpdatedAt: string;
}

export interface ProjectSummaryEntry {
  projectId: string;
  projectPath: string;
  projectName: string;

  lastActivityAt: string;
  lastClassifiedAt: string;
  lastOpenedAt: string;

  activeWorkstreams: number;
  blockedWorkstreams: number;
  completedWorkstreams: number;
  uncertainWorkstreams: number;
  totalWorkstreams: number;

  topWorkstreams: ProjectWorkstreamSummary[];

  overallHealth: 'healthy' | 'needs_attention' | 'blocked' | 'stale';
  healthReasons: string[];

  totalSessions: number;
  recentSessions: number;

  currentStateSummary: string;
  recommendedNextAction: string;
  openBlockerCount: number;

  cachedMapState?: ProjectMapState;
}

export interface ProjectWorkstreamSummary {
  id: string;
  label: string;
  status: WorkstreamStatus;
  confidence: number;
  lastActivityAt: string;
  phase: string;
  colorToken: string;
  stationCount: number;
}

export interface CrossProjectResumeRecommendation {
  projectId: string;
  projectName: string;
  workstreamId: string;
  workstreamLabel: string;
  reason: string;
  confidence: number;
}
```

### Supporting types

```typescript
export interface WorkstreamBlocker {
  id: string;
  label: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  stationId?: string;
  sessionId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface PendingDecision {
  id: string;
  label: string;
  options?: string[];
  stationId?: string;
  sessionId?: string;
  createdAt: string;
}

export interface ModelRunLogEntry {
  id: string;
  modelTier: ModelTier;
  task:
    | 'workstream_classification'
    | 'station_extraction'
    | 'current_state_synthesis'
    | 'plan_reality_comparison'
    | 'semantic_edit'
    | 'resume_diff';
  startedAt: string;
  completedAt?: string;
  inputHash: string;
  outputHash?: string;
  costUsd?: number;
  error?: string;
}
```

## AI Model Strategy

### Required model roles

Sonnet must be used for semantic understanding tasks that affect the structure of the map.

Use Sonnet for:

* Workstream classification
* Station extraction
* Split detection
* Merge detection
* Plan detection
* Plan versus reality comparison
* Current State synthesis
* Resume View diff synthesis
* Natural language edits that change workstream structure
* Reclassification after user feedback

Use Haiku only for lightweight operations that do not decide project structure.

Haiku may be used for:

* Simple filter parsing
* Simple command parsing after object references are already explicit
* Short UI copy generation
* Toast confirmation text
* Local explanation of already computed state

Use local heuristics for:

* Git branch grouping
* File overlap scoring
* Temporal proximity scoring
* Exact session lookup
* Sort order
* Layout hints
* Storage cleanup

### Why Sonnet is required for semantic edits

Natural language edits often change the meaning of the map.

Examples:

* Merge these two lines because they are both auth work.
* Split from this station into a new infrastructure stream.
* This session is not part of the bug. It belongs to onboarding.
* Show me where reality deviated from the original plan.

These are not simple UI commands. They are semantic corrections to the project model. Therefore, Sonnet must be used unless the command maps to an obvious explicit operation.

### AI pipeline overview

The AI pipeline has six stages:

* Data enrichment
* Heuristic pre clustering
* Sonnet workstream classification
* Sonnet station extraction
* Sonnet current state synthesis
* Sonnet plan and resume analysis

The webview does not ask the model to draw UI. The model creates structured JSON. The React and SVG layer renders that JSON consistently.

## Extension Architecture

### Main services

Create this directory:

```typescript
src/extension/workstream/
```

Services:

```typescript
WorkstreamManager.ts
WorkstreamStore.ts
WorkstreamClassifier.ts
StationExtractor.ts
CurrentStateSynthesizer.ts
ResumeStateBuilder.ts
PlanRealityAnalyzer.ts
WorkstreamNLEditor.ts
FileTracker.ts
SessionBackfiller.ts
WorkstreamImportanceScorer.ts
WorkstreamSnapshotStore.ts
UserPortfolioStore.ts
UserPortfolioManager.ts
```

### UserPortfolioStore

Persistence layer for cross-project data.

Storage:

* Use `globalState` (not workspaceState) so data is shared across all workspaces.
* Key: `workstreamMap.portfolio`
* Maximum projects: 30
* Auto-remove projects not classified in the last 180 days.
* Write queue to avoid race conditions.

### UserPortfolioManager

Orchestrator for the portfolio view.

Responsibilities:

* Build `UserPortfolioState` from stored `ProjectSummaryEntry` records.
* Compute cross-project resume recommendation using local heuristics.
* Publish project summary after each classification run.
* Compute project health from workstream counts and recency.
* Enrich with session counts from `SessionStore` (which already has `workspacePath`).

Public methods:

```typescript
class UserPortfolioManager {
  getPortfolioState(): Promise<UserPortfolioState>;
  publishProjectSummary(projectId: string, mapState: ProjectMapState): Promise<void>;
  computeCrossProjectResume(): CrossProjectResumeRecommendation | null;
  removeProject(projectId: string): Promise<void>;
}
```

Integration hook:

After `WorkstreamManager.classifyProject()` saves the classified state, call `UserPortfolioManager.publishProjectSummary()` to update the global portfolio entry. This happens automatically on every classification, keeping the portfolio fresh.

Health computation rules:

* `healthy`: all workstreams are active or completed, no blockers, activity within 7 days
* `needs_attention`: has uncertain workstreams or low confidence, or activity between 7 and 21 days ago
* `blocked`: has one or more blocked workstreams
* `stale`: no activity in 21 or more days

Cross-project resume algorithm:

1. Filter to projects with activity in the last 30 days
2. Prioritize projects with blocked workstreams whose blockers were recently resolved
3. Then prioritize projects with active workstreams and recent activity
4. Within a project, use the project's own `recommendedResumeWorkstreamId`
5. Tie-break by last activity timestamp

### WorkstreamManager

The orchestrator.

Responsibilities:

* Load project sessions
* Trigger data enrichment
* Trigger classification
* Trigger station extraction
* Trigger current state synthesis
* Trigger resume state generation
* Persist ProjectMapState
* Send map data to webview
* Apply user edits
* Respect manual overrides
* Expose commands to open and refresh the map

Public methods:

```typescript
class WorkstreamManager {
  openMap(): Promise<void>;
  getProjectMapState(projectId: string): Promise<ProjectMapState>;
  classifyProject(projectId: string, options: ClassificationOptions): Promise<ProjectMapState>;
  classifyNewSession(sessionId: string): Promise<void>;
  applyUserEdit(edit: UserEdit): Promise<ProjectMapState>;
  applyNaturalLanguageEdit(text: string, context: MapInteractionContext): Promise<ProjectMapState>;
  buildResumeState(projectId: string): Promise<ResumeState | undefined>;
}
```

### WorkstreamStore

Persistence layer.

Storage:

* Use workspaceState for current project map state.
* Use a project scoped key.
* Store archived workstreams separately.
* Store snapshots for Resume View.

Suggested keys:

```typescript
workstreamMap.current.${projectId}
workstreamMap.snapshots.${projectId}
workstreamMap.archived.${projectId}
```

Requirements:

* Write queue to avoid race conditions.
* Schema versioning.
* Migration path for future model changes.
* Maximum active workstreams per project: 50.
* Maximum active stations per project: 500.
* Archive completed workstreams after 90 days if not pinned.
* Never archive blocked workstreams automatically.
* Never archive user pinned workstreams.

### FileTracker

Captures file level signals from tool events.

Capture paths from:

* Read
* Write
* Edit
* MultiEdit
* Glob
* Grep
* Bash commands that clearly reference project files when safe to parse

Capture git context:

* Current branch
* Current commit hash when available
* Dirty status when available

Store this on SessionSummary.

### SessionBackfiller

Backfills old sessions.

Responsibilities:

* Read existing JSONL sessions.
* Extract first user prompt.
* Extract file paths from historical tool uses.
* Extract rough task type when available.
* Populate missing SessionSummary fields.
* Avoid expensive full model calls during backfill unless the user explicitly requests reclassification.

## Data Enrichment

Extend SessionSummary with:

```typescript
interface SessionSummary {
  filesModified?: string[];
  filesRead?: string[];
  gitBranch?: string;
  gitCommit?: string;
  firstPrompt?: string;
  summary?: string;
  taskType?: string;
  outcome?: 'completed' | 'failed' | 'partial' | 'unknown';
  startedAt?: string;
  endedAt?: string;
  totalTurns?: number;
  totalCostUsd?: number;
}
```

Data enrichment must happen before classification.

Without file, branch, prompt, summary, and outcome signals, classification quality will be too low.

## Workstream Classification

### Classification triggers

Run incremental classification:

* At session end
* When a previously missing summary becomes available
* When file tracking data is backfilled

Run full classification:

* First time the map opens
* User clicks Reclassify
* User asks a natural language command requiring broad reinterpretation
* Major schema upgrade

Debounce rule:

* Do not run full classification more than once every five minutes unless explicitly requested by the user.

### Classification inputs

For each session:

```typescript
{
  id: string;
  firstPrompt: string;
  summary: string;
  filesModified: string[];
  filesRead: string[];
  gitBranch?: string;
  taskType?: string;
  outcome?: string;
  startedAt: string;
  endedAt?: string;
  totalTurns?: number;
  totalCostUsd?: number;
}
```

Also provide:

* Existing workstreams
* User edits
* Existing splits and merges
* Existing plan associations
* Existing current state

### Heuristic pre clustering

Before calling Sonnet, create candidate clusters.

Signals:

* Same git branch
* High file overlap
* Same files modified repeatedly
* Similar first prompt terms
* Similar summaries
* Temporal proximity
* Repeated bug language
* Explicit continuation language
* Same task type

Output:

```typescript
interface CandidateCluster {
  id: string;
  sessionIds: string[];
  labelHint?: string;
  reasons: string[];
  confidence: number;
}
```

### Sonnet classification prompt

Use Sonnet for final classification.

Prompt requirements:

* Group sessions into coherent workstreams.
* Prefer fewer meaningful workstreams over many tiny ones.
* Do not merge unrelated work just because it happened nearby in time.
* Do not split one coherent bug investigation into many lines unless the goal actually diverged.
* Respect all protected user edits.
* Return confidence and reasons.
* Identify possible splits and merges.
* Identify stale or abandoned work.
* Identify current phase.
* Identify next likely action.

Expected JSON:

```typescript
interface ClassificationOutput {
  workstreams: Array<{
    id?: string;
    label: string;
    goal: string;
    type: WorkstreamType;
    status: WorkstreamStatus;
    sessionIds: string[];
    confidence: number;
    confidenceReasons: string[];
    importanceScore: number;
    currentState: Partial<WorkstreamCurrentState>;
  }>;
  splits: Array<{
    fromSessionId: string;
    reason: string;
    childLabels: string[];
    confidence: number;
  }>;
  merges: Array<{
    workstreamLabels: string[];
    reason: string;
    confidence: number;
  }>;
  projectCurrentState: Partial<ProjectCurrentState>;
}
```

### Classification quality rules

The classifier should optimize for user comprehension, not perfect taxonomy.

Quality rules:

* A workstream should have a clear goal.
* A workstream label should be human readable.
* A workstream should not be named after a file unless the file is truly the product concept.
* A workstream should not contain unrelated sessions.
* Low confidence classifications must remain editable and visually uncertain.
* Sessions that do not clearly belong anywhere should go into Uncertain Work, not random lines.

## Station Extraction

### Extraction goal

Stations should communicate meaningful progress.

Use Sonnet to extract important events from each session.

Input:

* Session summary
* First prompt
* Task outcome
* Important turns if available
* Tool use metadata
* Files modified
* Existing workstream goal

Output:

```typescript
interface StationExtractionOutput {
  stations: Array<{
    type: StationType;
    label: string;
    description: string;
    whyItMatters: string;
    status: StationStatus;
    importanceScore: number;
    attentionScore: number;
    evidence: StationEvidence[];
    confidence: number;
  }>;
}
```

Rules:

* Extract between 1 and 5 stations per session.
* Prefer fewer stations when the session is repetitive.
* Always include failures that affect the current state.
* Always include blockers.
* Always include decisions that shape implementation.
* Always include meaningful plan changes.
* Mark low confidence stations as uncertain.

## Current State Synthesis

### Purpose

Current State is the most important product layer.

It turns the map from a history visualization into a practical work recovery tool.

### Implementation

Create:

```typescript
src/extension/workstream/CurrentStateSynthesizer.ts
```

Use Sonnet.

Inputs:

* Workstreams
* Stations
* Recent sessions
* Blockers
* Plan reality data
* Last visited timestamp
* User edits

Outputs:

* ProjectCurrentState
* WorkstreamCurrentState for each active workstream
* Recommended resume workstream
* Recommended resume station
* Recommended next action

Prompt requirements:

* Be concise.
* Prefer concrete state over generic summaries.
* Identify blockers and pending decisions.
* Identify what is done versus what still needs verification.
* Recommend the next action based on evidence, not generic advice.
* Include evidence ids.

## Resume State

### Purpose

Resume View helps the user re enter a project quickly.

It answers:

* What changed since I last opened this project?
* What should I look at first?
* Did anything become blocked?
* Did anything finish?
* Did the plan change?

### Implementation

Create:

```typescript
src/extension/workstream/ResumeStateBuilder.ts
```

Resume state should be built from snapshots.

Store a snapshot when:

* The user opens the map
* The user closes the map
* A classification run completes
* A significant edit is applied

Snapshot type:

```typescript
interface WorkstreamMapSnapshot {
  id: string;
  projectId: string;
  createdAt: string;
  workstreamHashes: Record<string, string>;
  stationHashes: Record<string, string>;
  currentStateHash: string;
}
```

If the user returns after more than 24 hours, compare the current state to the last viewed snapshot.

Use local diff first. Use Sonnet to synthesize a concise Resume View summary if changes are non trivial.

## Plan Overlay

### Plan detection

Plans can come from:

* Planning sessions
* Markdown plan files
* HTML plan output
* Checklists
* User created plan objects
* Explicit model generated plans

Detect plan candidates using heuristics first.

Then use Sonnet to decide whether the plan is actually relevant to a workstream.

### Plan step extraction

Use Sonnet to extract ordered plan steps.

Each step should include:

* Label
* Description
* Expected outcome
* Status
* Linked actual stations
* Deviation note
* Confidence

### Plan versus reality comparison

The PlanRealityAnalyzer compares:

* Planned steps
* Actual stations
* Missing steps
* Extra work
* Failed steps
* Reordered steps
* Deviations
* Current plan status

Visual representation:

* Planned route: thin muted line
* Actual route: main line
* Aligned segments: on track
* Divergent segments: deviation
* Failed plan steps: red marker
* Pending plan steps: gray marker
* Partial plan steps: yellow marker
* Completed plan steps: green marker

## Webview Architecture

Create directory:

```typescript
src/webview/components/WorkstreamMap/
```

Components:

```typescript
WorkstreamMapView.tsx
UserPortfolioView.tsx
ProjectCard.tsx
ProjectMapView.tsx
WorkstreamFocusView.tsx
StationDetailView.tsx
WorkstreamLine.tsx
StationNode.tsx
SplitJunction.tsx
MergeJunction.tsx
PlanOverlayLine.tsx
CurrentStateLayer.tsx
ResumeViewLayer.tsx
AttentionBadges.tsx
MapHeader.tsx
MapControls.tsx
MapLegend.tsx
MapTooltip.tsx
WorkstreamDetailPanel.tsx
ResolveToolbar.tsx
NLCommandBar.tsx
ConfidenceReviewPanel.tsx
layout.ts
visualEncoding.ts
animations.ts
```

### UserPortfolioView

The top-level cross-project view.

Renders a scrollable list of `ProjectCard` components sorted by last activity.

Shows a cross-project resume recommendation banner at the top when available.

Shows project health summary: total projects, active projects, projects with blockers.

Entry animation: cards fade-slide in staggered from top to bottom.

### ProjectCard

Displays one project summary.

Content:

* Project name with activity indicator dot (filled if recent, outlined if stale)
* Workstream count badges: active (blue), blocked (red), completed (green)
* Mini subway lines: up to 3 simplified horizontal colored lines with station dots
* Top workstream labels (max 2, one line each)
* Last activity timestamp as relative time
* Health indicator: colored left border (green, yellow, red, or gray)

Interaction:

* Hover: slight lift with shadow
* Click: navigates to that project's Project Map
* If the project is not the current workspace, show a small external-link icon

### Webview state

Add to the Zustand store:

```typescript
interface WorkstreamMapSlice {
  workstreamMapOpen: boolean;
  workstreamMapZoom: 'portfolio' | 'project' | 'workstream' | 'station_detail';
  workstreamMapData: ProjectMapState | null;
  userPortfolioData: UserPortfolioState | null;
  focusedWorkstreamId: string | null;
  selectedStationId: string | null;
  currentStateLayerEnabled: boolean;
  resumeViewEnabled: boolean;
  planOverlayEnabled: boolean;
  resolveModeEnabled: boolean;
  filters: WorkstreamMapFilter;
  hoveredEntityId: string | null;
}
```

Filter type:

```typescript
interface WorkstreamMapFilter {
  statuses: WorkstreamStatus[];
  types: WorkstreamType[];
  showInactive: boolean;
  showLowConfidence: boolean;
  showLowImportanceStations: boolean;
  changedSince?: string;
  textQuery?: string;
}
```

### Message protocol

Add extension to webview messages:

```typescript
{ type: 'workstreamMapData'; data: ProjectMapState }
{ type: 'workstreamMapClassifying'; progress: number; phase: string }
{ type: 'workstreamMapError'; message: string }
{ type: 'workstreamMapResumeState'; resumeState: ResumeState }
{ type: 'workstreamPortfolioData'; data: UserPortfolioState }
```

Add webview to extension messages:

```typescript
{ type: 'workstreamMapOpen' }
{ type: 'workstreamMapRequestData' }
{ type: 'workstreamMapReclassify'; force?: boolean }
{ type: 'workstreamMapApplyEdit'; edit: UserEdit }
{ type: 'workstreamMapNaturalLanguageEdit'; text: string; context: MapInteractionContext }
{ type: 'workstreamMapOpenSession'; sessionId: string }
{ type: 'workstreamMapDismissResumeView' }
{ type: 'workstreamMapSaveSnapshot' }
{ type: 'workstreamPortfolioRequestData' }
{ type: 'workstreamPortfolioOpenProject'; projectPath: string }
```

## Layout Algorithm

### Initial implementation

Use a deterministic lane based layout first.

Do not start with a complex force layout.

The first production layout should be predictable, stable, and easy to debug.

Algorithm:

* Sort workstreams by priority.
* Priority order: blocked, active, uncertain, research, planning, completed, abandoned.
* Within each status, sort by last activity and importance.
* Assign each workstream to a horizontal lane.
* Time and semantic order flow from left to right.
* Important stations receive more spacing.
* Low importance stations may be compressed.
* Splits route downward from parent lane.
* Merges route upward or inward to target lane.
* Avoid crossings using lane reassignment when possible.

### Stability requirement

The layout must not jump around unnecessarily after each classification.

If the same workstreams remain, preserve lane assignments.

Only change layout when:

* New high priority workstream appears
* Workstream status changes significantly
* User manually reorders lines
* User requests re layout

### Layout output

```typescript
interface MapLayout {
  workstreamPaths: Record<string, SvgPathDefinition>;
  stationPositions: Record<string, { x: number; y: number }>;
  labelPositions: Record<string, { x: number; y: number }>;
  junctionPositions: Record<string, { x: number; y: number }>;
  bounds: { width: number; height: number };
}
```

## Interaction Model

### Hover

Hovering a line:

* Highlight full workstream.
* Show label, goal, status, confidence, and current phase.

Hovering a station:

* Show label, status, timestamp, why it matters, and source session.

### Click

Clicking a line:

* Opens Workstream Focus.

Clicking a station:

* Opens Station Detail.

Clicking a blocker badge:

* Filters to blocker related stations.

Clicking Resume marker:

* Opens the recommended resume workstream.

### Keyboard

Required keyboard behavior:

* Escape exits current focus level.
* Enter opens the selected entity.
* Arrow keys move between nearby stations.
* Ctrl plus Z undo in Resolve Mode.
* Ctrl plus Y redo in Resolve Mode.

### Accessibility

SVG elements must have meaningful accessibility labels.

Examples:

* Workstream: Auth middleware rewrite, blocked, high confidence, four sessions.
* Station: Tests failing after session refresh change, unresolved failure.

## Resolve Mode

### Visual editing

Resolve Mode must support:

* Move session to another workstream
* Rename workstream
* Change status
* Change type
* Mark complete
* Mark abandoned
* Hide station from Project Map
* Add milestone
* Split workstream from station
* Merge workstreams
* Pin workstream
* Unpin workstream

### Natural language editing

Create:

```typescript
src/extension/workstream/WorkstreamNLEditor.ts
```

Natural language edit classification:

* Explicit simple commands can use Haiku or local parsing.
* Structural semantic commands must use Sonnet.

Simple command examples:

* Hide inactive streams.
* Mark selected line as complete.
* Show only blockers.

Semantic command examples:

* These two lines are the same auth effort.
* This debugging session belongs to the onboarding bug, not auth.
* Split everything after this failed test into a new reliability stream.
* The plan changed here. Treat the new implementation as the real path.

NLEditor output:

```typescript
interface NLEditResult {
  edits: UserEdit[];
  explanation: string;
  requiresConfirmation: boolean;
  confidence: number;
}
```

Require confirmation when:

* Confidence is below 0.75.
* More than one workstream will be changed.
* More than three sessions will be moved.
* A merge or split is requested by ambiguous language.
* The edit would override an earlier user protected edit.

### Undo and redo

All edits must be reversible.

Persisted user edits remain the long term source of truth, but the current UI should maintain an in memory undo stack during the session.

## Implementation Phases

### Phase 0: Product Slice Definition

Goal: define the first useful user experience before building all infrastructure.

Deliverables:

* Product acceptance scenarios
* Visual hierarchy rules
* MVP scope locked
* Current State requirements locked
* Resume View requirements locked
* Manual edit override rules locked

Exit criteria:

* A developer can describe what the user sees in the first five seconds.
* The team agrees that Current State is MVP, not later polish.

Estimated effort:

* 1 day

### Phase 1: Data Enrichment Foundation

Goal: capture enough session data to classify workstreams accurately.

Tasks:

* Extend SessionSummary.
* Add FileTracker.
* Capture file paths from tool use.
* Capture git branch and commit when possible.
* Ensure summaries are stored consistently.
* Implement SessionBackfiller.
* Add tests for path extraction.

Exit criteria:

* New sessions include first prompt, summary, files read, files modified, branch, timestamps, outcome, and task type when available.
* Historical sessions can be backfilled without model calls.

Estimated effort:

* 3 to 4 days

### Phase 2: Store and Schema

Goal: persist workstream map state safely.

Tasks:

* Create workstreamTypes.ts.
* Create WorkstreamStore.
* Add schema versioning.
* Add migration shell.
* Add snapshot storage.
* Add write queue.
* Add archive behavior.

Exit criteria:

* ProjectMapState can be saved, loaded, migrated, snapshotted, and archived.
* User edits persist and are protected from AI overwrite.

Estimated effort:

* 2 to 3 days

### Phase 3: Sonnet Classification Engine

Goal: group sessions into meaningful workstreams.

Tasks:

* Implement heuristic pre clustering.
* Implement Sonnet classification call.
* Respect protected user edits.
* Generate confidence reasons.
* Generate current state draft per workstream.
* Detect likely splits and merges.
* Add unit tests with mock sessions.

Exit criteria:

* Given 20 sample sessions, the classifier creates 3 to 6 coherent workstreams.
* Low confidence sessions are not forced into random lines.
* Manual assignments are never overridden.

Estimated effort:

* 5 to 7 days

### Phase 4: Station Extraction and Importance Scoring

Goal: convert sessions into meaningful visual stations.

Tasks:

* Implement StationExtractor with Sonnet.
* Implement WorkstreamImportanceScorer.
* Score station importance and attention.
* Collapse repetitive low value events.
* Mark visibleInProjectMap based on importance.
* Add sample based tests.

Exit criteria:

* Each session produces 1 to 5 stations.
* Project Map remains readable with 20 sessions.
* Failures, blockers, milestones, and decisions are preserved.

Estimated effort:

* 4 to 5 days

### Phase 5: Current State and Resume State

Goal: make the map useful for immediate orientation.

Tasks:

* Implement CurrentStateSynthesizer with Sonnet.
* Implement ResumeStateBuilder.
* Store and compare snapshots.
* Generate recommended resume point.
* Generate project level summary chips.
* Generate workstream level current states.

Exit criteria:

* The map can answer where am I now without opening any session.
* Returning after 24 hours shows meaningful changes.
* Recommended next action is evidence based.

Estimated effort:

* 4 to 5 days

### Phase 6: Core SVG Map

Goal: render the Project Map.

Tasks:

* Add webview state slice.
* Add message protocol.
* Create WorkstreamMapView.
* Create ProjectMapView.
* Create WorkstreamLine.
* Create StationNode.
* Create CurrentStateLayer.
* Create ResumeViewLayer.
* Create MapHeader and summary chips.
* Implement deterministic layout.
* Implement visual encoding.

Exit criteria:

* User can open the map and see readable workstream lines.
* Current State layer is visible by default.
* Resume View appears after inactivity.
* Map opens within 3 seconds using existing stored state.

Estimated effort:

* 8 to 10 days

### Phase 7: Focus and Detail Views

Goal: allow the user to inspect the map without losing context.

Tasks:

* Implement WorkstreamFocusView.
* Implement StationDetailView.
* Implement WorkstreamDetailPanel.
* Add hover tooltips.
* Add click navigation.
* Add session jump action.
* Add keyboard navigation.

Exit criteria:

* User can understand a workstream in detail.
* User can jump from station to source session.
* Focused view keeps surrounding context visible.

Estimated effort:

* 5 to 6 days

### Phase 8: Plan Overlay

Goal: show plan versus reality.

Tasks:

* Implement plan detection.
* Implement plan step extraction with Sonnet.
* Implement PlanRealityAnalyzer.
* Implement PlanOverlayLine.
* Add deviation markers.
* Add plan status to Current State.

Exit criteria:

* If a plan exists, user can see whether actual work follows it.
* Deviations are visible without reading text.
* Plan status contributes to recommended next action.

Estimated effort:

* 4 to 5 days

### Phase 9: Resolve Mode

Goal: let the user correct the map quickly.

Tasks:

* Implement ResolveToolbar.
* Implement visual edits.
* Implement UserEdit application.
* Implement NLEditor.
* Use Sonnet for semantic edits.
* Use confirmation flow for risky edits.
* Implement undo and redo.

Exit criteria:

* User can fix incorrect classification in seconds.
* User edits persist.
* AI never overwrites protected user edits.
* Semantic edits are handled by Sonnet.

Estimated effort:

* 6 to 8 days

### Phase 10: User Portfolio View (Cross-Project)

Goal: add a top-level cross-project view so the user can see all their projects at a glance and decide where to resume.

#### Phase 10a: Portfolio Data Foundation

Tasks:

* Define `UserPortfolioState`, `ProjectSummaryEntry`, `ProjectWorkstreamSummary`, and `CrossProjectResumeRecommendation` types in `workstreamTypes.ts`.
* Create `UserPortfolioStore.ts` using `context.globalState` with key `workstreamMap.portfolio`.
* Add write queue, max 30 projects, auto-prune projects not classified in 180 days.
* Create `UserPortfolioManager.ts` with methods: `getPortfolioState()`, `publishProjectSummary()`, `computeCrossProjectResume()`, `removeProject()`.
* Hook `publishProjectSummary()` into `WorkstreamManager.classifyProject()` so every classification automatically updates the portfolio.
* Extract project name from workspace folder path (last segment).
* Compute project health from workstream status counts and recency.
* Implement cross-project resume recommendation algorithm using local heuristics.
* Enrich session counts from `SessionStore` (uses `globalState`, has `workspacePath` field).

Exit criteria:

* After classifying workstreams in two different workspaces, `UserPortfolioStore` contains two `ProjectSummaryEntry` records accessible from either workspace.
* Cross-project resume recommendation identifies the most logical project and workstream to resume.
* Portfolio data survives VS Code restarts.

Estimated effort:

* 3 to 4 days

#### Phase 10b: Portfolio Webview

Tasks:

* Add `'portfolio'` to the zoom level type: `'portfolio' | 'project' | 'workstream' | 'station_detail'`.
* Add `userPortfolioData: UserPortfolioState | null` to the Zustand store.
* Add `workstreamPortfolioData` and `workstreamPortfolioRequestData` to the message protocol.
* Add `workstreamPortfolioOpenProject` message for navigating to a project.
* Create `UserPortfolioView.tsx`: scrollable list of project cards with cross-project resume banner.
* Create `ProjectCard.tsx`: project name, activity indicator, workstream count badges, mini subway lines (max 3 colored lines with dots), top workstream labels, relative timestamp, health border.
* Add "All Projects" button to `MapHeader.tsx` when portfolio has more than one project.
* Add Back navigation from Project Map to Portfolio when entered from portfolio.
* Handle navigation to non-current workspace projects: show cached map state with stale-data banner and "Open Workspace" action.
* Apply glassmorphism and entrance animations consistent with the rest of the map.

Exit criteria:

* User can see all previously classified projects in a clean card layout.
* Clicking a current-workspace project opens its live Project Map.
* Clicking a different-workspace project shows its cached state with a stale-data notice.
* Cross-project resume recommendation is visible and clickable.
* Portfolio opens within 1 second (data is pre-cached in globalState).

Estimated effort:

* 5 to 7 days

#### Phase 10c: Portfolio Intelligence

Tasks:

* Add `claudeMirror.openWorkstreamPortfolio` command to `package.json`.
* Auto-open portfolio instead of project map when the user opens the map for the first time and multiple projects exist.
* Show portfolio health summary: total projects, active projects, projects with blockers.
* Add project card hover tooltip with current state summary and recommended next action.
* Add relative time badges that update live (e.g., "2 days ago", "just now").
* Add empty state for portfolio with "Classify your first project" prompt.
* Handle edge case: project folder was moved or deleted (show grayed out card with "Project not found" status).

Exit criteria:

* Portfolio provides a complete cross-project overview within 2 seconds of scanning.
* The user can answer "which project should I work on?" from the portfolio view.
* Empty, single-project, and multi-project states are all handled gracefully.

Estimated effort:

* 2 to 3 days

Total Phase 10 effort: 10 to 14 days

## Recommended Build Order

Build in this order:

* Phase 0: Product Slice Definition
* Phase 1: Data Enrichment Foundation
* Phase 2: Store and Schema
* Phase 3: Sonnet Classification Engine
* Phase 4: Station Extraction and Importance Scoring
* Phase 5: Current State and Resume State
* Phase 6: Core SVG Map
* Phase 7: Focus and Detail Views
* Phase 8: Plan Overlay
* Phase 9: Resolve Mode
* Phase 10a: Portfolio Data Foundation
* Phase 10b: Portfolio Webview
* Phase 10c: Portfolio Intelligence

Reasoning:

* The map cannot be useful without accurate data.
* The visualization cannot be useful without Current State.
* Resolve Mode is valuable after classification and visualization exist.
* The portfolio view should not delay the single project experience.
* Phase 10a can begin as soon as Phase 5 is complete since it only touches extension code.
* Phase 10b depends on Phase 6 for visual conventions and component patterns.
* Phase 10c adds polish after the portfolio is functional.

Total estimated effort:

* 48 to 67 developer days

## Integration Points

Existing integration targets:

* SessionTab.wireProcessEvents
* StreamDemux tool use events
* SessionSummarizer
* ProjectAnalyticsStore.saveSummary
* useClaudeStream
* Dashboard
* StatusBar
* TabManager
* commands.ts
* package.json

New commands:

```json
{
  "command": "claudeMirror.openWorkstreamMap",
  "title": "Open Workstream Map"
},
{
  "command": "claudeMirror.openWorkstreamPortfolio",
  "title": "Open Workstream Portfolio"
}
```

Dashboard integration:

* Add Workstream Map tab.
* Add Map button in relevant project or session context.
* Allow opening map focused on current session.

Session integration:

* From a session, user can click Show in Workstream Map.
* The map opens focused on the workstream and station associated with that session.

## Performance Requirements

### Opening the map

The map should open within 3 seconds using cached ProjectMapState.

If classification is stale, show cached state first, then update asynchronously inside the active UI session.

### Rendering

SVG rendering should handle:

* 50 workstreams maximum active
* 500 stations maximum active
* Default Project Map rendering should show far fewer visible station labels

Optimization rules:

* Render only visible station labels.
* Collapse inactive workstreams.
* Use memoized layout.
* Preserve layout across refreshes.
* Avoid re rendering full SVG on hover when possible.

### AI cost controls

Rules:

* Incremental classification on session end.
* Full classification only on first map open, user request, or major state change.
* Cap station extraction calls per full run.
* Batch sessions when possible.
* Cache model outputs by input hash.
* Do not rerun Sonnet if enriched session data did not change.

## Risk Management

### Risk: AI groups sessions incorrectly

Mitigation:

* Confidence score visible.
* Confidence reasons visible in Resolve Mode.
* Low confidence lines are dashed.
* User edits are protected.
* Resolve Mode makes correction fast.

### Risk: The map becomes visually overwhelming

Mitigation:

* Current State layer controls attention.
* Low importance stations hidden by default.
* Inactive workstreams collapsed.
* Project Map shows structure, not all details.
* Workstream Focus handles detail.

### Risk: The product becomes an analytics dashboard

Mitigation:

* Design around orientation questions.
* Keep metrics secondary.
* Do not lead with token cost or session counts.
* Lead with current state, blockers, and resume point.

### Risk: Layout instability annoys users

Mitigation:

* Preserve lane assignment.
* Re layout only when needed.
* Allow user pinned order.
* Avoid force layout for MVP.

### Risk: Sonnet cost is too high

Mitigation:

* Heuristic pre clustering.
* Input hashing.
* Incremental updates.
* Capped extraction.
* Haiku only for safe lightweight tasks.

### Risk: Portfolio data becomes stale or misleading

Mitigation:

* Each project self-publishes on every classification run. No manual sync required.
* Show relative timestamps on every project card so staleness is immediately visible.
* Gray out projects with no activity in 21 or more days.
* Show "Last classified X days ago" on non-current workspace projects.
* Never show stale portfolio data as current fact. Always indicate data age.
* Auto-prune projects not classified in 180 days.

### Risk: Natural language edits damage the map

Mitigation:

* Use Sonnet for semantic edits.
* Require confirmation for risky edits.
* Maintain undo and redo.
* Store all edits as reversible operations.

## Testing Strategy

### Unit tests

Test:

* Type serialization
* Store migration
* File path extraction
* Git branch capture
* Heuristic clustering
* Importance scoring
* Snapshot diff
* Layout stability
* User edit application

### AI output contract tests

Use mocked model responses.

Test:

* WorkstreamClassifier parses valid JSON.
* Invalid JSON is handled safely.
* Missing confidence defaults to low confidence.
* User protected assignments are preserved.
* StationExtractor caps station count.
* CurrentStateSynthesizer includes evidence ids.
* NLEditor requests confirmation for risky operations.

### Visual tests

Test:

* WorkstreamLine rendering
* StationNode shapes
* CurrentStateLayer markers
* ResumeViewLayer highlights
* PlanOverlayLine deviations
* Collapsed inactive streams
* Low confidence dashed lines

### Manual acceptance tests

Use real or fixture sessions.

Scenarios:

* Feature development across multiple sessions
* Bug investigation with failed tests
* Plan created, then implementation deviates
* Two workstreams merge
* One workstream splits into two
* User moves a misclassified session
* User returns after 24 hours
* User asks a natural language edit

## Product Acceptance Scenarios

### Scenario: Return after several days

Given a project with several active workstreams, when the user opens the map after several days, the map should show:

* What changed since last visit
* Which workstream is most relevant to resume
* Any new blockers
* Any newly completed work
* The last meaningful station on active lines

Pass condition:

* The user can identify where to continue within 2 seconds of scanning.

### Scenario: Bug investigation

Given several sessions about a recurring bug, the map should group them into one bug fix workstream unless there is a genuine split.

The line should show:

* Initial bug discovery
* Failed hypotheses
* Relevant code changes
* Failed tests
* Identified blocker
* Final fix or current blocked state

Pass condition:

* The user can understand the debugging story without opening every session.

### Scenario: Plan versus reality

Given a plan session followed by implementation sessions, the map should show:

* Planned route
* Actual route
* Completed plan steps
* Skipped steps
* Failed steps
* Deviations

Pass condition:

* The user can see whether the project is still following the plan.

### Scenario: AI makes a classification mistake

Given a session placed in the wrong workstream, the user should be able to move it visually or through natural language.

Pass condition:

* The correction persists across reclassification.

### Scenario: Cross-project orientation

Given a developer who works on three projects, when they open the portfolio view, it should show:

* All three projects as cards with clear health indicators
* Which project has blockers or needs attention
* Which project and workstream to resume
* Last activity time for each project
* Mini subway lines showing the shape of each project's workstreams

Pass condition:

* The user can decide which project to work on within 3 seconds of scanning the portfolio.
* Clicking a project navigates to its Project Map.

### Scenario: Large project

Given a project with many sessions, the Project Map should remain readable.

Pass condition:

* No more than seven full lines dominate the default view.
* Inactive and low importance details are collapsed.
* Blockers and resume point remain visible.

## Success Metrics

The feature is successful when:

* The user can open a coherent map within 3 seconds.
* The user can answer where am I within 2 seconds.
* AI classification accuracy is above 80 percent measured by user corrections.
* No more than 2 manual edits are needed per 10 classified sessions.
* Low confidence work is clearly marked.
* Current State identifies the correct resume point in most real projects.
* Returning users understand what changed without rereading sessions.
* The map remains readable with 20 to 50 sessions.
* User edits survive reclassification.
* Added memory stays below 50 MB in typical use.

## MVP Definition

The MVP must include:

* Single project Project Map
* Workstream classification using Sonnet
* Station extraction using Sonnet
* Current State layer
* Resume View after inactivity
* Deterministic SVG subway layout
* Workstream Focus
* Station Detail
* Basic Resolve Mode
* Protected user edits
* Cached state for fast opening

The MVP may exclude:

* User Portfolio View (cross-project overview, Phase 10)
* Advanced drag gestures
* Complex force layout
* Real time per turn classification
* Deep Git history visualization
* Full issue tracker integration

The User Portfolio View is planned for the release immediately following MVP. Its data foundation (publishing project summaries to globalState) should be added during Phase 5 to start collecting cross-project data early, even if the UI is built later.

## Developer Checklist

Before implementation is considered complete, verify:

* Workstream is the primary object, not session.
* Current State appears by default.
* Resume View appears after inactivity.
* Sonnet is used for semantic structure decisions.
* Haiku is not used for major workstream edits.
* User edits are protected from AI overwrite.
* Low confidence is visible.
* Map hides noise by default.
* Station density is capped.
* Plan Overlay compares planned versus actual work.
* The layout is stable across refreshes.
* The user can jump from map to source session.
* The user can correct the map quickly.
* The feature answers where am I, what is blocked, and what changed.
* Portfolio publishes project summaries to globalState on every classification.
* Portfolio shows all projects with health indicators and cross-project resume.
* Portfolio data age is always visible to prevent stale-data confusion.

## Final Product Definition

The Workstream Map is a live visual model of project work.

It transforms raw sessions into structured workstreams, highlights the current state, shows progress and blockers, reveals splits and merges, compares plan against reality, and helps the user resume work without rereading session history.

The correct mental model is not a dashboard.

The correct mental model is a cognitive map of the project.

At the user level, the Portfolio extends this mental model across all projects: it is a cognitive map of the developer's entire work landscape, answering not just "where am I in this project?" but "which project should I open right now?"
