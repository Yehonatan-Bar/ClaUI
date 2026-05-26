# Workspace Access Guard (WAG)

Snapshot date: 2026-05-26

Workspace Access Guard is ClaUi's hook-level filesystem boundary guard for Claude Code and Codex sessions. It blocks agent tool calls that try to read, search, write, copy, delete, or otherwise operate outside approved working folders, and it also blocks access to organization-denied sensitive folders even when they are nested under an allowed root.

WAG is complementary to the existing security layers:

- **Secret Protection Broker** scans data crossing trust boundaries for secrets and sensitive content.
- **Super Particle Accelerator (SPA)** blocks agents from writing secrets into the codebase.
- **Particle Accelerator (PA)** compresses and redacts terminal output before it reaches the agent.
- **Workspace Access Guard (WAG)** enforces the filesystem scope before a tool or command runs.

## Problem

The failure mode WAG addresses is broad filesystem access, especially broad reads/searches from an AI coding session.

Example risky commands:

```bash
grep -r "password" /c/Users/yoni.bar
rg "token" C:\Users\yoni.bar
cat %USERPROFILE%\.ssh\id_rsa
type %APPDATA%\Microsoft\Credentials\...
```

These commands may not write secrets and may not contain a secret inline. The risk is that the agent is operating outside the project boundary or inside a sensitive local credential store.

## Current Implementation Status

Implemented in this snapshot:

- Dedicated WAG runtime webpack target under `dist/workspace-access-guard-runtime/`.
- Claude hook entry point for `PreToolUse`.
- Codex hook entry point for `PreToolUse` plus Bash `PermissionRequest`.
- Hook installer that inserts WAG entries before SPA and PA entries.
- Windows-focused path normalization for normal Windows paths, Git Bash `/c/...`, WSL `/mnt/c/...`, env vars, `~`, relative paths, and symlinks/junctions.
- Segment-aware containment checks using `path.win32.relative()`.
- Shell command path extraction and access-kind classification.
- Direct tool and MCP argument path extraction.
- Two-layer policy engine: user-allowed roots plus organization-denied roots, with deny roots winning.
- Built-in Windows enterprise denied-root policy with 20 enabled denied roots.
- Organization policy loader for `C:\ProgramData\ClaUi\workspace-access-guard.policy.json`.
- User allowed-root store in extension global storage.
- Runtime environment injection for Claude and Codex process managers.
- Runtime hooks load the complete `runtime-enabled.json` settings snapshot and then apply env var overrides.
- JSONL audit writer and reader for deny/audit decisions.
- VS Code settings manifest entries for `claudeMirror.workspaceAccessGuard.*`.
- Extension-side webview message handlers for status, roots, org policy, audit events, and path/command testing.
- Dashboard Tools tab UI for enabling WAG, switching mode, adding/removing allowed roots, viewing org policy status, viewing recent audit events, and testing a path/command.
- Zustand state and webview message handling for WAG status, allowed roots, org policy, audit events, test results, and errors.
- Focused WAG tests for path normalization, command extraction, policy evaluation, wildcard denied roots, no-root deny behavior, broad-root hard denial, runtime settings loading, direct-file fail-closed behavior, and provider hook output.

Not present in this snapshot:

- WAG-specific audit pruning. `auditRetentionDays` is defined in settings, but the current WAG audit reader/writer does not yet delete old files.
- OS-level sandboxing. WAG is hook preflight, not an operating-system containment boundary.

## Policy Model

WAG evaluates every extracted filesystem target against two policy layers:

1. **User allowed roots**
   The agent may access only files and folders under approved roots. When `autoAllowWorkspaceFolders` is enabled, the current VS Code workspace folder is added to the runtime evaluation set.

2. **Organization denied roots**
   Sensitive folders are denied even if they are under an allowed root. Deny roots always win over user allowed roots.

Decision rule:

```text
ALLOW only when every target path is inside an allowed root
AND no target path is inside an organization-denied root.

DENY when any target path is inside a denied root
OR any target path is outside all allowed roots.
```

In `audit` mode, policy violations are logged as `audit` decisions and the hook exits successfully. In `block` mode, policy violations return a deny decision to the provider hook.

## Hook Ordering

