# Claude Auth Login/Logout (CLI Account)

## Purpose

Adds Claude CLI account controls to the Session Vitals gear panel so users can:
- check Claude CLI login status
- launch interactive `claude auth login` in a VS Code terminal
- run `claude auth logout` silently in the extension host
- refresh status manually after completing login

This is separate from API key management (`ANTHROPIC_API_KEY` / SecretStorage).

## UI Entry Point

- **File**: `src/webview/components/Vitals/VitalsInfoPanel.tsx`
- **Row**: `Claude Account` (above the API Key row)
- **Buttons**:
  - `Login` -> posts `claudeAuthLogin`
  - `Logout` -> posts `claudeAuthLogout`
  - `↻` (Refresh) -> posts `claudeAuthStatus`
- **Display**:
  - Logged out: `Not logged in`
  - Logged in: email + subscription type (if returned by CLI)

## Message Protocol

### Webview -> Extension

- `claudeAuthLogin`
- `claudeAuthLogout`
- `claudeAuthStatus`

Defined in `src/extension/types/webview-messages.ts`.

### Extension -> Webview

- `claudeAuthStatus` with:
  - `loggedIn: boolean`
  - `email: string`
  - `subscriptionType: string`

## Extension Flow

### `MessageHandler.ts`

- `claudeAuthLogin`
  - Opens VS Code terminal named `Claude Login`
  - Runs `<cliPath> auth login`
  - No completion detection (interactive/browser flow)

- `claudeAuthLogout`
  - Calls `AuthManager.logout(cliPath)`
  - Posts error message on failure
  - Always refreshes auth status after attempt

- `claudeAuthStatus`
  - Calls `sendClaudeAuthStatus()`

- `ready`
  - Calls `sendClaudeAuthStatus()` so webview gets initial account state

### `AuthManager.ts`

- `getAuthStatus(cliPath)`
  - Runs `claude auth status --json` via `execFile`
  - 10s timeout
  - Parses JSON and normalizes fields into `{ loggedIn, email, subscriptionType }`
  - Falls back to logged-out on error/parse failure

- `logout(cliPath)`
  - Runs `claude auth logout` via `execFile`
  - 10s timeout
  - Returns boolean success/failure

## Webview State

Stored in Zustand (`src/webview/state/store.ts`):
- `claudeAuthLoggedIn`
- `claudeAuthEmail`
- `claudeAuthSubscriptionType`
- `setClaudeAuthStatus(...)`

Updated in `src/webview/hooks/useClaudeStream.ts` when receiving `claudeAuthStatus`.

## Design Notes / Gotchas

- **Manual refresh is required after login**: the login flow is interactive and terminal/browser-based, so the extension does not reliably know when it finished.
- **Separate from API key auth**: Claude subscription login status and stored Anthropic API key can both exist; they are intentionally shown as separate rows.
- **CLI path source**: uses `claudeMirror.cliPath` (falls back to `claude`).

## Key Files

| File | Responsibility |
|------|----------------|
| `src/extension/auth/AuthManager.ts` | CLI auth status/logout execution + normalization |
| `src/extension/webview/MessageHandler.ts` | Webview handlers + terminal launch + status posting |
| `src/extension/session/SessionTab.ts` | Injects `AuthManager` into `MessageHandler` |
| `src/extension/types/webview-messages.ts` | Auth request/response message types |
| `src/webview/state/store.ts` | Zustand auth state |
| `src/webview/hooks/useClaudeStream.ts` | Applies `claudeAuthStatus` updates |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Claude Account row UI |
