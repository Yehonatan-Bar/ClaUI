# Secret Protection Broker

Multi-boundary, destination-aware DLP broker that protects 9+ boundaries where secrets can leak from an AI coding agent session.

**See also:** [[SUPER_PARTICLE_ACCELERATOR]] (write-operation secret blocking) and [[PARTICLE_ACCELERATOR]] (terminal-output redaction).

## Architecture

The Secret Protection Broker extends Particle Accelerator's terminal-output-only redaction into a comprehensive system. The core insight: the same secret can leak through any boundary, and the correct action depends on the **destination** (local disk vs. remote model vs. Git remote vs. MCP server).

```
User prompt / Context / File / Command / Terminal / MCP / Browser / Git / Persistence
       |          |        |       |          |       |       |       |        |
       +----------+--------+-------+----------+-------+-------+-------+--------+
                                    |
                         SecretProtectionBroker
                                    |
                  +-----------------+-----------------+
                  |                 |                 |
          CompositeScanner    PolicyEngine    AuditEventWriter
                  |                 |
           6 scanners       destination-aware
           + rule packs     decision matrix
```

## Foundation Types (Step 1)

### Files

| File | Purpose |
|------|---------|
| `src/shared/secret-protection/types.ts` | All core DLP types |
| `src/shared/secret-protection/policySchema.ts` | Policy loader + validator |
| `src/shared/secret-protection/scanners/types.ts` | Scanner interfaces |
| `src/shared/secret-protection/rules/types.ts` | Rule pack schema (`RuleDefinition` includes `type?: FindingType`) |
| `src/extension/secret-protection/SecretProtectionSettings.ts` | VS Code settings reader |

### Core Types

- **`DlpEvent`** -- event for each boundary crossing (id, timestamp, sessionId, turnId, provider, workspacePath, boundary, source, destination, contentBytes, contentHash)
- **`DlpDestination`** -- destination descriptor (kind, provider, remote, host, trustTier)
- **`DlpFinding`** -- individual secret finding (id, ruleId, type, severity, confidence, location, redaction)
- **`RedactionToken`** -- structured replacement (`<REDACTED type="..." id="sec_xxxx" source="..." length="..." />`)
- **`DlpDecision`** -- policy output (action, reason, findings, redactedContent, safeSummary, approvalRequest, audit)
- **`AuditEvent`** -- persistence-safe audit record (no raw secrets; only hashes, rule IDs, counts)
- **`DlpException`** -- scoped temporary approval (userId, workspaceHash, provider, destination, ruleId, maxUses)
- **`CommandRisk`** -- risk classification (classes[], severity, requiresApproval, hardBlock, explanation)
- **`ContextManifest`** -- pre-send manifest with distinct shapes for files, screenshots, and MCP resources
- **`PolicyConfig`** -- project-level `.claui/secret-protection.policy.json` shape

### Boundaries (13 granular types)

`prompt.submit`, `context.attach`, `file.read_for_context`, `command.preflight`, `command.output`, `git.diff`, `git.publish`, `mcp.request`, `mcp.response`, `browser.capture`, `persistence.write`, `telemetry.export`, `diagnostic.export`

### Destination Kinds (9 types)

`local_agent`, `remote_model_provider`, `terminal_stdout_to_agent`, `local_disk`, `git_remote`, `mcp_server`, `browser_context`, `telemetry_backend`, `diagnostic_export`

### Policy

Project-level policy file at `.claui/secret-protection.policy.json`:
- `protectedPaths`: glob patterns for sensitive files
- `internalDomains`: internal hostname patterns
- `allowedModelProviders`, `allowedMcpServers`, `allowedGitRemotes`
- `blockedCommands`: commands to hard-block
- `approvalRequiredCommandClasses`: risk classes that need user approval
- `hardBlockRules`: rules that always block (no exceptions)
- `exceptionMaxMinutes`: max duration for temporary exceptions
- `allowlistedSecretHmacs`: pre-approved secret hashes

Validation returns `PolicyLoadResult` with `config`, `source` (`'file'` or `'defaults'`), and `warnings` array. Missing file returns defaults silently. Broken JSON or invalid fields produce explicit warnings.

### VS Code Settings (11)

All under `claudeMirror.secretProtection.*`:
`enabled`, `mode` (off/observe/balanced/strict), `blockProtectedPaths`, `scanPrompts`, `scanTerminalOutput`, `scanGitPublication`, `scanMcp`, `requireBrowserCaptureApproval`, `exceptionMaxMinutes`, `auditRetentionDays`, `enableEntropyScanner`

