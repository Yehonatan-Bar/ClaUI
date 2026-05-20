# Particle Accelerator

Local-only command output compressor for ClaUi. Intercepts Bash commands from coding agents (Claude/Codex), routes eligible commands through a `claui-run` CLI, redacts secrets, filters and compresses noisy output, preserves exit codes, and writes trace files for analytics.

## Architecture

```
Agent (Claude/Codex)
  |
  v  pre-tool-use hook
  |  rewrites: bash "git status" -> bash "claui-run --claui-encoded-shell-command <base64url>"
  v
claui-run CLI (separate Node.js process, no network)
  |
  +-- executeShellCommand (spawn with shell, byte cap, signal forwarding)
  +-- SecretRedactor (env-value scanning + regex rules)
  +-- OutputFilterRegistry (command-specific filter selection)
  +-- CommandTraceWriter (atomic trace file)
  |
  v  stdout: filtered output
  v  exit code: preserved from original command
```

Three execution contexts:
- **Extension host** (Node.js): `ParticleAcceleratorService` lifecycle, settings, context store, trace reader, hooks, reports
- **claui-run CLI** (Node.js, separate webpack bundle): command execution, redaction, filtering, tracing
- **Webview** (browser): status badge, settings panel, trace dashboard

## Extension-Side Components

### ParticleAcceleratorService (`src/extension/particle-accelerator/ParticleAcceleratorService.ts`)
Top-level service implementing `vscode.Disposable`. Created in `extension.ts`, injected into `TabManager` -> `SessionTab`/`CodexSessionTab` (forwarded to both MessageHandler and process manager env builder). On `initialize()`: checks Node.js availability, calls installer, creates sub-services, generates yesterday's report, schedules retention cleanup.

### Session Integration
`SessionTab.setParticleAcceleratorService()` and `CodexSessionTab.setParticleAcceleratorService()` wire the env builder on the process manager and manage context file lifecycle:
- **Context creation**: Before CLI spawn in `startSession()`, creates a context file via `ContextStore.createContext()`
- **Session ID update**: When the CLI reports its session/thread ID (init event or threadStarted), updates the context via `updateSessionId()`
- **Context cleanup**: On tab `dispose()`, removes the context file via `disposeContext()`
- **Env builder**: Sets `processManager.particleAcceleratorEnvBuilder` callback that calls `buildParticleAcceleratorAgentEnv()` with current tab state
- **Analytics**: `saveProjectAnalytics()` attaches `particleAccelerator` stats (command count, tokens saved, etc.) to `SessionSummary` via `TraceReader.getAggregate()`

### Codex instruction-only mode
When `codexMode === 'instruction-only'`, `CodexExecProcessManager` appends a `claui-run` usage instruction to Codex CLI args via `-c instructions=...`. This guides Codex to use `claui-run` without requiring hook installation.

### ParticleAcceleratorInstaller (`ParticleAcceleratorInstaller.ts`)
Manages runtime directory under VS Code global storage (`<globalStoragePath>/particle-accelerator/`). Copies compiled runtime files from extension `dist/particle-accelerator-runtime/`, generates platform-specific launcher scripts (`claui-run` shell script + `claui-run.cmd` batch file), creates store subdirectories, writes `version.json`.

### ParticleAcceleratorEnvBuilder (`ParticleAcceleratorEnvBuilder.ts`)
Builds the environment for agent processes. Prepends `binDir` to `PATH`, sets all `CLAUI_PARTICLE_ACCELERATOR_*` env vars (context file path, store dir, filter profile, raw log toggle), removes external telemetry vars. Verifies Node.js availability.

### ParticleAcceleratorContextStore (`ParticleAcceleratorContextStore.ts`)
Manages per-tab context JSON files at `<storeDir>/contexts/<tabRuntimeId>.json`. Context includes session ID, turn ID, workspace path, provider, model. All writes are atomic (write `.tmp` then rename).

### ParticleAcceleratorTraceReader (`ParticleAcceleratorTraceReader.ts`)
Reads traces for UI dashboard. Methods: `getRecentTraces`, `getTrace`, `getAggregate`, `getRawLog`, `getDailyReport`, `cleanExpired`. Three-tier retention enforcement with hard caps.

### ParticleAcceleratorDailyReportGenerator (`ParticleAcceleratorDailyReportGenerator.ts`)
Generates idempotent daily aggregate reports. `generateIfMissing(date)` scans all traces for the given date and writes a summary to `reports/daily-YYYY-MM-DD.json`.

