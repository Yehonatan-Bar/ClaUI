# Happy Provider (`remote`) Sessions

## What Is Happy Coder?

Happy Coder is an **external CLI tool** (not built in this repo) that acts as a **remote AI coding relay**. It wraps the Claude Code CLI and routes AI sessions through a relay server, enabling **cross-device access** -- including continuing a local coding session on a mobile device and returning back to the local session afterwards.

The core use case: a developer starts a Claude Code session locally in VS Code, then picks up that same session on their phone (e.g. while away from the desk), and later returns to the local machine where the session continues seamlessly. The relay server and mobile interface are part of the Happy Coder ecosystem, not part of ClaUi.

## ClaUi Integration Approach

The provider id is still `remote`, but the ClaUi integration is intentionally simple:

- No custom WebSocket client
- No custom crypto/auth module
- No custom demux/message handler/session tab stack
- Reuse the existing Claude session pipeline end-to-end

Happy CLI is treated as a Claude-compatible executable. ClaUi just swaps the spawned command from `claude` to `happy`. All remote/mobile/cross-device capabilities are handled transparently by the Happy CLI and its relay server -- ClaUi only sees the same JSON stream it gets from the regular Claude CLI.

---

## Runtime Architecture

1. User selects provider `remote` in the UI (label shown as **Happy**).
2. `TabManager.createRemoteTab()` creates a normal `SessionTab`.
3. `TabManager` reads `claudeMirror.happy.cliPath` (default `happy`) and calls `tab.setCliPathOverride(...)`.
4. `SessionTab.startSession()` passes the override to `ClaudeProcessManager.start(...)`.
5. `MessageHandler` also reads the per-tab override from `WebviewBridge.getCliPathOverride()` for webview-driven starts/restarts (`startSession`, `clearSession`, `resumeSession`, `forkSession`, edit-and-resend resume).
6. Before starting a new session, `MessageHandler.syncProviderOverrideForNewSession()` checks whether the provider dropdown setting differs from the tab's current provider and updates the CLI path override accordingly. This allows seamless Claude <-> Happy switching within the same tab.
7. `ClaudeProcessManager` spawns the overridden CLI path with the same stream-json flags used for Claude.
8. Happy CLI emits the session ID as a raw `[DEV] Session: <id>` line (not a JSON `system/init` event like Claude). `ClaudeProcessManager.handleStdoutChunk()` detects this pattern, captures the session ID, and synthesizes a `system/init` event so the entire downstream pipeline (`StreamDemux`, `SessionTab`, `SessionStore`) works identically to Claude sessions.
9. Standard `StreamDemux`, `MessageHandler`, control protocol, analytics, forking, and history all work unchanged.

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

## Auto-fallback when Happy CLI is not installed

If a remote tab tries to spawn `happy` and the executable is missing from PATH (detected via stderr "is not recognized" / "command not found" or ENOENT on the spawn `error` event), `SessionTab.fallbackFromHappyToClaude(reason)` runs:

1. Clears `cliPathOverride` on the tab so subsequent spawns use the regular `claude` CLI
2. Fires the `onProviderChanged(tabId, 'claude', null)` callback so `TabManager.handleProviderChanged` rewrites the persisted snapshot entry to `provider: 'claude'` (the tab does not re-spawn as remote on the next workspace load)
3. Surfaces a non-modal information toast: *"Happy Coder CLI not found. Switched to Claude Code for this session. Install Happy Coder to use it."* with a `Configure Happy CLI Path` button that opens the relevant setting
4. Calls `startSession()` to spin up a fresh Claude session in the same tab — no resume, since the prior Happy session id is not Claude-compatible

The fallback path runs from both the process `exit` handler and the `error` handler, so synchronous ENOENT and async stderr-driven detection both lead to the same recovery. The Claude-missing path is unchanged: there is no fallback target, so install guidance is shown.

---

## Cross-Device Session Resume

Happy Coder enables continuing a local session on mobile and returning back. ClaUi supports this via the standard session resume flow:

1. **Via History** (Ctrl+Shift+H): Happy sessions are stored in `SessionStore` with `provider: 'remote'`. Picking one creates a Happy tab and runs `happy --resume <id>`.
2. **Via Command Palette** (`ClaUi: Resume Session`): Enter the session ID. If the session was previously opened in ClaUi, the stored provider is used.
3. **Auto-resume on cancel**: When the user cancels a Happy session, the exit handler detects `cancelledByUser` and auto-resumes with `happy --resume <id>`.

**Session ID capture**: Happy CLI does not emit a JSON `system/init` event. Instead, it outputs `[DEV] Session: <id>` as a raw text line. `ClaudeProcessManager` parses this and synthesizes a `system/init` event so sessions are tracked in `SessionStore` and appear in History.

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
  - Parses Happy `[DEV] Session:` raw line and synthesizes `system/init` event
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
