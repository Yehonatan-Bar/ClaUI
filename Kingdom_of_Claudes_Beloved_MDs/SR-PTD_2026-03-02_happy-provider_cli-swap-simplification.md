# SR-PTD - Happy Provider CLI-Swap Simplification

**Date**: 2026-03-02 | **Type**: Refactor | **Domain**: ClaUi Extension / Provider Routing / Process Management | **Complexity**: Medium

## Trigger
> Replace the overengineered Happy remote stack (Socket.IO + crypto + custom demux/tab) with a simple approach: reuse the existing Claude session pipeline and spawn `happy` CLI via per-tab override.

## Workflow (numbered steps)
1. Added `cliPathOverride?: string` to `ProcessStartOptions` in `ClaudeProcessManager`.
2. Updated `ClaudeProcessManager.start()` to use `options?.cliPathOverride || claudeMirror.cliPath`.
3. Extended `SessionTab` with:
   - `cliPathOverride` field
   - `setCliPathOverride(path)` setter
   - override propagation to all process start/restart paths (`startSession`, switch-model resume, cancel auto-resume, fork phase-2, crash restart)
4. Added Happy auth-required detection in `SessionTab` stderr/error handling and exit-time user guidance.
5. Expanded CLI-missing detection patterns to include both `claude` and `happy`.
6. Simplified `TabManager.createRemoteTab()`:
   - removed `RemoteSessionTab` usage
   - now creates regular `SessionTab`
   - reads `claudeMirror.happy.cliPath` and applies `tab.setCliPathOverride(...)`
7. Updated provider display labels from `Remote` to `Happy` in:
   - `commands.ts` (start/resume/history labels)
   - `ProviderSelector.tsx`
8. Added new command `claudeMirror.authenticateHappy`:
   - opens terminal
   - runs `<happyCliPath> auth`
9. Updated `package.json` manifest:
   - removed `claudeMirror.remote.*` settings
   - added `claudeMirror.happy.cliPath`
   - added `claudeMirror.authenticateHappy`
   - removed dependencies `socket.io-client`, `tweetnacl`
10. Removed obsolete files:
    - `src/extension/remote/HappyTypes.ts`
    - `src/extension/remote/HappyCrypto.ts`
    - `src/extension/remote/HappyClient.ts`
    - `src/extension/remote/RemoteDemux.ts`
    - `src/extension/webview/RemoteMessageHandler.ts`
    - `src/extension/session/RemoteSessionTab.ts`
11. Updated docs: `TECHNICAL.md`, `REMOTE_SESSIONS.md` (rewritten to CLI-swap architecture).

## Key Decisions
- **Keep provider id as `remote`** -> avoids migration work for persisted sessions/settings data that already use this id.
- **Reuse existing SessionTab/ClaudeProcessManager pipeline** -> lowest-risk architecture; already battle-tested for stream-json handling, controls, analytics, and restart flows.
- **Authenticate via terminal command** -> Happy auth is interactive (QR/device flow); terminal UX is the most reliable path.
- **Detect auth-required via stderr patterns** -> gives targeted remediation message instead of generic process crash.

## Knowledge Used
- Existing provider-routing pattern in `TabManager`.
- Existing process lifecycle wiring and restart paths in `SessionTab`.
- VS Code command registration and terminal APIs in `commands.ts`.
- Extension manifest contributions and settings conventions in `package.json`.

## Files Modified
| File | Change |
|------|--------|
| `src/extension/process/ClaudeProcessManager.ts` | Added `cliPathOverride` support in process start options and spawn path resolution |
| `src/extension/session/SessionTab.ts` | Added CLI override plumbing, Happy auth detection, expanded missing-CLI detection |
| `src/extension/session/TabManager.ts` | Removed `RemoteSessionTab` dependency; route remote provider through `SessionTab` + `happy.cliPath` |
| `src/extension/commands.ts` | Added `claudeMirror.authenticateHappy`; updated provider label text |
| `src/webview/components/ProviderSelector/ProviderSelector.tsx` | Renamed provider label to Happy |
| `package.json` | Removed old remote settings/deps; added Happy CLI setting + auth command |
| `webpack.config.js` | Removed no-longer-needed `IgnorePlugin` entries and `webpack` import |
| `TECHNICAL.md` | Updated component index, directory tree, settings table, dependencies table |
| `Kingdom_of_Claudes_Beloved_MDs/REMOTE_SESSIONS.md` | Rewrote documentation to reflect CLI-swap implementation |

## Files Deleted
| File | Reason |
|------|--------|
| `src/extension/remote/HappyTypes.ts` | Obsolete custom protocol stack |
| `src/extension/remote/HappyCrypto.ts` | Obsolete custom auth/crypto |
| `src/extension/remote/HappyClient.ts` | Obsolete custom Socket.IO client |
| `src/extension/remote/RemoteDemux.ts` | Obsolete custom event translation |
| `src/extension/webview/RemoteMessageHandler.ts` | Obsolete custom webview bridge |
| `src/extension/session/RemoteSessionTab.ts` | Obsolete dedicated remote tab type |

## Skill Potential: Medium
Reusable pattern: when a new provider is CLI-compatible, prefer per-tab process override over a parallel architecture.

## Tags
**Languages**: TypeScript, JSON | **Domain**: VS Code Extension, CLI integration, provider routing | **Services**: Happy CLI, Claude CLI