### ParticleAcceleratorHookManager (`ParticleAcceleratorHookManager.ts`)
Installs/uninstalls pre-tool-use hooks for Claude and Codex. Claude hooks go in `<workspace>/.claude/settings.json`, Codex hooks go in `<workspace>/.codex/hooks.json`. Creates backups, preserves existing settings, identifies managed hooks by `--claui-managed-hook` marker.

### ParticleAcceleratorSettings (`ParticleAcceleratorSettings.ts`)
Reads from `claudeMirror.particleAccelerator.*` VS Code configuration. Exports `getParticleAcceleratorSettings()` and `onSettingsChanged(callback)`.

### ParticleAcceleratorTypes (`ParticleAcceleratorTypes.ts`)
All shared type definitions: `ParticleAcceleratorTrace`, `ParticleAcceleratorStatus`, `ParticleAcceleratorAggregate`, `ParticleAcceleratorSettings`, `FilterConfig`, `RedactionResult`, etc. Version constants: `CLAUI_PARTICLE_ACCELERATOR_VERSION = '1.0.0'`, `CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION = 1`.

## CLI Runtime Components

All in `src/particle-accelerator-runtime/`, built as a separate webpack target (`dist/particle-accelerator-runtime/`). `optimization.minimize = false` because the runner outputs intentionally to stdout.

### cli.ts (claui-run entry point)
Flow: `enforceNoNetwork` -> read context file -> create redactor -> execute command -> redact output -> classify command -> select and apply filter -> write raw logs (optional) -> write trace -> output filtered result -> exit with original code.

Error handling per spec: decode failure = exit 127, redaction failure = suppressed output, filter failure = fallback to redacted output, trace write failure = warning only.

### SecretRedactor (`SecretRedactor.ts`)
`createSecretRedactor(envSnapshot)` builds a sensitive value list from env keys matching patterns (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, etc.), sorts longest-first for replacement priority. Regex rules for GitHub PATs (`ghp_*`), AWS keys, JWTs, OpenAI keys, etc. Fail-closed: returns suppression message on error. Supports chunked redaction with 200-char overlap for boundary handling.

### CommandEligibility (`CommandEligibility.ts`)
`classifyCommand(command)` returns `{eligible, reason, filterHint?, commandFamily?}`. Three-phase classification:
1. Reject: output redirections (`>`/`>>`), command substitutions (`$()`, backticks)
2. Strip prefixes: env vars, `cd` prefix, pipe suffix (for classification only -- pipes still execute)
3. Deny list (ssh, sudo, vim, npm run dev, docker run, etc.)
4. Allow list (~80 patterns) with filter hints and command family classification
5. Default: eligible with GenericFilter (deny-list-only approach)

### Output Filters

Registry pattern: `OutputFilterRegistry` with `register()`, `findFilter()`, `applyFilter()`. Registration order (first match wins):

| Priority | Filter | Matches | Key Behavior |
|----------|--------|---------|-------------|
| 1 | User DeclarativeFilter | User-defined JSON | Custom suppress/preserve patterns |
| 2 | JavaScriptPackageFilter | npm/pnpm/yarn/bun | Suppresses funding, deprecation, progress |
| 3 | PytestFilter | pytest | Preserves FAILURES, tracebacks, summary |
| 4 | JestVitestFilter | jest/vitest | Preserves Expected/Received, stack frames |
| 5 | TypeScriptFilter | tsc | Groups by file, caps at 10 errors/file |
| 6 | EslintFilter | eslint | Groups by file, caps at 10 issues/file |
| 7 | GitSemanticFilter | git diff/log/show/status | Per-file diff grouping, commit limiting |
| 8 | DeclarativeFilter (built-in) | 55+ commands | Data-driven suppress/preserve/groupByFile |
| 9 | GenericFilter | Fallback | ANSI strip, dedup, head 20 + tail 80 |

### DeclarativeFilter Engine (`filters/DeclarativeFilter.ts`)

Data-driven filter that processes `DeclarativeFilterDefinition` objects. Each definition specifies command patterns (regex), suppress patterns (noise), important patterns (signal), and optional diagnostic grouping by file. One class handles all definitions -- filter name in traces is `DeclarativeFilter:<id>` (e.g., `DeclarativeFilter:docker-build`).

55 built-in definitions in `filters/builtinDefinitions.ts` covering: Docker, Go, Rust/Cargo, Python tools (pip, mypy, ruff, black, flake8, pylint), .NET, Kubernetes, Terraform, AWS/GCloud, Maven/Gradle, GCC/Clang/Make, Playwright, Next.js, Vite, Prisma, Swift/Xcode, Homebrew, Turbo/NX, and more.

