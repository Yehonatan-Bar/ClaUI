# ClaUi Particle Accelerator - Full Implementation Plan

**Spec source:** `C:\projects\CLAUI_PARTICLE_ACCELERATOR_TECHNICAL_SPEC.md`
**Target:** Developer implementing the feature inside ClaUi
**Date:** 2026-05-11

---

## Dependency Graph

```
Phase 1: Types & Settings ──────────────────────────────────────────────────┐
Phase 2: Secret Redactor (standalone) ──────────────────────────────────────┤
Phase 3: Filters (standalone) ──────────────────────────────────────────────┤
Phase 4: Command Eligibility (standalone) ──────────────────────────────────┤
Phase 5: Trace Writer, Context Store & Daily Reports ──────────────────────┤
                                                                            │
Phase 6: CLI Runner (claui-run) ── depends on Phases 1-5 ──────────────────┤
                                                                            │
Phase 7: Extension Services ── depends on Phases 1,5,6 ────────────────────┤
Phase 8: Process Manager & Analytics Integration ── depends on Phase 7 ────┤
Phase 9: Hook System ── depends on Phases 4,7 ─────────────────────────────┤
Phase 10: Webview UI ── depends on Phases 7,8 ──────────────────────────────┤
Phase 11: Build & Webpack ── depends on Phase 6 ────────────────────────────┤
Phase 12: Testing & Security Audit ── runs throughout, final after all ─────┤
Phase 13: Documentation ── depends on all above ────────────────────────────┘
```

Phases 1-5 are independent and can be developed in parallel.
Phase 6 ties them together into the standalone CLI.
Phases 7-10 integrate into ClaUi.
Phase 11 ensures packaging works.
Phase 12 runs continuously but has a final gate.
Phase 13 documents the final state.

---

## Phase 1: Types, Settings & Project Scaffolding

**Goal:** Define all shared types and VS Code settings. Create directory structure.

### 1.1 Create directories

```
src/extension/particle-accelerator/
src/particle-accelerator-runtime/
src/particle-accelerator-runtime/filters/
src/particle-accelerator-runtime/hooks/
```

### 1.2 Create `src/extension/particle-accelerator/ParticleAcceleratorTypes.ts`

All shared types used across extension and runtime:

```ts
// ParticleAcceleratorTrace - full trace schema (spec section 11.3)
// ParticleAcceleratorTraceSummary - lightweight version for UI
// ParticleAcceleratorStatus - current feature state
// ParticleAcceleratorAggregate - aggregated stats
// ParticleAcceleratorSessionStats - per-session stats (spec section 17.7)
// ParticleAcceleratorContextFile - context JSON schema (spec section 10.4)
// CommandEligibilityResult - { eligible, reason, filterHint, commandFamily }
// RedactionResult - { text, replacements, rulesTriggered }
// FilterInput / FilterOutput - filter I/O shapes (spec section 13.1)
// ParticleAcceleratorEnvInput - env builder input (spec section 10.1)

export const CLAUI_PARTICLE_ACCELERATOR_VERSION = '1.0.0';
export const CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION = 1;
```

### 1.3 Create `src/extension/particle-accelerator/ParticleAcceleratorSettings.ts`

Read settings from `vscode.workspace.getConfiguration('claudeMirror.particleAccelerator')`.

```ts
export interface ParticleAcceleratorSettings {
  enabled: boolean;
  filterProfile: 'balanced' | 'strict' | 'verbose';
  storeRawRedactedLogs: boolean;
  rawLogRetentionDays: number;
  maxRawLogMb: number;
  traceRetentionDays: number;
  maxTraceCount: number;
  dailyReportRetentionDays: number;
  workspaceLocalStorage: boolean;
  installClaudeHook: boolean;
  installCodexHook: boolean;
  codexMode: 'off' | 'instruction-only' | 'hook-guard';
}

export function getParticleAcceleratorSettings(): ParticleAcceleratorSettings;
export function onSettingsChanged(callback: (settings: ParticleAcceleratorSettings) => void): vscode.Disposable;
```

### 1.4 Update `package.json` — `contributes.configuration`

Add all 12 settings (8 from spec section 19 + 4 retention/storage) under the existing `"configuration"` object:

```json
"claudeMirror.particleAccelerator.enabled": { "type": "boolean", "default": false, ... },
"claudeMirror.particleAccelerator.filterProfile": { "type": "string", "enum": ["balanced","strict","verbose"], "default": "balanced" },
"claudeMirror.particleAccelerator.storeRawRedactedLogs": { "type": "boolean", "default": true },
"claudeMirror.particleAccelerator.rawLogRetentionDays": { "type": "number", "default": 7, "min": 1, "max": 90 },
"claudeMirror.particleAccelerator.maxRawLogMb": { "type": "number", "default": 100, "min": 10, "max": 5000 },
"claudeMirror.particleAccelerator.traceRetentionDays": { "type": "number", "default": 30, "min": 1, "max": 365 },
"claudeMirror.particleAccelerator.maxTraceCount": { "type": "number", "default": 10000, "min": 100, "max": 100000 },
"claudeMirror.particleAccelerator.dailyReportRetentionDays": { "type": "number", "default": 90, "min": 7, "max": 365 },
"claudeMirror.particleAccelerator.workspaceLocalStorage": { "type": "boolean", "default": false, "description": "Store traces/logs in <workspace>/.claui/particle-accelerator/ instead of global storage. Opt-in because it writes files inside the project." },
"claudeMirror.particleAccelerator.installClaudeHook": { "type": "boolean", "default": false },
"claudeMirror.particleAccelerator.installCodexHook": { "type": "boolean", "default": false },
"claudeMirror.particleAccelerator.codexMode": { "type": "string", "enum": ["off","instruction-only","hook-guard"], "default": "instruction-only" }
```

### 1.5 Acceptance

- Types compile with `npx tsc --noEmit`
- Settings appear in VS Code settings UI after `npm run deploy:local`

---

## Phase 2: Secret Redactor

**Goal:** Standalone, testable module that redacts secrets from text. No dependencies on VS Code APIs.

### 2.1 Create `src/particle-accelerator-runtime/SecretRedactor.ts`

**API (spec section 12.2):**

```ts
export interface SecretRedactor {
  redact(text: string): RedactionResult;
  redactChunk(chunk: string): RedactionResult;
  flush(): RedactionResult;
}

export function createSecretRedactor(envSnapshot: Record<string, string>): SecretRedactor;
```

**Implementation steps:**

1. **Env-value scanner (spec 12.3):** On construction, scan `envSnapshot` for keys matching sensitive patterns (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_CREDENTIAL`, `*_AUTH`, `*_PRIVATE`, `*_API_KEY`, `*_APIKEY`, `*_ACCESS_KEY*`, `AWS_*`, `AZURE_*`, `GITHUB_TOKEN`, `GITHUB_PAT`, `GH_TOKEN`, `DATABASE_URL`, `CONNECTION_STRING`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SLACK_*`, `STRIPE_*`, `NUGET_*`). Collect values. Ignore values shorter than 8 chars unless obviously a known token format. Sort values longest-first for replacement priority. Do NOT store key names or values beyond the in-memory set.

