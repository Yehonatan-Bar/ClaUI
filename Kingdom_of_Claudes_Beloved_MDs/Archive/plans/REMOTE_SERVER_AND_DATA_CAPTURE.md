# Remote Server Communication & Full Data Capture

Technical reference for two future capabilities:
1. Sending/receiving/displaying text from a remote server
2. Capturing all data flowing through the extension

---

## Part 1: Remote Server Communication

### Current Architecture Overview

The extension uses a layered pipeline where each layer is decoupled from its neighbors:

```
ClaudeProcessManager ── spawn() ──> CLI process (stdin/stdout NDJSON)
        |
        | emits 'event' (CliOutputEvent)
        v
   StreamDemux ── demultiplexes into typed events
        |
        | emits 'textDelta', 'assistantMessage', 'result', etc.
        v
  MessageHandler ── translates to webview protocol
        |
        | panel.webview.postMessage(ExtensionToWebviewMessage)
        v
     Webview (React + Zustand store)
```

The critical insight: **everything below `ClaudeProcessManager` is transport-agnostic**. The `StreamDemux` receives `CliOutputEvent` JSON objects and doesn't care where they came from. The `MessageHandler` works through the `WebviewBridge` interface and doesn't know what tab type it's running in. The webview receives `ExtensionToWebviewMessage` via `postMessage` and has zero knowledge of the data source.

### Key Abstraction Boundaries

#### 1. Process Manager Interface

`ClaudeProcessManager` (`src/extension/process/ClaudeProcessManager.ts`) is an `EventEmitter` with this effective interface:

```typescript
// Events emitted (line 34-40):
'event'  (CliOutputEvent)   // Parsed JSON from CLI stdout
'raw'    (string)            // Non-JSON stdout lines
'stderr' (string)            // Stderr output
'exit'   (ProcessExitInfo)   // Process exited
'error'  (Error)             // Spawn/runtime error

// Input methods:
send(message: CliInputMessage): void           // line 225
sendUserMessage(text: string): void            // line 233
sendCompact(instructions?: string): void       // line 238
sendCancel(): void                             // line 262

// State:
get isRunning(): boolean
get currentSessionId(): string | null
```

#### 2. Wire Protocol Types

Defined in `src/extension/types/stream-json.ts`:

```typescript
// CLI -> Extension (line 188-194):
type CliOutputEvent =
  | SystemInitEvent      // Session initialization with sessionId, model
  | StreamEvent          // Streaming chunks (text deltas, tool use, message lifecycle)
  | AssistantMessage     // Complete assistant message with all content blocks
  | UserMessage          // Echoed user message or synthetic meta content
  | ResultSuccess        // Turn completed with cost/usage data
  | ResultError;         // Turn failed with error details

// Extension -> CLI (line 214):
type CliInputMessage = UserInputMessage | ControlRequest;
```

#### 3. WebviewBridge Interface

Defined in `src/extension/webview/MessageHandler.ts` (line 59-92):

```typescript
interface WebviewBridge {
  postMessage(msg: ExtensionToWebviewMessage): void;
  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void;
  setSuppressNextExit?(suppress: boolean): void;
  switchModel?(model: string): Promise<void>;
  getProvider?(): ProviderId;
  // ... other optional lifecycle methods
}
```

Both `SessionTab` and `CodexSessionTab` implement this interface. A new `RemoteSessionTab` would do the same.

#### 4. Provider Routing

`ProviderId` (`src/extension/types/webview-messages.ts`, line 8) already includes a `'remote'` value:

```typescript
type ProviderId = 'claude' | 'codex' | 'remote';
```

`TabManager` (`src/extension/session/TabManager.ts`, line 47) manages a union of tab types:

```typescript
type ManagedTab = SessionTab | CodexSessionTab;
// Would become: type ManagedTab = SessionTab | CodexSessionTab | RemoteSessionTab;
```

### Existing Precedent: Codex as a Second Backend

The codebase already supports two independent backends, proving the architecture handles multiple providers:

| Component | Claude | Codex |
|-----------|--------|-------|
| Process Manager | `ClaudeProcessManager` | `CodexExecProcessManager` |
| Demux | `StreamDemux` | `CodexExecDemux` |
| Message Handler | `MessageHandler` | `CodexMessageHandler` |
| Session Tab | `SessionTab` | `CodexSessionTab` |
| Wire Protocol | `CliOutputEvent` (NDJSON) | `CodexExecJsonEvent` (NDJSON) |

