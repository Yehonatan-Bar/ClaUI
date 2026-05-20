# Secret Protection Broker - Comprehensive Visual Demo Test Plan

## Purpose

Create a repeatable, visual, evidence-producing demo for the Secret Protection Broker (SPB). The demo must show:

1. What is exposed when protection is disabled.
2. What is detected, redacted, blocked, warned, or approval-gated when protection is enabled.
3. Coverage across all implemented scanner families, all 13 rule packs, and all DLP boundaries.
4. Claude Code / ClaUi normal work continues without meaningful disruption when protection is enabled.
5. Detailed JSON output from which an HTML results report can be generated.

Important wording: the plan must not claim "100% detection" or "0% false positives" before execution. Those are acceptance targets. The JSON report must show measured pass/fail evidence.

---

## Source of Truth

The test must be aligned to these implementation files:

| Area | Source |
|---|---|
| Boundary enum | `src/shared/secret-protection/types.ts` |
| Destination mapping | `src/shared/secret-protection/DestinationClassifier.ts` |
| Scanner composition | `src/shared/secret-protection/scanners/CompositeSecretScanner.ts` |
| Rule packs | `src/shared/secret-protection/rules/index.ts` |
| Policy decisions | `src/shared/secret-protection/PolicyEngine.ts` |
| Redaction | `src/shared/secret-protection/RedactionEngine.ts` |
| Broker API | `src/extension/secret-protection/SecretProtectionBroker.ts` |
| Command risk | `src/shared/secret-protection/CommandRiskClassifier.ts` |
| Live UI/audit | `src/webview/components/SecretProtectionStatusBadge.tsx`, `src/webview/components/SettingsPanel.tsx` |
| Current behavior docs | `Kingdom_of_Claudes_Beloved_MDs/SECRET_PROTECTION_BROKER.md`, `Kingdom_of_Claudes_Beloved_MDs/DLP_SETUP.md` |

---

## Test Architecture

### Layer 1: Rule-Aligned Fake Secret Fixture Library

Location:

```text
tests/secret-protection-demo/fixtures/
```

The fixture library must be generated or manually verified against the actual rules. Each expected detection entry must include an `expectedRuleIds` array and a `minimumExpectedFindings` value. If any expected entry produces zero findings in all applicable boundaries, the test run fails.

The library must include:

```text
tests/secret-protection-demo/
  fixtures/
    manifest.json
    env-files/
      .env.cloud
      .env.providers
      .env.database
      .env.general
      .env.entropy
    code-files/
      hardcoded-secrets.ts
      config-with-creds.json
      connection-strings.yaml
      gcp-service-account.json
      server-outbound-payloads.txt
      extension-outbound-logs.txt
    pii-files/
      user-data.txt
      payment-data.txt
      internal-network.txt
    git-files/
      staged-secrets.diff
      git-credential-output.txt
    commands/
      exfiltration-commands.txt
      risky-commands.txt
      safe-commands.txt
    crypto/
      fake-private-key.pem
      fake-jwt-tokens.txt
    protected-paths/
      path-only-cases.txt
    clean/
      normal-code.ts
      public-config.json
      readme-text.txt
      benign-urls-and-hashes.txt
```

### Required Fixture Coverage

The previous 50-entry list is a starting point, not sufficient by itself. Add cases for the missing rule/scanner paths:

| Coverage Gap | Required fake case |
|---|---|
| GCP service account | JSON with `"type": "service_account"` |
| GCP OAuth | `ya29.` token with at least 50 valid chars after the prefix |
| Azure client secret | Value matching `[A-Za-z0-9_~.-]{30,}` with no spaces/quotes inside the value |
| OpenAI org ID | `org-` plus 24 alphanumeric chars |
| Stripe webhook secret | `whsec_` plus at least 32 chars |
| Git credential URL/helper | `https://user:pass@example.com/repo.git`, `password=...` |
| Protected paths | `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.ssh`, `.aws`, `.azure`, `.kube/config`, `terraform.tfstate`, `.npmrc`, `.pypirc`, `.claude`, `.codex`, `.cursor`, `.git` |
| Webview-only rules | Discord webhook, pasted `.env` block, explicit "my api key is ..." text |
| Extension outbound rules | Authorization header, session cookie/token, stack trace path, DB error leak |
| Server outbound rules | ADO.NET connection string, token query param, SMTP URL, `X-Api-Key`, OAuth client secret, credit card, SSN |
| Entropy scanner | One high-entropy fake token with `enableEntropyScanner=true` |
| Clean corpus | Benign URLs, hashes, version strings, normal code, docs text, public GitHub URLs |

All fake values must be clearly non-real and use reserved/demo domains such as `example.com`, `invalid`, or internal test names. Values must still satisfy the exact detection regex shape.

### Manifest Schema

```json
{
  "id": "gcp-service-account-json",
  "description": "Fake GCP service account JSON",
  "category": "cloud_credential",
  "fixtureFile": "code-files/gcp-service-account.json",
  "sampleSelector": "full-file",
  "isClean": false,
  "expectedFindingTypes": ["cloud_credential"],
  "expectedRuleIds": ["gcp-service-account-json"],
  "expectedSeverityMin": "critical",
  "applicableBoundaries": ["prompt.submit", "mcp.request", "diagnostic.export"],
  "mustBeHiddenWhenProtected": true,
  "notes": "Structured payload rule, not regex-rule."
}
```

Clean entries must have:

```json
{
  "isClean": true,
  "expectedFindingTypes": [],
  "expectedRuleIds": [],
  "mustBeHiddenWhenProtected": false
}
```

---

## Layer 2: Automated Evidence Runner

File:

```text
tests/secret-protection-demo/run-demo-test.ts
```

Do not rely on an undeclared `npx ts-node` path. Add a project script and dependency, or implement a JS runner that imports compiled code. Recommended:

```json
{
  "scripts": {
    "demo:secret-protection": "tsx tests/secret-protection-demo/run-demo-test.ts"
  }
}
```

Install `tsx` as a dev dependency and commit the pinned version from the lockfile. If adding dependencies is not desired, use a committed JS runner instead.

### Execution Modes

The runner must separate enforcement modes from oracle scans:

| Mode ID | Scanner enabled | Policy mode | Purpose |
|---|---:|---|---|
| `off_exposed` | false | `off` | Shows what is visible without the feature |
| `off_oracle_scan` | true | `off` | Finds what would have been detected while still allowing content |
| `observe` | true | `observe` | Audit-only mode |
| `balanced` | true | `balanced` | Default protection |
| `strict` | true | `strict` | Aggressive protection |
| `balanced_entropy` | true | `balanced` + entropy on | Entropy-specific capability check |

### Boundary Coverage

The runner must cover all 13 `DlpBoundary` values. Use `SecretProtectionBroker` for wired broker behavior where available. For scanner-supported but currently unwired boundaries, run scanner-only evidence and mark `integrationStatus: "scanner_only_not_wired"`.

| Boundary | Runner path | Live demo path | Status |
|---|---|---|---|
| `prompt.submit` | `broker.scanPromptSubmission()` | Paste a fake secret into prompt | wired |
| `context.attach` | `broker.scanContextExpansion()` | Attach/handoff context if available | wired/programmatic |
| `file.read_for_context` | `broker.scanFileExposure()` | Ask model to inspect fixture file, plus programmatic proof | wired/programmatic |
| `command.preflight` | `broker.scanCommandPreflight()` + `classifyCommandRisk()` | Risky command through CLI hook | wired |
| `command.output` | `broker.scanTerminalOutput()` and PA runtime output | `cat` fake secret file through Claude Bash | wired |
| `git.diff` | direct scanner scan with `boundary: "git.diff"` | optional local diff display | scanner supported |
| `git.publish` | `broker.scanGitPublication()` | ClaUi Git Push flow with fake secret diff | wired |
| `mcp.request` | `broker.scanMcpRequest()` | MCP tool call or hook JSON replay | wired |
| `mcp.response` | direct scanner scan | no current caller; report scanner-only | scanner only |
| `browser.capture` | `broker.scanBrowserCapture()` | Send image/screenshot and show approval gate | wired |
| `persistence.write` | `broker.scanPersistence()` / `SafePersistenceGuard` | programmatic evidence | wired |
| `telemetry.export` | direct `ServerOutboundScanner`/composite scan | no current caller; report scanner-only | scanner only |
| `diagnostic.export` | `broker.scanDiagnosticExport()` | bug report dry-run or programmatic evidence | wired |