### GitSemanticFilter (`filters/GitSemanticFilter.ts`)

Semantic filter for git commands with subcommand-specific handlers:
- **git diff**: Parses into per-file sections, counts +/- per file, caps hunks per file (5), generates summary
- **git log**: Limits to 25 entries, truncates long messages
- **git status**: Collapses untracked file lists >15 entries
- **git show**: Hybrid metadata + diff filtering

### User Custom Filters (`filters/UserFilterLoader.ts`)

Users can define custom declarative filters in JSON files:
- `.claui/filters.json` in project root (highest priority)
- `${storeDir}/config/filters.json` (global)

Format: `{ "customFilters": [{ "id": "...", "commandPatterns": [...], "suppressPatterns": [...], "importantPatterns": [...] }] }`

### Shared Utilities (`filters/filterUtils.ts`)

Common ANSI stripping, budget calculation, and `FilterOutput` builder used by all filters.

Budget profiles:
- **balanced**: 8k char budget, 16k hard cap
- **strict**: 4k char budget, 8k hard cap
- **verbose**: 32k char budget, 32k hard cap

### NoNetworkGuard (`NoNetworkGuard.ts`)
`enforceNoNetwork()` overrides `globalThis.fetch` and patches `module.constructor.prototype.require` to block `http`, `https`, `net`, `dgram`, `http2`.

### executeShellCommand (`executeShellCommand.ts`)
Spawns commands with `shell: true`. Captures stdout/stderr with byte cap. Forwards SIGINT/SIGTERM. On Windows, uses `taskkill /F /T /PID` for process tree kill. Returns `{stdout, stderr, exitCode, signal, interrupted, durationMs}`.

### Pre-Tool-Use Hooks

**claudePreToolUse.ts**: Reads JSON from stdin (Claude hook protocol). Intercepts `Bash` commands for Particle Accelerator routing and `mcp__*` tool calls for Secret Protection scanning. Eligible Bash commands are rewritten to `claui-run --claui-encoded-shell-command <base64url>` with `permissionDecision: 'allow'` and `updatedInput`; MCP requests are scanned before they leave the agent boundary.

**codexPreToolUse.ts**: Uses the Codex deny/retry pattern for eligible Bash commands and also scans `mcp__*` tool arguments. Secret Protection findings are evaluated through `PolicyEngine` plus `ApprovalEngine`; blocked or approval-gated MCP requests are denied before execution. Loads active exceptions from `CLAUI_SECRET_PROTECTION_EXCEPTIONS_PATH` (JSON file shared with `SecretProtectionService`) and persists consumption (usedCount increment) back to the same file.

## Secret Protection Integration

Particle Accelerator remains local-only command compression, but it now carries Secret Protection state across the same extension/runtime boundary:

- `ParticleAcceleratorEnvBuilder` passes `CLAUI_SECRET_PROTECTION`, mode, entropy, terminal-scan, MCP-scan, and exceptions-path env vars to agent processes and hook runtimes.
- `claui-run` optionally runs `CompositeSecretScanner` after its legacy redactor and stores DLP summary metadata on traces.
- `ParticleAcceleratorHookManager` installs both Bash and `mcp__*` pre-tool-use entries for Claude and Codex; hook installation is considered complete only when both entries exist.
- Codex sessions append DLP redaction instructions through `CodexExecProcessManager` so `<REDACTED ... />` tokens are treated as intentional safe substitutes.
- Audit events are written under `<globalStoragePath>/secret-protection/audit/`, separate from Particle Accelerator traces/raw logs.

## Webview Components

All in `src/webview/components/ParticleAccelerator/`.

- **ParticleAcceleratorStatusBadge**: Renders in the StatusBar right section. Green/red dot + summary text (command count, tokens saved). Hidden when Particle Accelerator is disabled.
- **ParticleAcceleratorSettingsPanel**: Enable/disable toggle, version/node info, hook install/uninstall buttons, clear data, refresh. Rendered in VitalsInfoPanel and Dashboard ParticleAccelerator tab.
- **ParticleAcceleratorTracePanel**: Value-first dashboard layout with three sections: (1) **Data Filtered hero** - prominent blue-bordered card showing tokens saved, words filtered, and lines filtered with raw totals, plus compression ratio and byte savings summary; (2) **Secret Protection** - yellow-bordered card showing total redactions and a pill-badge breakdown by secret type (GitHub PAT, JWT, AWS Key, etc.) with friendly labels from `SECRET_TYPE_LABELS` map; (3) **Operations overview** - 3-column grid (commands, avg duration, data volume), followed by provider breakdown, top command families bar chart, top filters bar chart, and recent traces list (expandable, initially 10, up to 100).
- **ParticleAcceleratorTraceDetail**: Single trace card with command family, provider badge (color-coded Claude/Codex), timestamp, exit code (red-highlighted on failure), duration, compression, token savings, lines saved, redaction count with secret type labels (short form from `SECRET_TYPE_SHORT` map), filter name.

