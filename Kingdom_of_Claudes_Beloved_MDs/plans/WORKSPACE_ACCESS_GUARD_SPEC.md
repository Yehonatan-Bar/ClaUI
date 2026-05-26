# Technical Specification: Workspace Access Guard for ClaUi

**Feature name:** Workspace Access Guard  
**Internal key:** `workspaceAccessGuard`  
**Target extension:** ClaUi / Claude Code Mirror  
**Target providers:** Claude Code and Codex  
**Primary platform:** Windows enterprise environments  
**Authoring date:** 2026-05-25

---

## 1. Executive Summary

Workspace Access Guard adds a filesystem boundary around AI coding agents. It prevents Claude Code and Codex sessions launched through ClaUi from reading, searching, writing, or otherwise operating on files outside user-approved working folders, and from operating inside organization-denied folders.

The feature is intended to prevent incidents such as:

```bash
grep -r "..." /c/Users/yoni.bar
```

where an agent-initiated shell command recursively scans the whole Windows user profile, including credential stores, browser profiles, shell history, cloud credentials, SSH keys, and other sensitive locations.

The feature has two policy layers:

1. **User allowed working folders** — configured through a friendly UI under the existing **Tools** tab. Every file and folder nested under an allowed folder is allowed unless it is denied by the organization policy.
2. **Organization denied folders** — configured in a centrally managed policy file, with secure Windows defaults. Denied folders always win over allowed folders.

Policy result:

```text
ALLOW only when target path is inside an allowed working folder
AND target path is not inside any denied organization folder.

DENY when target path is inside a denied folder
OR target path is outside all allowed working folders.
```

This must happen before Bash commands, file tools, or MCP operations execute.

---

## 2. Problem Statement

Particle Accelerator currently focuses on command output routing, redaction, compression, and trace generation. Secret Write Guard / SPA focuses on blocking secrets written into code, git, Bash writes, and MCP write operations.

Those protections are not sufficient for broad read/search incidents. A command like this may not write anything and may not contain a secret inline:

```bash
grep -r "password" /c/Users/yoni.bar
```

The risk is the **scope of filesystem access**, not only the content of the command output or a write target.

Workspace Access Guard closes this gap by enforcing path boundaries before execution.

---

## 3. Goals

Workspace Access Guard must:

1. Let the user configure allowed working folders through an easy UI.
2. Treat all nested files and folders under an allowed root as allowed.
3. Load organization-denied folders from a centrally managed policy file.
4. Ship with secure default denied folders for Windows.
5. Allow the organization to edit or deploy the denied-folder policy easily.
6. Block all agent tool calls that target denied paths.
7. Block all agent tool calls that target paths outside allowed roots.
8. Intercept Bash commands before they execute.
9. Intercept direct file tools such as Read, Grep, Glob, LS, Edit, Write, and MultiEdit where supported by the provider hook protocol.
10. Intercept MCP tool arguments when they contain filesystem paths or write-like operations.
11. Normalize Windows, Git Bash, MSYS, WSL-style, tilde, environment-variable, relative, and symlink/junction paths before policy evaluation.
12. Provide audit events without storing file content or secrets.
13. Integrate cleanly with existing Particle Accelerator and SPA hook ordering.

---

## 4. Non-Goals and Important Limitations

Workspace Access Guard is a hook-level and command-preflight guardrail, not a full operating-system sandbox.

It can reliably block explicit paths exposed through agent tool calls and shell command text. It cannot fully prevent a trusted binary or script from internally reading outside the allowed folder if the command does not reveal that path to the hook runtime.

Example:

```bash
node scripts/custom-tool.js
```

If `custom-tool.js` internally reads `C:\Users\yoni.bar\.ssh\id_rsa` without that path appearing in the command line, a hook-only implementation cannot see it before execution.

For stronger enforcement, a later version may add OS-level sandboxing using Windows security boundaries, separate low-privilege users, AppContainer, WDAC, or controlled process isolation. This is out of scope for version 1.

Version 1 must still block the common and high-risk explicit-path cases, including:

```bash
grep -r ... /c/Users/yoni.bar
rg ... C:\Users\yoni.bar
find C:\Users\yoni.bar
cat %USERPROFILE%\.ssh\id_rsa
type %APPDATA%\Microsoft\Credentials\...
```

---

## 5. User Experience Requirements

### 5.1 Location in UI

Add a new card/panel under the existing **Tools** tab:

```text
Tools -> Workspace Access Guard
```

Suggested UI label:

```text
Workspace Access Guard
Control which folders Claude/Codex may access.
```

### 5.2 Main UI Elements

The panel must include:

1. **Enable/disable toggle**

```text
Workspace Access Guard [ On / Off ]
```

2. **Mode selector**

```text
Mode: Block | Audit
```

Default:

```text
Block
```

3. **Allowed working folders list**

Example:

```text
Allowed working folders
- C:\projects
- C:\Users\yoni.bar\Documents\Workspaces
```

4. **Add folder button**

Use VS Code folder picker:

```ts
vscode.window.showOpenDialog({
  canSelectFolders: true,
  canSelectFiles: false,
  canSelectMany: true
})
```

5. **Add current workspace button**

```text
Add current VS Code workspace
```

6. **Remove button per allowed folder**

```text
Remove
```

7. **Folder risk warning**

When the user adds a broad folder, show a warning.

Broad examples:

```text
C:\
C:\Users
C:\Users\<user>
C:\Users\<user>\Documents
C:\Users\<user>\Desktop
C:\Users\<user>\Downloads
```

Warning text:

```text
This is a broad user-data folder. Claude/Codex commands may scan personal or sensitive documents.
Recommended: add a project-specific subfolder instead.
```

8. **Organization policy status**

Example:

```text
Organization policy: Loaded
Path: C:\ProgramData\ClaUi\workspace-access-guard.policy.json
Last modified: 2026-05-25 09:42
Denied folders: 27 rules
```

If the organization policy file is missing:

```text
Organization policy: Built-in defaults active
```

If invalid:

```text
Organization policy: Invalid JSON/schema. Built-in defaults are active. See Output -> ClaUi.
```

9. **Last blocked action preview**

Example:

```text
Last blocked action
Provider: Claude
Tool: Bash
Reason: Recursive search outside allowed folders
Command: grep -r "..." /c/Users/yoni.bar
Matched path: C:\Users\yoni.bar
```

Do not display file contents.

10. **Test a path / command utility**

Optional but recommended:

```text
Test path or command
[ C:\Users\yoni.bar\.ssh ] [Check]
Result: Blocked by organization policy: user SSH key folder
```

---

## 6. Policy Model

### 6.1 Policy Decision

```ts
export type WorkspaceAccessDecisionAction = 'allow' | 'deny' | 'audit';

export interface WorkspaceAccessDecision {
  action: WorkspaceAccessDecisionAction;
  reason: string;
  matchedPath?: string;
  matchedRuleId?: string;
  matchedRuleSource?: 'builtin-default' | 'organization-policy' | 'user-allowed-root';
  normalizedPaths: string[];
  remediation?: string;
}
```

