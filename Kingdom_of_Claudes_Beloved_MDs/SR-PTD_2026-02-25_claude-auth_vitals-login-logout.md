# SR-PTD - Claude Auth Login/Logout in VitalsInfoPanel

**Date**: 2026-02-25 | **Type**: Feature | **Domain**: ClaUi Extension / Auth / UI | **Complexity**: Medium

## Trigger
> User requested adding Claude CLI Login/Logout controls to the Session Vitals gear dropdown (`VitalsInfoPanel`) so the extension can mirror `claude auth login` / `claude auth logout` and show current auth status.

## Workflow (numbered steps)
1. Extended `AuthManager` with Claude CLI auth helpers: `getAuthStatus(cliPath)` and `logout(cliPath)` using `execFile` with 10s timeout.
2. Added new webview message types in `src/extension/types/webview-messages.ts` for auth login/logout/status requests and the auth status response payload.
3. Added Claude auth state slice to Zustand store (`claudeAuthLoggedIn`, `claudeAuthEmail`, `claudeAuthSubscriptionType`) plus `setClaudeAuthStatus(...)` and reset handling.
4. Updated `useClaudeStream.ts` to handle `claudeAuthStatus` messages and update the store.
5. Added Claude auth handling in `MessageHandler.ts`:
   - terminal-based login (`Claude Login`)
   - background logout
   - explicit status refresh
   - initial status push on webview `ready`
6. Wired `AuthManager` into `SessionTab.ts` via `messageHandler.setAuthManager(new AuthManager())`.
7. Added `Claude Account` row to `VitalsInfoPanel.tsx` (Login/Logout/Refresh + status display) above the API Key row.
8. Ran `npm run deploy:local` and `npm run verify:installed` successfully.
9. Updated `TECHNICAL.md`, `SESSION_VITALS.md`, `API_KEY_MANAGEMENT.md`, and added a dedicated detail doc for the feature.

## Key Decisions
- **Login via VS Code terminal** -> interactive CLI/browser flow is not reliable to detect programmatically -> manual Refresh button keeps implementation simple and robust.
- **Logout via extension host (`execFile`)** -> non-interactive command -> silent background execution gives better UX than opening another terminal.
- **Status via `claude auth status --json`** -> structured CLI output -> normalized into a stable UI payload (`loggedIn`, `email`, `subscriptionType`).
- **Separate from API key UI** -> subscription login and explicit API key auth are different mechanisms -> keep both visible as independent rows in Vitals settings.

## Knowledge Used
- **Code patterns**: existing webview message union pattern, `MessageHandler` switch-based request dispatch, Zustand state slice conventions, VitalsInfoPanel button styling (`vitals-info-close`)
- **Architecture**: webview <-> extension `postMessage` contract, `SessionTab` dependency injection into `MessageHandler`
- **Runtime constraints**: interactive CLI login must run in a user-visible terminal; no reliable completion callback for browser-based auth flow

## Code Written (if reusable)

### Normalized auth status contract
```typescript
{ loggedIn: boolean; email: string; subscriptionType: string }
```

### Terminal login command pattern
```typescript
const terminal = vscode.window.createTerminal({ name: 'Claude Login' });
terminal.show();
terminal.sendText(`${quoteTerminalArg(cliPath)} auth login`, true);
```

## Output Format (if templatable)

### Extension -> Webview auth status message
```typescript
{
  type: 'claudeAuthStatus',
  loggedIn: boolean,
  email: string,
  subscriptionType: string
}
```

## Issues -> Fixes
- **Potential CLI JSON shape variability** -> `AuthManager.parseAuthStatus()` accepts multiple field names (`loggedIn`, `authenticated`, `status`, nested `account/user.email`, snake_case variants) and falls back safely.
- **Interactive login completion cannot be detected** -> added explicit Refresh button in the UI and initial `ready` status sync.

## Files Modified
| File | Change |
|------|--------|
| `src/extension/auth/AuthManager.ts` | Added `AuthStatus`, `getAuthStatus()`, `logout()`, JSON normalization helpers |
| `src/extension/types/webview-messages.ts` | Added 3 auth request types + 1 auth status response type + union entries |
| `src/extension/webview/MessageHandler.ts` | Added auth manager wiring API, auth handlers, ready-time auth status push |
| `src/extension/session/SessionTab.ts` | Injected `AuthManager` into `MessageHandler` |
| `src/webview/state/store.ts` | Added Claude auth state + setter + reset values |
| `src/webview/hooks/useClaudeStream.ts` | Added `claudeAuthStatus` handler |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Added Claude Account row UI |
| `TECHNICAL.md` | Updated directory tree, component index, Session Vitals summary, docs list |
| `Kingdom_of_Claudes_Beloved_MDs/SESSION_VITALS.md` | Documented Claude Account row + state/message flow |
| `Kingdom_of_Claudes_Beloved_MDs/API_KEY_MANAGEMENT.md` | Clarified separation from Claude Account auth |

## Files Created
| File | Purpose |
|------|---------|
| `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_AUTH_LOGIN_LOGOUT.md` | Detailed feature documentation |

## Skill Potential: Medium
**Notes**: Reusable pattern for terminal-based interactive auth commands paired with background status polling and webview state synchronization.

## Tags
**Languages**: TypeScript | **Domain**: VS Code Extension, Webview UI, CLI Auth | **Services**: Claude CLI, VS Code Terminal
