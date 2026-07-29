# Super Particle Accelerator (SPA)

Hook-based secret write guard that intercepts every AI agent write operation and blocks attempts to write secrets into the codebase.

## What It Does

SPA installs hooks into Claude Code (`.claude/settings.json`) and Codex (`.codex/hooks.json`) that run before and after tool operations. It scans file writes, bash commands, MCP tool arguments, and the working tree for secrets, then blocks or audits operations containing them.

## Architecture

### Three Layers

1. **Runtime layer** (`src/super-particle-accelerator-runtime/`) - Standalone Node.js scripts that run as hooks. Separate webpack target, no VS Code dependencies. Two entry points: `claude-spa.js` and `codex-spa.js`.

2. **Extension layer** (`src/extension/super-particle-accelerator/`) - VS Code service that manages lifecycle, installs/uninstalls hooks, builds env vars, reads audit events, and manages exceptions.

3. **UI layer** (`src/webview/components/SuperParticleAccelerator/`) - React components for status badge and settings/audit panel.

### Runtime Modules

| Module | Purpose |
|--------|---------|
| `SecretScanner.ts` | Wraps `CompositeSecretScanner`, maps findings to `SecretFinding`, safe redaction |
| `PathClassifier.ts` | Classifies file paths by risk: public-client-code, generated-public-artifact, server-code, local-secret-file, unknown-repository-file |
| `SecretWritePolicyEngine.ts` | Deny-first waterfall with 5 gates |
| `GitStateScanner.ts` | Git diff parsing, staged/unstaged/untracked scanning, `isGitIgnored()` verification |
| `AuditWriter.ts` | JSONL audit files at `<storeDir>/audit/YYYY-MM-DD.jsonl` |
| `ExceptionLoader.ts` | Read-only exception loading + `consumeMany` with atomic write |
| `BaselineStore.ts` | Per-session baseline JSON for Stop hook deduplication |

### Policy Engine Gates (Deny-First Waterfall)

```
Gate 0: No findings -> ALLOW
Gate 1: All placeholders/low-confidence -> ALLOW
Gate 2: Public/client path -> DENY in block mode (no exception can override); AUDIT in audit mode
Gate 3: Gitignored env file + allowIgnoredEnvFiles -> AUDIT
Gate 4: Covered by valid exception -> AUDIT
Default: DENY in block mode, AUDIT in audit mode
```

**Audit mode never blocks.** The `mode` setting is authoritative for every gate: `audit` means log-only for all paths, including public/client code. In `block` mode, Gate 2 remains a hard deny that no exception can override. Gate 3 requires `isFileGitIgnored === true` (not undefined, not false).

### Hook Events

| Event | Claude | Codex | Behavior |
|-------|--------|-------|----------|
| PreToolUse | Edit/Write/MultiEdit, Bash, mcp__* | Edit/Write/MultiEdit/apply_patch, Bash, mcp__* | Scan content, deny if secrets found. Fail-closed on timeout. |
| PermissionRequest | — | Bash | Codex-specific. Scans Bash commands for secrets before approval. Same logic as PreToolUse. |
| PostToolUse | Bash | Bash | Scan output for echoed secrets. Audit-only, fail-open. |
| Stop | all | all | Scan working tree (staged+unstaged+untracked), baseline-filtered. Fail-open. |

### Security Properties

- **Fail-closed on PreToolUse**: Timeouts and errors produce `deny` for write operations.
- **Fail-open on PostToolUse/Stop**: Timeouts and errors allow completion.
- **Gitignore verification required**: `.env.local` files are only allowed through Gate 3 if `git check-ignore` confirms they are gitignored. Unverified files are denied.
- **Public path hard deny (block mode)**: In block mode, no exception can override a deny for `public/`, `dist/`, `build/`, `static/`, `client/`, `frontend/`, `web/`, `*.bundle.js`, `*.min.js`. Audit mode records these findings without blocking.
- **Untracked file scanning**: Git add/commit/push guards scan untracked files, not just staged/unstaged diffs.
- **Redaction**: Raw secret values never appear in audit/logs/hook output. Only `redactedPreview` (max 25% revealed, capped at 8 chars) and `valueSha256`.
- **SPA hooks ordered before PA hooks**: `installHookEntry()` inserts before any PA-marker entries to ensure SPA runs first.
- **Large content truncation**: Content exceeding `MAX_SCAN_BYTES` (2MB) is truncated to the first 2MB and scanned, not skipped. Secrets embedded in the first 2MB of oversized writes are still detected.
- **Configurable entropy threshold**: The `entropyThreshold` setting (default 4.2) is wired through `SpaSecretScanner` -> `CompositeSecretScanner` -> `EntropyScanner`. Lower values increase sensitivity; the default Secret Protection system uses 4.5.
- **Runtime file is the single source of truth**: Hooks consult `runtime-enabled.json` in `CLAUI_SPA_STORE_DIR` FIRST. Env vars are frozen at process spawn time and serve only as a fallback when the file is absent. In particular, `enabled: false` in the file overrides a stale `CLAUI_SPA=1` env, so a mid-session disable from the UI immediately stops enforcement in already-running agent processes.