### 6.2 Precedence

Evaluation order:

```text
1. Normalize and resolve all paths.
2. If any path matches an organization denied root -> DENY.
3. If any path is outside all user allowed roots -> DENY.
4. If command/path extraction is uncertain and command is file-accessing -> DENY in block mode, AUDIT in audit mode.
5. Otherwise -> ALLOW.
```

Hard rule:

```text
Deny wins over allow.
```

Example:

```text
Allowed root:
- C:\Users\yoni.bar\Documents

Denied root:
- C:\Users\*\Documents\Secrets\**

Target:
- C:\Users\yoni.bar\Documents\Secrets\customer-token.txt

Decision:
- DENY
```

---

## 7. Configuration

### 7.1 VS Code Settings

Add settings under:

```text
claudeMirror.workspaceAccessGuard.*
```

Recommended settings:

```ts
export interface WorkspaceAccessGuardSettings {
  enabled: boolean;                         // default false
  mode: 'block' | 'audit';                  // default 'block'
  userAllowedRoots: string[];               // editable through UI
  autoAllowWorkspaceFolders: boolean;        // default true
  orgPolicyPath: string;                    // default C:\ProgramData\ClaUi\workspace-access-guard.policy.json
  scanBashCommands: boolean;                // default true
  scanFileTools: boolean;                   // default true
  scanMcpTools: boolean;                    // default true
  blockOutsideAllowedRoots: boolean;         // default true
  blockDeniedRoots: boolean;                // default true
  warnOnBroadAllowedRoots: boolean;          // default true
  denyUnresolvedSymlinkTargets: boolean;     // default true
  denyUnknownFileAccessCommands: boolean;    // default true
  auditRetentionDays: number;               // default 90
}
```

Recommended `package.json` defaults:

```json
{
  "claudeMirror.workspaceAccessGuard.enabled": false,
  "claudeMirror.workspaceAccessGuard.mode": "block",
  "claudeMirror.workspaceAccessGuard.userAllowedRoots": [],
  "claudeMirror.workspaceAccessGuard.autoAllowWorkspaceFolders": true,
  "claudeMirror.workspaceAccessGuard.orgPolicyPath": "C:\\ProgramData\\ClaUi\\workspace-access-guard.policy.json",
  "claudeMirror.workspaceAccessGuard.scanBashCommands": true,
  "claudeMirror.workspaceAccessGuard.scanFileTools": true,
  "claudeMirror.workspaceAccessGuard.scanMcpTools": true,
  "claudeMirror.workspaceAccessGuard.blockOutsideAllowedRoots": true,
  "claudeMirror.workspaceAccessGuard.blockDeniedRoots": true,
  "claudeMirror.workspaceAccessGuard.warnOnBroadAllowedRoots": true,
  "claudeMirror.workspaceAccessGuard.denyUnresolvedSymlinkTargets": true,
  "claudeMirror.workspaceAccessGuard.denyUnknownFileAccessCommands": true,
  "claudeMirror.workspaceAccessGuard.auditRetentionDays": 90
}
```

### 7.2 User Allowed Roots Store

The UI may write `userAllowedRoots` to VS Code settings, but the recommended implementation is a JSON file under extension global storage, because it is easy to update atomically and avoids malformed user settings.

Recommended path:

```text
<globalStoragePath>/workspace-access-guard/user-allowed-roots.json
```

Format:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-25T09:42:00.000Z",
  "roots": [
    "C:\\projects",
    "C:\\Users\\yoni.bar\\Documents\\Workspaces"
  ]
}
```

The webview should present this through the Tools UI. Users should not need to edit this file manually.

---

## 8. Organization Policy File

### 8.1 Recommended Central Policy Location

For Windows enterprise deployments, use:

```text
C:\ProgramData\ClaUi\workspace-access-guard.policy.json
```

Reasons:

1. It is machine-wide.
2. It is easy to deploy with Intune, GPO, SCCM, or PowerShell.
3. Administrators can write it.
4. Standard users can read it but should not be able to modify it.
5. It does not depend on a specific user's profile path.

### 8.2 File Permissions

Recommended ACL:

```text
Administrators: Full Control
SYSTEM: Full Control
Users: Read
Authenticated Users: Read
```

Regular users should not have Modify or Full Control permission on this policy file.

### 8.3 Organization Policy Schema

```ts
export interface WorkspaceAccessOrgPolicy {
  schemaVersion: 1;
  policyName: string;
  policyId?: string;
  updatedAt?: string;
  updatedBy?: string;
  mode?: 'block' | 'audit';
  deniedRoots: WorkspaceAccessDeniedRoot[];
  broadRootRules?: WorkspaceAccessBroadRootRules;
  commandRules?: WorkspaceAccessCommandRules;
  ui?: WorkspaceAccessPolicyUi;
}

export interface WorkspaceAccessDeniedRoot {
  id: string;
  description: string;
  path: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category:
    | 'windows-credentials'
    | 'browser-profile'
    | 'ssh-keys'
    | 'cloud-credentials'
    | 'kubernetes-credentials'
    | 'shell-history'
    | 'git-credentials'
    | 'ai-agent-history'
    | 'application-secrets'
    | 'custom';
}

export interface WorkspaceAccessBroadRootRules {
  denyWholeUserProfile: boolean;
  denyWholeUsersFolder: boolean;
  denyDriveRoot: boolean;
  warnOnDocumentsDesktopDownloads: boolean;
}

export interface WorkspaceAccessCommandRules {
  denyRecursiveSearchOutsideAllowedRoots: boolean;
  denyFileReadOutsideAllowedRoots: boolean;
  denyFileWriteOutsideAllowedRoots: boolean;
  denyUnknownFileAccessCommands: boolean;
}