## Core Detection & Decision Engines (Step 2)

### Scanners (`src/shared/secret-protection/scanners/`)

| File | Scanner Name | What it Detects |
|------|-------------|-----------------|
| `EnvValueScanner.ts` | `env-value` | `KEY=VALUE` lines where KEY matches `SENSITIVE_KEY_PATTERNS` (13 patterns from SecretRedactor). HMAC-based stableIds, skips values < 8 chars |
| `RegexRuleScanner.ts` | `regex-rule` | Provider token patterns from `REGEX_RULES` (14 built-in rules from SecretRedactor) + rules from enabled rule packs. Uses `rule.type` from `RuleDefinition` (falls back to `TYPE_MAP` then `'hard_secret'`). Deduplicates by both rule ID and regex pattern source to prevent double-matches from packs with different IDs but identical regexes. Fresh RegExp per scan to avoid stale `lastIndex` |
| `EntropyScanner.ts` | `entropy` | Shannon entropy on tokens > 16 chars using 32-char sliding windows. Threshold > 4.5 bits/char. Opt-in via `enableEntropyScanner` setting |
| `PathSensitivityClassifier.ts` | `path-sensitivity` | File path references classified by sensitivity. 6 finder patterns: absolute paths, tilde paths, relative paths, dot-prefixed names (`.env`, `.ssh/id_rsa`), bare filenames with sensitive extensions (`private.pem`, `server.key`, `cert.p12`), and specific sensitive filenames (`terraform.tfstate`, `secrets.json`, `credentials.json`). Critical/high/medium tiers |
| `StructuredPayloadScanner.ts` | `structured-payload` | JSON (`"key": "value"`) and YAML (`key: value`) patterns where key names match sensitive patterns |
| `PiiAndInternalTopologyScanner.ts` | `pii-topology` | Email (with false-positive filtering), RFC 1918 internal IPs (10.x, 172.16-31.x, 192.168.x), internal hostnames (*.internal, *.corp, *.cluster.local) |
| `CompositeSecretScanner.ts` | `composite` | Orchestrates all 10 scanners (6 core + 4 boundary-specific). Auto-loads enabled rule packs via `getEnabledRulePacks()`. Deduplicates overlapping findings (highest severity wins). 100ms performance budget for inputs <= 128KB |

### Rule Packs (`src/shared/secret-protection/rules/`)

13 packs, 45 rules total. Each pack is a `RulePackDefinition` with `enabled: true` by default. Each `RuleDefinition` carries an explicit `type: FindingType` (e.g. `cloud_credential`, `api_key`, `network_exfil_primitive`, `pii`, `internal_topology`, `protected_path`, `webhook`).

| File | Pack ID | Rules |
|------|---------|-------|
| `cloud/aws.ts` | `cloud-aws` | 4: access key, secret key, session token, ARN role |
| `cloud/gcp.ts` | `cloud-gcp` | 3: service account JSON, API key, OAuth token |
| `cloud/azure.ts` | `cloud-azure` | 3: connection string, SAS token, client secret |
| `providers/github.ts` | `provider-github` | 4: classic PAT, fine-grained PAT, OAuth, app token |
| `providers/openai.ts` | `provider-openai` | 2: API key, org ID |
| `providers/anthropic.ts` | `provider-anthropic` | 1: API key |
| `providers/slack.ts` | `provider-slack` | 4: bot/user/app tokens, webhook URL |
| `providers/stripe.ts` | `provider-stripe` | 3: secret key, restricted key, webhook secret |
| `vcs/git.ts` | `vcs-git` | 2: credential URL, credential helper output |
| `files/protectedPaths.ts` | `files-protected` | 8: env, private keys, ssh, cloud config, terraform, secrets, agent control, git control |
| `pii/basic.ts` | `pii-basic` | 3: email, US phone, SSN |
| `topology/internal.ts` | `topology-internal` | 4: 3 RFC 1918 ranges, internal hostnames |
| `commands/exfiltration.ts` | `commands-exfiltration` | 4: curl upload, wget post, netcat, pipe to remote |
| `index.ts` | (registry) | `getRulePack(id)`, `getAllRulePacks()`, `getEnabledRulePacks()` |

### RedactionEngine (`src/shared/secret-protection/RedactionEngine.ts`)