### Test Flow

```text
1. Load manifest.json.
2. Read fixture content and create boundary-specific payloads.
3. Build a boundary x mode x fixture matrix.
4. For each case:
   a. Build settings for the mode.
   b. Prefer SecretProtectionBroker when a broker method exists.
   c. Use direct CompositeSecretScanner for scanner-only boundaries.
   d. Run PolicyEngine and RedactionEngine where needed.
   e. Record raw content hash, findings, decision, redacted content, visibility, audit data, latency.
5. Run off_oracle_scan for every exposed OFF case.
6. Validate expectedRuleIds and expectedFindingTypes.
7. Validate clean corpus false positives.
8. Run command risk cases.
9. Run no-regression functional workflow cases.
10. Aggregate JSON and write report input files.
```

### Visibility Rules

Do not report "0 secrets exposed" globally in `balanced`. The policy intentionally allows some lower-risk local cases, for example internal topology in terminal/local persistence. Instead report:

```text
policyViolatingExposures = 0
policyAllowedVisibleFindings = N
blocked = N
redacted = N
warned = N
approvalRequired = N
allowed = N
```

For each case, compute:

```json
{
  "secretVisibleInRenderedOutput": false,
  "visibilityAllowedByPolicy": false,
  "policyViolation": false
}
```

### Output JSON

Write:

```text
tests/secret-protection-demo/results/demo-results.json
tests/secret-protection-demo/results/live-evidence.json
tests/secret-protection-demo/results/screenshot-manifest.json
```

High-level JSON shape:

```json
{
  "metadata": {
    "testRunId": "spb-demo-2026-05-20T143022Z",
    "timestamp": "2026-05-20T14:30:22.000Z",
    "sourceCommit": "<git commit hash>",
    "scannerCountExpected": 10,
    "rulePackCountExpected": 13,
    "boundaryCountExpected": 13
  },
  "summary": {
    "fixturesTotal": 0,
    "secretFixtures": 0,
    "cleanFixtures": 0,
    "boundariesTested": 13,
    "modesTested": 6,
    "expectedRuleCoverageRate": 0,
    "expectedDetectionPassRate": 0,
    "cleanFalsePositiveRate": 0,
    "policyViolatingExposures": 0,
    "p95ScanLatencyMs": 0
  },
  "boundaryCoverage": [
    {
      "boundary": "mcp.response",
      "integrationStatus": "scanner_only_not_wired",
      "casesRun": 0,
      "findings": 0,
      "notes": "ServerOutboundScanner supports it, but no current caller triggers it."
    }
  ],
  "ruleCoverage": [
    {
      "ruleId": "stripe-webhook-secret",
      "coveredByFixtureIds": ["stripe-webhook-secret"],
      "detected": true,
      "boundaryEvidence": ["prompt.submit", "mcp.request", "diagnostic.export"]
    }
  ],
  "modeComparison": {
    "off_exposed": {},
    "off_oracle_scan": {},
    "observe": {},
    "balanced": {},
    "strict": {},
    "balanced_entropy": {}
  },
  "caseResults": [],
  "commandRiskResults": [],
  "noRegressionEvidence": [],
  "performanceMetrics": {},
  "policyDecisionMatrix": {},
  "reportInputs": {
    "screenshots": [],
    "auditLogFiles": [],
    "outputLogFiles": []
  }
}
```