2. **Regex rules (spec 12.4):** Build a list of compiled regexes:
   - GitHub classic PATs: `ghp_[A-Za-z0-9]{36}`
   - GitHub fine-grained: `github_pat_[A-Za-z0-9_]{82}`
   - AWS access keys: `AKIA[0-9A-Z]{16}`
   - AWS secret keys: 40-char base64-ish after `=`
   - JWTs: `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
   - OpenAI keys: `sk-[A-Za-z0-9]{20,}`
   - Anthropic keys: `sk-ant-[A-Za-z0-9-]{20,}`
   - Slack tokens: `xox[bpras]-[A-Za-z0-9-]+`
   - Stripe keys: `[rs]k_(live|test)_[A-Za-z0-9]{20,}`
   - Google API keys: `AIza[A-Za-z0-9_-]{35}`
   - Private key blocks: `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`
   - Basic auth in URLs: `://[^:@\s]+:[^@\s]+@`
   - DB URLs with creds: `(postgres|mysql|mongodb|redis)://[^:@\s]+:[^@\s]+@`
   - Bearer tokens: `Bearer [A-Za-z0-9_.+/=-]{20,}`

3. **`redact(text)`:** First replace exact env values, then apply regex rules. Return `{ text, replacements, rulesTriggered }`.

4. **`redactChunk(chunk)` / `flush()`:** MVP can buffer chunks up to `maxRawBytes` (default 10MB) and redact the buffer. For secrets split across chunk boundaries, hold back the last 200 chars of each chunk as overlap. `flush()` processes the held-back tail.

5. **Fail-closed (spec 12.1, 12.6):** If redaction throws, return `{ text: '[claui-particle-accelerator] Output suppressed: redaction error.', replacements: 0, rulesTriggered: ['ERROR'] }`.

### 2.2 Tests — `tests/particle-accelerator/SecretRedactor.test.ts`

Per spec section 12.6, verify:
1. Env-backed token in stdout is redacted
2. Env-backed token in stderr is redacted
3. Secret in command preview is redacted
4. JWT across chunk boundary is redacted or suppressed
5. Private key block is redacted
6. Database URL password is redacted
7. Redactor failure suppresses output (mock `String.replace` to throw)
8. Short env values (< 8 chars) not matched unless obviously sensitive
9. Multiple secrets in one line are all redacted
10. Non-secret text passes through unchanged

### 2.3 Acceptance

- All redaction tests pass
- Module has zero imports from `vscode`, `http`, `https`, `net`, `dgram`, `http2`, `ws`, `undici`, `node-fetch`

---

## Phase 3: Output Filters

**Goal:** Standalone, testable output filter system. No VS Code dependencies.

### 3.1 Create filter interfaces — `src/particle-accelerator-runtime/filters/OutputFilterRegistry.ts`

```ts
export interface OutputFilter {
  name: string;
  version: string;
  supports(input: FilterInput): boolean;
  filter(input: FilterInput): FilterOutput;
}

export class OutputFilterRegistry {
  register(filter: OutputFilter): void;
  findFilter(input: FilterInput): OutputFilter;  // returns best match or generic
  applyFilter(input: FilterInput): FilterOutput;
}
```

### 3.2 Create `GenericFilter.ts`

This is the fallback for all commands. Implementation (spec 13.2):

1. Strip ANSI escape sequences (`/\x1b\[[0-9;]*[a-zA-Z]/g` and related)
2. Normalize `\r`-based progress lines (keep only last state)
3. Remove spinner frames (braille, box-drawing, clock patterns)
4. Collapse adjacent duplicate lines (keep one + `[repeated N times]`)
5. Preserve lines matching importance regex patterns (error, failed, failure, exception, traceback, panic, segmentation fault, assert, expected, received, warning, `TS\d+`, `E\d{3,}`, FATAL, Cannot find module, Module not found)
6. Preserve first 20 and last 80 lines
7. Preserve summary lines (lines with counts, totals, passed/failed)
8. Apply output budget caps:
   - Success: 8,000 chars (balanced), 4,000 (strict), 32,000 (verbose)
   - Failure: 16,000 chars (balanced), 8,000 (strict), 32,000 (verbose)
9. Prepend output header (spec 13.3):
   ```
   [claui-particle-accelerator] <command> <passed/failed> with exit code <N> in <duration>.
   Raw output: <X> bytes. Filtered output: <Y> bytes. Estimated tokens saved: <Z>.
   Filter: <name>@<version>. Redacted secrets: <N>.
   ```

### 3.3 Create MVP command-specific filters

**MVP scope (implement first):** GenericFilter, JavaScriptPackageFilter, PytestFilter, JestVitestFilter, TypeScriptFilter, EslintFilter.
**Post-MVP (implement after core integration works):** PlaywrightFilter, DockerFilter, GoFilter, MavenGradleFilter, CargoFilter, GitDiffFilter.

Each filter implements the `OutputFilter` interface. Create these files:

| File | `supports()` match | Key behavior | MVP? |
|---|---|---|---|
| `JavaScriptPackageFilter.ts` | `npm`, `pnpm`, `yarn`, `bun` + test/build/install/ci/lint | Spec 13.5: preserve npm ERR!, test failures, audit counts, install summary. Suppress funding, deprecation repeats, progress bars, long pass lists | Yes |
| `PytestFilter.ts` | `pytest`, `python -m pytest` | Spec 13.6: preserve failing test IDs, assertion diffs (capped), project tracebacks, short test summary. Suppress passing dots, collection lines | Yes |
| `JestVitestFilter.ts` | `jest`, `vitest`, `npx jest`, `npx vitest` | Spec 13.7: preserve failed suites/tests, expected/received, workspace stack frames, snapshot summary. Suppress passing list, watch hints | Yes |
| `TypeScriptFilter.ts` | `tsc`, `npx tsc` | Spec 13.8: group diagnostics by file, show top files by error count, cap per file | Yes |
| `EslintFilter.ts` | `eslint`, `npx eslint` | Spec 13.8: same grouped diagnostics pattern | Yes |
| `PlaywrightFilter.ts` | `playwright test`, `npx playwright test` | Preserve failed test names, error messages, trace paths. Suppress passing test list | Post-MVP |
| `DockerFilter.ts` | `docker build`, `docker compose build`, `docker logs` | Spec 13.9: preserve failed step/error/last N lines. Suppress layer progress, pull bars | Post-MVP |
| `GoFilter.ts` | `go test`, `go build`, `go vet` | Preserve failures, compiler errors, test summary | Post-MVP |
| `MavenGradleFilter.ts` | `mvn`, `gradle`, `./gradlew` | Preserve build failures, test results | Post-MVP |
| `CargoFilter.ts` | `cargo test`, `cargo build`, `cargo clippy` | Preserve compiler errors, test failures, clippy warnings | Post-MVP |
| `GitDiffFilter.ts` | `git diff`, `git log`, `git show` | Spec 13.10: pass through small output; for large output summarize file list/stats and suggest scoped commands | Post-MVP |

### 3.4 User-configurable filter overrides — `config/filters.json`

The registry should support loading user overrides from `<storeDir>/config/filters.json`. This file is created with default/empty content by the installer (Phase 7) and allows users to:
- Adjust output budget caps per filter
- Add custom important-line regex patterns
- Disable specific filters

Schema:
```ts
type FilterConfig = {
  budgetOverrides?: Record<string, { success?: number; failure?: number }>;
  extraImportantPatterns?: string[];
  disabledFilters?: string[];
};
```

For MVP, the registry reads this file if present but the UI does not expose editing it. Users can edit it manually.

### 3.5 Token estimation utility

In `OutputFilterRegistry.ts` or a shared util:

```ts
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}
```

### 3.6 Tests — `tests/particle-accelerator/filters/`

One test file per filter. Each test should:
- Verify `supports()` returns true for matching commands
- Verify `supports()` returns false for non-matching commands
- Test success output compression (verify ratio > 1)
- Test failure output preserves error details
- Test output budget enforcement
- Test ANSI stripping (GenericFilter)
- Test duplicate line collapsing (GenericFilter)

### 3.7 Acceptance

