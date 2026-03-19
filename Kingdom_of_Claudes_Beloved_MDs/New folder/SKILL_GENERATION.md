# Auto Skill Generation

Automatically generates Claude skills from accumulated SR-PTD (post-task documentation) files. When the number of new/changed documents reaches a configurable threshold, a phase-orchestrated pipeline runs in an isolated workspace -- non-AI phases use Python subprocesses, AI phases use Claude Code CLI one-shot calls (no API key required). Generated skills are deduplicated against existing ones and installed atomically with backup and rollback.

## Key Files

### Extension Host (Node.js)

| File | Purpose |
|------|---------|
| `src/extension/skillgen/SkillGenStore.ts` | Document ledger persistence via `globalState` |
| `src/extension/skillgen/SkillGenService.ts` | Main orchestrator (scan, preflight, lock, pipeline, dedup, install) |
| `src/extension/skillgen/PhaseOrchestrator.ts` | Phase-by-phase pipeline execution (replaced PythonPipelineRunner) |
| `src/extension/skillgen/ClaudeCliCaller.ts` | Shared one-shot Claude CLI utility for AI phases |
| `src/extension/skillgen/phases/types.ts` | Shared types: PhaseId enum, PhaseResult, progress ranges |
| `src/extension/skillgen/phases/PythonPhaseRunner.ts` | Runs non-AI Python scripts (B, C.0-C.1, C.5, sanity) |
| `src/extension/skillgen/phases/PhaseC2TagEnrichment.ts` | AI tag enrichment via Claude CLI |
| `src/extension/skillgen/phases/PhaseC3IncrementalClustering.ts` | AI incremental clustering via Claude CLI |
| `src/extension/skillgen/phases/PhaseC4CrossBucketMerge.ts` | AI cross-bucket merging via Claude CLI |
| `src/extension/skillgen/phases/PhaseDSkillSynthesis.ts` | AI skill synthesis via Claude CLI (parallelized, max 3 concurrent) |
| `src/extension/skillgen/DeduplicationEngine.ts` | 3-tier deduplication engine |
| `src/extension/skillgen/SkillInstaller.ts` | Atomic skill installation with backup/rollback |
| `src/extension/skillgen/SkillUsageTracker.ts` | Tracks skill invocations in `~/.claude/skills/_usage.json` |
| `src/extension/skillgen/SrPtdBootstrap.ts` | Auto-install SR-PTD skill + inject CLAUDE.md instructions |

### Bundled Skill Files

| File | Purpose |
|------|---------|
| `sr-ptd-skill/SKILL.md` | Main skill instructions (949 lines) |
| `sr-ptd-skill/CLAUDE_MD_INSTRUCTIONS.md` | Template for CLAUDE.md injection |
| `sr-ptd-skill/assets/full-template.md` | Full SR-PTD template (Sections A-J) |
| `sr-ptd-skill/assets/quick-template.md` | Quick capture template |
| `sr-ptd-skill/references/example-completed.md` | Worked example |
| `sr-ptd-skill/assets/skills-pipeline-guide.html` | Visual guide: how docs become skills (opens in browser) |

### Webview (React)

| File | Purpose |
|------|---------|
| `src/webview/components/SkillGen/SkillGenPanel.tsx` | Full overlay panel UI |
| `src/webview/components/SkillGen/index.ts` | Barrel export |

### Shared

| File | Purpose |
|------|---------|
| `src/extension/types/webview-messages.ts` | Message contract (5 webview->ext, 4 ext->webview) |
| `src/webview/state/store.ts` | Zustand state (10 fields, 5 actions) |
| `src/webview/hooks/useClaudeStream.ts` | Message dispatch for skillGen events |

---

## Architecture

### Pipeline Phase Architecture

```
SkillGenService (unchanged orchestration: scan, preflight, lock, dedup, install)
  |
  v
PhaseOrchestrator (runs phases individually, supports resume)
  |
  +-- PythonPhaseRunner (non-AI phases: Python subprocess per phase)
  |     |-- Phase B: layer1_extractor.py
  |     |-- Phase C.0-C.1: phase_c_clustering.py
  |     |-- Phase C.5: phase_c5_representatives.py
  |     +-- Sanity: sanity_check.py
  |
  +-- ClaudeCliCaller (shared one-shot `claude -p --model` utility)
  |
  +-- AI Phase Handlers (TypeScript, use ClaudeCliCaller)
        |-- PhaseC2TagEnrichment.ts     (Sonnet, 30s/call, sequential)
        |-- PhaseC3IncrementalClustering.ts  (Sonnet, 30s/call, sequential per bucket)
        |-- PhaseC4CrossBucketMerge.ts       (Sonnet, 60s/call, one per rollup group)
        +-- PhaseDSkillSynthesis.ts          (Opus, 300s/call, 3 concurrent)
```

