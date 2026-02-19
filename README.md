# ClaUi

A VS Code extension that gives [Claude Code](https://docs.anthropic.com/en/docs/claude-code) a rich chat UI - multiple tabs, model selection, file sending, image paste, and more.

## Features

- **Multi-tab sessions** - Run multiple Claude conversations in parallel, each in its own VS Code tab with a distinct color
- **Model selection** - Switch between Sonnet, Opus, and Haiku from the status bar
- **File sending** - Send file paths via right-click context menu, the "+" button, or a keyboard shortcut
- **Image paste** - Paste images from clipboard directly into the chat with `Ctrl+V`
- **Conversation history** - Browse and resume past sessions
- **Auto-naming** - Tabs are automatically named based on your first message
- **Activity summaries** - Tab title updates with what Claude is currently doing
- **Plan approval** - Approve, reject, or give feedback on Claude's plans inline
- **RTL support** - Full right-to-left support for Hebrew and Arabic
- **Permission modes** - Choose between Full Access and Supervised (read-only) modes
- **Session logging** - Per-session log files saved to disk
- **Customizable fonts** - Adjust chat font size and family, including Hebrew-friendly presets

## Prerequisites

| Requirement | How to install |
|-------------|----------------|
| **Claude Code CLI** | `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in |
| **VS Code** | Version 1.85 or later |

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Press **`Ctrl+Shift+C`** to open a new Claude session
3. Type a message and press **`Ctrl+Enter`** to send

That's it!

## Keyboard Shortcuts

| Shortcut | What it does |
|----------|-------------|
| **`Ctrl+Shift+C`** | Open a new Claude session |
| **`Ctrl+Enter`** | Send your message |
| **`Enter`** | New line in the input (does NOT send) |
| **`Escape`** | Cancel the current response |
| **`Ctrl+Shift+H`** | Open conversation history |
| **`Ctrl+Alt+Shift+C`** | Send the current file's path to the chat |
| **`Ctrl+V`** | Paste an image from clipboard into the chat |

> **Mac users**: Replace `Ctrl` with `Cmd` for all shortcuts above.
>
> To customize shortcuts, open Keyboard Shortcuts (`Ctrl+K`, `Ctrl+S`) and search for `claudeMirror`.

## Sending Files

Three ways to reference files in your messages:

1. **Right-click in Explorer** - Select **"ClaUi: Send Path to Chat"**. Works with multiple files.
2. **The "+" button** - Click the **+** button next to the chat input to open a file picker.
3. **Keyboard shortcut** - Press **`Ctrl+Alt+Shift+C`** while editing a file.

The path is inserted into the input box so you can add context before sending.

## Commands

Press `Ctrl+Shift+P` and type "ClaUi" to see all commands:

| Command | What it does |
|---------|-------------|
| **Start New Session** | Open a new Claude chat tab |
| **Stop Session** | Stop the active session's CLI process |
| **Send Message** | Send the current input (same as Ctrl+Enter) |
| **Compact Context** | Compact the conversation context |
| **Resume Session** | Resume a previous session by ID |
| **Conversation History** | Browse and resume past sessions |
| **Cancel Current Response** | Stop Claude's current response |
| **Send Path to Chat** | Insert a file/folder path into the chat input |
| **Open Plan Document** | Open plan docs from the project |
| **Open Log Directory** | Open the session logs folder |

## Settings

All settings are under `claudeMirror.*` in VS Code Settings (`Ctrl+,`).

| Setting | Default | Description |
|---------|---------|-------------|
| `cliPath` | `"claude"` | Path to Claude CLI executable |
| `useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `autoRestart` | `true` | Auto-restart CLI process on crash |
| `chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `chatFontFamily` | `""` | Font family for chat (empty = VS Code default) |
| `autoNameSessions` | `true` | Auto-generate tab names from first message |
| `activitySummary` | `true` | Summarize Claude's activity in the tab title |
| `activitySummaryThreshold` | `3` | Tool uses before triggering a summary (1-10) |
| `model` | `""` | Claude model for new sessions (empty = CLI default) |
| `permissionMode` | `"full-access"` | `full-access` or `supervised` (read-only tools) |
| `enableFileLogging` | `true` | Write session logs to disk |
| `logDirectory` | `""` | Directory for log files (empty = default) |

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, architecture overview, and development setup.

## License

MIT