### File-Based Runtime Settings (Single Source of Truth)

`SuperParticleAcceleratorService.reconcile()` rewrites `runtime-enabled.json` with the full settings object (including `enabled: true/false`) on initialize, on every settings change, on every UI toggle, and on every mode change. The file is never deleted on disable — it is written with `enabled: false`, which hooks treat as an authoritative stop signal.

```
main() flow (both hooks):
1. Read CLAUI_SPA_STORE_DIR from env (always set, even when disabled)
2. tryLoadRuntimeSettings() reads runtime-enabled.json:
   - file says enabled:false -> exit 0 (SPA off, overrides any env)
   - file says enabled:true  -> use file-based settings
   - file absent/corrupt     -> fall back to env: CLAUI_SPA === '1' ? env settings : exit 0
```

The env builder (`SuperParticleAcceleratorEnvBuilder`) always returns `CLAUI_SPA_STORE_DIR` even when SPA is disabled (`CLAUI_SPA: '0'`), ensuring running processes can discover the store directory.

### Status Verification and Drift Detection

`SuperParticleAcceleratorService.getStatus()`:

- **Setting enabled**: delegates to `SuperParticleAcceleratorHookManager.getStatus()`, which checks both Claude and Codex hook files with specific matcher verification per event type:
  - Claude: PreToolUse(`Edit|Write|MultiEdit`), PreToolUse(`Bash`), PreToolUse(`mcp__.*`), PostToolUse(`Bash`), Stop(``)
  - Codex: PreToolUse(`Edit|Write|MultiEdit|apply_patch`), PreToolUse(`Bash`), PreToolUse(`mcp__.*`), PermissionRequest(`Bash`), PostToolUse(`Bash`), Stop(``)
- **Setting disabled**: verifies nothing on disk still enforces (`hasEnforcementResidue()`: runtime file `enabled:true`, or any SPA-marker hook entry via `hookManager.hasAnySpaHook()` — which catches partial leftovers the full-matcher checks would miss). If residue exists it self-heals once via `reconcile()`; if residue survives, returns `disabled-drift`.

Status values: `disabled`, `disabled-drift` (setting off but stale artifacts may still enforce), `enabled-hooks-installed` (all hooks present, SPA before PA), `enabled-partial-coverage` (some hooks missing or wrong order), `enabled-hooks-missing` (no hooks found), `enabled-trust-required`, `error`.

### UI Truth Guarantees

- `MessageHandler` pushes `superParticleAcceleratorStatus` on webview `ready`, so the badge reflects real state from first paint (it no longer waits for the panel to be opened).
- The badge value distinguishes `On` (block), `Audit`, `Off`, `Stale` (drift), and `Warn`.
- Mode changes from the panel run `reconcile()` (propagating the new mode to running sessions via the runtime file) and re-send status.
- When status is `disabled-drift`, the panel shows a **Force cleanup** button that re-runs the disable flow (hook removal + `enabled:false` runtime file).

## Key Files

### Extension
- `src/extension/super-particle-accelerator/SuperParticleAcceleratorService.ts` - Lifecycle, initialize/activate/deactivate, env builder, exception CRUD
- `src/extension/super-particle-accelerator/SuperParticleAcceleratorHookManager.ts` - Hook installation/uninstallation/status for both Claude and Codex
- `src/extension/super-particle-accelerator/SuperParticleAcceleratorEnvBuilder.ts` - Maps settings to `CLAUI_SPA_*` env vars
- `src/extension/super-particle-accelerator/SuperParticleAcceleratorSettings.ts` - VS Code configuration reader
- `src/extension/super-particle-accelerator/SuperParticleAcceleratorAuditReader.ts` - Reads JSONL audit files
- `src/extension/super-particle-accelerator/SpaExceptionStore.ts` - Exception persistence with atomic writes

### Runtime (Hook Scripts)
- `src/super-particle-accelerator-runtime/hooks/claudeSuperParticleAccelerator.ts` - Claude hook entry point
- `src/super-particle-accelerator-runtime/hooks/codexSuperParticleAccelerator.ts` - Codex hook entry point
- `src/super-particle-accelerator-runtime/SecretWritePolicyEngine.ts` - Deny-first policy waterfall
- `src/super-particle-accelerator-runtime/PathClassifier.ts` - File path risk classification
- `src/super-particle-accelerator-runtime/GitStateScanner.ts` - Git state scanning and gitignore verification
- `src/super-particle-accelerator-runtime/SecretScanner.ts` - Secret detection with safe redaction

### Shared Types
- `src/shared/super-particle-accelerator/types.ts` - All shared interfaces and type unions