Replaces finding spans with structured `<REDACTED type="..." id="sec_..." />` tokens.

- **`redact(text, findings)`**: Resolves overlapping spans by severity (highest wins), then replaces rightmost-first to preserve byte offsets. Returns `{ redacted, tokenMap, replacementCount, replacedBytes }`. `replacedBytes` is the sum of original secret byte spans (byteEnd - byteStart) for each resolved finding, used for accurate audit metrics.
- **`redactChunked(chunk, findings)`**: Streaming mode with 200-char overlap buffer. Findings that fall in the overlap zone are automatically deferred (with byte-offset adjustment) for processing by `flush()`. Accumulates `replacedBytes` across chunks.
- **`flush()`**: Applies deferred findings from previous `redactChunked()` calls to the remaining buffer. Returns accumulated `replacedBytes`. No arguments needed -- safe by default, no unredacted tail leak.

### CommandRiskClassifier (`src/shared/secret-protection/CommandRiskClassifier.ts`)

`classifyCommandRisk(command)` returns `CommandRisk` with classes, severity, requiresApproval, hardBlock, explanation.

- Checks full-command obfuscation patterns BEFORE splitting (catches `base64 | curl` intact)
- Calls `classifyCommand()` from `CommandEligibility.ts` for interactive/ineligible command detection
- Splits command on `|`, `&&`, `||`, `;` and classifies each segment against 11 risk class pattern groups
- Cross-segment pipeline analysis: secret-reader piped to network command -> critical
- `hardBlock = true` when `agent_control_write` + `shell_obfuscation` both detected
- `requiresApproval = true` for severity >= high

### Audit Store and Compliance (`src/shared/audit/`)

- **`AuditStore.append(event)`**: Appends one JSON line to `storeDir/audit/YYYY-MM-DD.jsonl`. Creates directories as needed.
- **`AuditStore.read(filter?, limit?)`**: Reads JSONL files newest-first, applies boundary/action/severity/date filters.
- **`AuditStore.getStats(filter?)`**: Computes action, boundary, severity, redaction count, byte, and timestamp summaries.
- **`AuditStore.prune(retentionDays)`**: Deletes JSONL files older than retention cutoff.
- **`AuditEventWriter`**: Small facade over `AuditStore`; `src/shared/secret-protection/AuditEventWriter.ts` remains as a compatibility re-export.
- **`ComplianceReporter.generate(filter?)`**: Builds SOC 2 CC6/CC7 and GDPR Article 32/5 evidence summaries without exposing raw secret values.

### DestinationClassifier (`src/shared/secret-protection/DestinationClassifier.ts`)

`classifyDestination(boundary, metadata)` -> `DlpDestination`. Pure function.

Boundary -> Destination mapping:
- `prompt.submit`, `context.attach`, `file.read_for_context` -> `remote_model_provider`
- `command.preflight`, `command.output` -> `terminal_stdout_to_agent`
- `git.diff` -> `local_disk`, `git.publish` -> `git_remote`
- `mcp.request/response` -> `mcp_server` (local vs remote resolved from URL)
- `persistence.write` -> `local_disk`
- `telemetry.export` -> `telemetry_backend`

Trust tiers: `trusted_local` (local_disk, terminal, browser), `trusted_org` (Anthropic/OpenAI model providers), `approved_remote` (known Git hosts: github.com/gitlab.com/bitbucket.org/dev.azure.com, local MCP servers), `unknown_remote` (unrecognized remotes), `public` (telemetry/diagnostic to unknown hosts).

### Modified Existing Files

- `SecretRedactor.ts`: Exported `SENSITIVE_KEY_PATTERNS`, `REGEX_RULES`, `RegexRule` (no behavioral change)
- `CommandEligibility.ts`: Exported `DENY_LIST`, `ALLOW_LIST`, `AllowEntry` (no behavioral change)

## Broker Orchestrator + CLI Integration (Step 3)

### PolicyEngine (`src/shared/secret-protection/PolicyEngine.ts`)

`evaluate(boundary, destination, findings, exceptions, contentHash, sessionId?, turnId?)` -> `DlpDecision`

Destination-aware decision matrix with 7 finding categories x 5 destination categories:

| Finding Category | Terminal | Remote Model | MCP | Git | Persistence |
|---|---|---|---|---|---|
| Private key / hard secret | Redact | Block | Block | Block | Redact |
| API key / cloud credential | Redact | Block | Block | Block | Redact |
| JWT | Redact | Redact | Block | Block | Redact |
| PII | Summarize | Require approval | Block | Block | Redact |
| Internal topology | Allow | Warn | Require approval | Warn | Allow |
| Protected path | Block | Block | Block | Block | Redact |
| Network exfil primitive | Warn | Warn | Block | Block | Allow |

Mode-aware evaluation:
- `off`: always allow
- `observe`: always allow, findings logged
- `balanced`: use decision matrix
- `strict`: escalate to block for severity >= medium

Checks hard-block rules, HMAC allowlist, and active exceptions before matrix lookup. Tracks `consumedExceptionIds` on the returned `DlpDecision` so the caller (broker) can increment usage counts and persist consumption.

### SecretProtectionBroker (`src/extension/secret-protection/SecretProtectionBroker.ts`)

Central orchestrator with 8 boundary-specific scan methods:
- `scanPromptSubmission(prompt, provider?)`
- `scanContextExpansion(content, filePath?)`
- `scanFileExposure(filePath, content)`
- `scanCommandPreflight(command)` -- integrates `classifyCommandRisk()` for hard-block detection
- `scanTerminalOutput(stdout, stderr)`
- `scanMcpRequest(toolName, args, serverUrl?)`
- `scanGitPublication(diff, commitMsg?, remoteName?)`
- `scanPersistence(key, value)`

Each method: `CompositeScanner.scan()` -> `PolicyEngine.evaluate()` -> consume exceptions -> `RedactionEngine.redact()` (if action=redact, sets `redactedBytes` from `replacedBytes`) -> `AuditEventWriter.writeEvent()` -> return `DlpDecision`

**Fail-closed**: any scan error returns `{ action: 'block', reason: 'scan-error' }` and writes an audit event (best-effort).

Exception management:
- `addException(exception)`: adds to in-memory list
- `getActiveExceptions()`: returns non-expired, under-limit exceptions
- `setOnExceptionConsumed(callback)`: registers callback fired when an exception is consumed during `scan()`
- After `PolicyEngine.evaluate()`, the broker increments `usedCount` on consumed exceptions in memory and fires the `onExceptionConsumed` callback for each, enabling the `SecretProtectionService` to persist consumption to disk via `ExceptionStore`. Consumption is gated: exceptions are only consumed when the overall decision allows content through (`allow`, `redact`, `warn`, `summarize_locally`), NOT when the decision is `block` or `require_approval`.

### SecretProtectionService (`src/extension/secret-protection/SecretProtectionService.ts`)

Lifecycle management following `ParticleAcceleratorService` pattern:
- Constructor: reads settings via `getSecretProtectionSettings()`
- `initialize()`: loads policy, creates broker, subscribes to settings changes
- `isEnabled()`: settings enabled AND broker created
- `getBroker()` / `getSettings()` / `getAuditStoreDir()`
- `readAuditEvents(filter?, limit?)`: reads audit events via `AuditStore`
- `getComplianceReport(filter?)`: generates compliance report via `ComplianceReporter`
- `updateSetting(key, value)`: writes to VS Code global config
- `addException(exception)`: adds to broker in-memory list and persists to `ExceptionStore`
- `consumeException(exceptionId)`: consumes from persistent `ExceptionStore`
- `getExceptionStorePath()`: returns path to `exceptions.json` under audit store dir
- `dispose()`: cleans up subscriptions

**Exception lifecycle in `createBroker()`**: Creates `ExceptionStore`, loads active (non-expired, under-limit) exceptions into the broker, wires `onExceptionConsumed` callback to persist consumption, and prunes expired exceptions. `SessionTab` and `CodexSessionTab` pass `exceptionsPath` to `ParticleAcceleratorEnvBuilder` so the Codex hook runtime can read/write the same file.

### SafePersistenceGuard (`src/extension/secret-protection/guards/SafePersistenceGuard.ts`)

Wraps trace/log/report writes through the persistence boundary:
- `guardWrite(key, value)` -> `{ safe, content, decision }`
- Block -> `safe: false, content: ''`
- Redact -> `safe: true, content: redactedContent`
- Allow -> `safe: true, content: originalValue`

### CLI Pipeline Integration

**Modified `cli.ts`**: After existing `SecretRedactor` redaction, creates `CompositeSecretScanner` when `CLAUI_SECRET_PROTECTION=1` env var is set. Scans redacted stdout/stderr, applies `RedactionEngine` redaction in balanced/strict mode (converts structured tokens to `[REDACTED]` for terminal compatibility), adds `dlp` field to trace.