- All filter tests pass
- GenericFilter works for any command
- Each specific filter produces measurable compression on realistic sample output
- No VS Code / network imports

---

## Phase 4: Command Eligibility

**Goal:** Deterministic classifier that decides whether a Bash command should be routed through claui-run.

### 4.1 Create `src/particle-accelerator-runtime/CommandEligibility.ts`

Also create a copy/shared version at `src/extension/particle-accelerator/CommandEligibility.ts` if the hook scripts need a standalone module (the hook scripts run outside the extension process).

```ts
export type CommandEligibilityResult = {
  eligible: boolean;
  reason: string;
  filterHint?: string;
  commandFamily?: string;
};

export function classifyCommand(command: string): CommandEligibilityResult;
```

**Implementation:**

1. Parse the command string to extract the base command (first word or first word after env vars)
2. Check **deny list first** (spec 8.3): `ssh`, `scp`, `rsync` to remote, `sudo`, `su`, `passwd`, `vim`/`vi`/`nano`/`emacs`, `less`/`more`, `man`, `top`/`htop`, `watch`, `tail -f`, `npm run dev`, `vite dev`, `next dev`, `serve`, `python -m http.server`, `docker run -it`, `kubectl exec -it`, commands with `read` prompts
3. Check for `CLAUI_PARTICLE_ACCELERATOR_BYPASS=1` in the command string — if present, not eligible
4. Check for already-wrapped (`claui-run` prefix) — if present, not eligible
5. Check for pipeline/redirection patterns (spec 8.4): `$(...)`, backticks, `| jq`, `> file`, `>> file` — if detected, not eligible (conservative)
6. Check **allow list** (spec 8.2): match against the ~40 command patterns. Return with `commandFamily` and `filterHint`
7. Default: not eligible

### 4.2 Tests — `tests/particle-accelerator/CommandEligibility.test.ts`

Test cases:
- Each allowed command returns eligible=true with correct family
- Each denied command returns eligible=false
- Already-wrapped commands return eligible=false
- Bypass marker returns eligible=false
- Pipeline `npm test | grep foo` returns eligible=false
- Redirection `npm test > out.txt` returns eligible=false
- Command substitution `$(npm test)` returns eligible=false
- Unknown commands return eligible=false
- Commands with env var prefixes like `NODE_ENV=test npm test` are parsed correctly

### 4.3 Acceptance

- All eligibility tests pass
- No false positives on pipeline/redirection commands

---

## Phase 5: Trace Writer & Context Store

**Goal:** File-based local storage for traces and runtime context.

### 5.1 Create `src/particle-accelerator-runtime/CommandTraceWriter.ts`

```ts
export class CommandTraceWriter {
  constructor(private storeDir: string);

  writeTrace(trace: ParticleAcceleratorTrace): Promise<void>;
  writeRawLog(traceId: string, stream: 'stdout' | 'stderr', content: string): Promise<void>;
}
```

**Implementation (spec 11.4):**
- Atomic writes: write `.tmp` file, flush, rename to final name
- Directory structure: `traces/YYYY-MM-DD/<traceId>.json`, `raw/YYYY-MM-DD/<traceId>.stdout.log`
- Create date directories on demand
- Generate `traceId` as `${Date.now()}-${randomHex(8)}`

### 5.2 Create `src/extension/particle-accelerator/ParticleAcceleratorContextStore.ts`

Manages context files that bridge the extension and the runner (spec 10.4).

```ts
export class ParticleAcceleratorContextStore {
  constructor(private storeDir: string);

  createContext(tabRuntimeId: string, provider: 'claude' | 'codex', workspacePath: string): Promise<string>;
  updateSessionId(tabRuntimeId: string, sessionId: string): Promise<void>;
  updateTurnId(tabRuntimeId: string, turnId: string): Promise<void>;
  disposeContext(tabRuntimeId: string): Promise<void>;
  getContextPath(tabRuntimeId: string): string;
}
```

Context file location: `<storeDir>/contexts/<tabRuntimeId>.json`

### 5.3 Create `src/extension/particle-accelerator/ParticleAcceleratorTraceReader.ts`

Reads traces for the UI dashboard.

```ts
export class ParticleAcceleratorTraceReader {
  constructor(private storeDir: string);

  getRecentTraces(limit: number, workspacePath?: string): Promise<ParticleAcceleratorTraceSummary[]>;
  getTrace(traceId: string): Promise<ParticleAcceleratorTrace | null>;
  getAggregate(workspacePath?: string): Promise<ParticleAcceleratorAggregate>;
  getRawLog(traceId: string, stream: 'stdout' | 'stderr'): Promise<string | null>;
  getDailyReport(date: string): Promise<ParticleAcceleratorDailyReport | null>;
  cleanExpired(settings: ParticleAcceleratorSettings): Promise<{ deletedTraces: number; deletedRawLogs: number; deletedReports: number; freedBytes: number }>;
}
```

### 5.4 Create `src/extension/particle-accelerator/ParticleAcceleratorDailyReportGenerator.ts`

Generates persisted daily aggregate reports (spec 11.2, 11.5). These are stored as `reports/daily-YYYY-MM-DD.json` and retained for 90 days (configurable via `dailyReportRetentionDays`).

```ts
export class ParticleAcceleratorDailyReportGenerator {
  constructor(private storeDir: string, private traceReader: ParticleAcceleratorTraceReader);

  async generateDailyReport(date: string): Promise<ParticleAcceleratorDailyReport>;
  async generateIfMissing(date: string): Promise<void>;
}

type ParticleAcceleratorDailyReport = {
  schemaVersion: 1;
  date: string;
  generatedAt: string;
  commandCount: number;
  failedCommandCount: number;
  totalRawBytes: number;
  totalFilteredBytes: number;
  estimatedTokensSaved: number;
  topCommandFamilies: Array<{ family: string; count: number; tokensSaved: number }>;
  topFilters: Array<{ filter: string; count: number }>;
  avgCompressionRatio: number;
  avgDurationMs: number;
  totalRedactions: number;
  providerBreakdown: Record<string, { count: number; tokensSaved: number }>;
};
```

**Generation triggers:**
- On extension activation, generate report for previous day if missing
- On `ParticleAcceleratorService.dispose()`, generate report for current day (partial)
- The `cleanExpired()` method in TraceReader handles 90-day retention for reports

### 5.5 Retention enforcement — three tiers (spec 11.5)

The `cleanExpired()` method in `ParticleAcceleratorTraceReader` must enforce all three retention policies:

| Data type | Default retention | Setting | Hard cap |
|---|---|---|---|
| Raw redacted logs | 7 days OR 100 MB | `rawLogRetentionDays`, `maxRawLogMb` | 90 days / 5 GB |
| Trace metadata JSON | 30 days OR 10,000 traces | `traceRetentionDays`, `maxTraceCount` | 365 days / 100,000 |
| Daily aggregate reports | 90 days | `dailyReportRetentionDays` | 365 days |

For each tier, enforce whichever limit is reached first (time or count/size). Hard caps apply even if the user overrides settings.

### 5.6 Workspace-local storage (spec 11.1)

When `workspaceLocalStorage` is enabled, storage root moves to `<workspace>/.claui/particle-accelerator/` instead of `<globalStorageUri>/particle-accelerator/`.

