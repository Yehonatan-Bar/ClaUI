# Stream-JSON Protocol Reference

## Overview

The Claude CLI supports machine-readable communication via `--output-format stream-json` and `--input-format stream-json`. Each message is a single JSON object on one line (newline-delimited JSON / NDJSON).

**CLI invocation:**
```bash
claude -p --verbose \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --replay-user-messages
```

**Flag meanings:**
| Flag | Purpose |
|------|---------|
| `-p` | Print mode (non-interactive, reads from stdin) |
| `--verbose` | Include tool use details in output |
| `--output-format stream-json` | Emit JSON lines on stdout |
| `--input-format stream-json` | Accept JSON lines on stdin |
| `--include-partial-messages` | Emit streaming deltas (not just final messages) |
| `--replay-user-messages` | Include user messages in output stream |

---

## Output Events (stdout)

### system/init

Emitted once when the session is initialized.

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "abc-123",
  "tools": ["Read", "Write", "Bash", "Glob", "Grep"],
  "model": "claude-sonnet-4-5-20250929",
  "cwd": "/path/to/workspace",
  "mcp_servers": []
}
```

### stream_event

Wraps Anthropic API streaming events. The `event` field contains the actual streaming payload.

#### message_start
```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": {
      "id": "msg_123",
      "type": "message",
      "role": "assistant",
      "model": "claude-sonnet-4-5-20250929"
    }
  }
}
```

#### content_block_start (text)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 0,
    "content_block": {
      "type": "text",
      "text": ""
    }
  }
}
```

#### content_block_start (tool_use)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 1,
    "content_block": {
      "type": "tool_use",
      "id": "toolu_123",
      "name": "Read",
      "input": ""
    }
  }
}
```

#### content_block_delta (text)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "Here is the "
    }
  }
}
```

#### content_block_delta (tool input)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 1,
    "delta": {
      "type": "input_json_delta",
      "partial_json": "{\"file_path\":"
    }
  }
}
```

#### content_block_stop
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_stop",
    "index": 0
  }
}
```

#### message_delta
```json
{
  "type": "stream_event",
  "event": {
    "type": "message_delta",
    "delta": {
      "stop_reason": "end_turn"
    },
    "usage": {
      "output_tokens": 150
    }
  }
}
```

#### message_stop
```json
{
  "type": "stream_event",
  "event": {
    "type": "message_stop"
  }
}
```

### assistant

Complete assistant message (emitted after all streaming events for that turn).

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_123",
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Here is the answer..." },
      { "type": "tool_use", "id": "toolu_123", "name": "Read", "input": { "file_path": "/foo" } }
    ],
    "model": "claude-sonnet-4-5-20250929",
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 500,
      "output_tokens": 150,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 400
    }
  },
  "session_id": "abc-123"
}
```

### user

Replayed user message (when `--replay-user-messages` is used).

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "text", "text": "Hello Claude" }
    ]
  },
  "session_id": "abc-123"
}
```

### result (success)

Emitted when a turn completes successfully.

```json
{
  "type": "result",
  "subtype": "success",
  "cost_usd": 0.0045,
  "total_cost_usd": 0.0123,
  "duration_ms": 3500,
  "duration_api_ms": 2800,
  "is_error": false,
  "num_turns": 1,
  "session_id": "abc-123",
  "usage": {
    "input_tokens": 500,
    "output_tokens": 150
  }
}
```

### result (error)

Emitted when a turn fails.

```json
{
  "type": "result",
  "subtype": "error",
  "error": "Rate limit exceeded",
  "is_error": true,
  "session_id": "abc-123"
}
```

---

## Input Messages (stdin)

### user_message

Send a user message (text or content blocks).

**Text only:**
```json
{ "type": "user_message", "content": "What files are in the src directory?" }
```

**With images:**
```json
{
  "type": "user_message",
  "content": [
    { "type": "text", "text": "What does this screenshot show?" },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgo..."
      }
    }
  ]
}
```

### control_request

Send control commands.

**Compact context:**
```json
{
  "type": "control_request",
  "request": {
    "subtype": "compact",
    "custom_instructions": "Focus on the authentication module"
  }
}
```

**Cancel current request:**
```json
{
  "type": "control_request",
  "request": {
    "subtype": "cancel"
  }
}
```

---

## Event Sequence (Typical Turn)

A typical request-response cycle produces events in this order:

```
1. -> stdin:  { type: "user_message", content: "..." }
2. <- stdout: { type: "user", message: {...} }                    (if --replay-user-messages)
3. <- stdout: { type: "stream_event", event: { type: "message_start", ... } }
4. <- stdout: { type: "stream_event", event: { type: "content_block_start", index: 0, ... } }
5. <- stdout: { type: "stream_event", event: { type: "content_block_delta", index: 0, ... } }  (repeated)
6. <- stdout: { type: "stream_event", event: { type: "content_block_stop", index: 0 } }
7. <- stdout: { type: "stream_event", event: { type: "message_delta", ... } }
8. <- stdout: { type: "stream_event", event: { type: "message_stop" } }
9. <- stdout: { type: "assistant", message: {...} }                (complete message)
10.<- stdout: { type: "result", subtype: "success", ... }          (cost/usage)
```

If the assistant uses tools, steps 4-6 repeat for each content block (text blocks and tool_use blocks alternate).

---

## Session Management Flags

| Flag | Purpose |
|------|---------|
| `--resume <session-id>` | Resume an existing session |
| `--fork-session` | Used with --resume, creates a fork instead of continuing |

---

## Important Notes

- **CLAUDECODE env var**: Must be unset before spawning to prevent nested-session detection
- **Working directory**: The `cwd` passed to spawn determines the workspace context for file operations
- **Encoding**: All communication is UTF-8
- **Line termination**: Each JSON object must be followed by `\n`
