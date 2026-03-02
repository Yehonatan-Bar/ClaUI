# Remote Sessions (Happy Coder Relay)

## What This Is

Remote Sessions add a third provider type (`'remote'`) to ClaUi, enabling users to monitor and interact with AI coding sessions running on a remote machine via a Happy Coder relay server. The existing webview React UI is provider-agnostic — all new code lives in the extension host.

Architecture mirrors the Codex provider pattern exactly: `RemoteSessionTab` replaces `CodexSessionTab`, `RemoteDemux` replaces `CodexExecDemux`, `RemoteMessageHandler` replaces `CodexMessageHandler`.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/remote/HappyTypes.ts` | Protocol types (envelopes, events, auth, connection state) |
| `src/extension/remote/HappyCrypto.ts` | Ed25519 keypair + AES-256-GCM encryption |
| `src/extension/remote/HappyClient.ts` | Socket.IO client, auth flow, reconnection |
| `src/extension/remote/RemoteDemux.ts` | Translates Happy envelopes to internal events |
| `src/extension/webview/RemoteMessageHandler.ts` | Webview bridge, maps demux events to webview messages |
| `src/extension/session/RemoteSessionTab.ts` | Third tab type, orchestrates all remote components |

---

## Auth Flow

1. User sets `claudeMirror.remote.serverUrl` in VS Code settings
2. User selects "Remote" provider — `TabManager.createRemoteTab()` is called
3. On first connect: `HappyCrypto.init()` generates or restores an ed25519 keypair from VS Code `SecretStorage` (key: `claui.remote.ed25519Seed`)
4. `HappyClient.authenticate()`:
   - `POST /v1/auth` with `{ publicKey }` — server returns a challenge
   - `HappyCrypto.signChallenge(challenge)` signs with the ed25519 private key
   - `POST /v1/auth/verify` with `{ publicKey, signature, nonce? }` — server returns JWT
5. JWT is cached in memory and passed as `auth.token` to the Socket.IO connection
6. On reconnection: re-auth automatically before re-connecting the socket

---

## Connection Lifecycle

```
startSession()
  └─ HappyCrypto.init()
  └─ HappyClient.authenticate()       POST /v1/auth, POST /v1/auth/verify
  └─ HappyClient.connect()            Socket.IO to /v1/updates
  └─ HappyClient.createSession()      POST /v1/sessions  (or joinSession for resume)
  └─ RemoteSessionTab.wireClientEvents()
       └─ client 'message' -> RemoteDemux.handleEnvelope()
       └─ client 'stateChange' -> postMessage processBusy
       └─ client 'connectionFailed' -> postMessage error
```

Reconnection uses exponential backoff (1s → 30s, max 10 attempts). A 30-second keepalive heartbeat (`session-alive` event) prevents idle disconnection.

---

## Event Pipeline

```
Happy server ─ Socket.IO ─► HappyClient (emits 'message')
                                   │
                              RemoteDemux.handleEnvelope()
                                   │
                    ┌──────────────┼──────────────┐
               turnStarted   streamingText   turnCompleted
               toolCallStart toolCallEnd    agentMessage
                    │              │              │
              RemoteMessageHandler (maps to ExtensionToWebviewMessage)
                                   │
                           webview React UI
```

---

## Happy Protocol Types

All messages are wrapped in `HappyEnvelope`:

```typescript
interface HappyEnvelope {
  id: string;           // UUID
  time: number;         // Unix ms
  role: 'assistant' | 'user' | 'system';
  turn: number;
  subagent?: string;    // Subagent ID if spawned
  ev: HappyEvent;       // Typed event payload
}
```

`HappyEvent` is a discriminated union with types: `text`, `service`, `tool-call-start`, `tool-call-end`, `file`, `turn-start`, `turn-end`, `start`, `stop`.

---

## Provider Capabilities

```typescript
const REMOTE_PROVIDER_CAPABILITIES = {
  supportsPlanApproval: false,
  supportsCompact: false,
  supportsFork: false,
  supportsImages: false,
  supportsGitPush: false,
  supportsTranslation: true,
  supportsPromptEnhancer: false,
  supportsCodexConsult: false,
  supportsPermissionModeSelector: false,
  supportsLiveTextStreaming: true,   // Happy streams text deltas
  supportsConversationDiskReplay: false,
  supportsCostUsd: true,             // turn-end events include cost_usd
};
```

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.remote.serverUrl` | `""` | Happy Coder relay server URL |
| `claudeMirror.remote.autoReconnect` | `true` | Auto-reconnect on disconnection |
| `claudeMirror.remote.keepAliveIntervalMs` | `30000` | Keepalive heartbeat interval |

---

## Encryption

`HappyCrypto` uses:
- **Key generation**: `tweetnacl` ed25519 from a 32-byte random seed stored in VS Code `SecretStorage`
- **Challenge signing**: `nacl.sign.detached(message, secretKey)` — ed25519 detached signature
- **Session encryption**: Node.js built-in `crypto` — AES-256-GCM with random 12-byte IV
- **Wire format**: `base64(iv):base64(tag):base64(ciphertext)` for each encrypted payload

---

## Integration Points

- `TabManager` — `createRemoteTab()` method, `createTabForProvider('remote')` routing, `Map` type updated to include `RemoteSessionTab`
- `webview-messages.ts` — `ProviderId = 'claude' | 'codex' | 'remote'`
- `package.json` — `claudeMirror.provider` enum includes `'remote'`, three new `claudeMirror.remote.*` settings
- `ProviderSelector.tsx` — "Remote" option added to dropdown
- `commands.ts` — `'remote'` label in provider display strings
- `webpack.config.js` — `IgnorePlugin` suppresses optional `bufferutil`/`utf-8-validate` warnings from the `ws` native addon

---

## npm Dependencies Added

| Package | Purpose |
|---------|---------|
| `socket.io-client` | Socket.IO WebSocket client |
| `tweetnacl` | Ed25519 key generation and signing (includes built-in `.d.ts`) |
