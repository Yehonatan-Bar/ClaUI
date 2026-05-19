# Secret Protection Broker

Multi-boundary, destination-aware DLP broker that protects 9+ boundaries where secrets can leak from an AI coding agent session.

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
| `CompositeSecretScanner.ts` | `composite` | Orchestrates all 6 scanners. Auto-loads enabled rule packs via `getEnabledRulePacks()`. Deduplicates overlapping findings (highest severity wins). 100ms performance budget for inputs <= 128KB |

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

- **`redact(text, findings)`**: Resolves overlapping spans by severity (highest wins), then replaces rightmost-first to preserve byte offsets. Returns `{ redacted, tokenMap, replacementCount }`.
- **`redactChunked(chunk, findings)`**: Streaming mode with 200-char overlap buffer. Findings that fall in the overlap zone are automatically deferred (with byte-offset adjustment) for processing by `flush()`.
- **`flush()`**: Applies deferred findings from previous `redactChunked()` calls to the remaining buffer. No arguments needed -- safe by default, no unredacted tail leak.

### CommandRiskClassifier (`src/shared/secret-protection/CommandRiskClassifier.ts`)

`classifyCommandRisk(command)` returns `CommandRisk` with classes, severity, requiresApproval, hardBlock, explanation.

- Checks full-command obfuscation patterns BEFORE splitting (catches `base64 | curl` intact)
- Calls `classifyCommand()` from `CommandEligibility.ts` for interactive/ineligible command detection
- Splits command on `|`, `&&`, `||`, `;` and classifies each segment against 11 risk class pattern groups
- Cross-segment pipeline analysis: secret-reader piped to network command -> critical
- `hardBlock = true` when `agent_control_write` + `shell_obfuscation` both detected
- `requiresApproval = true` for severity >= high

### AuditEventWriter (`src/shared/secret-protection/AuditEventWriter.ts`)

- **`writeEvent(event, storeDir)`**: Appends one JSON line to `storeDir/audit/YYYY-MM-DD.jsonl`. Creates directories as needed.
- **`readEvents(storeDir, filter?, limit?)`**: Reads JSONL files newest-first, applies boundary/action/severity/date filters.
- **`pruneOldEvents(storeDir, retentionDays)`**: Deletes JSONL files older than retention cutoff.

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

Checks hard-block rules, HMAC allowlist, and active exceptions before matrix lookup.

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

Each method: `CompositeScanner.scan()` -> `PolicyEngine.evaluate()` -> `RedactionEngine.redact()` (if action=redact) -> `AuditEventWriter.writeEvent()` -> return `DlpDecision`

**Fail-closed**: any scan error returns `{ action: 'block', reason: 'scan-error' }`.

Exception management: `addException(exception)`, `getActiveExceptions()`.

### SecretProtectionService (`src/extension/secret-protection/SecretProtectionService.ts`)

Lifecycle management following `ParticleAcceleratorService` pattern:
- Constructor: reads settings via `getSecretProtectionSettings()`
- `initialize()`: loads policy, creates broker, subscribes to settings changes
- `isEnabled()`: settings enabled AND broker created
- `getBroker()` / `getSettings()`
- `dispose()`: cleans up subscriptions

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

## Planned (Steps 4-5)

### Step 4: Boundary Modules + Hooks
- ContextManifestBuilder + new hooks (postToolUse, userPromptSubmit)
- GitPublicationScanner
- ApprovalEngine + ExceptionStore
- ProtectedPathGuard + Codex upgrades

### Step 5: UI + Tests + Documentation
- Webview panels (OutboundManifest, AuditLog, Settings)
- 14 test files
- Backward compatibility verification