### Webview
- `src/webview/components/SuperParticleAccelerator/SuperParticleAcceleratorStatusBadge.tsx` - StatusBar badge, rendered inside the Tools dropdown menu under the "Protection" section
- `src/webview/components/SuperParticleAccelerator/SuperParticleAcceleratorPanel.tsx` - Settings/audit panel

### Tests (78 total)
- `tests/super-particle-accelerator/SecretWritePolicyEngine.test.ts` - Policy engine gate tests, including audit-never-blocks and block-mode hard-deny (15 tests)
- `tests/super-particle-accelerator/PathClassifier.test.ts` - Path classification tests (15 tests)
- `tests/super-particle-accelerator/SecretScanner.test.ts` - Scanner and redaction tests (7 tests)
- `tests/super-particle-accelerator/AuditWriter.test.ts` - JSONL audit file writing (3 tests)
- `tests/super-particle-accelerator/ExceptionLoader.test.ts` - Exception loading, filtering, atomic consumption (6 tests)
- `tests/super-particle-accelerator/BaselineStore.test.ts` - Baseline save/load, filterNew, path sanitization (5 tests)
- `tests/super-particle-accelerator/EntropyThreshold.test.ts` - Configurable entropy threshold wiring (5 tests)
- `tests/super-particle-accelerator/hooks/runtimeSettings.test.ts` - Runtime settings file-based activation + simpleGlobMatch globstar tests (12 tests)
- `tests/super-particle-accelerator/security/gitignoreBypass.test.ts` - Security regression tests (5 tests)
- `tests/super-particle-accelerator/security/largContentBypass.test.ts` - Large content truncation verification (5 tests)

### SPA Capability Demo
Standalone demonstration script that runs realistic scenarios through the compiled SPA hook to showcase all types of secret leaks it prevents.

**Location:** `tests/super-particle-accelerator/spa-capability-demo.ts`  
**Usage:** `npx tsx tests/super-particle-accelerator/spa-capability-demo.ts`  
**Output:** Generates `spa-capability-demo-report.html` with evidence and scenario breakdown

This is not a test suite file — it is an executable harness for capability verification that validates SPA's detection and blocking across realistic secret scenarios.

## Configuration

All settings under `claudeMirror.superParticleAccelerator.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable SPA |
| `mode` | `"block"` | `block` = deny writes, `audit` = log only |
| `scanEditTools` | `true` | Scan Edit/Write/MultiEdit |
| `scanBashCommands` | `true` | Scan Bash for secrets and git guards |
| `scanMcpTools` | `true` | Scan MCP tool arguments |
| `scanWorkingTreeOnStop` | `true` | Scan working tree on Stop |
| `blockGitCommitPush` | `true` | Block git add/commit/push with secrets |
| `allowIgnoredEnvFiles` | `true` | Allow gitignored .env files |
| `entropyThreshold` | `4.2` | Entropy threshold |
| `frontendPathGlobs` | (see package.json) | Frontend path patterns |
| `allowedSecretFileGlobs` | (see package.json) | Allowed env file patterns |

## simpleGlobMatch Implementation

Used in `PathClassifier` and `SecretWritePolicyEngine` for glob pattern matching. Converts globs to regex with placeholder-based ordering to avoid character clobbering:

1. `.` -> `\\.` (escape dots)
2. `?` -> `<<QMARK>>` (save glob single-char wildcard before regex `?` is introduced)
3. `**` -> `<<GLOBSTAR>>` (save globstar before `*` replacement)
4. `*` -> `[^/]*` (single-segment wildcard)
5. `<<GLOBSTAR>>/` -> `(.*/)? ` (zero-or-more path segments — the `?` makes it optional for zero-segment matches like `src/**/*.tsx` matching `src/App.tsx`)
6. `<<GLOBSTAR>>` -> `.*` (trailing globstar)
7. `<<QMARK>>` -> `.` (restore glob `?` as regex single-char)

## How It Integrates

1. `extension.ts` creates `SuperParticleAcceleratorService`, calls `initialize()` (which auto-activates if enabled)
2. `TabManager` receives the service, forwards to each `SessionTab`/`CodexSessionTab`
3. Each tab's process manager gets env vars via `buildSpaEnv()`
4. `MessageHandler` handles webview messages for status, toggle, mode, audit, exceptions
5. Hooks run as subprocess scripts (`node claude-spa.js --claui-spa-hook PreToolUse`), read JSON from stdin, write deny/allow JSON to stdout

## Related Security Features

**[[PARTICLE_ACCELERATOR]]** — Complimentary terminal-output filtering for Bash command output. Redacts secrets from logs after execution. SPA blocks secrets at the write point; Particle Accelerator filters them from console output.

**[[SECRET_PROTECTION_BROKER]]** — Comprehensive multi-boundary DLP that scans 13+ boundaries (prompts, context, MCP, git, telemetry). SPA focuses specifically on write operations; Secret Protection Broker handles a broader set of data flows and destinations.