## Data Flow (Extension <-> Webview)

WebviewToExtension messages:
- `particleAcceleratorGetStatus` / `particleAcceleratorSetEnabled` / `particleAcceleratorInstallHooks` / `particleAcceleratorUninstallHooks` / `particleAcceleratorClearData`
- `secretProtectionGetStatus` / `secretProtectionSetSetting` / `secretProtectionGetAuditEvents` / `secretProtectionGetComplianceReport`

ExtensionToWebview messages:
- `particleAcceleratorStatus` / `particleAcceleratorTraceUpdate` / `particleAcceleratorAggregateUpdate` / `particleAcceleratorRecentTraces` / `particleAcceleratorError`
- `secretProtectionStatus` / `secretProtectionAuditEvents` / `secretProtectionComplianceReport` / `secretProtectionError`

Zustand store fields: `particleAcceleratorEnabled`, `particleAcceleratorStatus`, `particleAcceleratorAggregate` (full aggregate with 16 fields: totalCommands, failedCommands, totalRawBytes, totalFilteredBytes, totalEstimatedTokensSaved, avgCompressionRatio, avgDurationMs, totalRedactions, totalRawLines, totalFilteredLines, totalRawWords, totalFilteredWords, secretTypeBreakdown, topCommandFamilies, topFilters, providerBreakdown), `particleAcceleratorRecentTraces` (each trace includes rulesTriggered, rawLines, filteredLines), `particleAcceleratorError`. Setters: `addParticleAcceleratorTrace` (prepend + cap at 100), `setParticleAcceleratorRecentTraces` (batch replace from extension).

Secret Protection store fields include `secretProtectionSettings`, `secretProtectionEnabled`, `secretProtectionMode`, `secretProtectionPanelOpen`, `secretProtectionPanelTab`, `secretProtectionAuditEvents`, `secretProtectionLastEvent`, `secretProtectionComplianceReport`, and loading/error state.

## Store Directory Layout

```
<globalStoragePath>/particle-accelerator/
+-- bin/
|   +-- claui-run         # Shell launcher (Unix)
|   +-- claui-run.cmd     # Batch launcher (Windows)
|   +-- cli.js            # Compiled CLI entry point
|   +-- filters/          # Compiled filter modules
|   +-- hooks/            # Compiled hook modules
+-- store/
|   +-- contexts/         # Per-tab context JSON files
|   +-- traces/           # Command trace JSON files
|   +-- raw/              # Raw redacted output logs (optional)
|   +-- reports/          # Daily aggregate reports
|   +-- config/           # Filter overrides
+-- version.json          # Runtime version tracking
```

Secret Protection audit data is stored separately:

```
<globalStoragePath>/secret-protection/
+-- audit/
|   +-- YYYY-MM-DD.jsonl  # Append-only audit events; no raw secret values
```

## Retention Policy

| Tier | Default Retention | Hard Cap | Setting |
|------|-------------------|----------|---------|
| Raw logs | 7 days | 100 MB | `rawLogRetentionDays`, `maxRawLogMb` |
| Traces | 30 days | 10,000 files | `traceRetentionDays`, `maxTraceCount` |
| Daily reports | 90 days | n/a | `dailyReportRetentionDays` |

## Configuration