export interface WorkspaceAccessPolicyUi {
  supportContact?: string;
  helpUrl?: string;
}
```

### 8.4 Default Organization Policy File

The extension should ship with these built-in defaults. If no organization file exists, the extension should apply these defaults in memory.

Recommended default JSON:

```json
{
  "schemaVersion": 1,
  "policyName": "ClaUi Workspace Access Guard - Windows Enterprise Defaults",
  "policyId": "claui-wag-windows-defaults-v1",
  "updatedAt": "2026-05-25T00:00:00.000Z",
  "updatedBy": "ClaUi built-in defaults",
  "mode": "block",
  "deniedRoots": [
    {
      "id": "win-credential-manager-local",
      "description": "Windows Credential Manager local credential store",
      "path": "%LOCALAPPDATA%\\Microsoft\\Credentials\\**",
      "enabled": true,
      "severity": "critical",
      "category": "windows-credentials"
    },
    {
      "id": "win-credential-manager-roaming",
      "description": "Windows Credential Manager roaming credential store",
      "path": "%APPDATA%\\Microsoft\\Credentials\\**",
      "enabled": true,
      "severity": "critical",
      "category": "windows-credentials"
    },
    {
      "id": "win-protect-masterkeys",
      "description": "Windows DPAPI Protect folder",
      "path": "%APPDATA%\\Microsoft\\Protect\\**",
      "enabled": true,
      "severity": "critical",
      "category": "windows-credentials"
    },
    {
      "id": "ssh-keys",
      "description": "User SSH keys",
      "path": "%USERPROFILE%\\.ssh\\**",
      "enabled": true,
      "severity": "critical",
      "category": "ssh-keys"
    },
    {
      "id": "gnupg-keys",
      "description": "GPG private keys and trust database",
      "path": "%USERPROFILE%\\.gnupg\\**",
      "enabled": true,
      "severity": "high",
      "category": "application-secrets"
    },
    {
      "id": "aws-credentials",
      "description": "AWS CLI credentials and configuration",
      "path": "%USERPROFILE%\\.aws\\**",
      "enabled": true,
      "severity": "critical",
      "category": "cloud-credentials"
    },
    {
      "id": "azure-credentials",
      "description": "Azure CLI credentials",
      "path": "%USERPROFILE%\\.azure\\**",
      "enabled": true,
      "severity": "critical",
      "category": "cloud-credentials"
    },
    {
      "id": "gcloud-credentials",
      "description": "Google Cloud SDK credentials",
      "path": "%APPDATA%\\gcloud\\**",
      "enabled": true,
      "severity": "critical",
      "category": "cloud-credentials"
    },
    {
      "id": "kube-credentials",
      "description": "Kubernetes kubeconfig and cluster credentials",
      "path": "%USERPROFILE%\\.kube\\**",
      "enabled": true,
      "severity": "critical",
      "category": "kubernetes-credentials"
    },
    {
      "id": "docker-config",
      "description": "Docker config and registry credentials",
      "path": "%USERPROFILE%\\.docker\\**",
      "enabled": true,
      "severity": "high",
      "category": "application-secrets"
    },
    {
      "id": "git-credentials-file",
      "description": "Git credential helper plaintext credential file",
      "path": "%USERPROFILE%\\.git-credentials",
      "enabled": true,
      "severity": "critical",
      "category": "git-credentials"
    },
    {
      "id": "npmrc-user",
      "description": "User npm token file",
      "path": "%USERPROFILE%\\.npmrc",
      "enabled": true,
      "severity": "high",
      "category": "application-secrets"
    },
    {
      "id": "pypirc-user",
      "description": "User PyPI credential file",
      "path": "%USERPROFILE%\\.pypirc",
      "enabled": true,
      "severity": "high",
      "category": "application-secrets"
    },
    {
      "id": "chrome-profile",
      "description": "Google Chrome browser profile, cookies, tokens, and history",
      "path": "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\**",
      "enabled": true,
      "severity": "critical",
      "category": "browser-profile"
    },
    {
      "id": "edge-profile",
      "description": "Microsoft Edge browser profile, cookies, tokens, and history",
      "path": "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\**",
      "enabled": true,
      "severity": "critical",
      "category": "browser-profile"
    },
    {
      "id": "firefox-profile",
      "description": "Firefox browser profile, cookies, tokens, and history",
      "path": "%APPDATA%\\Mozilla\\Firefox\\Profiles\\**",
      "enabled": true,
      "severity": "critical",
      "category": "browser-profile"
    },
    {
      "id": "powershell-history",
      "description": "PowerShell command history may contain secrets or internal paths",
      "path": "%APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\**",
      "enabled": true,
      "severity": "medium",
      "category": "shell-history"
    },
    {
      "id": "claude-agent-history",
      "description": "Claude local conversation and project history",
      "path": "%USERPROFILE%\\.claude\\**",
      "enabled": true,
      "severity": "high",
      "category": "ai-agent-history"
    },
    {
      "id": "codex-agent-history",
      "description": "Codex local conversation and session history",
      "path": "%USERPROFILE%\\.codex\\**",
      "enabled": true,
      "severity": "high",
      "category": "ai-agent-history"
    },
    {
      "id": "vscode-user-global-storage",
      "description": "VS Code extension global storage may contain tokens, session data, or secrets",
      "path": "%APPDATA%\\Code\\User\\globalStorage\\**",
      "enabled": true,
      "severity": "high",
      "category": "application-secrets"
    }
  ],
  "broadRootRules": {
    "denyWholeUserProfile": true,
    "denyWholeUsersFolder": true,
    "denyDriveRoot": true,
    "warnOnDocumentsDesktopDownloads": true
  },
  "commandRules": {
    "denyRecursiveSearchOutsideAllowedRoots": true,
    "denyFileReadOutsideAllowedRoots": true,
    "denyFileWriteOutsideAllowedRoots": true,
    "denyUnknownFileAccessCommands": true
  },
  "ui": {
    "supportContact": "Security team",
    "helpUrl": ""
  }
}
```

---

## 9. Best Deployment Model for Security Teams

### 9.1 Recommended Enterprise Method

The most convenient and secure model is:

1. The extension ships with built-in default denied roots.
2. Security manages one machine-level JSON policy file:

```text
C:\ProgramData\ClaUi\workspace-access-guard.policy.json
```

3. Security deploys or updates this file with Intune, GPO, SCCM, or a signed PowerShell script.
4. The extension reads the file on startup and watches it for changes.
5. Users can configure only their allowed working folders through the UI.
6. Users cannot edit organization-denied folders through the UI.

### 9.2 Why Not Store Organization Policy in User Settings?

Do not store organization-denied paths in normal VS Code user settings as the primary enterprise mechanism. Users can usually edit those settings.

VS Code settings may still expose `orgPolicyPath`, but the default should be machine-wide and admin-controlled.

### 9.3 Policy Reload

The extension should:

1. Load policy during activation.
2. Reload policy when a new session starts.
3. Watch the policy file with `fs.watch` or a VS Code file watcher.
4. Debounce reloads by 500 ms.
5. Validate schema before applying.
6. If validation fails, keep the previous valid policy if available; otherwise fall back to built-in defaults.
7. Show policy error in `Output -> ClaUi` and the Tools UI.

---

## 10. PowerShell Deployment Script for Security

Security can deploy this script through Intune, GPO, SCCM, or manual admin execution.

File name suggestion:

```text
Install-ClaUiWorkspaceAccessPolicy.ps1
```

Script:

```powershell
# Install-ClaUiWorkspaceAccessPolicy.ps1
# Creates or updates the ClaUi Workspace Access Guard organization policy.
# Run as Administrator. Intended for Intune/GPO/SCCM deployment.

param(
    [string]$PolicyDirectory = "C:\ProgramData\ClaUi",
    [string]$PolicyFileName = "workspace-access-guard.policy.json"
)

$ErrorActionPreference = "Stop"

$policyPath = Join-Path $PolicyDirectory $PolicyFileName

if (-not (Test-Path $PolicyDirectory)) {
    New-Item -Path $PolicyDirectory -ItemType Directory -Force | Out-Null
}

