# Local Boost

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
- **Extension host** (Node.js): `LocalBoostService` lifecycle, settings, context store, trace reader, hooks, reports
- **claui-run CLI** (Node.js, separate webpack bundle): command execution, redaction, filtering, tracing
- **Webview** (browser): status badge, settings panel, trace dashboard

## Extension-Side Components

### LocalBoostService (`src/extension/local-boost/LocalBoostService.ts`)
Top-level service implementing `vscode.Disposable`. Created in `extension.ts`, injected into `TabManager` -> `SessionTab`/`CodexSessionTab` (forwarded to both MessageHandler and process manager env builder). On `initialize()`: checks Node.js availability, calls installer, creates sub-services, generates yesterday's report, schedules retention cleanup.

### Session Integration
`SessionTab.setLocalBoostService()` and `CodexSessionTab.setLocalBoostService()` wire the env builder on the process manager and manage context file lifecycle:
- **Context creation**: Before CLI spawn in `startSession()`, creates a context file via `ContextStore.createContext()`
- **Session ID update**: When the CLI reports its session/thread ID (init event or threadStarted), updates the context via `updateSessionId()`
- **Context cleanup**: On tab `dispose()`, removes the context file via `disposeContext()`
- **Env builder**: Sets `processManager.localBoostEnvBuilder` callback that calls `buildLocalBoostAgentEnv()` with current tab state
- **Analytics**: `saveProjectAnalytics()` attaches `localBoost` stats (command count, tokens saved, etc.) to `SessionSummary` via `TraceReader.getAggregate()`

### Codex instruction-only mode
When `codexMode === 'instruction-only'`, `CodexExecProcessManager` appends a `claui-run` usage instruction to Codex CLI args via `-c instructions=...`. This guides Codex to use `claui-run` without requiring hook installation.

### LocalBoostInstaller (`LocalBoostInstaller.ts`)
Manages runtime directory under VS Code global storage (`<globalStoragePath>/local-boost/`). Copies compiled runtime files from extension `dist/local-boost-runtime/`, generates platform-specific launcher scripts (`claui-run` shell script + `claui-run.cmd` batch file), creates store subdirectories, writes `version.json`.

### LocalBoostEnvBuilder (`LocalBoostEnvBuilder.ts`)
Builds the environment for agent processes. Prepends `binDir` to `PATH`, sets all `CLAUI_LOCAL_BOOST_*` env vars (context file path, store dir, filter profile, raw log toggle), removes external telemetry vars. Verifies Node.js availability.

### LocalBoostContextStore (`LocalBoostContextStore.ts`)
Manages per-tab context JSON files at `<storeDir>/contexts/<tabRuntimeId>.json`. Context includes session ID, turn ID, workspace path, provider, model. All writes are atomic (write `.tmp` then rename).

### LocalBoostTraceReader (`LocalBoostTraceReader.ts`)
Reads traces for UI dashboard. Methods: `getRecentTraces`, `getTrace`, `getAggregate`, `getRawLog`, `getDailyReport`, `cleanExpired`. Three-tier retention enforcement with hard caps.

### LocalBoostDailyReportGenerator (`LocalBoostDailyReportGenerator.ts`)
Generates idempotent daily aggregate reports. `generateIfMissing(date)` scans all traces for the given date and writes a summary to `reports/daily-YYYY-MM-DD.json`.

### LocalBoostHookManager (`LocalBoostHookManager.ts`)
Installs/uninstalls pre-tool-use hooks for Claude and Codex. Claude hooks go in `<workspace>/.claude/settings.json`, Codex hooks go in `<workspace>/.codex/hooks.json`. Creates backups, preserves existing settings, identifies managed hooks by `--claui-managed-hook` marker.

### LocalBoostSettings (`LocalBoostSettings.ts`)
Reads from `claudeMirror.localBoost.*` VS Code configuration. Exports `getLocalBoostSettings()` and `onSettingsChanged(callback)`.

### LocalBoostTypes (`LocalBoostTypes.ts`)
All shared type definitions: `LocalBoostTrace`, `LocalBoostStatus`, `LocalBoostAggregate`, `LocalBoostSettings`, `FilterConfig`, `RedactionResult`, etc. Version constants: `CLAUI_LOCAL_BOOST_VERSION = '1.0.0'`, `CLAUI_LOCAL_BOOST_SCHEMA_VERSION = 1`.