### Phase Execution Order

| Phase | Name | Type | Model | Description |
|-------|------|------|-------|-------------|
| B | Layer 1 Extraction | Python | N/A | Extracts structured data from SR-PTD markdown |
| C.0-C.1 | Doc Cards & Bucketing | Python | N/A | Creates doc cards and initial buckets |
| C.2 | AI Tag Enrichment | CLI | Sonnet | Enriches cards with missing domain/pattern tags |
| C.3 | Incremental Clustering | CLI | Sonnet | Sequential within-bucket clustering |
| C.4 | Cross-Bucket Merge | CLI | Sonnet | Groups clusters by domain rollup, AI merge decisions |
| C.5 | Representative Selection | Python | N/A | Selects representative docs per cluster |
| sanity | Sanity Check | Python | N/A | Validates pipeline output consistency |
| D | Skill Synthesis | CLI | Opus | Generates SKILL.md + supporting files (parallelized) |

### Progress Mapping

Each phase is allocated a progress range (0-100%):

| Phase | Start% | End% |
|-------|--------|------|
| B | 5 | 15 |
| C.0-C.1 | 15 | 25 |
| C.2 | 25 | 40 |
| C.3 | 40 | 55 |
| C.4 | 55 | 65 |
| C.5 | 65 | 70 |
| sanity | 70 | 72 |
| D | 72 | 95 |

### Data Flow

```
[SR-PTD docs on disk]
       |
       v  (file scan via glob)
[SkillGenStore]  -- fingerprint comparison (path + mtime + size) -->  pending count
       |
       v  (threshold reached OR manual trigger)
[SkillGenService]  -- preflight checks -->  lock acquisition -->  workspace setup
       |
       v
[PhaseOrchestrator]  -- runs 8 phases sequentially (resume via .pipeline_progress.json)
       |
       +-- Non-AI phases: PythonPhaseRunner (subprocess per phase)
       +-- AI phases: ClaudeCliCaller -> Claude Code CLI one-shot calls
       |
       v  (skills_out/ directory)
[DeduplicationEngine]  -- 3-tier comparison against existing skills
       |
       v  (filtered verdicts: new/upgrade/skip)
[SkillInstaller]  -- backup existing -->  copy new -->  rollback on failure
       |
       v
[webview notification via multi-tab broadcast]
```

### Multi-Tab Broadcast

SkillGenService is a singleton created in `extension.ts`. It uses a `registerTab(tabId, sender)` / `unregisterTab(tabId)` pattern to broadcast status/progress/complete messages to ALL open webview tabs simultaneously via a `Map<string, WebviewSender>`.

### Wiring

1. `extension.ts` creates `SkillGenService` with `globalState`, runs initial scan
2. `extension.ts` creates `SkillUsageTracker` with `~/.claude/skills` path, attaches to `SkillGenService`
3. `TabManager` passes `skillGenService` and `skillUsageTracker` to each `SessionTab`
4. `SessionTab` calls `skillGenService.registerTab()` after panel creation, wires `skillUsageTracker` to `MessageHandler`
5. `SessionTab` calls `skillGenService.unregisterTab()` on dispose
6. `MessageHandler` receives `skillUsageReport` messages from webview and calls `skillUsageTracker.recordUsage()`
7. Webview detects skill invocations in streaming output (`useClaudeStream.ts`) and posts `skillUsageReport`

---

## Components

### ClaudeCliCaller

Shared utility for making one-shot Claude CLI calls. Used by all AI phases to replace direct Anthropic SDK calls.

**Pattern:** Spawns `claude -p --model <model>`, pipes prompt to stdin, collects stdout. Based on the same pattern as `PromptEnhancer.ts`.

**Key behaviors:**
- Environment cleanup: deletes `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` to prevent nested-session detection
- Windows process tree kill: `taskkill /F /T /PID` for proper cleanup
- Configurable timeout per call
- `callJson<T>()` method: strips markdown code fences before JSON parsing
- Uses `claudeMirror.cliPath` setting for the CLI executable path