$policy = @{
    schemaVersion = 1
    policyName = "ClaUi Workspace Access Guard - Organization Policy"
    policyId = "org-wag-policy-v1"
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    updatedBy = "Security"
    mode = "block"
    deniedRoots = @(
        @{
            id = "win-credential-manager-local"
            description = "Windows Credential Manager local credential store"
            path = "%LOCALAPPDATA%\\Microsoft\\Credentials\\**"
            enabled = $true
            severity = "critical"
            category = "windows-credentials"
        },
        @{
            id = "win-credential-manager-roaming"
            description = "Windows Credential Manager roaming credential store"
            path = "%APPDATA%\\Microsoft\\Credentials\\**"
            enabled = $true
            severity = "critical"
            category = "windows-credentials"
        },
        @{
            id = "win-protect-masterkeys"
            description = "Windows DPAPI Protect folder"
            path = "%APPDATA%\\Microsoft\\Protect\\**"
            enabled = $true
            severity = "critical"
            category = "windows-credentials"
        },
        @{
            id = "ssh-keys"
            description = "User SSH keys"
            path = "%USERPROFILE%\\.ssh\\**"
            enabled = $true
            severity = "critical"
            category = "ssh-keys"
        },
        @{
            id = "aws-credentials"
            description = "AWS CLI credentials and configuration"
            path = "%USERPROFILE%\\.aws\\**"
            enabled = $true
            severity = "critical"
            category = "cloud-credentials"
        },
        @{
            id = "azure-credentials"
            description = "Azure CLI credentials"
            path = "%USERPROFILE%\\.azure\\**"
            enabled = $true
            severity = "critical"
            category = "cloud-credentials"
        },
        @{
            id = "gcloud-credentials"
            description = "Google Cloud SDK credentials"
            path = "%APPDATA%\\gcloud\\**"
            enabled = $true
            severity = "critical"
            category = "cloud-credentials"
        },
        @{
            id = "kube-credentials"
            description = "Kubernetes kubeconfig and cluster credentials"
            path = "%USERPROFILE%\\.kube\\**"
            enabled = $true
            severity = "critical"
            category = "kubernetes-credentials"
        },
        @{
            id = "docker-config"
            description = "Docker config and registry credentials"
            path = "%USERPROFILE%\\.docker\\**"
            enabled = $true
            severity = "high"
            category = "application-secrets"
        },
        @{
            id = "git-credentials-file"
            description = "Git credential helper plaintext credential file"
            path = "%USERPROFILE%\\.git-credentials"
            enabled = $true
            severity = "critical"
            category = "git-credentials"
        },
        @{
            id = "npmrc-user"
            description = "User npm token file"
            path = "%USERPROFILE%\\.npmrc"
            enabled = $true
            severity = "high"
            category = "application-secrets"
        },
        @{
            id = "pypirc-user"
            description = "User PyPI credential file"
            path = "%USERPROFILE%\\.pypirc"
            enabled = $true
            severity = "high"
            category = "application-secrets"
        },
        @{
            id = "chrome-profile"
            description = "Google Chrome browser profile, cookies, tokens, and history"
            path = "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\**"
            enabled = $true
            severity = "critical"
            category = "browser-profile"
        },
        @{
            id = "edge-profile"
            description = "Microsoft Edge browser profile, cookies, tokens, and history"
            path = "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\**"
            enabled = $true
            severity = "critical"
            category = "browser-profile"
        },
        @{
            id = "firefox-profile"
            description = "Firefox browser profile, cookies, tokens, and history"
            path = "%APPDATA%\\Mozilla\\Firefox\\Profiles\\**"
            enabled = $true
            severity = "critical"
            category = "browser-profile"
        },
        @{
            id = "powershell-history"
            description = "PowerShell command history may contain secrets or internal paths"
            path = "%APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\**"
            enabled = $true
            severity = "medium"
            category = "shell-history"
        },
        @{
            id = "claude-agent-history"
            description = "Claude local conversation and project history"
            path = "%USERPROFILE%\\.claude\\**"
            enabled = $true
            severity = "high"
            category = "ai-agent-history"
        },
        @{
            id = "codex-agent-history"
            description = "Codex local conversation and session history"
            path = "%USERPROFILE%\\.codex\\**"
            enabled = $true
            severity = "high"
            category = "ai-agent-history"
        }
    )
    broadRootRules = @{
        denyWholeUserProfile = $true
        denyWholeUsersFolder = $true
        denyDriveRoot = $true
        warnOnDocumentsDesktopDownloads = $true
    }
    commandRules = @{
        denyRecursiveSearchOutsideAllowedRoots = $true
        denyFileReadOutsideAllowedRoots = $true
        denyFileWriteOutsideAllowedRoots = $true
        denyUnknownFileAccessCommands = $true
    }
    ui = @{
        supportContact = "Security team"
        helpUrl = ""
    }
}

$json = $policy | ConvertTo-Json -Depth 12
$tmp = "$policyPath.tmp"
Set-Content -Path $tmp -Value $json -Encoding UTF8
Move-Item -Path $tmp -Destination $policyPath -Force

# Lock down ACLs: Administrators and SYSTEM can modify; Users can read.
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$administrators = New-Object System.Security.Principal.NTAccount("BUILTIN", "Administrators")
$system = New-Object System.Security.Principal.NTAccount("NT AUTHORITY", "SYSTEM")
$users = New-Object System.Security.Principal.NTAccount("BUILTIN", "Users")

$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($administrators, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($users, "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow")))
Set-Acl -Path $PolicyDirectory -AclObject $acl

$fileAcl = Get-Acl -Path $policyPath
$fileAcl.SetAccessRuleProtection($true, $false)
$fileAcl.Access | ForEach-Object { [void]$fileAcl.RemoveAccessRule($_) }
$fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($administrators, "FullControl", "Allow")))
$fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, "FullControl", "Allow")))
$fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($users, "Read", "Allow")))
Set-Acl -Path $policyPath -AclObject $fileAcl

Write-Host "ClaUi Workspace Access Guard policy installed: $policyPath"
```

---

## 11. Architecture

### 11.1 New Extension Module

Add:

```text
src/extension/workspace-access-guard/
```

Recommended files:

```text
src/extension/workspace-access-guard/WorkspaceAccessGuardService.ts
src/extension/workspace-access-guard/WorkspaceAccessGuardSettings.ts
src/extension/workspace-access-guard/WorkspaceAccessGuardHookManager.ts
src/extension/workspace-access-guard/WorkspaceAccessGuardEnvBuilder.ts
src/extension/workspace-access-guard/WorkspaceAccessGuardTypes.ts
src/extension/workspace-access-guard/WorkspaceAccessGuardAuditReader.ts
src/extension/workspace-access-guard/UserAllowedRootsStore.ts
src/extension/workspace-access-guard/OrgPolicyLoader.ts
```

### 11.2 New Runtime Module

Add:

```text
src/workspace-access-guard-runtime/
```

Recommended files:

```text
src/workspace-access-guard-runtime/PathNormalizer.ts
src/workspace-access-guard-runtime/PathPolicyEngine.ts
src/workspace-access-guard-runtime/CommandPathExtractor.ts
src/workspace-access-guard-runtime/ToolPathExtractor.ts
src/workspace-access-guard-runtime/AuditWriter.ts
src/workspace-access-guard-runtime/hooks/claudeWorkspaceAccessGuard.ts
src/workspace-access-guard-runtime/hooks/codexWorkspaceAccessGuard.ts
```

### 11.3 Integration Order

Workspace Access Guard must run before SPA and Particle Accelerator.

Recommended order:

```text
Agent tool call
  ↓