WAG is intentionally first:

```text
WAG -> SPA -> PA
```

The reason is scope first, content second. If a command targets `C:\Users\<user>\.ssh`, WAG should reject it before SPA or PA tries to inspect command content or route terminal output.

`WorkspaceAccessGuardHookManager` installs new hook entries before entries containing:

- `--claui-spa-hook`
- `--claui-managed-hook`

## Hook Coverage

| Provider | Event | Matchers |
|----------|-------|----------|
| Claude | `PreToolUse` | `Bash` |
| Claude | `PreToolUse` | `Read\|Grep\|Glob\|LS` |
| Claude | `PreToolUse` | `Edit\|Write\|MultiEdit\|NotebookEdit` |
| Claude | `PreToolUse` | `mcp__.*` |
| Codex | `PreToolUse` | `Bash` |
| Codex | `PreToolUse` | `Edit\|Write\|MultiEdit\|apply_patch` |
| Codex | `PreToolUse` | `mcp__.*` |
| Codex | `PermissionRequest` | `Bash` |

Hook files copied into global storage:

```text
<globalStorage>/workspace-access-guard/runtime/hooks/claude-wag.js
<globalStorage>/workspace-access-guard/runtime/hooks/codex-wag.js
```

Workspace hook config files modified by the installer:

```text
<workspace>/.claude/settings.json
<workspace>/.codex/hooks.json
```

The installer creates timestamped backups before editing existing hook files.

## Runtime Flow

1. Provider invokes the WAG hook with JSON on stdin.
2. Hook loads runtime settings from `runtime-enabled.json`, then applies env var overrides.
3. Hook loads user allowed roots from `user-allowed-roots.json`.
4. Hook loads org policy from `orgPolicyPath`, falling back to built-in defaults.
5. Hook extracts target paths from the tool call or command.
6. Paths are normalized for stable Windows comparison.
7. `PathPolicyEngine.evaluate()` checks denied roots, allowed roots, symlink warnings, unknown file access behavior, and fail-closed direct-file tool inputs with no parseable path.
8. Non-allow decisions are written to WAG audit JSONL.
9. `deny` returns provider-specific hook output; `allow` exits with code 0.

## Path Normalization

Implemented in `src/workspace-access-guard-runtime/PathNormalizer.ts`.

Supported input forms:

- Windows absolute paths: `C:\projects\repo`
- Slash variants: `C:/projects/repo`
- Git Bash paths: `/c/projects/repo`
- WSL paths: `/mnt/c/projects/repo`
- Windows env vars: `%USERPROFILE%\.ssh`
- Unix env vars: `$HOME/.aws`, `${APPDATA}/gcloud`
- Tilde: `~/.ssh`
- Relative paths: `./src/file.ts`, `../other`
- UNC-like paths beginning with `\\`
- Existing symlink/junction targets via `fs.realpathSync.native()`
- Non-existing paths by resolving the nearest existing parent

Containment is segment-aware:

```ts
path.win32.relative(root, target)
```

This avoids unsafe prefix checks where `C:\foo` would accidentally match `C:\foobar`.

## Command Extraction

Implemented in `src/workspace-access-guard-runtime/CommandPathExtractor.ts`.

The command parser:

- Caps command parse length at 256 KB.
- Strips simple `bash -c`, `sh -c`, and `cmd /c` preambles.
- Splits pipelines and command chains while respecting quotes and grouping.
- Tokenizes single quotes, double quotes, escapes, pipes, `&&`, `||`, and `;`.
- Extracts redirect targets from `>`, `>>`, `1>`, `2>`, and similar forms.
- Detects in-place edit patterns such as `sed -i` and `perl -i`.

Current access kinds:

| Access kind | Examples |
|-------------|----------|
| `no-file-access` | `echo`, `date`, `whoami`, `pwd` |
| `file-read` | `cat`, `type`, `Get-Content`, `tail`, `stat` |
| `recursive-file-read` | `grep`, `rg`, `find`, `fd`, `tree`, `Get-ChildItem` |
| `file-write` | `tee`, `Set-Content`, `Out-File`, redirects |
| `file-delete` | `rm`, `del`, `Remove-Item` |
| `file-move-copy` | `cp`, `xcopy`, `robocopy`, `mv`, `Copy-Item` |
| `git-operation` | `git`, `gh` |
| `build-or-test` | `npm`, `pnpm`, `node`, `python`, `go`, `dotnet`, `pytest`, `vitest` |
| `network-or-exfiltration` | `curl`, `wget`, `ssh`, `scp`, `Invoke-WebRequest` |
| `unknown-file-access` | Unknown commands or commands with unclassified path arguments |