### PhaseOrchestrator

Replaces the former `PythonPipelineRunner`. Runs all 8 pipeline phases individually.

**Key behaviors:**
- Implements same interface as the old runner (`run()`, `cancel()`, progress callbacks)
- Dispatches non-AI phases to `PythonPhaseRunner`, AI phases to their TypeScript handlers
- Resume support: reads/writes `.pipeline_progress.json` (same format as Python)
- Cancel propagation: kills active Python subprocess or sets abort flag for AI phase loops
- Progress mapping: each phase gets a progress range within 0-100%

### PythonPhaseRunner

Runs individual non-AI Python scripts as subprocesses.

**Phase-to-script mapping:**
- B: `scripts/layer1_extractor.py` with `[srptd_raw_dir, -o, extractions_dir]`
- C.0-C.1: `scripts/phase_c_clustering.py` with `[--input-dir, extractions_dir, --output-dir, clusters_dir]`
- C.5: `scripts/phase_c5_representatives.py` (no args, uses SRPTD_PROJECT_ROOT env)
- sanity: `scripts/sanity_check.py` (no args, uses SRPTD_PROJECT_ROOT env)

**Environment:** Sets `PYTHONUNBUFFERED=1` and `SRPTD_PROJECT_ROOT=<workspaceDir>`.

### PhaseC2TagEnrichment

AI tag enrichment for doc cards with missing domain/pattern tags.

- Reads from `{clusters_dir}/doc_cards/*.json`
- Filters cards needing enrichment (missing/unknown domains or patterns)
- For each card: builds prompt with allowed vocabularies, calls ClaudeCliCaller
- Validates response against hardcoded domain/pattern vocabularies (~70 terms total)
- Writes enriched cards to `doc_cards_enriched/` and regenerated buckets to `buckets_enriched/`
- Writes `_enrichment_summary.json`

### PhaseC3IncrementalClustering

Incremental within-bucket clustering.

- Reads buckets from `buckets_enriched/`, doc cards from `doc_cards_enriched/`
- Filters buckets below `minDocsPerBucket` threshold (default 3) to prevent thin clusters
- For each bucket, processes docs sequentially (order matters -- clusters build incrementally)
- Two prompt variants: first-doc-in-bucket (create initial cluster) vs subsequent-doc (assign or create new)
- No singleton fallback on error (prevents junk clusters)
- Writes per-bucket cluster files to `clusters_incremental/`
- Writes `_incremental_clustering_summary.json`

### PhaseC4CrossBucketMerge

Cross-bucket merging using domain rollups.

- Filters clusters below `minDocsPerSkill` threshold (default 3)
- Groups clusters by domain rollup (hardcoded mapping: pdf-processing, data-analysis, frontend, etc.)
- One CLI call per rollup group (far fewer calls than C.2/C.3)
- AI decides: merge_all (one skill) or split -- hard cap at `maxSkillsPerRollup` (default 2)
- Forces merge_all when total docs < 10 or AI splits beyond max
- Writes to `clusters_final/`, `doc_to_cluster_map_final.json`, `_merge_summary.json`

### PhaseDSkillSynthesis

Skill synthesis from cluster representatives.

- Uses Opus model (heavy synthesis, up to 32K token output)
- 300s timeout per call
- Parallelized with concurrency limiter (max 3 concurrent CLI processes)
- Each cluster is independent -- no sequential dependency
- Enforces description max 120 chars with trigger-first format (prevents truncation in system-reminder)
- Patches SKILL.md frontmatter description to match enforced length
- Parses large JSON response, creates skill directory structure (SKILL.md, references/, scripts/, assets/, traceability.json)
- Writes `_phase_d_synthesis_summary.json`

### SkillGenStore

Persistent document ledger stored via VS Code `globalState` (key: `skillGen.ledger`).

**Key methods:**
- `updateFromScan(files)` - Compares disk files against stored fingerprints, marks new/changed as pending
- `getPendingDocPaths()` - Returns paths of documents with status `pending`
- `markAllProcessed()` - Sets all document statuses to `processed`
- `addRunHistory(entry)` - Appends a run record (capped at 20)

### SkillGenService

Central orchestrator. Coordinates the full pipeline: scan -> preflight -> lock -> pipeline -> dedup -> install.