Workspace Access Guard
  ↓
Super Particle Accelerator / Secret Write Guard
  ↓
Particle Accelerator / claui-run
  ↓
Actual shell or tool execution
```

Reason:

1. Workspace Access Guard blocks dangerous path access before command execution.
2. SPA then blocks secret writes and git publication risks.
3. Particle Accelerator then handles output filtering/redaction/compression for commands that were allowed.

### 11.4 Hook Marker

Use a dedicated marker:

```text
--claui-workspace-access-guard-hook
```

Do not rely only on the existing Particle Accelerator or SPA markers.

### 11.5 Hook Installation Locations

Claude:

```text
<workspace>/.claude/settings.json
```

Codex:

```text
<workspace>/.codex/hooks.json
```

The hook manager must preserve existing settings, create backups, and verify hook status per provider.

---

## 12. Hook Coverage

### 12.1 Claude Code Hooks

Install Workspace Access Guard hooks for:

```text
PreToolUse: Bash
PreToolUse: Read
PreToolUse: Grep
PreToolUse: Glob
PreToolUse: LS
PreToolUse: Edit|Write|MultiEdit
PreToolUse: NotebookEdit
PreToolUse: mcp__.*
Stop: optional audit scan only
```

Required behavior:

```text
If disabled:
  allow

If Bash:
  extract path targets from command
  evaluate all targets against policy
  deny before execution if outside allowed roots or inside denied roots

If Read/Grep/Glob/LS:
  extract file_path, path, pattern root, or directory argument
  evaluate target paths
  deny before tool execution if blocked

If Edit/Write/MultiEdit/NotebookEdit:
  evaluate target file path before write
  deny if target path is blocked
  pass to SPA afterward for secret write scanning

If mcp__.*:
  recursively scan string arguments for filesystem-like paths
  deny write-like or file-accessing MCP calls if blocked
```

### 12.2 Codex Hooks

Install Workspace Access Guard hooks for:

```text
PreToolUse: Bash
PermissionRequest: Bash
PreToolUse: apply_patch
PreToolUse: Edit|Write
PreToolUse: mcp__.*
Stop: optional audit scan only
```

Codex behavior:

```text
If Bash command contains explicit file paths:
  extract and evaluate all paths
  deny command before execution if blocked

If apply_patch/Edit/Write:
  evaluate changed target file paths
  deny if any target path is blocked

If PermissionRequest:Bash:
  apply the same Bash policy before approving
```

### 12.3 Provider-Specific Deny Output

Claude deny response should include a `permissionDecision: "deny"` style result compatible with the existing hook pattern.

Codex deny response should use its provider-compatible hook response, for example:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Workspace Access Guard blocked this action because it targets a path outside allowed working folders or inside an organization-denied folder."
  }
}
```

---

## 13. Path Normalization Requirements

Path normalization is security-critical.

Implement:

```ts
export interface PathNormalizer {
  normalizePath(input: string, cwd: string, env: NodeJS.ProcessEnv): NormalizedPathResult;
  normalizeMany(inputs: string[], cwd: string, env: NodeJS.ProcessEnv): NormalizedPathResult[];
}

export interface NormalizedPathResult {
  original: string;
  expanded: string;
  absolutePath: string;
  realPath?: string;
  comparisonPath: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'unknown';
  warnings: string[];
}
```

### 13.1 Must Support These Input Forms

```text
C:\Users\yoni.bar\Documents
C:/Users/yoni.bar/Documents
/c/Users/yoni.bar/Documents
/mnt/c/Users/yoni.bar/Documents
~/.ssh/id_rsa
%USERPROFILE%\.ssh\id_rsa
$USERPROFILE/.ssh/id_rsa
${USERPROFILE}/.ssh/id_rsa
..\..\Users\yoni.bar\.ssh
C:\projects\..\Users\yoni.bar
\\server\share\folder
```

### 13.2 Comparison Rules

1. Use case-insensitive comparison on Windows.
2. Convert `/c/...` and `/mnt/c/...` to `C:\...`.
3. Expand `%VAR%`, `$VAR`, `${VAR}`, and `~`.
4. Resolve relative paths against the command/tool `cwd`.
5. Call `fs.realpathSync.native()` where possible.
6. For paths that do not exist yet, resolve the nearest existing parent and append the missing suffix.
7. Normalize trailing slashes.
8. Reject or deny ambiguous unresolved paths when `denyUnresolvedSymlinkTargets` is enabled.
9. Resolve symlinks and junctions before policy matching.

### 13.3 Symlink / Junction Example

Allowed root:

```text
C:\projects
```

Symlink:

```text
C:\projects\safe-looking-link -> C:\Users\yoni.bar\AppData\Local\Microsoft\Credentials
```

Target command:

```bash
cat C:\projects\safe-looking-link\secret.dat
```

Decision:

```text
DENY
```

Reason:

```text
Resolved path points to organization-denied folder.
```

---

## 14. Command Path Extraction

### 14.1 Command Classifier

Implement:

```ts
export type CommandAccessKind =
  | 'no-file-access'
  | 'file-read'
  | 'recursive-file-read'
  | 'file-write'
  | 'file-delete'
  | 'file-move-copy'
  | 'git-operation'
  | 'build-or-test'
  | 'network-or-exfiltration'
  | 'unknown-file-access';

export interface CommandPathExtractionResult {
  accessKind: CommandAccessKind;
  paths: string[];
  cwdIsTarget: boolean;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
}
```

### 14.2 Read/Search Commands

Extract paths from:

```text
grep, rg, find, fd, ag, ack, ls, dir, tree, cat, type, more, less,
head, tail, wc, sed -n, awk, powershell Get-Content, Select-String
```

Examples:

```bash
grep -r "token" /c/Users/yoni.bar
rg "token" C:\Users\yoni.bar
find C:\Users\yoni.bar -type f
cat ~/.ssh/id_rsa
type %USERPROFILE%\.aws\credentials
```

Each extracted target path must be evaluated.

### 14.3 Write/Delete/Move Commands

Extract paths from:

```text
echo ... > file
printf ... > file
cat > file <<EOF
tee file
sed -i file
perl -pi file
cp source target
copy source target
mv source target
move source target
rm target
del target
mkdir target
rmdir target
powershell Set-Content/Add-Content/Out-File/Remove-Item/Copy-Item/Move-Item
```

Workspace Access Guard checks path access only. SPA/Secret Write Guard still scans written content for secrets.

### 14.4 Git Commands

For git commands:

1. Determine repository root from `cwd`.
2. Repository root must be inside an allowed root and not denied.
3. Any explicit pathspecs must be evaluated.
4. Git commit/push secret scanning remains the responsibility of SPA/Secret Write Guard.