---

## Layer 3: No-Regression / Claude Code Normal Work Proof

This must be a measured comparison, not a single happy-path screenshot.

### Functional Workflow

Run the same normal workflow twice:

1. `claudeMirror.secretProtection.enabled=false`
2. `claudeMirror.secretProtection.enabled=true`, `mode=balanced`

Use a fresh ClaUi session for each run so hook env vars are correct.

Workflow:

```text
1. Ask Claude Code to create a small TypeScript utility in a temp demo folder.
2. Ask it to add one focused unit-like sample or usage snippet.
3. Run npm run build.
4. Ask it to read and summarize src/extension/extension.ts.
5. Ask it to inspect git status.
```

Record:

| Metric | Required evidence |
|---|---|
| Completion | Both runs finish the workflow |
| Build result | Same exit code, ideally 0 |
| DLP interference | No block/redact on clean workflow |
| Audit events | 0 findings or only allowed clean status events |
| Timing | Total duration and command latency delta |
| Output quality | Human-readable summary of equivalence |
| Screenshots | OFF and BALANCED workflow states |

Acceptance target:

```text
The protected run must complete without DLP blocks and without material delay.
Any warning/redaction in the clean workflow is a failure unless explicitly explained as policy-allowed and harmless.
```

---

## Layer 4: Live Visual Demo Guide

File:

```text
tests/secret-protection-demo/DEMO_GUIDE.md
```

### Required Setup

Before live demo:

```powershell
cd C:/projects/claude-code-mirror
npm run deploy:local
npm run verify:installed
```

Then reload VS Code:

```text
Ctrl+Shift+P -> Developer: Reload Window
```

Also verify:

1. Secret Protection settings are visible in VS Code settings.
2. Particle Accelerator hooks are installed for Claude/Codex if terminal/MCP hook behavior is demonstrated.
3. A new ClaUi session is started after changing protection settings.
4. `Output -> ClaUi` shows a fresh startup timestamp.
5. Audit tab is available and receives events.

### Scenario A: Exposure Without Protection

Settings:

```text
claudeMirror.secretProtection.enabled = false
```

Run:

1. Paste a fake API key directly in a prompt and ask Claude to repeat/analyze it.
2. Ask Claude to run `cat tests/secret-protection-demo/fixtures/env-files/.env.providers`.
3. Stage or prepare a fake git diff containing a secret.

Capture:

| Evidence | Expected |
|---|---|
| Chat screenshot | Fake secret visible |
| Terminal/tool output screenshot | Fake secret visible |
| Audit panel | No SP enforcement events |
| JSON | `off_exposed.secretVisible=true` |

### Scenario B: Observe Mode

Settings:

```text
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = observe
```

Run same prompt/command set.

Expected:

```text
Content remains visible, but findings are logged.
```

This proves the detector can see the same exposed data without enforcing.

### Scenario C: Balanced Protection

Settings:

```text
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = balanced
```

Run separate boundary-specific prompts:

| Boundary | Live action | Expected |
|---|---|---|
| Prompt submit | Paste fake key into prompt | Block/redact according to policy |
| Command output | `cat` fake secret file through Claude Bash | Redacted output |
| Git publish | Attempt ClaUi Git Push with fake secret diff | Block or approval gate |
| MCP request | Trigger fake MCP args or hook replay | Block for high/critical findings |
| Browser capture | Send image/screenshot | Approval required |

Capture the status badge, audit table, redacted output, and blocked message.

### Scenario D: Strict Protection

Settings:

```text
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = strict
```

Run medium-severity cases:

1. Internal IP / hostname.
2. PII.
3. Medium command risk.

Expected:

```text
Medium+ findings escalate toward block where PolicyEngine strict mode requires it.
```

### Scenario E: Business As Usual

