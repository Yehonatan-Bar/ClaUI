# Git Push Button

One-click git add/commit/push from the webview UI, driven by VS Code configuration.

## What It Does

A "Git" button in the InputArea executes `scripts/git-push.ps1` which:
1. Stages all changes (`git add -A`)
2. Commits with the session tab name as the commit message
3. Pushes to the remote

## Key Files

| File | Role |
|------|------|
| `src/webview/App.tsx` | Git button and gear toggle in the StatusBar component |
| `src/webview/components/InputArea/InputArea.tsx` | Git push toast notification, config panel rendering, settings request on mount |
| `src/webview/components/InputArea/GitPushPanel.tsx` | Configuration panel component |
| `src/extension/webview/MessageHandler.ts` | `handleGitPush()` executes the script, `sendGitPushSettings()` syncs config |
| `src/extension/session/SessionTab.ts` | Wires `setSessionNameGetter` so MessageHandler can access the tab name |
| `src/webview/state/store.ts` | `gitPushSettings`, `gitPushResult`, `gitPushConfigPanelOpen`, `gitPushRunning` |
| `src/extension/types/webview-messages.ts` | `GitPushRequest`, `GitPushConfigRequest`, `GetGitPushSettingsRequest`, `GitPushResultMessage`, `GitPushSettingsMessage` |
| `scripts/git-push.ps1` | PowerShell script that performs the actual git operations |
| `package.json` | `claudeMirror.gitPush.*` settings schema |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.gitPush.enabled` | `false` | Whether the feature is ready to use |
| `claudeMirror.gitPush.scriptPath` | `"scripts/git-push.ps1"` | Script path relative to workspace root |
| `claudeMirror.gitPush.commitMessageTemplate` | `"{sessionName}"` | Commit message template; `{sessionName}` is replaced with the tab name |

## UI Components

### Git Button
- Location: Bottom status bar, next to History and Plans buttons
- When configured (`enabled=true`): clicking executes the push script
- When not configured: clicking opens the config panel
- Shows "..." while the push is running

### Gear Toggle
- Small `*` button joined to the right of the Git button in the status bar
- Always available - opens/closes the config panel regardless of config state

### Config Panel
- Shows above the input area when open
- Displays status indicator (green dot = configured, orange = not configured)
- When configured: shows current script path and commit message template
- Text input for asking Claude to set up or modify the configuration
- "Ask Claude" button sends the instruction as a message to the active Claude session

### Toast Notification
- Appears above the input area after a push completes
- Green for success, red for error (shows error message)
- Auto-dismisses after 5 seconds
- Dismiss button for manual close

## Data Flow

### Push Execution
```
Click "Git" button
  -> postToExtension({ type: 'gitPush' })
  -> MessageHandler.handleGitPush()
  -> Reads claudeMirror.gitPush.* config
  -> Resolves script path relative to workspace root
  -> child_process.execFile('powershell', ['-File', script, '-Message', commitMsg])
  -> On completion: postMessage({ type: 'gitPushResult', success, output })
  -> Store updates -> Toast renders (auto-dismiss 5s)
```

### Configuration Request
```
Type instruction in panel -> click "Ask Claude"
  -> postToExtension({ type: 'gitPushConfig', instruction })
  -> MessageHandler sends prefixed prompt to Claude CLI
  -> Claude modifies VS Code settings
  -> onDidChangeConfiguration fires
  -> sendGitPushSettings() updates webview
```

### Settings Sync
- On webview ready: `getGitPushSettings` request -> `sendGitPushSettings()` response
- On config change: `watchConfigChanges` detects `claudeMirror.gitPush` change -> auto-sends to webview

## Script Details

`scripts/git-push.ps1` accepts a `-Message` parameter:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/git-push.ps1 -Message "commit message"
```

The script checks for changes, stages all, commits with the message, and pushes. Exits cleanly if there are no changes. 30-second timeout in the extension prevents hanging.