Commands:

```text
git status
git diff
git add
git commit
git push
gh pr create
```

### 14.5 Commands Without Explicit Paths

If command has no explicit path and uses current working directory as the effective target, evaluate `cwd`.

Example:

```bash
npm test
```

If `cwd` is:

```text
C:\projects\my-app
```

and `C:\projects` is allowed, allow.

If `cwd` is:

```text
C:\Users\yoni.bar
```

and that path is not allowed, deny.

### 14.6 Unknown File-Access Commands

When a command is likely to access files but the parser cannot confidently extract the paths:

```text
block mode -> DENY
 audit mode -> AUDIT and allow
```

Example:

```bash
python -c "import pathlib; print(pathlib.Path.home().read_text())"
```

This should be classified as `unknown-file-access` or `file-read` and denied in block mode unless clearly limited to allowed roots.

---

## 15. File Tool Path Extraction

Implement:

```ts
export interface ToolPathExtractionInput {
  provider: 'claude' | 'codex';
  toolName: string;
  toolInput: unknown;
  cwd: string;
}

export interface ToolPathExtractionResult {
  paths: string[];
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
}
```

Known tool field names to inspect:

```text
file_path
path
paths
dir
directory
root
cwd
patternRoot
target
source
destination
```

For MCP tools, recursively inspect all string arguments. Treat a string as path-like if it matches:

```text
Windows absolute path
Git Bash /c path
WSL /mnt/c path
t . or .. relative path
~/ path
%ENVVAR% path
$ENVVAR path
Common file extensions or directory separators
```

---

## 16. Policy Engine

Implement:

```ts
export interface WorkspaceAccessPolicyInput {
  provider: 'claude' | 'codex';
  toolName: string;
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'bash' | 'unknown';
  command?: string;
  cwd: string;
  extractedPaths: string[];
  userAllowedRoots: string[];
  orgPolicy: WorkspaceAccessOrgPolicy;
  settings: WorkspaceAccessGuardSettings;
  env: Record<string, string | undefined>;
}

export interface WorkspaceAccessPolicyEngine {
  evaluate(input: WorkspaceAccessPolicyInput): WorkspaceAccessDecision;
}
```

### 16.1 Evaluation Algorithm

Pseudocode:

```ts
function evaluate(input: WorkspaceAccessPolicyInput): WorkspaceAccessDecision {
  const paths = input.extractedPaths.length > 0
    ? input.extractedPaths
    : shouldTreatCwdAsTarget(input) ? [input.cwd] : [];

  const normalizedTargets = normalizeMany(paths, input.cwd, input.env);
  const normalizedAllowedRoots = normalizeMany(input.userAllowedRoots, input.cwd, input.env);
  const normalizedDeniedRoots = normalizeDeniedPolicy(input.orgPolicy, input.env);

  for (const target of normalizedTargets) {
    const denied = firstMatchingDeniedRoot(target, normalizedDeniedRoots);
    if (denied) {
      return deny('Target path is inside an organization-denied folder', target, denied);
    }
  }

  if (input.settings.blockOutsideAllowedRoots) {
    for (const target of normalizedTargets) {
      if (!isInsideAnyAllowedRoot(target, normalizedAllowedRoots)) {
        return deny('Target path is outside allowed working folders', target);
      }
    }
  }

  if (input.operation === 'unknown' && input.settings.denyUnknownFileAccessCommands) {
    return deny('File-access command could not be safely parsed');
  }

  return allow('All target paths are inside allowed roots and outside denied roots');
}
```

### 16.2 Broad Root Blocking

If `broadRootRules.denyWholeUserProfile === true`, deny user attempts to add or use:

```text
%USERPROFILE%
C:\Users\<user>
/c/Users/<user>
```

If `broadRootRules.denyWholeUsersFolder === true`, deny:

```text
C:\Users
/c/Users
```

If `broadRootRules.denyDriveRoot === true`, deny:

```text
C:\
D:\
/c
/mnt/c
```

This applies both to:

1. User adding allowed roots in UI.
2. Agent commands targeting those broad roots.

---

## 17. Remediation Messages

### 17.1 Bash Recursive Search Block

Model-visible message:

```text
Workspace Access Guard blocked this command.

Reason:
The command tries to recursively search a folder outside the allowed working folders.

Blocked path:
{blockedPath}

Allowed working folders:
{allowedRoots}

Required fix:
Run the search only inside the project/workspace folder. Do not scan the entire user profile or credential-related folders.
```

### 17.2 Denied Folder Block

```text
Workspace Access Guard blocked this action.

Reason:
The target path is protected by the organization policy.

Blocked path:
{blockedPath}
Matched policy rule:
{ruleDescription}

Required fix:
Do not read, search, write, or copy files from this protected location. Use files inside the approved project workspace only.
```

### 17.3 Outside Allowed Roots Block

```text
Workspace Access Guard blocked this action.

Reason:
The target path is outside the folders that the user approved for Claude/Codex access.

Blocked path:
{blockedPath}

Allowed working folders:
{allowedRoots}

Required fix:
Use a file under one of the allowed working folders, or ask the user to add the relevant project folder in Tools -> Workspace Access Guard.
```

---

## 18. Audit Logging

### 18.1 Audit Path

Write audit events to:

```text
<globalStoragePath>/workspace-access-guard/audit/YYYY-MM-DD.jsonl
```

### 18.2 Audit Event Type

```ts
export interface WorkspaceAccessAuditEvent {
  id: string;
  timestamp: string;
  provider: 'claude' | 'codex';
  sessionId?: string;
  turnId?: string;
  workspacePathHash: string;
  toolName: string;
  operation: 'read' | 'search' | 'list' | 'write' | 'delete' | 'mcp' | 'bash' | 'unknown';
  action: 'allow' | 'deny' | 'audit';
  reason: string;
  commandFamily?: string;
  matchedPath?: string;
  normalizedMatchedPath?: string;
  matchedRuleId?: string;
  matchedRuleSource?: 'builtin-default' | 'organization-policy' | 'user-allowed-root';
  extractedPathCount: number;
  allowedRootCount: number;
  deniedRuleCount: number;
}
```

### 18.3 Audit Safety Rules

1. Do not store file contents.
2. Do not store command output.
3. Do not store raw secrets.
4. Command text may be stored only after secret redaction.
5. If command redaction fails, store command family and matched path only.
6. Hash workspace path with HMAC or SHA-256 before storing when possible.

---

## 19. Webview Messaging

Add messages.

### 19.1 Webview -> Extension

```ts
type WorkspaceAccessGuardWebviewToExtension =
  | { type: 'workspaceAccessGuardGetStatus' }
  | { type: 'workspaceAccessGuardSetEnabled'; enabled: boolean }
  | { type: 'workspaceAccessGuardSetMode'; mode: 'block' | 'audit' }
  | { type: 'workspaceAccessGuardGetAllowedRoots' }
  | { type: 'workspaceAccessGuardAddAllowedRoots'; roots: string[] }
  | { type: 'workspaceAccessGuardRemoveAllowedRoot'; root: string }
  | { type: 'workspaceAccessGuardAddCurrentWorkspace' }
  | { type: 'workspaceAccessGuardGetOrgPolicyStatus' }
  | { type: 'workspaceAccessGuardGetAuditEvents'; limit?: number }
  | { type: 'workspaceAccessGuardTestPath'; value: string }
  | { type: 'workspaceAccessGuardTestCommand'; command: string; cwd?: string };
```