The Codex integration demonstrates that adding a new backend requires implementing the same four classes, each adapting the provider's protocol into the shared webview message format.

### Implementation Plan: RemoteProcessManager

#### Transport Options

| Transport | Streaming | Bidirectional | Reconnection | Best For |
|-----------|-----------|---------------|--------------|----------|
| WebSocket | Yes | Yes | Manual | Interactive sessions, bidirectional control |
| Server-Sent Events (SSE) | Yes | No (need HTTP POST for input) | Built-in | Streaming responses, simpler server |
| HTTP Long-Polling | Simulated | No | Built-in | Simplest server, worst latency |
| gRPC Streaming | Yes | Yes | Manual | High-performance, typed contracts |

**Recommended: WebSocket** for full bidirectional communication, or **SSE + HTTP POST** for simpler implementation.

#### RemoteProcessManager Class

```typescript
// New file: src/extension/process/RemoteProcessManager.ts

import { EventEmitter } from 'events';
import type { CliOutputEvent, CliInputMessage } from '../types/stream-json';

interface RemoteConnectionOptions {
  serverUrl: string;        // WebSocket URL: wss://server.example.com/session
  authToken?: string;       // Authentication bearer token
  sessionId?: string;       // Resume existing remote session
  reconnect?: boolean;      // Auto-reconnect on disconnect (default: true)
  heartbeatMs?: number;     // Keepalive interval (default: 30000)
}

/**
 * Drop-in replacement for ClaudeProcessManager that connects
 * to a remote server via WebSocket instead of spawning a local CLI.
 *
 * Emits the same events: 'event', 'raw', 'stderr', 'exit', 'error'
 * Accepts the same input: send(CliInputMessage)
 *
 * The remote server must speak the same NDJSON protocol as the Claude CLI:
 * - Send CliOutputEvent JSON objects (one per WebSocket message)
 * - Accept CliInputMessage JSON objects
 */
export class RemoteProcessManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private _isRunning = false;
  private _sessionId: string | null = null;
  private _cancelledByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RemoteConnectionOptions) {
    super();
  }

  async connect(): Promise<void> {
    const url = new URL(this.options.serverUrl);
    if (this.options.sessionId) {
      url.searchParams.set('session', this.options.sessionId);
    }

    // Node.js WebSocket (ws package) or native WebSocket
    this.ws = new WebSocket(url.toString(), {
      headers: this.options.authToken
        ? { Authorization: `Bearer ${this.options.authToken}` }
        : undefined,
    });

    this.ws.onopen = () => {
      this._isRunning = true;
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : event.data.toString();
      try {
        const parsed: CliOutputEvent = JSON.parse(text);
        // Track session ID from init event (same as ClaudeProcessManager)
        if (parsed.type === 'system' && parsed.subtype === 'init') {
          this._sessionId = parsed.session_id ?? null;
        }
        this.emit('event', parsed);
      } catch {
        this.emit('raw', text);
      }
    };

    this.ws.onerror = (err) => {
      this.emit('error', new Error(`WebSocket error: ${err}`));
    };

    this.ws.onclose = (event) => {
      this._isRunning = false;
      this.stopHeartbeat();
      this.emit('exit', { code: event.code, signal: null });
      if (this.options.reconnect && !this._cancelledByUser) {
        this.scheduleReconnect();
      }
    };
  }

  // --- Same interface as ClaudeProcessManager ---

  send(message: CliInputMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  sendUserMessage(text: string): void {
    this.send({ type: 'user', message: { role: 'user', content: text } });
  }

  sendCompact(instructions?: string): void {
    this.send({
      type: 'control_request',
      request: { subtype: 'compact', ...(instructions ? { custom_instructions: instructions } : {}) },
    });
  }

  sendCancel(): void {
    this._cancelledByUser = true;
    // Send cancel via the wire; the server handles termination
    try {
      this.send({ type: 'control_request', request: { subtype: 'cancel' } });
    } catch { /* connection may already be closed */ }
  }

  stop(): void {
    this._cancelledByUser = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'client-stop');
    this._isRunning = false;
  }

  get isRunning(): boolean { return this._isRunning; }
  get currentSessionId(): string | null { return this._sessionId; }
  get cancelledByUser(): boolean { return this._cancelledByUser; }

  // --- Private ---

  private startHeartbeat(): void {
    const interval = this.options.heartbeatMs ?? 30_000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping?.();
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}
```

#### RemoteSessionTab Class

The `RemoteSessionTab` follows the same pattern as `SessionTab` but substitutes `RemoteProcessManager` for `ClaudeProcessManager`:

```typescript
// New file: src/extension/session/RemoteSessionTab.ts

// The constructor would look like:
constructor(context: vscode.ExtensionContext, /* ... */) {
  // Instead of: this.processManager = new ClaudeProcessManager(context);
  this.processManager = new RemoteProcessManager({
    serverUrl: config.remoteServerUrl,
    authToken: config.remoteAuthToken,
    reconnect: true,
  });

  // Everything else stays identical:
  this.demux = new StreamDemux();                          // Same class
  this.control = new ControlProtocol(this.processManager); // Works if interface matches
  this.messageHandler = new MessageHandler(/* ... */);     // Same class via WebviewBridge
}

// wireProcessEvents is identical to SessionTab's:
private wireProcessEvents(tabLog: (msg: string) => void): void {
  this.processManager.on('event', (event: CliOutputEvent) => {
    // Same event flow as local CLI
    this.demux.handleEvent(event);
  });
}
```

#### ControlProtocol Compatibility

`ControlProtocol` (`src/extension/process/ControlProtocol.ts`) is typed against `ClaudeProcessManager` specifically (line 1: `import type { ClaudeProcessManager }`). To support `RemoteProcessManager`, extract an interface:

```typescript
// New: src/extension/process/IProcessManager.ts
export interface IProcessManager {
  send(message: CliInputMessage): void;
  sendUserMessage(text: string): void;
  sendCompact(instructions?: string): void;
  sendCancel(): void;
  get isRunning(): boolean;
  get currentSessionId(): string | null;
  on(event: 'event', listener: (e: CliOutputEvent) => void): this;
  on(event: 'exit', listener: (info: ProcessExitInfo) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'raw', listener: (text: string) => void): this;
  on(event: 'stderr', listener: (text: string) => void): this;
}
```

Then `ControlProtocol` accepts `IProcessManager` instead of `ClaudeProcessManager`.

#### TabManager Routing

Add a case in `TabManager` to create `RemoteSessionTab` based on provider selection:

```typescript
// In TabManager.createTab() or equivalent:
if (provider === 'remote') {
  return new RemoteSessionTab(this.context, serverConfig, /* ... */);
}
```

#### Server-Side Protocol Requirements

The remote server must implement the Claude CLI stream-json protocol:

**Inbound (server receives):**
```jsonl
{"type":"user","message":{"role":"user","content":"Hello"}}
{"type":"control_request","request":{"subtype":"compact"}}
{"type":"control_request","request":{"subtype":"cancel"}}
```

**Outbound (server sends):**
```jsonl
{"type":"system","subtype":"init","session_id":"abc123","model":"claude-sonnet-4-20250514","tools":[],"mcp_servers":[]}
{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100}}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello!"}],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":5}}}
{"type":"result","subtype":"success","cost_usd":0.001,"total_cost_usd":0.001,"usage":{"input_tokens":100,"output_tokens":5},"session_id":"abc123"}
```

The server can proxy to any AI provider as long as it translates responses into this format.

#### Configuration

New VS Code settings:

```json
{
  "claudeMirror.remoteServerUrl": "wss://your-server.com/session",
  "claudeMirror.remoteAuthToken": "",
  "claudeMirror.remoteAutoReconnect": true,
  "claudeMirror.remoteHeartbeatMs": 30000
}
```

### What Changes vs. What Stays

| Component | File | Changes? |
|-----------|------|----------|
| `RemoteProcessManager` | **NEW** `src/extension/process/RemoteProcessManager.ts` | New file |
| `IProcessManager` | **NEW** `src/extension/process/IProcessManager.ts` | New interface |
| `RemoteSessionTab` | **NEW** `src/extension/session/RemoteSessionTab.ts` | New file |
| `ControlProtocol` | `src/extension/process/ControlProtocol.ts` | Type change: accept `IProcessManager` |
| `TabManager` | `src/extension/session/TabManager.ts` | Add `RemoteSessionTab` to `ManagedTab`, routing |
| `package.json` | `package.json` | New settings declarations |
| `ClaudeProcessManager` | `src/extension/process/ClaudeProcessManager.ts` | Implement `IProcessManager` (no logic changes) |
| `StreamDemux` | `src/extension/process/StreamDemux.ts` | **No change** |
| `MessageHandler` | `src/extension/webview/MessageHandler.ts` | **No change** |
| `WebviewProvider` | `src/extension/webview/WebviewProvider.ts` | **No change** |
| Zustand store | `src/webview/state/store.ts` | **No change** |
| `useClaudeStream` | `src/webview/hooks/useClaudeStream.ts` | **No change** |
| All React components | `src/webview/components/*` | **No change** |

