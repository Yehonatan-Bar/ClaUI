# Happy Provider (`remote`) Sessions

## What This Is

The provider id is still `remote`, but the implementation is now intentionally simple:

- No custom WebSocket client
- No custom crypto/auth module
- No custom demux/message handler/session tab stack
- Reuse the existing Claude session pipeline end-to-end

Happy CLI is treated as a Claude-compatible executable. ClaUi just swaps the spawned command from `claude` to `happy`.

---

## Runtime Architecture

1. User selects provider `remote` in the UI (label shown as **Happy**).
2. `TabManager.createRemoteTab()` creates a normal `SessionTab`.
3. `TabManager` reads `claudeMirror.happy.cliPath` (default `happy`) and calls `tab.setCliPathOverride(...)`.
4. `SessionTab.startSession()` passes the override to `ClaudeProcessManager.start(...)`.
5. `MessageHandler` also reads the per-tab override from `WebviewBridge.getCliPathOverride()` for webview-driven starts/restarts (`startSession`, `clearSession`, `resumeSession`, `forkSession`, edit-and-resend resume).
6. Before starting a new session, `MessageHandler.syncProviderOverrideForNewSession()` checks whether the provider dropdown setting differs from the tab's current provider and updates the CLI path override accordingly. This allows seamless Claude <-> Happy switching within the same tab.
7. `ClaudeProcessManager` spawns the overridden CLI path with the same stream-json flags used for Claude.
7. Standard `StreamDemux`, `MessageHandler`, control protocol, analytics, forking, and history all work unchanged.

---

## Auth Flow

Happy authentication is done through a terminal command, not through extension-managed crypto:

- Command: `ClaUi: Authenticate Happy Coder`
- Implementation: runs `<happyCliPath> auth` in a VS Code terminal
- Reason: QR code/device auth is rendered correctly in a real terminal

When a Happy session exits with auth-related stderr (`auth required`, `not authenticated`, `please authenticate`, `qr code`, `token expired`), `SessionTab` shows:

`Happy Coder requires authentication. Run "ClaUi: Authenticate Happy Coder" from the Command Palette.`

Non-fatal stderr notices such as `Using Claude Code vX.Y.Z from npm` are intentionally ignored for UI error banners (they still appear in logs).

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.happy.cliPath` | `"happy"` | Path to the Happy Coder CLI executable |

Removed settings:

- `claudeMirror.remote.serverUrl`
- `claudeMirror.remote.autoReconnect`
- `claudeMirror.remote.keepAliveIntervalMs`

---

## Integration Points

- `src/extension/process/ClaudeProcessManager.ts`
  - Adds `ProcessStartOptions.cliPathOverride?: string`
  - Spawns `options?.cliPathOverride || claudeMirror.cliPath`
- `src/extension/session/SessionTab.ts`
  - Adds `setCliPathOverride(path)`
  - Exposes `getCliPathOverride()` and `getProvider()` via `WebviewBridge`
  - Threads override through all start/restart paths
  - Stamps `sessionStarted` and persisted metadata with the active provider (`claude` or `remote`)
  - Adds Happy auth detection + missing CLI detection for both `claude` and `happy`
- `src/extension/webview/MessageHandler.ts`
  - Uses `WebviewBridge.getCliPathOverride()` for webview-triggered process starts/restarts
  - Uses `WebviewBridge.getProvider()` so provider in `sessionStarted` reflects the actual tab runtime
  - `syncProviderOverrideForNewSession()` syncs CLI path override with provider dropdown before `startSession` / `clearSession`, enabling in-tab Claude <-> Happy switching
  - `WebviewBridge.setCliPathOverride()` allows updating the tab's CLI override at runtime
- `src/extension/session/TabManager.ts`
  - `createRemoteTab()` now returns `SessionTab` (not a custom tab type)
  - Applies `happy.cliPath` override
- `src/extension/commands.ts`
  - Registers `claudeMirror.authenticateHappy`
  - Provider display label changed from `Remote` to `Happy`
- `src/webview/components/ProviderSelector/ProviderSelector.tsx`
  - UI label changed from `Remote` to `Happy` (value remains `remote`)
- `package.json`
  - Adds `claudeMirror.happy.cliPath`
  - Adds `claudeMirror.authenticateHappy` command
  - Removes remote relay settings and old relay dependencies

---

## Removed Legacy Files

- `src/extension/remote/HappyTypes.ts`
- `src/extension/remote/HappyCrypto.ts`
- `src/extension/remote/HappyClient.ts`
- `src/extension/remote/RemoteDemux.ts`
- `src/extension/webview/RemoteMessageHandler.ts`
- `src/extension/session/RemoteSessionTab.ts`

---

## Dependencies

Removed:

- `socket.io-client`
- `tweetnacl`
