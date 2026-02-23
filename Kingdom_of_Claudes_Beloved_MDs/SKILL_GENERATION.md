# Auto Skill Generation

Automatically generates Claude skills from accumulated SR-PTD (post-task documentation) files. When the number of new/changed documents reaches a configurable threshold, a Python skill-generation pipeline runs in an isolated workspace, deduplicates against existing skills, and installs new/upgraded skills atomically with backup and rollback.

## Key Files

### Extension Host (Node.js)

| File | Purpose |
|------|---------|
| `src/extension/skillgen/SkillGenStore.ts` | Document ledger persistence via `globalState` |
| `src/extension/skillgen/SkillGenService.ts` | Main orchestrator (scan, preflight, lock, pipeline, dedup, install) |
| `src/extension/skillgen/PythonPipelineRunner.ts` | Python subprocess execution with progress monitoring |
| `src/extension/skillgen/DeduplicationEngine.ts` | 3-tier deduplication engine |
| `src/extension/skillgen/SkillInstaller.ts` | Atomic skill installation with backup/rollback |
| `src/extension/skillgen/SrPtdBootstrap.ts` | Auto-install SR-PTD skill + inject CLAUDE.md instructions |

### Bundled Skill Files

| File | Purpose |
|------|---------|
| `sr-ptd-skill/SKILL.md` | Main skill instructions (949 lines) |
| `sr-ptd-skill/CLAUDE_MD_INSTRUCTIONS.md` | Template for CLAUDE.md injection |
| `sr-ptd-skill/assets/full-template.md` | Full SR-PTD template (Sections A-J) |
| `sr-ptd-skill/assets/quick-template.md` | Quick capture template |
| `sr-ptd-skill/references/example-completed.md` | Worked example |

### Webview (React)

| File | Purpose |
|------|---------|
| `src/webview/components/SkillGen/SkillGenPanel.tsx` | Full overlay panel UI |
| `src/webview/components/SkillGen/index.ts` | Barrel export |

### Shared

| File | Purpose |
|------|---------|
| `src/extension/types/webview-messages.ts` | Message contract (4 webview->ext, 4 ext->webview) |
| `src/webview/state/store.ts` | Zustand state (9 fields, 4 actions) |
| `src/webview/hooks/useClaudeStream.ts` | Message dispatch for skillGen events |

---

## Architecture

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
[PythonPipelineRunner]  -- subprocess with progress stdout parsing
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
2. `TabManager` passes `skillGenService` to each `SessionTab`
3. `SessionTab` calls `skillGenService.registerTab()` after panel creation
4. `SessionTab` calls `skillGenService.unregisterTab()` on dispose
5. `MessageHandler` receives webview messages and delegates to `skillGenService`

---

## Components

### SkillGenStore

Persistent document ledger stored via VS Code `globalState` (key: `skillGen.ledger`).

**Ledger structure:**
```typescript
interface SkillGenLedger {
  documents: Record<string, DocumentFingerprint>;
  runHistory: SkillGenRunHistoryEntry[];
  lastRunAt?: string;
}

interface DocumentFingerprint {
  relativePath: string;
  size: number;
  mtimeMs: number;
  status: 'pending' | 'processed';
}
```

**Key methods:**
- `updateFromScan(files)` - Compares disk files against stored fingerprints, marks new/changed as pending
- `getPendingDocPaths()` - Returns paths of documents with status `pending`
- `markAllProcessed()` - Sets all document statuses to `processed`
- `addRunHistory(entry)` - Appends a run record (capped at 20)

### SkillGenService

Central orchestrator. Coordinates the full pipeline: scan -> preflight -> lock -> pipeline -> dedup -> install.

**Key behaviors:**
- Preflight checks: verifies Python exists, toolkit path valid, pipeline script exists at resolved path, docs directory exists
- Default toolkit path: auto-resolves to `<docsDirectory>/used/skills_from_docs_toolkit` when `toolkitPath` setting is empty
- Cross-process locking via lock files (stale detection after 2 hours)
- Auto-run mode: triggers pipeline automatically when threshold reached
- Notification mode: just broadcasts status, user triggers manually
- Records run history with status, duration, skills generated count

**Run statuses:** `idle` | `scanning` | `preflight` | `running` | `deduplicating` | `installing` | `succeeded` | `failed`

### PythonPipelineRunner

Spawns a Python child process to run the skill generation toolkit.

**Pipeline modes:**
- `run_pipeline` - Full pipeline via toolkit script
- `python_api` - Python API call
- `create_skills` - Direct skill creation

**Progress monitoring:** Parses stdout lines matching `[PROGRESS] <percent> <label>` format. Broadcasts progress to webview via `skillGenProgress` messages.

**Platform handling:** On Windows, uses `taskkill /F /T /PID` to kill the entire process tree (same pattern as `ClaudeProcessManager`).

### DeduplicationEngine

3-tier comparison against existing skills to prevent duplicates.

**Tier 1 - Traceability:** Reads `traceability.json` from each existing skill directory, compares source document fingerprints and overlap ratio.

**Tier 2 - Metadata:** Compares skill names, descriptions, and keywords using trigram-based string similarity (Jaccard coefficient). Flags skills with >0.7 similarity as potential upgrades.

**Tier 3 - AI (placeholder):** Reserved for Claude Sonnet-based semantic comparison. Currently returns `null` (no verdict), falling through to Tier 2 results.