**Modified `ParticleAcceleratorTypes.ts`**: Added optional `dlp` field to `ParticleAcceleratorTrace` (`findingCount`, `boundaries`, `severityMax`, `redactionTokenCount`) and `ParticleAcceleratorTraceSummary` (`dlpFindingCount?`, `dlpSeverityMax?`). Added `secretProtection?` field to `ParticleAcceleratorEnvInput`.

### Extension Wiring

- `extension.ts`: Creates `SecretProtectionService`, calls `initialize()`, pushes to subscriptions, sets on `tabManager.secretProtectionService`
- `TabManager.ts`: `secretProtectionService` property, wired to tabs in both Claude and Codex creation paths
- `SessionTab.ts`: `setSecretProtectionService()` sets `processManager.secretProtectionEnabled` and stores reference; PA env builder callback dynamically reads SP settings
- `CodexSessionTab.ts`: Same pattern as SessionTab
- `ClaudeProcessManager.ts`: `secretProtectionEnabled` flag, injects `CLAUI_SECRET_PROTECTION=1` to env
- `CodexExecProcessManager.ts`: Same flag and env injection
- `ParticleAcceleratorEnvBuilder.ts`: Passes `CLAUI_SECRET_PROTECTION_MODE` and `CLAUI_SECRET_PROTECTION_ENTROPY` when SP is enabled

## Boundary-Specific Scanners (Step 4)

### Specialized Detectors (`src/extension/scanners/`, `src/webview/scanners/`, `src/server/scanners/`, `src/shared/scanners/`)

| File | Scanner Name | Boundary | What it Detects | Gated By |
|------|-------------|----------|-----------------|----------|
| `src/extension/scanners/ExtensionOutboundScanner.ts` | `extension-outbound` | `context.attach`, `file.read_for_context`, `command.output` | Hardcoded passwords, connection strings, stack traces with internal paths, auth headers in logs, session token leaks, DB error message leaks | `scanTerminalOutput` |
| `src/webview/scanners/WebviewOutboundScanner.ts` | `webview-outbound` | `prompt.submit` | Pasted API keys (OpenAI/Anthropic/AWS), private keys, JWTs, URLs with embedded credentials, webhook URLs, explicit secret disclosures, .env block pastes | `scanPrompts` |
| `src/server/scanners/ServerOutboundScanner.ts` | `server-outbound` | `mcp.request`, `diagnostic.export` (wired); `mcp.response`, `telemetry.export` (scanner supports but no code path triggers yet) | DB connection strings (ADO.NET + URL), URL token params, session cookies, internal service credentials, SQL literal secrets, SMTP credentials, API key headers, OAuth client secrets, certificate material, SSN/credit card PII | `scanMcp` |
| `src/shared/scanners/GitPublicationScanner.ts` | `git-publication` | `git.diff`, `git.publish` | Phase 1: Sensitive files being staged (.env, .pem, .key, .p12, .pfx, SSH keys, tfstate, secrets/credentials files, .keystore, .npmrc, .pypirc, .htpasswd -- including binary diffs). Phase 2: Secrets in added lines only (AWS keys, GitHub tokens, API keys, private keys, passwords, DB URLs, JWTs, Slack/Stripe tokens, webhook URLs) | `scanGitPublication` |

All 4 scanners implement `ISecretScanner`, self-filter by `APPLICABLE_BOUNDARIES`, and are registered in `CompositeSecretScanner` gated by their respective VS Code settings.

### Integration Wiring