### 19.2 Extension -> Webview

```ts
type WorkspaceAccessGuardExtensionToWebview =
  | { type: 'workspaceAccessGuardStatus'; status: WorkspaceAccessGuardStatus }
  | { type: 'workspaceAccessGuardAllowedRoots'; roots: WorkspaceAccessAllowedRootView[] }
  | { type: 'workspaceAccessGuardOrgPolicyStatus'; status: WorkspaceAccessOrgPolicyStatus }
  | { type: 'workspaceAccessGuardAuditEvents'; events: WorkspaceAccessAuditEvent[] }
  | { type: 'workspaceAccessGuardLastEvent'; event: WorkspaceAccessAuditEvent }
  | { type: 'workspaceAccessGuardTestResult'; result: WorkspaceAccessDecision }
  | { type: 'workspaceAccessGuardError'; error: string };
```

### 19.3 Zustand State

Add:

```ts
workspaceAccessGuardEnabled: boolean;
workspaceAccessGuardMode: 'block' | 'audit';
workspaceAccessGuardStatus: WorkspaceAccessGuardStatus;
workspaceAccessGuardAllowedRoots: WorkspaceAccessAllowedRootView[];
workspaceAccessGuardOrgPolicyStatus?: WorkspaceAccessOrgPolicyStatus;
workspaceAccessGuardAuditEvents: WorkspaceAccessAuditEvent[];
workspaceAccessGuardLastEvent?: WorkspaceAccessAuditEvent;
workspaceAccessGuardError?: string;
```

Status type:

```ts
export type WorkspaceAccessGuardStatus =
  | 'disabled'
  | 'enabled-hooks-installed'
  | 'enabled-hooks-missing'
  | 'enabled-partial-coverage'
  | 'enabled-org-policy-invalid'
  | 'enabled-using-built-in-policy'
  | 'error';
```

---

## 20. Environment Variables

Pass these to agent and hook runtimes:

```text
CLAUI_WORKSPACE_ACCESS_GUARD=1
CLAUI_WORKSPACE_ACCESS_GUARD_MODE=block
CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR=<globalStoragePath>/workspace-access-guard
CLAUI_WORKSPACE_ACCESS_GUARD_USER_ROOTS_PATH=<...>/user-allowed-roots.json
CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH=C:\ProgramData\ClaUi\workspace-access-guard.policy.json
CLAUI_WORKSPACE_ACCESS_GUARD_AUDIT_DIR=<...>/audit
CLAUI_WORKSPACE_ACCESS_GUARD_SESSION_ID=<sessionId>
CLAUI_WORKSPACE_ACCESS_GUARD_TURN_ID=<turnId>
CLAUI_WORKSPACE_ACCESS_GUARD_PROVIDER=claude|codex
CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH=<workspacePath>
```

Runtime must also receive enough env data to expand common path variables:

```text
USERPROFILE
APPDATA
LOCALAPPDATA
HOMEDRIVE
HOMEPATH
HOME
TEMP
TMP
```

---

## 21. Hook Installation Status

The UI should report coverage separately for Claude and Codex.

Example:

```ts
export interface WorkspaceAccessGuardProviderHookStatus {
  provider: 'claude' | 'codex';
  bash: boolean;
  fileTools: boolean;
  mcp: boolean;
  stop?: boolean;
  orderBeforeSpa: boolean;
  orderBeforeParticleAccelerator: boolean;
}
```

Display examples:

```text
Enabled — protecting Claude and Codex
Enabled — Claude protected, Codex hooks missing
Enabled — partial coverage: Bash protected, MCP not protected
Disabled
```

---

## 22. Examples

### 22.1 Original Incident Scenario

User allowed roots:

```text
C:\projects
C:\Users\yoni.bar\Documents\Workspaces
```

Organization denied roots include:

```text
%LOCALAPPDATA%\Microsoft\Credentials\**
%APPDATA%\Microsoft\Credentials\**
%USERPROFILE%\.ssh\**
```

Agent command:

```bash
grep -r "..." /c/Users/yoni.bar
```

Normalized target:

```text
C:\Users\yoni.bar
```

Decision:

```text
DENY
```

Reason:

```text
Target path is outside allowed working folders and is a whole-user-profile recursive search.
```

### 22.2 Allowed Project Search

Allowed root:

```text
C:\projects
```

Command:

```bash
rg "TODO" C:\projects\my-app
```

Decision:

```text
ALLOW
```

### 22.3 Deny Wins Over Allow

Allowed root:

```text
C:\Users\yoni.bar\Documents
```

Denied root:

```text
C:\Users\*\Documents\Secrets\**
```

Command:

```bash
cat C:\Users\yoni.bar\Documents\Secrets\customer.txt
```

Decision:

```text
DENY
```

### 22.4 Current Working Directory Target

Allowed root:

```text
C:\projects
```

Command:

```bash
npm test
```

CWD:

```text
C:\projects\my-app
```

Decision:

```text
ALLOW
```

Same command with CWD:

```text
C:\Users\yoni.bar
```

Decision:

```text
DENY
```

---

## 23. Security Hardening Requirements

1. Policy file parsing must be fail-safe.
2. Invalid organization policy must not disable built-in denied roots.
3. User cannot remove organization-denied paths through the UI.
4. Denied roots must be applied after env expansion and realpath resolution.
5. Symlink/junction bypasses must be blocked.
6. `/c/...`, `C:\...`, `C:/...`, and `/mnt/c/...` must be treated equivalently.
7. Comparison must be case-insensitive on Windows.
8. Recursive search commands over broad roots must be blocked even if the command uses Git Bash paths.
9. Hook order must put Workspace Access Guard before SPA and Particle Accelerator.
10. Audit must not store file contents, command output, or raw secrets.
11. In block mode, fail closed for file-access commands that cannot be parsed safely.
12. In audit mode, allow but log uncertain cases.

---

## 24. Performance Requirements

```text
PreToolUse path extraction and policy check: normally < 100 ms
Hard timeout per hook: 3 seconds
Max command length to parse: 256 KB
Max MCP argument JSON size to inspect: 2 MB
Max audit file retention: configurable, default 90 days
```

If timeout occurs:

```text
Read/search/write command in block mode -> DENY
No-file-access command -> ALLOW
Audit mode -> AUDIT and ALLOW
```

---

## 25. Acceptance Criteria

### 25.1 UI Allowed Folder Management

```text
Given Workspace Access Guard is enabled
When the user opens Tools -> Workspace Access Guard
Then the user can add C:\projects as an allowed working folder
And nested paths under C:\projects are allowed
And the user can remove the folder
And the UI shows a warning for broad roots such as C:\Users\<user>\Documents
```