For recursive search commands without explicit path args, the current working directory is treated as the target. For build/test/git commands, the current working directory is also treated as the target when no explicit path is present.

## Tool And MCP Extraction

Implemented in `src/workspace-access-guard-runtime/ToolPathExtractor.ts`.

Direct tool path fields:

```text
file_path, path, paths, dir, directory, root, cwd,
patternRoot, target, source, destination, filePath,
old_file_path, new_file_path
```

Known tool operation mapping:

| Operation | Tools |
|-----------|-------|
| `read` | `Read`, `LS`, `ListDir` |
| `search` | `Grep`, `Glob` |
| `write` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `apply_patch` |
| `mcp` | `mcp__*` |

For MCP tools, WAG also recursively scans string values that look like filesystem paths.

Codex `apply_patch` receives special handling in the Codex hook. File paths are extracted from diff headers such as:

```diff
--- a/src/file.ts
+++ b/src/file.ts
```

## Organization Policy

Default file path:

```text
C:\ProgramData\ClaUi\workspace-access-guard.policy.json
```

Minimal schema:

```json
{
  "schemaVersion": 1,
  "policyName": "Company WAG Policy",
  "deniedRoots": [
    {
      "id": "ssh-dir",
      "description": "User SSH directory",
      "path": "%USERPROFILE%\\.ssh\\**",
      "enabled": true,
      "severity": "critical",
      "category": "ssh-keys"
    }
  ]
}
```

Built-in denied roots cover:

- Windows Credential Manager stores
- Windows DPAPI Protect folder
- SSH and GPG directories
- AWS, Azure, Google Cloud, Kubernetes, and Docker configs
- Git, npm, and PyPI credential files
- Chrome, Edge, and Firefox profiles
- PowerShell history
- Claude and Codex local history
- VS Code global storage

If the org policy file is missing or invalid, WAG falls back to built-in defaults. `OrgPolicyLoader.getStatus()` exposes the active source, policy name, denied-root count, last modified time, and load errors.

## User Allowed Roots

User-approved roots are stored atomically at:

```text
<globalStorage>/workspace-access-guard/user-allowed-roots.json
```