Required safeguards:
1. Add `.claui/` to a `.gitignore` suggestion (warn user, don't auto-modify their `.gitignore`)
2. The installer must create the workspace-local directory structure
3. Context files always stay in global storage (they're ephemeral and cross-workspace)
4. If workspace path changes or becomes unavailable, fall back to global storage

### 5.7 Tests

- `tests/particle-accelerator/CommandTraceWriter.test.ts`: atomic write, directory creation, concurrent writes
- `tests/particle-accelerator/ParticleAcceleratorContextStore.test.ts`: create/update/dispose, corrupt file handling
- `tests/particle-accelerator/ParticleAcceleratorTraceReader.test.ts`: read back written traces, aggregation, retention cleanup for all three tiers
- `tests/particle-accelerator/ParticleAcceleratorDailyReportGenerator.test.ts`: report generation from traces, idempotent generation, partial day reports

### 5.8 Acceptance

- Trace files are valid JSON
- Atomic writes confirmed (no partial files on crash simulation)
- Context updates are immediately readable by the runner
- `cleanExpired()` removes expired files for all three tiers independently
- Daily reports are persisted as `reports/daily-YYYY-MM-DD.json`
- Reports are generated on activation for the previous day

---

## Phase 6: CLI Runner (`claui-run`)

**Goal:** Standalone Node.js CLI that ties together redaction, filtering, tracing, and shell execution. Testable from a terminal without VS Code.

### 6.1 Create `src/particle-accelerator-runtime/NoNetworkGuard.ts`

```ts
export function enforceNoNetwork(): void;
```

At runner startup, override `globalThis.fetch` and optionally patch `require('http')` etc. to throw descriptive errors. This is a defense-in-depth measure; the primary enforcement is the static import ban in tests.

### 6.2 Create `src/particle-accelerator-runtime/executeShellCommand.ts`

```ts
export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  interrupted: boolean;
  durationMs: number;
}

export function executeShellCommand(
  command: string,
  options: { cwd: string; shell: string; maxOutputBytes: number; timeoutMs?: number }
): Promise<ShellCommandResult>;
```

**Implementation:**
- Spawn the command in the specified shell (e.g., `sh -c` on Unix, `cmd /c` on Windows)
- Capture stdout and stderr into buffers, capped at `maxOutputBytes`
- Forward SIGINT/SIGTERM/SIGHUP to child process tree
- On Windows, use `taskkill /F /T /PID` pattern from existing `src/extension/process/killTree.ts`
- Preserve original exit code exactly
- Track duration with `performance.now()` or `Date.now()`

### 6.3 Create `src/particle-accelerator-runtime/cli.ts`

This is the entry point for `claui-run`. It will compile to `dist/particle-accelerator-runtime/cli.js`.

**Flow:**

```
1. Parse CLI args:
   --claui-encoded-shell-command <base64url>  (hook form)
   -- <command...>                             (direct form)

2. Validate: if neither form, print usage and exit 1

3. enforceNoNetwork()

4. Read env vars:
   CLAUI_PARTICLE_ACCELERATOR_CONTEXT_FILE -> read context JSON
   CLAUI_PARTICLE_ACCELERATOR_STORE_DIR -> trace/log storage root
   CLAUI_PARTICLE_ACCELERATOR_SHELL -> shell override (optional)

5. Decode original command (base64url decode or join args)

6. Create SecretRedactor from process.env snapshot

7. Execute command via executeShellCommand()

8. Redact stdout and stderr

9. Determine command family (classifyCommand() or from filter registry)

10. Apply output filter

11. Write redacted raw logs (if enabled via settings or default)

12. Write trace file

13. Print filtered stdout to process.stdout
    Print filtered stderr to process.stderr

14. Exit with original exit code
```

**Error handling (spec 23 — all failure modes):**
- If decode fails: print `[claui-particle-accelerator] Runner failed before executing command: <reason>`, exit 127
- If command fails: preserve exit code, filter the failure output
- If redaction fails: suppress output (fail-closed), preserve exit code
- If filter fails: return bounded redacted generic output, mark `filter.fallbackUsed: true` in trace
- If trace write fails: still return filtered output to agent; log warning to stderr
- If raw log directory unavailable: write trace without `stdoutLogPath`/`stderrLogPath` (set to null). Do NOT write unredacted output to an alternate location. Log a warning to stderr
- If Node not found (runner invoked but Node missing): this shouldn't happen since claui-run is a Node script, but if the launcher can't find Node, print a diagnostic and exit 127

### 6.4 Create launcher scripts

Generated at install time (Phase 7), but define the templates here.

**`claui-run` (Unix):**
```sh
#!/usr/bin/env sh
exec node "<absolute-path>/dist/particle-accelerator-runtime/cli.js" "$@"
```

**`claui-run.cmd` (Windows):**
```bat
@echo off
node "<absolute-path>\dist\particle-accelerator-runtime\cli.js" %*
```

### 6.5 Tests — `tests/particle-accelerator/runner/`

Integration tests that invoke `cli.ts` directly (or via `ts-node` / compiled JS):

| Test | Assertion |
|---|---|
| `echo hello` | stdout contains "hello", exit code 0 |
| `exit 42` | exit code 42 |
| `echo $SECRET_TOKEN` (with env SECRET_TOKEN set) | stdout does NOT contain the actual secret |
| Large repeated output (10,000 identical lines) | output is compressed, under budget |
| Pipeline: `echo foo && echo bar` | both lines present (semantics preserved) |
| Encoded form works | base64url-encoded command decodes correctly |
| Direct form works | `-- npm test` form works |
| Trace JSON is written | file exists, valid JSON, correct fields |
| Raw redacted log is written | file exists, no unredacted secrets |
| NoNetworkGuard active | `fetch()` throws if called in runner code |

### 6.6 Acceptance

- Runner works from terminal: `node dist/particle-accelerator-runtime/cli.js -- echo hello`
- Exit codes preserved for success and failure
- Secrets redacted in all outputs
- Trace files written correctly
- No network calls from runner code

---

## Phase 7: Extension Services

**Goal:** Wire Particle Accelerator into the extension lifecycle. The service layer manages installation, environment building, and state.

### 7.1 Create `src/extension/particle-accelerator/ParticleAcceleratorInstaller.ts`

Manages the runtime directory under VS Code global storage.

```ts
export class ParticleAcceleratorInstaller {
  constructor(private globalStorageUri: vscode.Uri, private extensionUri: vscode.Uri);

  async ensureRuntime(): Promise<ParticleAcceleratorRuntimePaths>;
  async isInstalled(): Promise<boolean>;
  async getVersion(): Promise<string | null>;
  async cleanRuntime(): Promise<void>;
}

interface ParticleAcceleratorRuntimePaths {
  binDir: string;       // contains claui-run, claui-run.cmd
  runnerJs: string;     // path to compiled cli.js
  hooksDir: string;     // contains hook scripts
  storeDir: string;     // traces, raw logs, contexts
}
```

**`ensureRuntime()` implementation:**
1. Check `<globalStorage>/particle-accelerator/runtime/version.json` for current version
2. If missing or version mismatch, copy compiled runtime files from `<extensionPath>/dist/particle-accelerator-runtime/` to global storage
3. Generate `claui-run` and `claui-run.cmd` launcher scripts pointing to the copied `cli.js`
4. Set executable permission on Unix: `chmod +x claui-run`
5. Write `version.json` with current extension version
6. Create `storeDir` subdirectories: `contexts/`, `traces/`, `raw/`, `reports/`, `config/`
7. Create default `config/filters.json` if missing (empty overrides: `{ "budgetOverrides": {}, "extraImportantPatterns": [], "disabledFilters": [] }`)

### 7.2 Create `src/extension/particle-accelerator/ParticleAcceleratorEnvBuilder.ts`

Builds the environment for spawned agent processes (spec section 10).

```ts
export function buildParticleAcceleratorAgentEnv(input: ParticleAcceleratorEnvInput): NodeJS.ProcessEnv;
```

**Implementation:**
1. Clone `baseEnv`
2. Set all `CLAUI_PARTICLE_ACCELERATOR_*` env vars (spec 10.2)
3. Prepend `binDir` to PATH
4. Save original PATH as `CLAUI_PARTICLE_ACCELERATOR_ORIGINAL_PATH`
5. Remove external telemetry vars (spec 10.3): `BOOST_*`, `JFROG_*`, `OTEL_EXPORTER_*`, `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, etc.
6. Verify `node` is available — if not, throw with actionable message

### 7.3 Create `src/extension/particle-accelerator/ParticleAcceleratorService.ts`

The top-level service that ties everything together. Instantiated once per extension activation.

```ts
export class ParticleAcceleratorService implements vscode.Disposable {
  constructor(context: vscode.ExtensionContext);

  async initialize(): Promise<void>;
  isEnabled(): boolean;
  getStatus(): ParticleAcceleratorStatus;
  getRuntimePaths(): ParticleAcceleratorRuntimePaths | null;
  getSettings(): ParticleAcceleratorSettings;
  buildAgentEnv(input: ParticleAcceleratorEnvInput): NodeJS.ProcessEnv;
  getContextStore(): ParticleAcceleratorContextStore;
  getTraceReader(): ParticleAcceleratorTraceReader;
  getHookManager(): ParticleAcceleratorHookManager;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
}
```

**`initialize()` flow:**
1. Read settings
2. If not enabled, return early
3. Verify Node.js is available
4. Call `installer.ensureRuntime()`
5. Create `ContextStore`, `TraceReader` instances
6. Create `HookManager` instance
7. Listen for settings changes
8. Schedule retention cleanup (daily or on activation)

### 7.4 Register service in `src/extension/extension.ts`

In the `activate()` function:
```ts
const particleAcceleratorService = new ParticleAcceleratorService(context);
await particleAcceleratorService.initialize();
context.subscriptions.push(particleAcceleratorService);
```

Pass `particleAcceleratorService` to process managers and message handlers that need it.

### 7.5 Tests

- `tests/particle-accelerator/ParticleAcceleratorEnvBuilder.test.ts`: env vars set correctly, PATH prepended, telemetry vars removed, original PATH preserved
- `tests/particle-accelerator/ParticleAcceleratorInstaller.test.ts`: runtime created, version check works, update replaces files

### 7.6 Acceptance

- Service initializes without errors when enabled
- Service is a no-op when disabled
- Runtime files are created in global storage
- Node availability is checked

---

## Phase 8: Process Manager Integration

**Goal:** Modify existing process managers to inject Particle Accelerator environment when enabled.

### 8.1 Modify `src/extension/process/ClaudeProcessManager.ts`

**Minimal changes:**

1. Accept `ParticleAcceleratorService` (or null) in constructor or via setter
2. Before spawning Claude CLI (`child_process.spawn`), check if Particle Accelerator is enabled
3. If enabled:
   ```ts
   const env = this.particleAcceleratorService.buildAgentEnv({
     baseEnv: process.env,
     provider: 'claude',
     workspacePath: this.cwd,
     tabRuntimeId: this.tabRuntimeId,
     sessionId: this.resumeSessionId ?? null,
   });
   ```
4. Pass `env` to spawn options instead of `process.env`
5. If instruction fallback is needed (no hook installed), append Particle Accelerator instruction to system prompt if that mechanism exists

### 8.2 Modify `src/extension/process/CodexExecProcessManager.ts`

Same pattern, but `provider: 'codex'`.

Additional Codex-specific logic:
1. If `codexMode === 'instruction-only'`, append Particle Accelerator usage instruction to Codex `-c instructions=` parameter
2. Preserve existing instructions (append, don't replace)
3. If `codexMode === 'hook-guard'`, env injection is sufficient (hook handles routing)
4. If `codexMode === 'off'`, skip all Particle Accelerator integration

### 8.3 Modify `src/extension/session/SessionTab.ts`

1. Receive or create `tabRuntimeId`
2. Before starting Claude process, call `contextStore.createContext(tabRuntimeId, 'claude', workspacePath)`
3. When Claude `init` event provides `session_id`, call `contextStore.updateSessionId(tabRuntimeId, sessionId)`
4. On user turn start, call `contextStore.updateTurnId(tabRuntimeId, turnId)` if turn tracking exists
5. On tab dispose, call `contextStore.disposeContext(tabRuntimeId)`

### 8.4 Modify `src/extension/session/CodexSessionTab.ts`

Same as SessionTab but for Codex:
1. Create context with `provider: 'codex'`
2. Update session ID when `thread.started` event fires with thread ID

### 8.5 Modify `src/extension/analytics/ProjectAnalyticsStore.ts`

Add aggregate Particle Accelerator stats to session summaries (spec 17.7). This connects per-session command compression data to the existing analytics pipeline.

1. Add optional field to session summary type:
   ```ts
   particleAccelerator?: ParticleAcceleratorSessionStats;
   ```

2. Define `ParticleAcceleratorSessionStats` (in ParticleAcceleratorTypes.ts, referenced here):
   ```ts
   type ParticleAcceleratorSessionStats = {
     commandCount: number;
     failedCommandCount: number;
     totalRawBytes: number;
     totalFilteredBytes: number;
     estimatedTokensSaved: number;
     topCommandFamilies: Array<{ family: string; count: number }>;
   };
   ```

3. When a session ends, aggregate trace data for that session's `tabRuntimeId` via `ParticleAcceleratorTraceReader.getAggregate()` and attach to the session summary.

4. **Backward compatibility:** Old summaries without `particleAccelerator` field must load without errors. Use optional chaining throughout.

5. **Do NOT feed raw/filtered command output into ActivitySummarizer.** Only allowed integration: `recordToolUse("Bash (npm test, compressed by ClaUi Particle Accelerator)")` — no output content.

### 8.6 Modify `src/webview/hooks/useClaudeStream.ts`

If this hook processes incoming stream events to update the store, add handling for Particle Accelerator aggregate updates. When the extension sends `particleAcceleratorAggregateUpdate` or `particleAcceleratorTraceUpdate` messages, forward them to the store's Particle Accelerator slice.

### 8.7 Acceptance

- Claude sessions start with Particle Accelerator env vars when enabled
- Codex sessions start with Particle Accelerator env vars when enabled
- Context files are created and updated during session lifecycle
- Session summaries in ProjectAnalyticsStore include `particleAccelerator` stats when the feature is active
- Old session summaries without `particleAccelerator` field load without errors
- Existing Claude/Codex flows work identically when Particle Accelerator is disabled (all changes are gated)

---

## Phase 9: Hook System

**Goal:** Install/uninstall provider hooks that route commands through claui-run.

### 9.1 Create hook scripts

**`src/particle-accelerator-runtime/hooks/claudePreToolUse.ts`**

Standalone Node.js script. Reads JSON from stdin, writes JSON to stdout.

```
1. Read stdin (JSON)
2. Parse hook input
3. If tool_name !== "Bash", exit 0 (no output = allow unchanged)
4. Extract tool_input.command
5. If command starts with "claui-run" or contains CLAUI_PARTICLE_ACCELERATOR_BYPASS=1:
   exit 0 (allow unchanged)
6. Call classifyCommand(command)
7. If not eligible: exit 0 (allow unchanged)
8. Base64url-encode the original command
9. Build rewritten command: "claui-run --claui-encoded-shell-command <encoded>"
10. Output JSON (spec 7.1):
    {
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": "Routing noisy Bash output through ClaUi local compression.",
        "updatedInput": {
          "command": "<rewritten>",
          "description": "<preserve original if present>"
          // preserve ALL other tool_input fields
        }
      }
    }
```

**`src/particle-accelerator-runtime/hooks/codexPreToolUse.ts`**

Same stdin/stdout pattern, but uses deny+retry (spec 7.2):

```
1-6. Same as Claude hook
7. If eligible and not already wrapped:
   Output JSON:
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "deny",
       "permissionDecisionReason": "This command should be routed through ClaUi local compression. Retry exactly as: claui-run --claui-encoded-shell-command <encoded>"
     }
   }