**Key behaviors:**
- Preflight checks: verifies Python exists, toolkit path valid with scripts/ directory, docs directory exists
- No API key check needed (AI phases use Claude Code CLI which is authenticated via the user's Claude account)
- Default toolkit path: auto-resolves to `<docsDirectory>/used/skills_from_docs_toolkit` when `toolkitPath` setting is empty
- Cross-process locking via lock files (stale detection after 2 hours)
- Auto-run mode: triggers pipeline automatically when threshold reached
- Records run history with status, duration, skills generated count
- Post-install auto-archiving: enforces `maxSkills` cap (default 50) by moving least-used skills to `_archived/`
- 30-day grace period protects newly created skills from archiving

### DeduplicationEngine

3-tier comparison against existing skills to prevent duplicates.

**Tier 1 - Traceability:** Reads `traceability.json` from each existing skill directory, compares source document fingerprints and overlap ratio.

**Tier 2 - Metadata:** Compares skill names, descriptions, and keywords using trigram-based string similarity (Jaccard coefficient). Configurable upgrade threshold (default 0.45, previously 0.6) favors updating existing skills over creating new ones.

**Tier 3 - AI (placeholder):** Reserved for Claude Sonnet-based semantic comparison. Currently returns `null` (no verdict).

**Verdicts per skill:** `new`, `upgrade`, `skip`.

### SkillInstaller

Atomic installation with safety guarantees.

**Flow:**
1. Reads `skills_out/` directory from pipeline workspace
2. For each skill with `new` or `upgrade` verdict:
   - Backs up existing skill directory (if upgrading) to `backups/` in workspace
   - Copies new skill files to target directory
3. On any failure: rolls back all installed skills from backups
4. Returns count of installed and skipped skills

### SkillUsageTracker

Tracks skill invocations for usage-based archiving decisions.

- Maintains `~/.claude/skills/_usage.json` with per-skill use counts and timestamps
- `recordUsage(skillName)`: increments count, updates `last_used` timestamp
- `getLeastUsed(count, protectedSkills)`: returns N least-used skill names, excluding protected skills and `_`-prefixed directories
- Builds records for ALL installed skills (including 0-usage ones) to catch never-used skills
- Wired through: `extension.ts` -> `TabManager` -> `SessionTab` -> `MessageHandler` (via `setSkillUsageTracker`)
- Webview reports usage via `skillUsageReport` message when a skill invocation is detected in streaming output

---

## Logging

### Log Categories

| Category | Layer | Purpose | Default Level |
|----------|-------|---------|---------------|
| `[SkillGen:UI]` | Webview -> Extension bridge | Button clicks, panel open/close, toggle | INFO |
| `[SkillGen:Msg]` | MessageHandler | Message routing, acceptance/rejection | INFO |
| `[SkillGen:Scan]` | SkillGenService | Document scan lifecycle, threshold decisions | INFO |
| `[SkillGen:Preflight]` | SkillGenService | Python/toolkit/docs checks | INFO/ERROR |
| `[SkillGen:Lock]` | SkillGenService | Cross-process lock acquire/release/stale | INFO/WARNING |
| `[SkillGen:Pipeline]` | SkillGenService + PhaseOrchestrator | Phase execution, progress stages | INFO/ERROR |
| `[PhaseC2]` | PhaseC2TagEnrichment | Per-card enrichment progress | INFO |
| `[PhaseC3]` | PhaseC3IncrementalClustering | Per-bucket clustering progress | INFO |
| `[PhaseC4]` | PhaseC4CrossBucketMerge | Per-rollup merge decisions | INFO |
| `[PhaseD]` | PhaseDSkillSynthesis | Per-cluster synthesis progress | INFO |
| `[ClaudeCliCaller]` | ClaudeCliCaller | CLI spawn/exit, timeouts | INFO |
| `[PythonPhaseRunner]` | PythonPhaseRunner | Python subprocess spawn/exit | INFO |
| `[SkillGen:Dedup]` | DeduplicationEngine | Dedup verdict summary | INFO |
| `[SkillGen:Install]` | SkillInstaller | Install plan/result, rollback | INFO |
| `[SkillGen:Store]` | SkillGenStore | Ledger persistence, history | DEBUG |
| `[SkillGen:Archive]` | SkillGenService | Auto-archiving decisions and operations | INFO |
| `[SkillUsage]` | SkillUsageTracker / MessageHandler | Skill invocation recording | INFO |
| `[SkillGen:WebviewTx]` | SkillGenService | Tab register/unregister, broadcast | DEBUG |

### Log Format

`[SkillGen:<Category>][<LEVEL>] <event> | key=value key=value`

### Correlation IDs

- **runId**: 8-char hex ID generated at the start of each pipeline run
- **scanId**: 8-char hex ID generated at the start of each document scan

### Viewing Logs

Logs appear in the VS Code **Output** panel under **ClaUi** channel.

---

## Webview UI

### Status Bar Indicator

A button in the status bar showing `SkillDocs N/T` where N = pending docs, T = threshold. It is shown in Claude UI mode (hidden in Codex UI mode). CSS classes:
- `.threshold-reached` - Pulse animation when N >= T
- `.running` - Visual indicator during pipeline execution

An `!` info button (`.skillgen-info-btn`) appears next to SkillDocs in both expanded and collapsed status bar modes (Claude UI mode only). Clicking it opens the SkillGenPanel with the info section auto-expanded (via `skillGenShowInfo` store flag).

### Settings Gear Toggle

The Vitals settings panel includes a "Skill Generation" toggle for enabling/disabling SkillGen directly from the UI.

### SkillGenPanel

Full overlay panel:
- **Info button** (`!` in header) -- toggles collapsible explanation of how documentation becomes skills, with a "Open full visual guide" link that opens `sr-ptd-skill/assets/skills-pipeline-guide.html` in the browser via `openSkillGenGuide` message
- Enable/disable toggle
- Current status display with run status badge
- Progress bar with shimmer animation during pipeline runs
- **Editable threshold** -- clicking the "X / Y documents" label enters inline edit mode with a number input (range 5-100). Saves on Enter/blur, cancels on Escape. Sends `setSkillGenThreshold` message to update the VS Code setting.
- "Generate Now" button (disabled when running or below threshold)
- "Cancel" button (visible only during runs)
- Last run info (time, status, skills generated)
- History table showing all past runs

---

## Message Contract

### Webview -> Extension

| Type | Purpose |
|------|---------|
| `setSkillGenEnabled` | Toggle feature on/off |
| `setSkillGenThreshold` | Update threshold from inline editor (5-100) |
| `skillGenTrigger` | Manual pipeline trigger |
| `skillGenCancel` | Cancel running pipeline |
| `getSkillGenStatus` | Request current status snapshot |
| `skillGenUiLog` | UI interaction log (bridged to extension output channel) |
| `openSkillGenGuide` | Open the skills pipeline HTML guide in the browser |
| `skillUsageReport` | Report a skill invocation detected in streaming output |

### Extension -> Webview

| Type | Purpose |
|------|---------|
| `skillGenSettings` | Sync enabled/threshold settings |
| `skillGenStatus` | Full status snapshot (pending count, run status, history) |
| `skillGenProgress` | Pipeline progress update (percent, label) |
| `skillGenComplete` | Pipeline completion (success/failure, skills count) |

---

## Configuration

All settings under `claudeMirror.skillGen.*` in `package.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable the feature |
| `threshold` | `5` | Pending docs count to trigger generation |
| `docsDirectory` | `"C:\\projects\\Skills\\Dev_doc_for_skills"` | SR-PTD documents directory |
| `docsPattern` | `"SR-PTD_*.md"` | Glob pattern for document files |
| `skillsDirectory` | `"~/.claude/skills"` | Target directory for installed skills |
| `pythonPath` | `"python"` | Python executable path |
| `toolkitPath` | `""` (auto-resolves to `<docsDir>/used/skills_from_docs_toolkit`) | Skill generation toolkit path |
| `workspaceDir` | `""` | Isolated pipeline workspace |
| `pipelineMode` | `"run_pipeline"` | Legacy setting (ignored by PhaseOrchestrator) |
| `autoRun` | `true` | Auto-trigger on threshold |
| `timeoutMs` | `300000` | Pipeline timeout (5 min) |
| `aiDeduplication` | `false` | Enable AI dedup (Tier 3) |
| `maxSkills` | `50` | Maximum active skills; excess archived by usage |
| `minDocsPerBucket` | `3` | Min docs in bucket to qualify for clustering (C3) |
| `minDocsPerSkill` | `3` | Min docs for a cluster to become a skill (C4) |
| `maxSkillsPerRollup` | `2` | Max skills per domain rollup group (C4) |
| `dedupUpgradeThreshold` | `0.45` | Similarity threshold for upgrading vs creating new |

**Additional setting:**

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.srPtdAutoInject` | `true` | Auto-install SR-PTD skill and inject instructions into project CLAUDE.md |

---

## SR-PTD Bootstrap

On extension activation, `SrPtdBootstrap.ts` performs two automatic actions:

### 1. Skill Installation

Copies the bundled `sr-ptd-skill/` directory to `~/.claude/skills/sr-ptd-skill/`.

- Skips if target `SKILL.md` already exists with the same file size
- Overwrites if the bundled version has changed (size differs)

### 2. CLAUDE.md Injection

Appends SR-PTD documentation instructions to the project-level `CLAUDE.md`.

- Marker-based duplicate detection: checks for `MANDATORY: Post-Task Documentation (SR-PTD)`
- The docs save path uses the configured `claudeMirror.skillGen.docsDirectory` value
- Gated by `claudeMirror.srPtdAutoInject` setting (default: `true`)

---

# Merged from SKILL_VISUAL_INDICATOR.md

# Skill Usage Visual Indicator

Three-layer visual indicator system that highlights when Claude invokes the Skill tool. Uses magenta (`#e040fb`) as the accent color across all layers, consistent with the `'skill'` turn category.

## Layer 1: SkillBadge (Message Stream)

When a `tool_use` block targets the Skill tool, the block renders with a distinctive magenta-accented card instead of the default tool block style.

- **File**: `src/webview/components/ChatView/ToolUseBlock.tsx`
- **Detection**: `toolName === 'Skill' || toolName.endsWith('__Skill')` (handles both direct and MCP-prefixed tool names)
- **CSS class**: `.skill-tool` applied to `.tool-use-block`
- **Header**: Magenta left-gradient background (`linear-gradient(90deg, rgba(224, 64, 251, 0.08) 0%, transparent 60%)`) with a 3px magenta left border
- **Skill name chip**: `.skill-name-chip` -- rounded pill displaying the invoked skill name, magenta text on translucent magenta background with 1px border, `border-radius: 10px`, font-size 11px
- **Streaming label**: Shows "invoking..." while the tool call is still streaming
- **Name extraction**: `extractSkillName()` parses the `skill` field from either the resolved `input` object or the raw `partialInput` JSON string (regex fallback: `/"skill"\s*:\s*"([^"]+)"/ `)

## Layer 2: Skill Pills (Above Input Toolbar)

Animated magenta pills appear above the input toolbar (above the Clear, attachment, and brain buttons). Skills accumulate across the session -- each unique skill invoked gets its own pill that persists for the rest of the session.

- **File**: `src/webview/components/InputArea/InputArea.tsx`
- **Container**: `.skill-pills-row` -- flex row with wrap, gap 6px, padding 4px 8px
- **Pill class**: `.skill-pill` -- inline-flex pill with translucent magenta background, 1px magenta border, border-radius 12px, max-width 160px (truncates with ellipsis)
- **Glowing dot**: `.skill-pill-dot` -- 6px magenta circle with `box-shadow` glow, animated via `skill-dot-glow` keyframes (2s infinite ease-in-out, shadow pulses between 4px and 8px spread)
- **Border animation**: `skill-pill-pulse` keyframes (2s infinite, border-color oscillates between 35% and 70% opacity)
- **Content**: Each pill displays a skill name from `sessionSkills` array in Zustand store
- **Tooltip**: `data-tooltip="Skill: {name}"`
- **Lifecycle**:
  - **Appears**: When `toolUseStart` fires with `toolName === 'Skill'` or `toolName.endsWith('__Skill')`, a pending flag is set; once `toolUseInput` streams the skill name, `addSessionSkill(name)` adds it (deduped)
  - **Persists**: Pills remain visible for the entire session
  - **Disappears**: `sessionSkills` resets to `[]` on `endSession`, `clearStreaming`, and `reset` actions

## Layer 3: Turn Category Integration

The `'skill'` turn category integrates into the existing Session Vitals system.

- **Color**: `#e040fb` (magenta) -- defined in `CATEGORY_COLORS` (SessionTimeline, dashboardUtils) and `INTENSITY_COLORS` (MessageBubble)
- **Label**: `'Skill'` -- defined in `CATEGORY_LABELS` (SessionTimeline) and `catLabels` (MessageBubble)

### Where it appears:

| Component | Effect |
|-----------|--------|
| **Session Timeline** | Magenta-colored segments for turns that used the Skill tool |
| **Intensity Borders** | Magenta left border on assistant messages from skill turns (width varies: 2px/3px/4px by tool count) |
| **Dashboard Charts** | Magenta in category distribution charts |
| **Weather Algorithm** | `'skill'` is classified as a productive category (same weight as `code-write`, `research`, `command`, `success`) |

### Turn Categorization Priority

In both `categorizeTurn()` (extension-side, `MessageHandler.ts`) and `categorizeTurnFromToolNames()` (webview-side, `turnVitals.ts`):

```
error > discussion (no tools) > skill > code-write > command > research > success
```

Skill takes precedence over code-write, command, and research. If a turn uses both Skill and Write tools, it is categorized as `'skill'`.

## State Management

### Zustand Store (`store.ts`)

| Field | Type | Purpose |
|-------|------|---------|
| `sessionSkills` | `string[]` | Accumulated skill names invoked during the session |
| `addSessionSkill` | `(name: string) => void` | Adds a skill name (deduped -- skips if already present) |

Resets to `[]` in: `endSession`, `clearStreaming`, `reset`.

### Stream Hook (`useClaudeStream.ts`)

- `toolUseStart`: Detects Skill tool, sets `pendingSkillExtraction = true` (module-level flag)
- `toolUseInput`: When pending, extracts skill name from streaming partial JSON via `extractSkillNameFromPartial()`, then calls `addSessionSkill(name)` and clears the pending flag
- `extractSkillNameFromPartial()`: Tries `JSON.parse()` first, falls back to regex match on `"skill": "..."` pattern

## CSS Details

All styles in `src/webview/styles/global.css`.

### Classes

| Class | Purpose |
|-------|---------|
| `.tool-use-block.skill-tool` | Magenta left border + gradient background on skill tool blocks |
| `.tool-use-block.skill-tool .tool-use-header` | Light text color for header |
| `.skill-name-chip` | Rounded magenta pill showing the skill name in the tool block |
| `.skill-pills-row` | Flex container for accumulated skill pills above input toolbar |
| `.skill-pill` | Animated pill in the skill pills row |
| `.skill-pill-dot` | Glowing magenta dot inside each pill |

### Animations

| Keyframe | Duration | Effect |
|----------|----------|--------|
| `skill-pill-pulse` | 2s infinite | Border color oscillates (35% -> 70% -> 35% opacity) |
| `skill-dot-glow` | 2s infinite | Box-shadow spread pulses (4px -> 8px -> 4px) |

### RTL Support

`src/webview/styles/rtl.css` flips `.skill-name-chip` margin (left -> right) under `[dir="rtl"]`. The skill pills row uses flex with gap, which auto-reverses in RTL.

## Key Files

| File | Role |
|------|------|
| `src/extension/types/webview-messages.ts` | `'skill'` in `TurnCategory` union type |
| `src/extension/webview/MessageHandler.ts` | `categorizeTurn()` -- `'Skill'` tool detection, priority above code-write |
| `src/webview/state/store.ts` | `sessionSkills` array + `addSessionSkill` action + lifecycle resets |
| `src/webview/hooks/useClaudeStream.ts` | Skill detection in `toolUseStart`, name extraction from `toolUseInput`, `pendingSkillExtraction` flag |
| `src/webview/components/InputArea/InputArea.tsx` | Layer 2: skill pills row rendering above input toolbar |
| `src/webview/components/ChatView/ToolUseBlock.tsx` | Layer 1: SkillBadge rendering, `extractSkillName()`, `.skill-tool` class |
| `src/webview/components/ChatView/MessageBubble.tsx` | `'skill'` in `INTENSITY_COLORS` + `catLabels` |
| `src/webview/components/Vitals/SessionTimeline.tsx` | `'skill'` in `CATEGORY_COLORS` + `CATEGORY_LABELS` |
| `src/webview/utils/turnVitals.ts` | `'Skill'` detection in webview-side category function |
| `src/webview/components/Dashboard/dashboardUtils.ts` | `'skill'` in dashboard `CATEGORY_COLORS` |
| `src/webview/styles/global.css` | All skill indicator CSS |
| `src/webview/styles/rtl.css` | RTL margin override for `.skill-name-chip` |