| Boundary | Integration Point | How |
|----------|-------------------|-----|
| Git publish | `MessageHandler.handleGitPush()`, `CodexMessageHandler.handleGitPush()` | Runs `git diff HEAD` + `git status --porcelain -uall` in parallel. For untracked files: reads file content (up to 256KB, first 200 lines) and builds synthetic diff with added lines so content scanners can detect secrets inside new files. Calls `broker.scanGitPublication()`, blocks if decision is `block`/`require_approval`. Gated by `scanGitPublication` setting. Fail-closed on scan error. |
| MCP request | `claudePreToolUse.ts`, `codexPreToolUse.ts` (CLI hooks) | Intercepts tools matching `mcp__*` via a dedicated hook entry (separate from the Bash matcher). Gated by `CLAUI_SECRET_PROTECTION_SCAN_MCP` env var (passed from `ParticleAcceleratorEnvBuilder`). Scans args via `CompositeSecretScanner` at `mcp.request` boundary, denies if critical/high findings in balanced/strict mode, and fails closed if the scanner cannot run. Runs independently of PA kill-switch. |
| Browser/image capture | `MessageHandler.sendMessageWithImages`, `CodexMessageHandler.dispatchPrompt()` | Pasted image payloads are treated as `browser.capture` and audited through `broker.scanBrowserCapture()`. If `requireBrowserCaptureApproval` is enabled, the send is blocked until an approval flow exists. The audit event records metadata only (image count/media types/size), not raw base64 image content. |
| Diagnostic export | `BugReportService.submit()` | Scans assembled report content via `broker.scanDiagnosticExport()` before Formspree submission. Blocks or redacts as appropriate. ZIP attachment is built from the (potentially redacted) sections, not raw sources. `SecretProtectionService` wired via `setSecretProtectionService()` during `bugReportInit`. |
| Prompt submit | `MessageHandler` (3 scan points), `CodexMessageHandler.dispatchPrompt()` | Scans composed payload (user text + handoff context) via `broker.scanPromptSubmission()`. Gated by `scanPrompts` setting. |
| **Scanner support only** | `mcp.response`, `telemetry.export` | ServerOutboundScanner supports these boundaries, but no caller currently triggers scanning at these points. |

### Hook Installation

`ParticleAcceleratorHookManager` installs **two** `PreToolUse` hook entries per CLI:
1. `matcher: 'Bash'` -- routes Bash commands through PA compression
2. `matcher: 'mcp__*'` -- routes MCP tool calls through secret scanning

Both hooks point to the same JS file; the tool name prefix determines which code path runs. `isClaudeHookInstalled()` / `isCodexHookInstalled()` require **both** entries to be present; an old installation with only the Bash hook will be detected as incomplete and reinstalled.

### Env Vars Passed to Hook Runtime

| Env Var | Source Setting | Purpose |
|---------|---------------|---------|
| `CLAUI_SECRET_PROTECTION` | `secretProtection.enabled` | Master kill-switch for all SP in hooks |
| `CLAUI_SECRET_PROTECTION_MODE` | `secretProtection.mode` | Scan mode (balanced/strict/off) |
| `CLAUI_SECRET_PROTECTION_ENTROPY` | `secretProtection.enableEntropyScanner` | Enable entropy-based detection |
| `CLAUI_SECRET_PROTECTION_SCAN_TERMINAL` | `secretProtection.scanTerminalOutput` | Terminal output scanning |
| `CLAUI_SECRET_PROTECTION_SCAN_MCP` | `secretProtection.scanMcp` | MCP tool argument scanning |
| `CLAUI_SECRET_PROTECTION_EXCEPTIONS_PATH` | `SecretProtectionService.getExceptionStorePath()` | Path to exceptions.json for hook-runtime exception loading/consumption |

## Audit and Enforcement UI (Step 5)

### Webview UI

- `SecretProtectionStatusBadge.tsx`: StatusBar badge (rendered inside the Tools dropdown menu under the "Protection" section) showing enabled/mode/audit state and opening the panel.
- `SettingsPanel.tsx`: Secret Protection overlay with Settings, Audit, and Manifest tabs.
- `AuditLogPanel.tsx`: Interactive audit event table with action/severity filters plus compliance evidence summary.
- `OutboundManifestPanel.ts`: Pure preview builder for guarded boundary names and the latest audit decision.
- `StatusBadge.tsx`: Shared compact badge primitive used by the DLP status entry point.

### State and Message Flow

- `src/webview/store/auditSlice.ts` and `src/webview/store/dlpSettingsSlice.ts` define the DLP UI state defaults/helpers.
- `src/webview/state/store.ts` owns `secretProtectionSettings`, status fields, audit events, last event, compliance report, panel tab/open state, loading, and errors.
- `useClaudeStream.ts` handles `secretProtectionStatus`, `secretProtectionAuditEvents`, `secretProtectionComplianceReport`, and `secretProtectionError`, and passes per-message `secretsDetected` / `redactionApplied` metadata into chat state.
- `MessageHandler` and `CodexMessageHandler` handle `secretProtectionGetStatus`, `secretProtectionSetSetting`, `secretProtectionGetAuditEvents`, and `secretProtectionGetComplianceReport`. Prompt-send decisions also attach `secretsDetected` / `redactionApplied` metadata to displayed user messages.
- `MessageBubble.tsx` displays compact Secrets / Redacted badges when those fields are present on a chat message.