All settings under `claudeMirror.particleAccelerator.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable Particle Accelerator |
| `filterProfile` | `"balanced"` | Output filter budget profile |
| `storeRawRedactedLogs` | `true` | Store raw redacted output |
| `rawLogRetentionDays` | `7` | Raw log retention (1-90 days) |
| `maxRawLogMb` | `100` | Max raw log storage (10-5000 MB) |
| `traceRetentionDays` | `30` | Trace retention (1-365 days) |
| `maxTraceCount` | `10000` | Max trace count (100-100000) |
| `dailyReportRetentionDays` | `90` | Daily report retention (7-365 days) |
| `workspaceLocalStorage` | `false` | Store in workspace instead of global storage |
| `installClaudeHook` | `false` | Auto-install Claude pre-tool-use hook |
| `installCodexHook` | `false` | Auto-install Codex pre-tool-use hook |
| `codexMode` | `"instruction-only"` | Codex integration mode (off/instruction-only/hook-guard) |

## Key Files

| File | Path |
|------|------|
| Service | `src/extension/particle-accelerator/ParticleAcceleratorService.ts` |
| Types | `src/extension/particle-accelerator/ParticleAcceleratorTypes.ts` |
| Settings | `src/extension/particle-accelerator/ParticleAcceleratorSettings.ts` |
| Installer | `src/extension/particle-accelerator/ParticleAcceleratorInstaller.ts` |
| Env Builder | `src/extension/particle-accelerator/ParticleAcceleratorEnvBuilder.ts` |
| Context Store | `src/extension/particle-accelerator/ParticleAcceleratorContextStore.ts` |
| Trace Reader | `src/extension/particle-accelerator/ParticleAcceleratorTraceReader.ts` |
| Report Generator | `src/extension/particle-accelerator/ParticleAcceleratorDailyReportGenerator.ts` |
| Hook Manager | `src/extension/particle-accelerator/ParticleAcceleratorHookManager.ts` |
| CLI Entry | `src/particle-accelerator-runtime/cli.ts` |
| Secret Redactor | `src/particle-accelerator-runtime/SecretRedactor.ts` |
| Command Eligibility | `src/particle-accelerator-runtime/CommandEligibility.ts` |
| Filter Registry | `src/particle-accelerator-runtime/filters/OutputFilterRegistry.ts` |
| Network Guard | `src/particle-accelerator-runtime/NoNetworkGuard.ts` |
| Shell Executor | `src/particle-accelerator-runtime/executeShellCommand.ts` |
| Claude Hook | `src/particle-accelerator-runtime/hooks/claudePreToolUse.ts` |
| Codex Hook | `src/particle-accelerator-runtime/hooks/codexPreToolUse.ts` |
| DLP Approval Engine | `src/server/enforcement/ApprovalEngine.ts` |
| DLP Exception Store | `src/server/enforcement/ExceptionStore.ts` |
| DLP Audit Store | `src/shared/audit/AuditStore.ts` |
| DLP Compliance Reporter | `src/shared/audit/ComplianceReporter.ts` |
| DLP Status Badge | `src/webview/components/SecretProtectionStatusBadge.tsx` |
| DLP Settings Panel | `src/webview/components/SettingsPanel.tsx` |
| DLP Audit Panel | `src/webview/components/AuditLogPanel.tsx` |
| Webpack Config | `webpack.config.js` (third config: `particle-accelerator-runtime`) |
| StatusBar Badge | `src/webview/components/ParticleAccelerator/ParticleAcceleratorStatusBadge.tsx` |
| Settings Panel | `src/webview/components/ParticleAccelerator/ParticleAcceleratorSettingsPanel.tsx` |
| Trace Panel | `src/webview/components/ParticleAccelerator/ParticleAcceleratorTracePanel.tsx` |
| Trace Detail | `src/webview/components/ParticleAccelerator/ParticleAcceleratorTraceDetail.tsx` |
| Dashboard Tab | `src/webview/components/Dashboard/tabs/ParticleAcceleratorTab.tsx` |

## Tests

11 test files in `tests/particle-accelerator/`:

| Test File | Coverage |
|-----------|----------|
| `SecretRedactor.test.ts` | Env scanning, regex rules, fail-closed, streaming |
| `CommandEligibility.test.ts` | Allow/deny lists, pipeline detection, bypass/wrap checks |
| `CommandTraceWriter.test.ts` | Atomic writes, directory creation |
| `ParticleAcceleratorContextStore.test.ts` | CRUD lifecycle, corrupt file handling |
| `ParticleAcceleratorEnvBuilder.test.ts` | Env vars, PATH prepend, telemetry removal |
| `filters/GenericFilter.test.ts` | ANSI strip, dedup, budgets |
| `filters/JavaScriptPackageFilter.test.ts` | npm/pnpm/yarn/bun output filtering |
| `filters/TypeScriptFilter.test.ts` | Diagnostic grouping, per-file caps |
| `hooks/claudePreToolUse.test.ts` | Allow+rewrite, passthrough |
| `hooks/codexPreToolUse.test.ts` | Deny+retry, passthrough |
| `security/noNetworkImports.test.ts` | Static import ban verification |