---

## Part 2: Full Data Capture

### What Is Currently Captured

| Data | Storage | Completeness |
|------|---------|-------------|
| Token counts, costs, usage | `ProjectAnalyticsStore` (workspaceState) | Full |
| Session metadata (model, timing, name) | `SessionStore` (globalState) | Full |
| User prompts | `PromptHistoryStore` (globalState + workspaceState) | Full |
| CLI events (all types) | `FileLogger` (.log files) | Partial: text truncated to 50-500 chars |
| Full assistant message content | Nowhere | Not captured |
| Full tool_use input/output | Nowhere | Not captured |
| Full streaming text | Nowhere | Not captured |
| Codex agent messages (full) | In-memory `transcriptBuffer` only | Lost on dispose |

### Interception Points

Every byte of data from both CLIs flows through exactly one chokepoint per provider:

#### Claude CLI Chokepoint

`SessionTab.wireProcessEvents()` at `src/extension/session/SessionTab.ts` line 1482:

```typescript
this.processManager.on('event', (event: CliOutputEvent) => {
  // `event` contains the FULL parsed JSON object with all content,
  // all tool_use blocks, all usage data, everything.
  // Currently only truncated summaries are logged.
  this.demux.handleEvent(event);
});
```

#### Codex CLI Chokepoint

`CodexSessionTab.wireProcessEvents()` at `src/extension/session/CodexSessionTab.ts` line 1274:

```typescript
this.processManager.on('event', (event: CodexExecJsonEvent) => {
  // Same: full event object with complete content.
  this.demux.handleEvent(event);
});
```

#### Additional Capture Points

| Point | Location | Data Available |
|-------|----------|---------------|
| Demux typed events | `StreamDemux` subscribers | Parsed/typed event data |
| `handleResultEvent()` | `MessageHandler` line 4622 | Turn-level aggregation: cost, usage, tool list |
| Webview incoming messages | `useClaudeStream` hook | All `ExtensionToWebviewMessage` objects |
| Webview outgoing messages | `postToExtension()` | All `WebviewToExtensionMessage` objects |

### Implementation: TranscriptRecorder

A new class that taps into the chokepoint and records everything:

```typescript
// New file: src/extension/session/TranscriptRecorder.ts

import * as fs from 'fs';
import * as path from 'path';
import type { CliOutputEvent } from '../types/stream-json';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';

type AnyEvent = CliOutputEvent | CodexExecJsonEvent;

interface TranscriptRecorderOptions {
  outputDir: string;            // Directory for JSONL transcript files
  sessionId: string;            // Used in file naming
  provider: 'claude' | 'codex' | 'remote';
  maxFileSizeMb?: number;       // Rotation threshold (default: 10)
  filterStreaming?: boolean;    // Skip noisy text_delta/input_json_delta events (default: false)
  remoteEndpoint?: string;      // Optional: also POST events to a remote collector
  remoteAuthToken?: string;
}

/**
 * Records every event passing through the extension into a JSONL file.
 * Each line is a timestamped JSON object containing the raw event.
 *
 * Usage: create in SessionTab/CodexSessionTab constructor, call
 * record() in wireProcessEvents(), call dispose() on tab close.
 */
export class TranscriptRecorder {
  private writeStream: fs.WriteStream | null = null;
  private currentFileSize = 0;
  private fileIndex = 0;
  private disposed = false;
  private readonly maxFileSize: number;
  private remoteBatch: string[] = [];
  private remoteFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: TranscriptRecorderOptions) {
    this.maxFileSize = (options.maxFileSizeMb ?? 10) * 1024 * 1024;
    fs.mkdirSync(options.outputDir, { recursive: true });
    this.openNewFile();
    if (options.remoteEndpoint) {
      this.startRemoteFlush();
    }
  }

  /**
   * Record a single event. Call this from wireProcessEvents().
   * Each recorded line is:
   * {"ts":"2025-01-15T10:30:00.000Z","provider":"claude","sid":"abc","event":{...}}
   */
  record(event: AnyEvent): void {
    if (this.disposed) return;

    if (this.options.filterStreaming && this.isStreamingNoise(event)) return;

    const envelope = {
      ts: new Date().toISOString(),
      provider: this.options.provider,
      sid: this.options.sessionId,
      event,
    };

    const line = JSON.stringify(envelope) + '\n';

    // Write to local file
    if (this.writeStream) {
      this.writeStream.write(line);
      this.currentFileSize += Buffer.byteLength(line, 'utf-8');
      if (this.currentFileSize >= this.maxFileSize) {
        this.rotate();
      }
    }

    // Buffer for remote send
    if (this.options.remoteEndpoint) {
      this.remoteBatch.push(line);
    }
  }

  /** Record outbound messages (user input sent TO the CLI) */
  recordInput(message: { type: string; [key: string]: unknown }): void {
    if (this.disposed) return;
    const envelope = {
      ts: new Date().toISOString(),
      provider: this.options.provider,
      sid: this.options.sessionId,
      direction: 'input',
      event: message,
    };
    const line = JSON.stringify(envelope) + '\n';
    if (this.writeStream) {
      this.writeStream.write(line);
      this.currentFileSize += Buffer.byteLength(line, 'utf-8');
    }
    if (this.options.remoteEndpoint) {
      this.remoteBatch.push(line);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flushRemoteBatch(); // final flush
    if (this.remoteFlushTimer) clearInterval(this.remoteFlushTimer);
    this.writeStream?.end();
    this.writeStream = null;
  }

  // --- Private ---

  private isStreamingNoise(event: AnyEvent): boolean {
    if ('event' in event && event.type === 'stream_event') {
      const inner = (event as { event: { type: string } }).event;
      return inner.type === 'content_block_delta';
    }
    return false;
  }

  private openNewFile(): void {
    const fileName = `transcript_${this.options.provider}_${this.options.sessionId}_${this.fileIndex}.jsonl`;
    const filePath = path.join(this.options.outputDir, fileName);
    this.writeStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
    this.currentFileSize = 0;
  }

  private rotate(): void {
    this.writeStream?.end();
    this.fileIndex++;
    this.openNewFile();
  }

  private startRemoteFlush(): void {
    this.remoteFlushTimer = setInterval(() => this.flushRemoteBatch(), 5000);
  }

  private async flushRemoteBatch(): Promise<void> {
    if (!this.options.remoteEndpoint || this.remoteBatch.length === 0) return;
    const batch = this.remoteBatch.splice(0);
    try {
      await fetch(this.options.remoteEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          ...(this.options.remoteAuthToken
            ? { Authorization: `Bearer ${this.options.remoteAuthToken}` }
            : {}),
        },
        body: batch.join(''),
      });
    } catch {
      // Re-queue on failure (with cap to prevent unbounded growth)
      if (this.remoteBatch.length < 10_000) {
        this.remoteBatch.unshift(...batch);
      }
    }
  }
}
```

### Wiring Into the Pipeline

#### Claude Sessions

In `SessionTab.wireProcessEvents()` (line 1482), add one line:

```typescript
this.processManager.on('event', (event: CliOutputEvent) => {
  this.transcriptRecorder?.record(event);   // <-- Full capture
  // ... existing logging, checkpoint tracking ...
  this.demux.handleEvent(event);
});
```

To also capture outbound messages, wrap `ControlProtocol.send()` or tap `ClaudeProcessManager.send()`:

```typescript
// In ClaudeProcessManager.send() (line 225):
send(message: CliInputMessage): void {
  this.emit('input', message);   // <-- New event for capture
  this.process.stdin.write(JSON.stringify(message) + '\n');
}

// In SessionTab.wireProcessEvents():
this.processManager.on('input', (msg: CliInputMessage) => {
  this.transcriptRecorder?.recordInput(msg);
});
```

#### Codex Sessions

In `CodexSessionTab.wireProcessEvents()` (line 1274), same pattern:

```typescript
this.processManager.on('event', (event: CodexExecJsonEvent) => {
  this.transcriptRecorder?.record(event);   // <-- Full capture
  tabLog(`Codex JSON: ${event.type}`);
  this.demux.handleEvent(event);
});
```

### Storage Destinations

#### Option A: Local JSONL Files (Recommended Starting Point)

```
globalStorage/.../transcripts/
  transcript_claude_sess123_0.jsonl
  transcript_claude_sess123_1.jsonl   (after 10MB rotation)
  transcript_codex_sess456_0.jsonl
```

**Pros:** Zero dependencies, immediate, replayable, grep-friendly.
**Cons:** Disk space (a heavy session can produce 10-50 MB of JSONL).

Each line in the file:
```json
{"ts":"2025-01-15T10:30:00.123Z","provider":"claude","sid":"sess_abc","event":{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Full response text here..."}],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":1500,"output_tokens":300}}}}
```