### Approval and Codex Enforcement

- `src/server/enforcement/ApprovalEngine.ts` wraps DLP decisions with approval/allow/block semantics and strict-mode escalation. Exception override requires ALL findings to be covered (`findings.every()`), not just any one; partial coverage falls through to the baseDecision check. Returns `consumedExceptions: DlpException[]` with all unique matched exceptions (deduplicated by ID), so callers can consume every exception that contributed to the allow decision.
- `src/server/enforcement/ExceptionStore.ts` persists temporary exceptions with expiry and max-use counters.
- `src/particle-accelerator-runtime/hooks/codexPreToolUse.ts` evaluates MCP request findings through `PolicyEngine` and `ApprovalEngine` before tool execution. Loads active exceptions from `CLAUI_SECRET_PROTECTION_EXCEPTIONS_PATH` and persists consumption (usedCount increment) for all consumed exceptions (via `approval.consumedExceptions` array) back to the same file in a single write.
- `src/server/Codex.ts` provides DLP redaction instructions appended to Codex sessions so redacted tokens are treated as intentional safe context.

### Tests

Step 5 adds node:test coverage under `tests/unit`, `tests/integration`, `tests/regression`, and `tests/secret-protection` covering scanner units (including multipart structured payloads), browser-capture approval gating, redaction, policy decisions, audit writer compatibility, approval engine behavior, git publication scanning, multi-way redaction, and backward-compatible import paths.

## Demo Test Harness

Location: `tests/secret-protection-demo/`

Comprehensive evidence-producing test suite that exercises every scanner, rule pack, boundary, and enforcement mode in the Secret Protection Broker. Wired boundaries run through `SecretProtectionBroker`; currently unwired boundaries run scanner-only and are explicitly labeled. Produces structured JSON, live-evidence placeholders, screenshot manifest, audit logs, and a standalone HTML report suitable for compliance evidence and live demonstrations.

### Running

| Command | What it does |
|---------|--------------|
| `npm run demo:secret-protection` | Executes the full evidence suite, writes `results/demo-results.json`, `results/live-evidence.json`, `results/screenshot-manifest.json`, and audit JSONL |
| `npm run demo:secret-protection:report` | Generates `results/secret-protection-demo-report.html` from the JSON evidence files |

### Coverage

- **26 fixture files**: 21 dirty (containing intentional secrets) and 5 clean (benign content)
- **13/13 boundaries**: all wired and scanner-only boundaries exercised
- **6 enforcement modes**: `off_exposed`, `off_oracle_scan`, `observe`, `balanced`, `strict`, `balanced_entropy`
- **Acceptance-gated evidence**: expected rule IDs, finding types, minimum finding counts, severity floors, clean false positives, policy-violating exposures, no-regression proxy, and p95 latency are measured; the runner exits non-zero on acceptance failures
- **Current measured result**: 100% expected rule coverage, 100% expected detection pass rate, 0% clean false positives, 0 policy-violating exposures, p95 scan latency under 20ms in the latest run

### Fixture Categories

| Category | Examples |
|----------|---------|
| `env-files` | `.env` files with API keys, cloud credentials |
| `code-files` | Source files with hardcoded secrets, connection strings |
| `pii-files` | Documents containing emails, phone numbers, SSNs, internal IPs |
| `git-files` | Simulated git diffs with staged secrets and sensitive file additions |
| `commands` | Shell commands with exfiltration patterns, credential discovery |
| `crypto` | Private keys, certificates, JWTs |
| `protected-paths` | References to sensitive file paths (`.ssh/`, `.aws/`, `terraform.tfstate`) |
| `clean` | Benign URLs, public documentation, safe code patterns |

### Scanner-Only Boundaries

`git.diff`, `mcp.response`, and `telemetry.export` are exercised at the scanner level. These boundaries have scanner support but no current broker caller wired in the extension.

### Manifest and Guide

- `fixtures/manifest.json`: Rule-aligned fixture manifest mapping each file to expected scanner rule IDs, finding types, severity floor, applicable boundaries, and `minimumExpectedFindings`
- `tests/secret-protection-demo/DEMO_GUIDE.md`: Step-by-step live visual demo walkthrough