```

### 9.2 Create `src/extension/particle-accelerator/ParticleAcceleratorHookManager.ts`

```ts
export class ParticleAcceleratorHookManager {
  constructor(
    private runtimePaths: ParticleAcceleratorRuntimePaths,
    private settings: ParticleAcceleratorSettings
  );

  async installClaudeHook(workspacePath: string): Promise<void>;
  async uninstallClaudeHook(workspacePath: string): Promise<void>;
  async isClaudeHookInstalled(workspacePath: string): Promise<boolean>;

  async installCodexHook(workspacePath: string): Promise<void>;
  async uninstallCodexHook(workspacePath: string): Promise<void>;
  async isCodexHookInstalled(workspacePath: string): Promise<boolean>;
}
```

**Claude hook install (spec 16.2):**

1. Target file: `<workspace>/.claude/settings.json`
2. Create `.claude/` directory if missing
3. Read existing `settings.json`:
   - If file exists but is invalid JSON: **do NOT modify**. Show error with exact file path: `"Cannot install hook: <path> contains invalid JSON. Please fix the file manually or delete it to start fresh."` Return without writing.
   - If file does not exist: start with `{}`
4. Back up: `.claude/settings.json.claui-backup-<timestamp>`
5. Merge a PreToolUse hook entry:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {
               "type": "command",
               "command": "node \"<absolute-path>/hooks/claude-pre-tool-use.js\" --claui-managed-hook claude-pre-tool-use"
             }
           ]
         }
       ]
     }
   }
   ```