## CLI Runtime Components

All in `src/local-boost-runtime/`, built as a separate webpack target (`dist/local-boost-runtime/`). `optimization.minimize = false` because the runner outputs intentionally to stdout.

### cli.ts (claui-run entry point)
Flow: `enforceNoNetwork` -> read context file -> create redactor -> execute command -> redact output -> classify command -> select and apply filter -> write raw logs (optional) -> write trace -> output filtered result -> exit with original code.

Error handling per spec: decode failure = exit 127, redaction failure = suppressed output, filter failure = fallback to redacted output, trace write failure = warning only.

### SecretRedactor (`SecretRedactor.ts`)
`createSecretRedactor(envSnapshot)` builds a sensitive value list from env keys matching patterns (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, etc.), sorts longest-first for replacement priority. Regex rules for GitHub PATs (`ghp_*`), AWS keys, JWTs, OpenAI keys, etc. Fail-closed: returns suppression message on error. Supports chunked redaction with 200-char overlap for boundary handling.

### CommandEligibility (`CommandEligibility.ts`)
`classifyCommand(command)` returns `{eligible, reason, filterHint?, commandFamily?}`. Deny list (ssh, sudo, vim, npm run dev, docker run, etc.), allow list (~40 patterns grouped by family: git, npm, python, rust, go, etc.). Strips leading env var assignments. Detects pipelines and redirections.

### Output Filters

Registry pattern: `OutputFilterRegistry` with `register()`, `findFilter()`, `applyFilter()`.

| Filter | Matches | Key Behavior |
|--------|---------|-------------|
| GenericFilter | Fallback | ANSI strip, dedup, head 20 + tail 80, budget caps |
| JavaScriptPackageFilter | npm/pnpm/yarn/bun | Suppresses funding, deprecation, progress bars |
| PytestFilter | pytest | Preserves FAILURES, tracebacks, summary |
| JestVitestFilter | jest/vitest | Preserves Expected/Received, stack frames |
| TypeScriptFilter | tsc | Groups by file, caps at 10 errors/file |
| EslintFilter | eslint | Groups by file, caps at 10 issues/file |

Budget profiles (GenericFilter):
- **balanced**: 8k char budget, 16k hard cap
- **strict**: 4k char budget, 8k hard cap
- **verbose**: 32k char budget, 32k hard cap

### NoNetworkGuard (`NoNetworkGuard.ts`)
`enforceNoNetwork()` overrides `globalThis.fetch` and patches `module.constructor.prototype.require` to block `http`, `https`, `net`, `dgram`, `http2`.

### executeShellCommand (`executeShellCommand.ts`)
Spawns commands with `shell: true`. Captures stdout/stderr with byte cap. Forwards SIGINT/SIGTERM. On Windows, uses `taskkill /F /T /PID` for process tree kill. Returns `{stdout, stderr, exitCode, signal, interrupted, durationMs}`.

### Pre-Tool-Use Hooks

**claudePreToolUse.ts**: Reads JSON from stdin (Claude hook protocol). Intercepts `Bash` tool only. Classifies command; if eligible, rewrites to `claui-run --claui-encoded-shell-command <base64url>`. Outputs `hookSpecificOutput` with `permissionDecision: 'allow'` and `updatedInput`.

**codexPreToolUse.ts**: Same pattern but uses `permissionDecision: 'deny'` with retry instruction in the reason field (Codex re-attempts the command through `claui-run`).

## Webview Components

All in `src/webview/components/LocalBoost/`.

- **LocalBoostStatusBadge**: Renders in the StatusBar right section. Green/red dot + summary text (command count, tokens saved). Hidden when Local Boost is disabled.
- **LocalBoostSettingsPanel**: Enable/disable toggle, version/node info, hook install/uninstall buttons, clear data, refresh. Rendered in VitalsInfoPanel and Dashboard LocalBoost tab.
- **LocalBoostTracePanel**: 3-column stat cards grid (total commands, tokens saved, compression ratio).
- **LocalBoostTraceDetail**: Single trace card with command family, timestamp, exit code, duration, compression, redaction count.

## Data Flow (Extension <-> Webview)

