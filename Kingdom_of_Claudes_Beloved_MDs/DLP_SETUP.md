# Secret Protection Broker Setup

Secret Protection Broker is ClaUi's multi-boundary DLP layer. It scans prompts, context, command output, MCP requests, git publication content, persistence writes, and diagnostic exports before sensitive data crosses a higher-risk boundary.

## Enable

Open VS Code settings and enable:

| Setting | Recommended |
|---------|-------------|
| `claudeMirror.secretProtection.enabled` | `true` |
| `claudeMirror.secretProtection.mode` | `"balanced"` |
| `claudeMirror.secretProtection.scanPrompts` | `true` |
| `claudeMirror.secretProtection.scanTerminalOutput` | `true` |
| `claudeMirror.secretProtection.scanGitPublication` | `true` |
| `claudeMirror.secretProtection.scanMcp` | `true` |
| `claudeMirror.secretProtection.auditRetentionDays` | `90` |

Modes:

| Mode | Behavior |
|------|----------|
| `off` | Do not enforce DLP decisions. |
| `observe` | Log findings, but allow content through. |
| `balanced` | Block or redact high-risk secrets at remote/public boundaries; warn on lower-risk findings. |
| `strict` | Escalate medium-or-higher findings to block at enforced boundaries. |

The webview StatusBar shows the Secret Protection badge when status is available. Click it to open the Settings, Audit, and Manifest tabs.

## Project Policy

Optional project-level policy lives at:

```text
.claui/secret-protection.policy.json
```

Example:

```json
{
  "schemaVersion": 1,
  "mode": "balanced",
  "protectedPaths": [".env", ".env.*", "*.pem", "*.key", ".ssh/**", ".aws/**"],
  "internalDomains": ["*.corp", "*.internal", "*.cluster.local"],
  "allowedModelProviders": ["anthropic", "openai"],
  "allowedMcpServers": [],
  "allowedGitRemotes": ["github.com"],
  "blockedCommands": ["cat .env*", "printenv", "env"],
  "approvalRequiredCommandClasses": ["network_upload", "credential_discovery", "browser_capture"],
  "hardBlockRules": ["private_key", "cloud_secret_pair", "secret_to_git_publication"],
  "exceptionMaxMinutes": 30,
  "allowlistedSecretHmacs": []
}
```

If the file is absent, ClaUi uses the defaults from `src/shared/secret-protection/policySchema.ts`. VS Code settings take precedence for the active mode.

## Audit Logs

Audit logs are append-only JSONL files and never store raw secret values:

```text
<globalStoragePath>/secret-protection/audit/YYYY-MM-DD.jsonl
```

The Audit tab requests events through `secretProtectionGetAuditEvents` and compliance summaries through `secretProtectionGetComplianceReport`. Retention cleanup runs when the broker is created and uses `claudeMirror.secretProtection.auditRetentionDays`.

## Hooks and Runtime

For tool-boundary enforcement, install Particle Accelerator hooks. The hook manager installs both:

- `Bash` hook for command compression and terminal-output scanning.
- `mcp__*` hook for MCP request scanning.

Codex sessions also receive DLP instructions that explain `<REDACTED ... />` tokens and discourage asking the user to reveal removed values.

## Validation

After changing code or settings contributions:

```powershell
cd C:/projects/claude-code-mirror
npm run deploy:local
npm run verify:installed
```

Then reload VS Code with `Ctrl+Shift+P` -> `Developer: Reload Window`.

Quick functional checks:

- Send a prompt containing `API_TOKEN=supersecretvalue123` in balanced mode and confirm it is blocked or redacted before the model boundary.
- Try a git publication flow with a staged `.env` or private key-like content and confirm the Git push path blocks.
- Open the Secret Protection panel and confirm the Audit tab lists the latest DLP decision.
- In observe mode, confirm findings are logged while content is allowed.

## Current Boundaries

Wired today:

- Prompt submission: `MessageHandler`, `CodexMessageHandler`
- Git publication: `handleGitPush()` in both handlers
- MCP request: Claude/Codex pre-tool-use hooks
- Diagnostic export: `BugReportService.submit()`
- Terminal output: `claui-run` when Secret Protection env vars are set
- Persistence writes: `SafePersistenceGuard`

Scanner support also exists for MCP responses and telemetry export, but those code paths need a caller before enforcement is active there.