Run the no-regression workflow described above in OFF and BALANCED. Capture side-by-side screenshots and measured JSON evidence.

---

## HTML Report Generation

Add:

```text
tests/secret-protection-demo/generate-html-report.ts
```

Input:

```text
tests/secret-protection-demo/results/demo-results.json
tests/secret-protection-demo/results/live-evidence.json
tests/secret-protection-demo/results/screenshot-manifest.json
```

Output:

```text
tests/secret-protection-demo/results/secret-protection-demo-report.html
```

Report sections:

1. Executive summary.
2. OFF vs OBSERVE vs BALANCED vs STRICT comparison.
3. Boundary coverage table for all 13 boundaries.
4. Rule coverage table for all expected rule IDs.
5. Redaction/blocking examples with before/after.
6. Audit event timeline.
7. No-regression Claude Code evidence.
8. Performance charts.
9. Known non-wired boundaries clearly marked as scanner-only.

The existing presentation file in `Kingdom_of_Claudes_Beloved_MDs/plans/secret-protection-demo-test-plan.html` is a planning deck. The final report must be generated from measured JSON, not hard-coded expected numbers.

---

## Files to Create or Update

| # | File | Purpose |
|---|---|---|
| 1 | `tests/secret-protection-demo/fixtures/manifest.json` | Rule-aligned fixture manifest |
| 2 | `tests/secret-protection-demo/fixtures/**` | Fake secret, clean, command, git, scanner-specific fixtures |
| 3 | `tests/secret-protection-demo/run-demo-test.ts` | Automated evidence runner |
| 4 | `tests/secret-protection-demo/generate-html-report.ts` | HTML report generator |
| 5 | `tests/secret-protection-demo/DEMO_GUIDE.md` | Live demo guide |
| 6 | `tests/secret-protection-demo/results/.gitignore` | Ignore generated JSON/screenshots if desired |
| 7 | `package.json` | Add runnable script if using `tsx` |
| 8 | `Kingdom_of_Claudes_Beloved_MDs/plans/secret-protection-demo-test-plan.html` | Planning presentation summary |

---

## Verification Checklist

### Static / Automated

```powershell
cd C:/projects/claude-code-mirror
npm run build
npm run demo:secret-protection
```

Verify:

1. Every expected fixture either passes or has a recorded failure reason.
2. Every `expectedRuleId` is detected at least once.
3. All 13 boundaries are represented in `boundaryCoverage`.
4. Scanner-only/not-wired boundaries are explicitly labeled.
5. Clean corpus false positive rate is measured.
6. Protected modes produce zero policy-violating exposures.
7. Performance p95 is under the target for normal-size payloads.
8. `demo-results.json` is sufficient to regenerate the HTML report.

### Live Demo / Installed Extension

Because the live demo depends on the installed VS Code extension, run:

```powershell
cd C:/projects/claude-code-mirror
npm run deploy:local
npm run verify:installed
```

Then reload VS Code and start fresh sessions for each mode.

### Documentation

After implementing the test harness, update:

```text
Kingdom_of_Claudes_Beloved_MDs/SECRET_PROTECTION_BROKER.md
Kingdom_of_Claudes_Beloved_MDs/DLP_SETUP.md
TECHNICAL.md
```

Document the demo harness location, scripts, generated outputs, and known scanner-only boundaries.

---

## Acceptance Criteria

The plan is complete only when the generated evidence can answer these questions with data:

1. Which fake secrets were exposed with protection off?
2. Which rule IDs detected them in oracle/observe/protected modes?
3. Which boundaries were covered, and which are scanner-only/not wired?
4. Which findings were blocked, redacted, warned, approval-gated, or allowed by policy?
5. Did any protected-mode case leak a policy-prohibited secret?
6. Did clean Claude Code work finish successfully with protection enabled?
7. What was the measured latency and false-positive rate?
8. Can a final HTML report be generated from JSON without hand-editing expected numbers?