WebviewToExtension messages:
- `localBoostGetStatus` / `localBoostSetEnabled` / `localBoostInstallHooks` / `localBoostUninstallHooks` / `localBoostClearData`

ExtensionToWebview messages:
- `localBoostStatus` / `localBoostTraceUpdate` / `localBoostAggregateUpdate` / `localBoostError`

Zustand store fields: `localBoostEnabled`, `localBoostStatus`, `localBoostAggregate`, `localBoostRecentTraces`, `localBoostError` with setters (`addLocalBoostTrace` prepends and caps at 100 entries).

## Store Directory Layout

```
<globalStoragePath>/local-boost/
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

## Retention Policy

| Tier | Default Retention | Hard Cap | Setting |
|------|-------------------|----------|---------|
| Raw logs | 7 days | 100 MB | `rawLogRetentionDays`, `maxRawLogMb` |
| Traces | 30 days | 10,000 files | `traceRetentionDays`, `maxTraceCount` |
| Daily reports | 90 days | n/a | `dailyReportRetentionDays` |

## Configuration

All settings under `claudeMirror.localBoost.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable Local Boost |
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
| Service | `src/extension/local-boost/LocalBoostService.ts` |
| Types | `src/extension/local-boost/LocalBoostTypes.ts` |
| Settings | `src/extension/local-boost/LocalBoostSettings.ts` |
| Installer | `src/extension/local-boost/LocalBoostInstaller.ts` |
| Env Builder | `src/extension/local-boost/LocalBoostEnvBuilder.ts` |
| Context Store | `src/extension/local-boost/LocalBoostContextStore.ts` |
| Trace Reader | `src/extension/local-boost/LocalBoostTraceReader.ts` |
| Report Generator | `src/extension/local-boost/LocalBoostDailyReportGenerator.ts` |
| Hook Manager | `src/extension/local-boost/LocalBoostHookManager.ts` |
| CLI Entry | `src/local-boost-runtime/cli.ts` |
| Secret Redactor | `src/local-boost-runtime/SecretRedactor.ts` |
| Command Eligibility | `src/local-boost-runtime/CommandEligibility.ts` |
| Filter Registry | `src/local-boost-runtime/filters/OutputFilterRegistry.ts` |
| Network Guard | `src/local-boost-runtime/NoNetworkGuard.ts` |
| Shell Executor | `src/local-boost-runtime/executeShellCommand.ts` |
| Claude Hook | `src/local-boost-runtime/hooks/claudePreToolUse.ts` |
| Codex Hook | `src/local-boost-runtime/hooks/codexPreToolUse.ts` |
| Webpack Config | `webpack.config.js` (third config: `local-boost-runtime`) |
| StatusBar Badge | `src/webview/components/LocalBoost/LocalBoostStatusBadge.tsx` |
| Settings Panel | `src/webview/components/LocalBoost/LocalBoostSettingsPanel.tsx` |
| Trace Panel | `src/webview/components/LocalBoost/LocalBoostTracePanel.tsx` |
| Trace Detail | `src/webview/components/LocalBoost/LocalBoostTraceDetail.tsx` |
| Dashboard Tab | `src/webview/components/Dashboard/tabs/LocalBoostTab.tsx` |

## Tests

11 test files in `tests/local-boost/`:

| Test File | Coverage |
|-----------|----------|
| `SecretRedactor.test.ts` | Env scanning, regex rules, fail-closed, streaming |
| `CommandEligibility.test.ts` | Allow/deny lists, pipeline detection, bypass/wrap checks |
| `CommandTraceWriter.test.ts` | Atomic writes, directory creation |
| `LocalBoostContextStore.test.ts` | CRUD lifecycle, corrupt file handling |
| `LocalBoostEnvBuilder.test.ts` | Env vars, PATH prepend, telemetry removal |
| `filters/GenericFilter.test.ts` | ANSI strip, dedup, budgets |
| `filters/JavaScriptPackageFilter.test.ts` | npm/pnpm/yarn/bun output filtering |
| `filters/TypeScriptFilter.test.ts` | Diagnostic grouping, per-file caps |
| `hooks/claudePreToolUse.test.ts` | Allow+rewrite, passthrough |
| `hooks/codexPreToolUse.test.ts` | Deny+retry, passthrough |
| `security/noNetworkImports.test.ts` | Static import ban verification |
