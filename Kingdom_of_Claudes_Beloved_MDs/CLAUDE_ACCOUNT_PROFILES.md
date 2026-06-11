# Claude Account Profiles

## Purpose

Claude account profiles let multiple Claude Code accounts run side by side in ClaUi without editing `.credentials.json` directly.

Each non-default profile gets its own Claude CLI config root and is passed to the CLI through:

```text
CLAUDE_CONFIG_DIR=<extension global storage>/claude-profiles/<profile-id>
```

The built-in `Default` profile keeps the historical behavior: no `CLAUDE_CONFIG_DIR` is set, so Claude uses its normal `~/.claude` directory.

## Storage Model

Profile metadata is stored in VS Code `globalState` because Claude accounts belong to the user, not to one workspace.

```ts
interface ClaudeAccountProfile {
  id: string;
  label: string;
  configDir: string;
  isDefault?: boolean;
  createdAt: string;
  lastUsedAt?: string;
}
```

Config directories are created under:

```text
<context.globalStorageUri>/claude-profiles/<profile-id>
```

## Entry Points

- `ClaUi: Manage Claude Accounts`
- `ClaUi: Claude Account Login`
- `ClaUi: Claude Account Logout`
- `ClaUi: New Claude Tab With Account`
- `ClaUi: Switch Claude Account (Carry Context)`

The manage command supports create, rename, delete, set current profile for new Claude tabs, login, logout, and opening a new tab with a selected account.

## Runtime Flow

- `ClaudeAccountProfileStore` owns profile CRUD and directory creation.
- `SessionTab` stores the selected profile per tab and threads it through every Claude respawn path.
- `ClaudeProcessManager` injects `CLAUDE_CONFIG_DIR` only when the tab uses a non-default profile.
- `AuthManager` runs `claude auth status --json` and `claude auth logout` with the selected profile env.
- Login opens a VS Code terminal with `CLAUDE_CONFIG_DIR` set for the selected profile.
- `OpenTabsSnapshot` stores `claudeAccountProfileId`, so restore-on-startup returns a tab to the same account.
- If a saved profile is deleted before restore, ClaUi warns and restores that tab with `Default` instead of crashing.

## Account Handoff

`ClaUi: Switch Claude Account (Carry Context)` uses the existing handoff capsule pipeline, but keeps the provider as `claude`.

The MVP opens a new Claude tab with the target account profile, starts a fresh session, and stages the handoff prompt for the first user message. It does not perform true cross-account `--resume`.

The handoff capsule includes optional source/target account profile metadata for diagnostics:

```ts
source.accountProfileId?: string;
target.accountProfileId?: string;
```

## Transcript Readers

Claude transcript lookup accepts an optional `claudeConfigDir`:

```ts
const claudeDir = claudeConfigDir || path.join(os.homedir(), '.claude');
```

This applies to conversation replay, truncation/forking, worktree transcript relocation, session discovery, end-of-session summarization, and usage fetching.

## Experimental True Resume

Setting:

```json
"claudeMirror.claudeAccounts.experimentalTrueResume": false
```

This is currently a reserved feature flag. The implemented MVP uses context handoff. Future true resume will copy the source transcript into the target profile config dir and attempt `claude --resume <sessionId>`, falling back to context handoff if the CLI rejects it.

## Security Notes

- ClaUi never edits `.credentials.json` manually.
- Tokens and credentials are never logged.
- Diagnostics may log profile ids and shortened config paths only.
- Deleting a profile removes metadata from globalState; it does not delete the profile directory automatically.