### 25.2 Organization Policy Loading

```text
Given C:\ProgramData\ClaUi\workspace-access-guard.policy.json exists
When the extension starts
Then it loads the organization denied roots
And the UI shows the policy file path and rule count
And standard users cannot edit the policy through the UI
```

### 25.3 Built-In Defaults

```text
Given no organization policy file exists
When Workspace Access Guard is enabled
Then built-in Windows denied roots are active
And the UI shows "Built-in defaults active"
```

### 25.4 Original grep Scenario

```text
Given allowed roots contain C:\projects only
When Claude or Codex tries to run:
grep -r "..." /c/Users/yoni.bar
Then Workspace Access Guard denies the Bash command before execution
And no filesystem scan occurs
And an audit event is written without command output or file contents
```

### 25.5 Denied Folder Inside Allowed Root

```text
Given C:\Users\yoni.bar\Documents is allowed
And C:\Users\*\Documents\Secrets\** is denied by organization policy
When the agent tries to read C:\Users\yoni.bar\Documents\Secrets\file.txt
Then the action is denied
```

### 25.6 Direct File Tool Blocking

```text
Given C:\projects is allowed
When Claude uses Read on C:\Users\yoni.bar\.ssh\id_rsa
Then the Read tool is denied before execution
```

### 25.7 Edit/Write Outside Allowed Roots

```text
Given C:\projects is allowed
When the agent tries to Write C:\Users\yoni.bar\Desktop\note.txt
Then the write is denied before execution
```

### 25.8 Symlink Bypass

```text
Given C:\projects is allowed
And C:\projects\link points to C:\Users\yoni.bar\.ssh
When the agent tries to read C:\projects\link\id_rsa
Then the action is denied after realpath resolution
```

### 25.9 Audit Mode

```text
Given Workspace Access Guard mode is audit
When the agent runs a blocked command
Then the command is allowed
And an audit event records that it would have been denied in block mode
```

### 25.10 Hook Ordering

```text
Given Workspace Access Guard, SPA, and Particle Accelerator are enabled
When hooks are installed
Then Workspace Access Guard hook entries appear before SPA and PA hook entries
```

---

## 26. Tests

Add test files:

```text
tests/workspace-access-guard/PathNormalizer.test.ts
tests/workspace-access-guard/PathPolicyEngine.test.ts
tests/workspace-access-guard/CommandPathExtractor.test.ts
tests/workspace-access-guard/ToolPathExtractor.test.ts
tests/workspace-access-guard/OrgPolicyLoader.test.ts
tests/workspace-access-guard/UserAllowedRootsStore.test.ts
tests/workspace-access-guard/AuditWriter.test.ts
tests/workspace-access-guard/hooks/claudeWorkspaceAccessGuard.test.ts
tests/workspace-access-guard/hooks/codexWorkspaceAccessGuard.test.ts
tests/workspace-access-guard/security/symlinkBypass.test.ts
tests/workspace-access-guard/security/windowsPathEquivalence.test.ts
tests/workspace-access-guard/security/noRawContentAudit.test.ts
```

Minimum cases:

```text
- /c/Users/yoni.bar normalizes to C:\Users\yoni.bar
- /mnt/c/Users/yoni.bar normalizes to C:\Users\yoni.bar
- %USERPROFILE%\.ssh expands and is denied
- $USERPROFILE/.ssh expands and is denied
- C:\projects\my-app is allowed when C:\projects is allowed
- C:\projects2 is not accidentally allowed by C:\projects prefix
- C:\projects\link -> C:\Users\yoni.bar\.ssh is denied
- grep -r ... /c/Users/yoni.bar is denied
- rg ... C:\projects\my-app is allowed
- npm test in allowed cwd is allowed
- npm test in user profile cwd is denied
- Read tool targeting denied folder is denied
- Write tool outside allowed roots is denied
- Deny policy wins over allowed root
- Invalid organization policy falls back to built-in defaults
- Audit event does not include file contents or command output
```

---

## 27. Implementation Checklist

1. Add settings schema to `package.json`.
2. Add extension module under `src/extension/workspace-access-guard/`.
3. Add runtime module under `src/workspace-access-guard-runtime/`.
4. Add policy loader with built-in defaults.
5. Add user allowed roots store with atomic writes.
6. Add Windows-safe path normalizer.
7. Add command path extractor.
8. Add direct tool path extractor.
9. Add policy engine.
10. Add audit writer and audit reader.
11. Add hook manager and markers.
12. Ensure Workspace Access Guard hooks are installed before SPA and PA hooks.
13. Add env builder and inject runtime env vars into Claude/Codex processes.
14. Add Tools tab UI panel.
15. Add webview messages and Zustand state.
16. Add test path/command UI utility.
17. Add tests and security regression tests.
18. Update technical docs.
19. Validate local deployment with `npm run deploy:local`.
20. Verify installed extension bundle contains new hook/runtime files.

---

## 28. Developer Notes

The main implementation risk is relying on string-prefix checks. Do not do that.

Bad:

```ts
if (target.startsWith(allowedRoot)) allow();
```

This incorrectly allows:

```text
Allowed: C:\projects
Target:  C:\projects2\secret.txt
```

Correct behavior must use normalized path segment-aware containment.

Example:

```ts
function isPathInsideRoot(target: string, root: string): boolean {
  const relative = path.win32.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
}
```

Also do not match denied roots before resolving env variables and real paths. The following must be denied:

```bash
cat /c/projects/link-to-ssh/id_rsa
```

if the real target is:

```text
C:\Users\yoni.bar\.ssh\id_rsa
```

---

## 29. Recommended First Version Scope

Version 1 should implement:

1. UI allowed roots management.
2. Machine-wide organization policy file in `C:\ProgramData\ClaUi`.
3. Built-in Windows denied roots.
4. Bash command preflight for common read/search/write commands.
5. Direct file tool path checks.
6. Basic MCP argument path checks.
7. Windows/Git Bash path normalization.
8. Symlink/junction resolution.
9. Audit logging.
10. Hook installation and status reporting.

Defer to version 2:

1. OS-level sandboxing.
2. Full shell AST parsing for every possible shell construct.
3. Deep runtime monitoring of child process filesystem access.
4. Central policy download from a server.
5. Per-team policy profiles.

---

## 30. Final Expected Behavior

With Workspace Access Guard enabled, these should be blocked:

```bash
grep -r "..." /c/Users/yoni.bar
rg "token" %USERPROFILE%
find C:\Users\yoni.bar -type f
cat ~/.ssh/id_rsa
type %APPDATA%\Microsoft\Credentials\somefile
```

These should be allowed when `C:\projects` is an allowed working folder:

```bash
rg "TODO" C:\projects\my-app
npm test
cat C:\projects\my-app\README.md
```

The feature should make the safe path the easy path:

```text
Agents work inside approved project folders.
Agents cannot scan the entire user profile.
Agents cannot touch organization-protected folders.
Security can update protected folders centrally.
Users can manage their own allowed project roots without editing JSON.
```