6. Preserve ALL existing settings and hooks
7. Identify managed hook by the `--claui-managed-hook` marker
8. Do not duplicate if already present
9. Write back with `JSON.stringify(data, null, 2)`

**Claude hook uninstall:**
1. Read settings.json
2. Find and remove only the entry containing `--claui-managed-hook claude-pre-tool-use`
3. If the hooks array becomes empty, remove the key
4. Preserve everything else

**Codex hook install (spec 16.3):**
1. Target file: `<workspace>/.codex/hooks.json` (project-local)
2. Same merge/backup/marker pattern
3. Before installing, verify Codex hook support empirically (check CLI version, feature flags)
4. If support cannot be verified, return error indicating instruction-only mode is recommended

### 9.3 Tests

- `tests/particle-accelerator/hooks/claudePreToolUse.test.ts`: mock stdin/stdout, verify rewrite for eligible commands, passthrough for ineligible
- `tests/particle-accelerator/hooks/codexPreToolUse.test.ts`: mock stdin/stdout, verify deny output for eligible commands
- `tests/particle-accelerator/ParticleAcceleratorHookManager.test.ts`: install/uninstall, merge behavior, backup creation, idempotent install, clean uninstall

### 9.4 Acceptance

- Claude hook rewrites `npm test` to `claui-run --claui-encoded-shell-command <encoded>`
- Claude hook passes through `echo hello` unchanged
- Claude hook passes through already-wrapped commands unchanged
- Codex hook denies eligible commands with retry instruction
- Hook install preserves existing user settings
- Hook uninstall removes only ClaUi-managed entry
- Backup file created on first install

---

## Phase 10: Webview UI

**Goal:** Add Particle Accelerator status, settings, and trace viewer to the ClaUi webview.

### 10.1 Update `src/extension/types/webview-messages.ts`

Add message types (spec 17.6):

```ts
// Webview -> Extension
| { type: 'particleAcceleratorGetStatus' }
| { type: 'particleAcceleratorSetEnabled'; enabled: boolean }
| { type: 'particleAcceleratorInstallHooks'; provider: 'claude' | 'codex' | 'both' }
| { type: 'particleAcceleratorUninstallHooks'; provider: 'claude' | 'codex' | 'both' }
| { type: 'particleAcceleratorOpenTrace'; traceId: string }
| { type: 'particleAcceleratorClearData'; scope: 'workspace' | 'all' }
| { type: 'particleAcceleratorExportReport'; scope: 'workspace' | 'all' }

// Extension -> Webview
| { type: 'particleAcceleratorStatus'; status: ParticleAcceleratorStatus }
| { type: 'particleAcceleratorTraceUpdate'; trace: ParticleAcceleratorTraceSummary }
| { type: 'particleAcceleratorAggregateUpdate'; aggregate: ParticleAcceleratorAggregate }
| { type: 'particleAcceleratorError'; error: string }
```

### 10.2 Update message handlers

In `src/extension/webview/MessageHandler.ts` and `src/extension/webview/CodexMessageHandler.ts`:
- Add case handlers for `particleAccelerator*` messages
- Route to `ParticleAcceleratorService` methods
- Return status/trace/aggregate data to webview

### 10.3 Update webview store — `src/webview/state/store.ts`

Add Particle Accelerator state slice:

```ts
particleAccelerator: {
  status: ParticleAcceleratorStatus | null;
  recentTraces: ParticleAcceleratorTraceSummary[];
  aggregate: ParticleAcceleratorAggregate | null;
  error: string | null;
};
```

Add actions: `setParticleAcceleratorStatus`, `addParticleAcceleratorTrace`, `setParticleAcceleratorAggregate`, `setParticleAcceleratorError`.

### 10.4 Create UI components

**`src/webview/components/ParticleAccelerator/`** (new directory)

| Component | Purpose |
|---|---|
| `ParticleAcceleratorStatusBadge.tsx` | Small badge in status bar area: "Particle Accelerator: Off/On - N cmds - ~Xk tokens saved" |
| `ParticleAcceleratorSettingsPanel.tsx` | Toggle enable, hook install/uninstall buttons, codex mode, filter profile, clear data |
| `ParticleAcceleratorTracePanel.tsx` | Table of recent traces: time, provider, command family, exit, duration, raw/filtered bytes, tokens saved, filter, redactions |
| `ParticleAcceleratorTraceDetail.tsx` | Expanded view of single trace with redacted log viewer |

### 10.5 Integrate into existing layout

- Add `ParticleAcceleratorStatusBadge` to the `StatusBar` component (or `VitalsInfoPanel` area)
- Add `ParticleAcceleratorSettingsPanel` as a collapsible section in the Vitals dashboard or a dedicated tab
- Add `ParticleAcceleratorTracePanel` as a section in Vitals/Analytics or as its own dashboard tab

### 10.6 Error UX — specific error states (spec 18.4)

Each error state must be actionable and not noisy. Display in the status badge or as a dismissible banner:

| Error state | Display | Action |
|---|---|---|
| Node runtime not found for claui-run | "Particle Accelerator: Node.js required" | Link to Node.js install instructions |
| Claude hook not installed | "Particle Accelerator: Hook not installed for this workspace" | "Install Hook" button |
| Codex hooks not enabled/trusted | "Particle Accelerator: Advisory mode (Codex hooks unavailable)" | Show codexMode setting |
| Runner failed | "Particle Accelerator: Runner error — [reason]" | "View Details" expands to show diagnostic |
| Redaction failed closed | "Particle Accelerator: Output suppressed (redaction error)" | "View Trace" link to the affected trace |
| Trace storage unavailable | "Particle Accelerator: Cannot write traces — [path]" | "Open Folder" to show the storage location |
| Existing hook settings invalid JSON | "Particle Accelerator: Cannot install hook — [path] is invalid JSON" | "Open File" to let user fix it |