**Verdicts per skill:**
- `new` - No existing skill matches, install fresh
- `upgrade` - Matches an existing skill with improvements, overwrite
- `skip` - Duplicate of existing skill, do not install

### SkillInstaller

Atomic installation with safety guarantees.

**Flow:**
1. Reads `skills_out/` directory from pipeline workspace
2. For each skill with `new` or `upgrade` verdict:
   - Backs up existing skill directory (if upgrading) to `backups/` in workspace
   - Copies new skill files to target directory
3. On any failure: rolls back all installed skills from backups
4. Returns count of installed and skipped skills

---

## Logging

Comprehensive categorized logging covers the full SkillGen flow from UI button click through pipeline completion.

### Log Categories

| Category | Layer | Purpose | Default Level |
|----------|-------|---------|---------------|
| `[SkillGen:UI]` | Webview -> Extension bridge | Button clicks, panel open/close, toggle | INFO |
| `[SkillGen:Msg]` | MessageHandler | Message routing, acceptance/rejection | INFO |
| `[SkillGen:Scan]` | SkillGenService | Document scan lifecycle, threshold decisions | INFO |
| `[SkillGen:Preflight]` | SkillGenService | Python/toolkit/docs checks | INFO/ERROR |
| `[SkillGen:Lock]` | SkillGenService | Cross-process lock acquire/release/stale | INFO/WARNING |
| `[SkillGen:Pipeline]` | SkillGenService + PythonPipelineRunner | Subprocess spawn/exit, progress stages | INFO/ERROR |
| `[SkillGen:Dedup]` | DeduplicationEngine | Dedup verdict summary, tier counts | INFO (summary), DEBUG (per-skill) |
| `[SkillGen:Install]` | SkillInstaller | Install plan/result, rollback | INFO (summary), DEBUG (per-skill) |
| `[SkillGen:Store]` | SkillGenStore | Ledger persistence, history | DEBUG |
| `[SkillGen:WebviewTx]` | SkillGenService | Tab register/unregister, broadcast | DEBUG |

### Log Format

`[SkillGen:<Category>][<LEVEL>] <event> | key=value key=value`

### Correlation IDs

- **runId**: 8-char hex ID generated at the start of each pipeline run. Appears in all pipeline/preflight/lock/install logs for end-to-end tracing.
- **scanId**: 8-char hex ID generated at the start of each document scan.

### Webview UI Logging Bridge

Since `console.log` is stripped in production builds, the webview sends a `skillGenUiLog` message to the extension, which writes it to the output channel:
- Message type: `skillGenUiLog` with fields `level`, `event`, `data`
- Extension-side handler formats as `[SkillGen:UI][LEVEL] event | key=value`
- Logged UI events: `panelOpened`, `generateClicked`, `cancelClicked`, `toggleEnabled`, `panelClosed`

### Viewing Logs

Logs appear in the VS Code **Output** panel under **ClaUi** channel.

---

## Webview UI

### Status Bar Indicator

A button in the status bar showing `SkillDocs N/T` where N = pending docs, T = threshold. CSS classes:
- `.threshold-reached` - Pulse animation when N >= T
- `.running` - Visual indicator during pipeline execution

### Settings Gear Toggle

The Vitals settings panel (gear icon next to the "Vitals" button) includes a "Skill Generation" toggle. This allows enabling/disabling SkillGen directly from the UI without opening VS Code settings. The toggle sends `setSkillGenEnabled` to the extension, which updates `claudeMirror.skillGen.enabled`.

### SkillGenPanel

Full overlay panel (same pattern as AchievementPanel and DashboardPanel):
- Enable/disable toggle
- Current status display with run status badge
- Progress bar with shimmer animation during pipeline runs
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
| `skillGenTrigger` | Manual pipeline trigger |
| `skillGenCancel` | Cancel running pipeline |
| `getSkillGenStatus` | Request current status snapshot |
| `skillGenUiLog` | UI interaction log (bridged to extension output channel) |

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
| `pipelineMode` | `"run_pipeline"` | Pipeline execution mode |
| `autoRun` | `true` | Auto-trigger on threshold |
| `timeoutMs` | `300000` | Pipeline timeout (5 min) |
| `aiDeduplication` | `false` | Enable AI dedup (Tier 3) |

**Additional setting:**

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.srPtdAutoInject` | `true` | Auto-install SR-PTD skill and inject instructions into project CLAUDE.md |

---

## SR-PTD Bootstrap

On extension activation, `SrPtdBootstrap.ts` performs two automatic actions:

### 1. Skill Installation

Copies the bundled `sr-ptd-skill/` directory to `~/.claude/skills/sr-ptd-skill/`. This makes the SR-PTD skill available to Claude Code CLI in any project.

- Skips if target `SKILL.md` already exists with the same file size
- Overwrites if the bundled version has changed (size differs)
- Creates all directories as needed
- Errors are logged but never surfaced to the user

### 2. CLAUDE.md Injection

Appends SR-PTD documentation instructions to the project-level `CLAUDE.md` (workspace root).

- Marker-based duplicate detection: checks for `MANDATORY: Post-Task Documentation (SR-PTD)`
- If marker not found: appends the instruction block (or creates the file)
- The docs save path uses the configured `claudeMirror.skillGen.docsDirectory` value
- Follows the same pattern as the Plans feature injection in `commands.ts`
- Gated by `claudeMirror.srPtdAutoInject` setting (default: `true`)