Shape:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-25T00:00:00.000Z",
  "roots": [
    "C:\\projects\\claude-code-mirror"
  ]
}
```

`UserAllowedRootsStore` normalizes slash direction and trims trailing separators before de-duplicating case-insensitively.

Broad-root warnings are generated by `checkBroadRoot()` using the org policy broad-root rules. Current broad examples include:

- Drive roots such as `C:\`
- Whole `C:\Users`
- Whole `%USERPROFILE%`
- `%USERPROFILE%\Documents`
- `%USERPROFILE%\Desktop`
- `%USERPROFILE%\Downloads`

## Settings

All settings are contributed in `package.json` under `claudeMirror.workspaceAccessGuard.*`.

| Setting | Default | Scope | Meaning |
|---------|---------|-------|---------|
| `enabled` | `false` | resource | Master toggle for WAG hook enforcement |
| `mode` | `"block"` | resource | `block` denies violations; `audit` logs and allows |
| `userAllowedRoots` | `[]` | resource | Additional settings-defined allowed roots |
| `autoAllowWorkspaceFolders` | `true` | resource | Add current VS Code workspace folders at runtime |
| `orgPolicyPath` | `C:\ProgramData\ClaUi\workspace-access-guard.policy.json` | resource | Organization denied-root policy path |
| `scanBashCommands` | `true` | resource | Scan shell command text |
| `scanFileTools` | `true` | resource | Scan direct file tools when hooks expose them |
| `scanMcpTools` | `true` | resource | Scan MCP tool arguments |
| `blockOutsideAllowedRoots` | `true` | resource | Enforce user allowed-root boundary |
| `blockDeniedRoots` | `true` | resource | Enforce org denied-root boundary |
| `warnOnBroadAllowedRoots` | `true` | resource | Flag broad user roots in service views |
| `denyUnresolvedSymlinkTargets` | `true` | resource | Deny unresolved symlink/junction traversals |
| `denyUnknownFileAccessCommands` | `true` | resource | Deny unknown commands that may access files |
| `auditRetentionDays` | `90` | resource | Retention setting for WAG audit logs; pruning is pending |

## Environment Variables

Injected into Claude and Codex process environments by `WorkspaceAccessGuardEnvBuilder`.

| Env var | Meaning |
|---------|---------|
| `CLAUI_WORKSPACE_ACCESS_GUARD` | `1` when enabled, `0` when disabled |
| `CLAUI_WORKSPACE_ACCESS_GUARD_MODE` | `block` or `audit` |
| `CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR` | WAG global storage directory |
| `CLAUI_WORKSPACE_ACCESS_GUARD_USER_ROOTS_PATH` | Path to `user-allowed-roots.json` |
| `CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH` | Org policy path |
| `CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH` | Current workspace root |
| `CLAUI_WAG_AUTO_ALLOW_WORKSPACE` | `1` or `0` |
| `CLAUI_WAG_SCAN_BASH` | `1` or `0` |
| `CLAUI_WAG_SCAN_FILE_TOOLS` | `1` or `0` |
| `CLAUI_WAG_SCAN_MCP` | `1` or `0` |
| `CLAUI_WAG_BLOCK_OUTSIDE_ALLOWED_ROOTS` | `1` or `0` |
| `CLAUI_WAG_BLOCK_DENIED_ROOTS` | `1` or `0` |
| `CLAUI_WAG_WARN_BROAD_ALLOWED_ROOTS` | `1` or `0` |
| `CLAUI_WAG_DENY_UNRESOLVED_SYMLINKS` | `1` or `0` |
| `CLAUI_WAG_DENY_UNKNOWN` | `1` or `0` |
| `CLAUI_WAG_AUDIT_RETENTION_DAYS` | Number of days |

When disabled, the env builder still emits:

```text
CLAUI_WORKSPACE_ACCESS_GUARD=0
CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR=<storeDir>
```

This lets runtime hooks fail open when WAG is disabled.

## Audit Logging

WAG audit events are written only for non-allow decisions.

Location:

```text
<globalStorage>/workspace-access-guard/audit/YYYY-MM-DD.jsonl
```

Audit event fields include:

- Event ID and timestamp
- Provider (`claude` or `codex`)
- Session and turn IDs when available from env
- Workspace path hash, not raw workspace path
- Tool name and operation
- Decision action (`deny` or `audit`)
- Reason
- Matched path and normalized matched path
- Matched rule ID/source
- Extracted path count
- Allowed root count
- Enabled denied rule count

Audit events do not store file contents.

## Webview Message Contract

Types are defined in `src/extension/types/webview-messages.ts`, and handlers live in `MessageHandler.ts`.

Webview to extension:

```text
workspaceAccessGuardGetStatus
workspaceAccessGuardSetEnabled
workspaceAccessGuardSetMode
workspaceAccessGuardGetAllowedRoots
workspaceAccessGuardAddAllowedRoots
workspaceAccessGuardRemoveAllowedRoot
workspaceAccessGuardAddCurrentWorkspace
workspaceAccessGuardGetOrgPolicyStatus
workspaceAccessGuardGetAuditEvents
workspaceAccessGuardTestPath
workspaceAccessGuardTestCommand
```

Extension to webview:

```text
workspaceAccessGuardStatus
workspaceAccessGuardAllowedRoots
workspaceAccessGuardOrgPolicyStatus
workspaceAccessGuardAuditEvents
workspaceAccessGuardTestResult
workspaceAccessGuardError
```

## Integration Points

| File | Role |
|------|------|
| `src/extension/extension.ts` | Creates and initializes shared `WorkspaceAccessGuardService`; injects it into `TabManager` |
| `src/extension/session/TabManager.ts` | Passes WAG service to Claude and Codex tabs |
| `src/extension/session/SessionTab.ts` | Wires WAG service into Claude `MessageHandler` and `ClaudeProcessManager` |
| `src/extension/session/CodexSessionTab.ts` | Wires WAG service into Codex handler and `CodexExecProcessManager` |
| `src/extension/process/ClaudeProcessManager.ts` | Injects WAG env before SPA env |
| `src/extension/process/CodexExecProcessManager.ts` | Injects WAG env before SPA env |
| `src/extension/webview/MessageHandler.ts` | Handles WAG webview requests |
| `src/extension/types/webview-messages.ts` | Defines WAG message request/response types |
| `webpack.config.js` | Adds `workspace-access-guard-runtime` target |
| `package.json` | Contributes WAG settings to VS Code |

## Failure Behavior

- Missing marker argument: allow.
- Missing/disabled settings: allow.
- Hook input parse failure:
  - `block` mode: deny for enforceable events.
  - `audit` mode: allow.
- Hook timeout after 3000 ms:
  - Claude `PreToolUse`: deny.
  - Codex `PreToolUse` and `PermissionRequest`: deny.
- Missing org policy file: built-in defaults.
- Invalid org policy schema/JSON: built-in defaults, status includes error.
- Invalid existing hook config JSON during install: installation throws and does not overwrite the file.

## Limitations

WAG is not a kernel or OS sandbox. It can block explicit paths exposed in tool calls, shell command text, MCP arguments, and patch headers. It cannot prove what a trusted binary or script will read internally when the path does not appear in the preflight input.

Example limitation:

```bash
node scripts/custom-tool.js
```

If `custom-tool.js` internally reads `C:\Users\<user>\.ssh\id_rsa` and that path is not present in the command line or tool input, WAG cannot detect it before execution.

For stronger future enforcement, ClaUi would need process isolation such as a low-privilege Windows user, AppContainer, WDAC, job objects with ACL changes, or another OS-level sandbox design.

## Development Summary

This development pass added the WAG backend and runtime foundation:

- Added shared WAG types for settings, decisions, policies, hook status, allowed roots, and audit events.
- Added extension services for settings, lifecycle, hook installation, env injection, user root persistence, org policy loading, and audit reading.
- Added hook runtime modules for path normalization, command extraction, tool extraction, policy evaluation, audit writing, and provider-specific hook entry points.
- Added Claude and Codex process env injection before SPA env injection.
- Added service propagation through extension activation, `TabManager`, `SessionTab`, and `CodexSessionTab`.
- Added WAG webview message request/response types and extension-side handlers.
- Added Tools tab UI controls and Zustand state for WAG.
- Fixed built-in denied-root string escaping so Windows paths keep their backslashes at runtime.
- Fixed runtime auto-allow behavior so it adds the VS Code workspace path from env, not the current command `cwd`.
- Fixed build/test commands such as `npm test` so they are allowed when their cwd is inside an allowed workspace.
- Fixed no-allowed-roots behavior to deny file access instead of failing open.
- Added wildcard denied-root matching for patterns such as `C:\Users\*\Documents\Secrets\**`.
- Blocked hard broad allowed roots (`C:\`, `C:\Users`, and the whole user profile) from granting access.
- Fixed runtime settings loading so hooks honor the complete `runtime-enabled.json` settings snapshot when `CLAUI_WORKSPACE_ACCESS_GUARD=1`.
- Expanded env overrides for `autoAllowWorkspaceFolders`, outside-root blocking, denied-root blocking, broad-root warnings, unresolved symlink handling, unknown command denial, and audit retention days.
- Aligned the Tools tab command tester with hook behavior for `build-or-test`, `unknown-file-access`, and no-file-access command classes.
- Fixed direct file tools with missing/unparseable path input to fail closed.
- Fixed Codex `PermissionRequest` deny output to report `hookEventName: "PermissionRequest"`.
- Added WAG unit/runtime tests under `tests/workspace-access-guard/`.
- Added the WAG runtime webpack target.
- Added `package.json` setting contributions for all `claudeMirror.workspaceAccessGuard.*` settings.
- Updated `TECHNICAL.md` with directory structure, component index, and configuration entries.

Remaining follow-up candidates:

- Add audit pruning that honors `auditRetentionDays`.