Errors should be shown once per session occurrence, not on every command. Use a dismissible notification pattern.

### 10.7 Acceptance

- Status badge shows current state (off/on/advisory)
- Enable/disable toggle works
- Hook install/uninstall buttons work and reflect current state
- Trace panel shows recent commands after running an agent session with Particle Accelerator enabled
- Aggregate stats (total commands, total tokens saved) are displayed

---

## Phase 11: Build & Webpack Configuration

**Goal:** Bundle the runtime as a third webpack target and ensure it's included in the VSIX.

### 11.1 Update `webpack.config.js`

Add a third entry in the configs array:

```js
{
  name: 'particle-accelerator-runtime',
  target: 'node',
  mode: mode,
  entry: {
    'cli': './src/particle-accelerator-runtime/cli.ts',
    'hooks/claude-pre-tool-use': './src/particle-accelerator-runtime/hooks/claudePreToolUse.ts',
    'hooks/codex-pre-tool-use': './src/particle-accelerator-runtime/hooks/codexPreToolUse.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'particle-accelerator-runtime'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',  // should never be imported, but safety
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
  },
  // IMPORTANT: do NOT use terser to strip console.log in runtime
  // (the runner outputs to stdout/stderr intentionally)
  optimization: {
    minimize: false,
  },
}
```

### 11.2 Update `.vscodeignore` (if exists) or `vsce` package config

Ensure `dist/particle-accelerator-runtime/` is included in the VSIX package.

### 11.3 Verify packaging

After `npm run build`:
```
dist/
  extension.js
  webview.js
  particle-accelerator-runtime/
    cli.js
    hooks/
      claude-pre-tool-use.js
      codex-pre-tool-use.js
```

After `npm run deploy:local`:
- Installed extension folder at `~/.vscode/extensions/` contains `dist/particle-accelerator-runtime/`
- Generated `claui-run` scripts in global storage point to valid JS files

### 11.4 Acceptance

- `npm run build` succeeds with all three targets
- `npm run deploy:local` installs with runtime files
- `claui-run` is executable from a terminal after extension activation
- No `console.log` stripping in runtime bundle (test by running `claui-run -- echo test`)

---

## Phase 12: Testing & Security Audit

**Goal:** Comprehensive test coverage and security verification.

### 12.1 No-network static test

Create `tests/particle-accelerator/security/noNetworkImports.test.ts`:

Scan all files in `src/particle-accelerator-runtime/` for imports of banned modules:
```
http, https, net, dgram, http2, ws, undici, node-fetch, @opentelemetry/exporter-*
```

Fail the test if any are found.

### 12.2 No-network runtime test

Create `tests/particle-accelerator/security/noNetworkRuntime.test.ts`:

Monkeypatch `globalThis.fetch`, `require('http')`, `require('https')`, `require('net')`, `require('dgram')` to throw, then run runner scenarios. Verify the runner completes without network-related errors.

### 12.3 Full redaction integration test

Create `tests/particle-accelerator/security/redactionIntegration.test.ts`:

Set environment variables with known secrets, run commands that echo those secrets, verify:
1. Filtered output returned by runner does not contain secrets
2. Trace JSON does not contain secrets
3. Raw redacted log files do not contain secrets
4. Output header does not contain secrets

### 12.4 Unit test summary

| Module | Test file | Key cases |
|---|---|---|
| SecretRedactor | `tests/particle-accelerator/SecretRedactor.test.ts` | 10+ cases (Phase 2) |
| GenericFilter | `tests/particle-accelerator/filters/GenericFilter.test.ts` | ANSI strip, dedup, budgets |
| JS Package Filter | `tests/particle-accelerator/filters/JavaScriptPackageFilter.test.ts` | npm test output compression |
| Pytest Filter | `tests/particle-accelerator/filters/PytestFilter.test.ts` | pytest output compression |
| Jest/Vitest Filter | `tests/particle-accelerator/filters/JestVitestFilter.test.ts` | jest output compression |
| TypeScript Filter | `tests/particle-accelerator/filters/TypeScriptFilter.test.ts` | tsc diagnostic grouping |
| ESLint Filter | `tests/particle-accelerator/filters/EslintFilter.test.ts` | eslint diagnostic grouping |
| Playwright Filter | `tests/particle-accelerator/filters/PlaywrightFilter.test.ts` | playwright output compression (post-MVP) |
| Docker Filter | `tests/particle-accelerator/filters/DockerFilter.test.ts` | docker build/logs compression (post-MVP) |
| Go Filter | `tests/particle-accelerator/filters/GoFilter.test.ts` | go test output compression (post-MVP) |
| Maven/Gradle Filter | `tests/particle-accelerator/filters/MavenGradleFilter.test.ts` | mvn/gradle compression (post-MVP) |
| Cargo Filter | `tests/particle-accelerator/filters/CargoFilter.test.ts` | cargo test/build compression (post-MVP) |
| GitDiff Filter | `tests/particle-accelerator/filters/GitDiffFilter.test.ts` | large diff compression (post-MVP) |
| DailyReportGenerator | `tests/particle-accelerator/ParticleAcceleratorDailyReportGenerator.test.ts` | report generation, idempotency |
| CommandEligibility | `tests/particle-accelerator/CommandEligibility.test.ts` | 15+ cases (Phase 4) |
| CommandTraceWriter | `tests/particle-accelerator/CommandTraceWriter.test.ts` | atomic writes |
| ParticleAcceleratorContextStore | `tests/particle-accelerator/ParticleAcceleratorContextStore.test.ts` | lifecycle |
| ParticleAcceleratorEnvBuilder | `tests/particle-accelerator/ParticleAcceleratorEnvBuilder.test.ts` | env vars |
| Hook: Claude | `tests/particle-accelerator/hooks/claudePreToolUse.test.ts` | rewrite/passthrough |
| Hook: Codex | `tests/particle-accelerator/hooks/codexPreToolUse.test.ts` | deny/passthrough |
| HookManager | `tests/particle-accelerator/ParticleAcceleratorHookManager.test.ts` | install/uninstall |
| No-network static | `tests/particle-accelerator/security/noNetworkImports.test.ts` | import scan |
| No-network runtime | `tests/particle-accelerator/security/noNetworkRuntime.test.ts` | monkeypatch |
| Redaction integration | `tests/particle-accelerator/security/redactionIntegration.test.ts` | end-to-end |

### 12.5 Manual QA matrix (spec 21.5)

Run all of these in VS Code after deploy:

| Scenario | Provider | What to verify |
|---|---|---|
| New session, hook installed | Claude | Noisy `npm test` output is compressed |
| Resumed session | Claude | Particle Accelerator still active, context updated |
| Command failure | Claude | Exit code preserved, failure details visible |
| Command success | Claude | Output compressed, tokens saved shown |
| Cancel while command running | Claude | Child process killed, trace marked interrupted |
| Instruction-only mode | Codex | Status shows "advisory", instruction appended |
| Hook-guard mode (if supported) | Codex | Deny/retry cycle works |
| Provider switch Claude <-> Codex | Both | Env vars change, hooks match provider |
| Multiple tabs concurrently | Both | Traces are per-tab, no cross-contamination |
| Workspace path with spaces | Both | Launcher scripts handle quoted paths |
| Windows cmd/PowerShell | Both | claui-run.cmd works |
| Disable feature | Both | No wrapping, no env vars injected |
| Uninstall hooks | Both | Settings files cleaned, only managed entry removed |
| Clear local data | Both | Traces and raw logs deleted |