#### Option B: Remote Collector (HTTP POST)

The `TranscriptRecorder` batches events and POSTs them as NDJSON every 5 seconds:

```
POST https://collector.example.com/ingest
Content-Type: application/x-ndjson
Authorization: Bearer <token>

{"ts":"...","provider":"claude","sid":"...","event":{...}}
{"ts":"...","provider":"claude","sid":"...","event":{...}}
```

**Pros:** Central storage, real-time analysis, no local disk pressure.
**Cons:** Network dependency, latency, authentication setup.

#### Option C: SQLite (Structured Queries)

Replace `fs.WriteStream` with an SQLite database for structured storage:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,           -- 'claude' | 'codex' | 'remote'
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,         -- 'assistant', 'result', 'stream_event', etc.
  event_subtype TEXT,               -- 'text_delta', 'tool_use', etc.
  content TEXT,                     -- Full JSON event
  cost_usd REAL,                    -- Extracted for easy querying
  input_tokens INTEGER,
  output_tokens INTEGER
);

CREATE INDEX idx_session ON events(session_id);
CREATE INDEX idx_type ON events(event_type);
```

**Pros:** Queryable, indexable, efficient storage with compression.
**Cons:** Requires `better-sqlite3` dependency (native module).

#### Option D: Local + Remote (Both)

The `TranscriptRecorder` already supports this: write to local JSONL for reliability, async-POST to remote for analysis. If the remote is down, local files serve as a buffer.

### Configuration

New VS Code settings:

```json
{
  "claudeMirror.transcriptCapture.enabled": false,
  "claudeMirror.transcriptCapture.outputDir": "",
  "claudeMirror.transcriptCapture.filterStreaming": false,
  "claudeMirror.transcriptCapture.maxFileSizeMb": 10,
  "claudeMirror.transcriptCapture.remoteEndpoint": "",
  "claudeMirror.transcriptCapture.remoteAuthToken": ""
}
```

### Data Volume Estimates

| Session Activity | Approx. JSONL Size | With filterStreaming |
|------------------|--------------------|---------------------|
| Short (10 turns, text only) | 200 KB | 50 KB |
| Medium (30 turns, some tools) | 2-5 MB | 500 KB |
| Heavy (100+ turns, many tools) | 20-50 MB | 5-10 MB |

The `filterStreaming: true` option skips `content_block_delta` events (text and tool input streaming chunks). The final `assistant` message with complete content is always captured, so no data is lost -- only the streaming deltas are dropped.

### Privacy and Security Considerations

- Transcripts contain full conversation content including code, file paths, and potentially sensitive data
- Remote endpoints must use TLS (wss:// or https://)
- Auth tokens for remote collectors should be stored in VS Code's `SecretStorage`, not in plain settings
- Consider adding a redaction layer (similar to `HandoffArtifactStore`'s secret scrubbing) before remote transmission
- The feature should be opt-in (disabled by default) with clear user-facing documentation

### Summary: Changes Required

| File | Change |
|------|--------|
| **NEW** `src/extension/session/TranscriptRecorder.ts` | New class |
| `src/extension/session/SessionTab.ts` | Add `TranscriptRecorder` field, wire in `wireProcessEvents` |
| `src/extension/session/CodexSessionTab.ts` | Same as above |
| `src/extension/process/ClaudeProcessManager.ts` | Emit `'input'` event in `send()` for bidirectional capture |
| `src/extension/process/CodexExecProcessManager.ts` | Same as above |
| `package.json` | New settings declarations |

No changes to: `StreamDemux`, `MessageHandler`, `ControlProtocol`, `WebviewProvider`, webview code, React components, Zustand store.

---

## Relationship Between Part 1 and Part 2

These two features are complementary and share infrastructure:

1. **Remote Server** (Part 1) adds a new data **source** -- the extension receives events from a remote server instead of a local CLI
2. **Data Capture** (Part 2) adds a new data **sink** -- the extension records events to additional storage

Both tap into the same chokepoint: `wireProcessEvents()`. A `RemoteSessionTab` would wire its `RemoteProcessManager` events through the exact same `TranscriptRecorder`:

```
[Local CLI] ──> ClaudeProcessManager ──┐
                                       ├──> TranscriptRecorder ──> JSONL / Remote Collector
[Remote Server] ──> RemoteProcessManager ──┘         |
                                                     v
                                              StreamDemux ──> MessageHandler ──> Webview
```

Both features combined enable a full relay architecture: receive from any source, display in the webview, and record everything to any destination.