### 12.6 Security review checklist (spec 24)

Before considering the feature complete, verify every item:

- [ ] No network imports in Particle Accelerator runtime
- [ ] No telemetry/exporter dependencies added
- [ ] No JFrog Boost binary or code included
- [ ] No raw unredacted output persisted
- [ ] Redaction tests cover stdout, stderr, command preview, trace JSON, and logs
- [ ] Hook installation is opt-in
- [ ] Hook uninstallation removes only ClaUi-managed entries
- [ ] Local logs are excluded from Git (add to .gitignore if workspace-local storage is used)
- [ ] Commands preserve exit code
- [ ] Pipeline semantics are tested
- [ ] Large output caps are enforced
- [ ] ActivitySummarizer does not receive command output
- [ ] Workstream prompts do not include raw logs

---

## Summary: File Creation Checklist

### New files to create

```
src/extension/particle-accelerator/
  ParticleAcceleratorTypes.ts
  ParticleAcceleratorSettings.ts
  ParticleAcceleratorService.ts
  ParticleAcceleratorInstaller.ts
  ParticleAcceleratorEnvBuilder.ts
  ParticleAcceleratorContextStore.ts
  ParticleAcceleratorHookManager.ts
  ParticleAcceleratorTraceReader.ts
  ParticleAcceleratorDailyReportGenerator.ts
  CommandEligibility.ts              (extension-side copy if needed)

src/particle-accelerator-runtime/
  cli.ts
  executeShellCommand.ts
  SecretRedactor.ts
  CommandTraceWriter.ts
  CommandEligibility.ts
  NoNetworkGuard.ts
  filters/
    OutputFilterRegistry.ts
    GenericFilter.ts
    JavaScriptPackageFilter.ts
    PytestFilter.ts
    JestVitestFilter.ts
    PlaywrightFilter.ts
    TypeScriptFilter.ts
    EslintFilter.ts
    DockerFilter.ts
    GoFilter.ts
    MavenGradleFilter.ts
    CargoFilter.ts
    GitDiffFilter.ts
  hooks/
    claudePreToolUse.ts
    codexPreToolUse.ts

src/webview/components/ParticleAccelerator/
  ParticleAcceleratorStatusBadge.tsx
  ParticleAcceleratorSettingsPanel.tsx
  ParticleAcceleratorTracePanel.tsx
  ParticleAcceleratorTraceDetail.tsx

tests/particle-accelerator/
  SecretRedactor.test.ts
  CommandEligibility.test.ts
  CommandTraceWriter.test.ts
  ParticleAcceleratorContextStore.test.ts
  ParticleAcceleratorEnvBuilder.test.ts
  ParticleAcceleratorHookManager.test.ts
  ParticleAcceleratorDailyReportGenerator.test.ts
  filters/
    GenericFilter.test.ts
    JavaScriptPackageFilter.test.ts
    PytestFilter.test.ts
    JestVitestFilter.test.ts
    TypeScriptFilter.test.ts
    EslintFilter.test.ts
    PlaywrightFilter.test.ts         (post-MVP)
    DockerFilter.test.ts             (post-MVP)
    GoFilter.test.ts                 (post-MVP)
    MavenGradleFilter.test.ts        (post-MVP)
    CargoFilter.test.ts              (post-MVP)
    GitDiffFilter.test.ts            (post-MVP)
  hooks/
    claudePreToolUse.test.ts
    codexPreToolUse.test.ts
  runner/
    cliIntegration.test.ts
  security/
    noNetworkImports.test.ts
    noNetworkRuntime.test.ts
    redactionIntegration.test.ts
```

### Existing files to modify

```
package.json                                          — add 12 settings (8 original + 4 new retention/storage)
webpack.config.js                                     — add particle-accelerator-runtime target
src/extension/extension.ts                            — instantiate ParticleAcceleratorService
src/extension/process/ClaudeProcessManager.ts         — inject env when enabled
src/extension/process/CodexExecProcessManager.ts      — inject env when enabled (TBD: verify file name)
src/extension/session/SessionTab.ts                   — context file lifecycle
src/extension/session/CodexSessionTab.ts              — context file lifecycle (TBD: verify existence)
src/extension/webview/MessageHandler.ts               — add particleAccelerator message handlers
src/extension/webview/CodexMessageHandler.ts          — add particleAccelerator message handlers (TBD: verify)
src/extension/analytics/ProjectAnalyticsStore.ts      — add ParticleAcceleratorSessionStats to session summaries
src/extension/types/webview-messages.ts               — add particleAccelerator message types
src/webview/state/store.ts                            — add particleAccelerator state slice
src/webview/hooks/useClaudeStream.ts                  — forward particleAccelerator messages to store
src/webview/components/StatusBar/*                    — add status badge
```

---

## Phase 13: Documentation Update

**Goal:** Update ClaUi technical docs to reflect the final implementation (spec section 27, point 9).

### 13.1 Create detail doc

Create `Kingdom_of_Claudes_Beloved_MDs/PARTICLE_ACCELERATOR.md` containing:
- What Particle Accelerator does and why it exists
- Full file listing with paths
- Architecture: runner, hooks, extension services, UI
- All VS Code settings with descriptions
- Hook installation format and marker identification
- Storage directory structure and retention policies
- Trace schema
- Filter list and how to add new filters
- Security model (no-network, redaction, fail-closed)
- Known limitations and constraints

### 13.2 Update `TECHNICAL.md`

Add an index entry for Particle Accelerator:
```
**[Particle Accelerator]** — Local-only command output compressor that reduces noisy Bash output before it reaches coding agents. Redacts secrets, filters noise, preserves exit codes, and tracks local-only metrics.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PARTICLE_ACCELERATOR.md`
```

Update the directory structure section to include `src/extension/particle-accelerator/`, `src/particle-accelerator-runtime/`, and `src/webview/components/ParticleAccelerator/`.

Update the settings table to include the new `claudeMirror.particleAccelerator.*` settings.

Update the dependencies table if any new packages were added.

### 13.3 Acceptance

- `PARTICLE_ACCELERATOR.md` exists and documents the current implementation
- `TECHNICAL.md` has an index entry pointing to it
- No references to removed or renamed files
- Documentation is a snapshot of current state (no history)

---

## Estimated Effort by Phase

| Phase | Scope | Complexity | Notes |
|---|---|---|---|
| 1: Types & Settings | Small | Low | Foundation, quick |
| 2: Secret Redactor | Medium | High | Security-critical, thorough testing needed |
| 3: Output Filters | Large | Medium | MVP: 6 filters; post-MVP: 6 more |
| 4: Command Eligibility | Small | Low | Pattern matching |
| 5: Trace Writer & Context | Medium | Medium | File I/O, atomicity, daily reports, retention |
| 6: CLI Runner | Medium | High | Ties everything together, process management |
| 7: Extension Services | Medium | Medium | VS Code API integration |
| 8: Process Manager Integration | Medium | Medium | Process managers + ProjectAnalyticsStore + useClaudeStream |
| 9: Hook System | Medium | High | Provider-specific, JSON merging, invalid JSON handling |
| 10: Webview UI | Medium | Medium | React components, messaging, error UX |
| 11: Build & Webpack | Small | Medium | Packaging correctness |
| 12: Testing & Security | Large | High | Comprehensive coverage required |
| 13: Documentation | Small | Low | Detail doc + TECHNICAL.md update |

**Recommended execution order:** 1 -> 2 -> 4 -> 3 (MVP filters first) -> 5 -> 6 -> 11 (get build working early) -> 7 -> 8 -> 9 -> 10 -> 12 (ongoing) -> 13 (final)
