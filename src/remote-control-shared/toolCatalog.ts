/**
 * Single source of truth for every ClaUi Remote Control tool.
 *
 * The extension host executes 'instance' tools; the stdio runtime serves this
 * same catalog (so `tools/list` works even while VS Code is closed) and
 * executes 'local' tools itself (instance discovery / window launch).
 * Must never import `vscode`.
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** True when the tool changes state. Blocked when access level is 'readOnly'. */
  mutating: boolean;
  /** True when the tool can remove/stop things (MCP destructiveHint). */
  destructive?: boolean;
  /** 'instance' = executed inside a VS Code window; 'local' = executed by the stdio runtime. */
  scope: 'instance' | 'local';
  /** May block for a long time (the stdio runtime sends progress heartbeats meanwhile). */
  longRunning?: boolean;
}

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const TAB_ID: JsonSchema = {
  type: ['string', 'number'],
  description:
    'Target tab: its id (e.g. "tab-3"), its tab number (3), or its exact display name. ' +
    'Omit to use the active (last focused) tab.',
};

const TIMEOUT_SEC = (defaultSec: number): JsonSchema => ({
  type: 'number',
  minimum: 1,
  maximum: 3600,
  description: `Maximum seconds to wait (default ${defaultSec}). On timeout the work keeps running; call wait_for_idle to keep waiting.`,
});

const PROVIDER: JsonSchema = {
  type: 'string',
  enum: ['claude', 'codex', 'remote'],
  description: 'Provider for the new tab: "claude" (Claude Code), "codex" (Codex CLI), or "remote" (Happy Coder relay). Defaults to the configured provider.',
};

const IMAGE_ITEM: JsonSchema = {
  type: 'object',
  description: 'An image attachment: either a local file path, or base64 data with its media type.',
  properties: {
    path: { type: 'string', description: 'Absolute path to a .png/.jpg/.jpeg/.gif/.webp file.' },
    base64: { type: 'string', description: 'Base64 image data (no data: prefix).' },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
  },
};

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TOOL_CATALOG: ToolDefinition[] = [
  // ----- Status & discovery ------------------------------------------------
  {
    name: 'get_status',
    title: 'Get ClaUi status',
    description:
      'Overview of the connected ClaUi window: extension version, workspace, open tabs (count + active tab), ' +
      'pending approvals, defaults (provider, model, permission mode) and remote-control access level. Start here.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'list_tabs',
    title: 'List chat tabs',
    description:
      'List every open ClaUi chat tab with id, name, provider, model, session id, busy state, hibernation state, ' +
      'pending approval, folder, worktree, cost so far and last activity.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'get_tab',
    title: 'Get tab details',
    description:
      'Full state of one tab: everything from list_tabs plus the last turn (cost/tokens/tools), last error, ' +
      'usage-limit state, scheduled message, pending approval details and transcript size.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'list_models',
    title: 'List available models',
    description:
      'Model ids accepted by set_model / create_tab: Claude models, Codex models (from the local Codex cache) and ' +
      'Bridge Provider models (Grok / Antigravity / OpenAI-compatible / Council) when configured.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },

  // ----- Tab lifecycle -----------------------------------------------------
  {
    name: 'create_tab',
    title: 'Open a new chat tab',
    description:
      'Open a new ClaUi chat tab (exactly like the "New Session" button) and optionally configure it and send a first prompt. ' +
      'With prompt + wait=true the call returns the assistant reply. Returns the new tab id.',
    inputSchema: obj({
      provider: PROVIDER,
      model: { type: 'string', description: 'Model id to select in the new tab (see list_models; "" = CLI default). Like the picker, it also becomes the default for new tabs.' },
      permissionMode: {
        type: 'string',
        enum: ['full-access', 'supervised'],
        description: 'Permission mode. Note: ClaUi stores this globally (applies to newly started sessions).',
      },
      effort: { type: 'string', description: 'Thinking / reasoning effort (Claude: low|medium|high|xhigh|max, Codex: none..ultra).' },
      name: { type: 'string', description: 'Tab name to set.' },
      accountProfileId: { type: 'string', description: 'Claude account profile id (Claude tabs only).' },
      prompt: { type: 'string', description: 'Optional first message to send.' },
      wait: { type: 'boolean', description: 'When prompt is given: wait for the reply (default true).' },
      timeoutSec: TIMEOUT_SEC(600),
      focus: { type: 'boolean', description: 'Bring the new tab to the front (default true).' },
    }),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'close_tab',
    title: 'Close a tab',
    description: 'Close a chat tab (stops its CLI process). The conversation stays on disk and can be resumed.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    destructive: true,
    scope: 'instance',
  },
  {
    name: 'focus_tab',
    title: 'Focus a tab',
    description: 'Bring a chat tab to the front in VS Code.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'rename_tab',
    title: 'Rename a tab',
    description: 'Set the display name of a chat tab.',
    inputSchema: obj({ tabId: TAB_ID, name: { type: 'string', minLength: 1 } }, ['name']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'resume_session',
    title: 'Resume a past session',
    description:
      'Reopen a past conversation (from list_sessions / search_conversations) in a new tab with its full history, ' +
      'optionally sending a follow-up prompt.',
    inputSchema: obj(
      {
        sessionId: { type: 'string', minLength: 1 },
        provider: { type: 'string', enum: ['claude', 'codex', 'remote'], description: 'Defaults to the provider recorded for the session.' },
        prompt: { type: 'string', description: 'Optional follow-up message to send after resuming.' },
        wait: { type: 'boolean', description: 'When prompt is given: wait for the reply (default true).' },
        timeoutSec: TIMEOUT_SEC(600),
      },
      ['sessionId'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'fork_session',
    title: 'Fork a past session',
    description: 'Open a copy of a past conversation in a new tab. The original session is left untouched.',
    inputSchema: obj(
      {
        sessionId: { type: 'string', minLength: 1 },
        provider: { type: 'string', enum: ['claude', 'codex', 'remote'] },
      },
      ['sessionId'],
    ),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'hibernate_tab',
    title: 'Hibernate a tab',
    description:
      'Free CPU/RAM: light = stop the CLI process but keep the chat; deep = also unload the chat UI. ' +
      'The tab wakes automatically on focus, on wake_tab, or when a message is sent to it.',
    inputSchema: obj({ tabId: TAB_ID, deep: { type: 'boolean', description: 'Deep hibernation (default false).' } }),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'wake_tab',
    title: 'Wake a hibernated tab',
    description: 'Wake a light- or deep-hibernated tab and resume its session.',
    inputSchema: obj({ tabId: TAB_ID, timeoutSec: TIMEOUT_SEC(60) }),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'stop_session',
    title: 'Stop a session',
    description: 'Stop the CLI session in a tab (the tab stays open; send a message or clear_session to start again).',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    destructive: true,
    scope: 'instance',
  },
  {
    name: 'clear_session',
    title: 'Start a fresh conversation in a tab',
    description: 'Clear the tab and start a brand-new conversation in it (like the "New conversation" button).',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    destructive: true,
    scope: 'instance',
  },

  // ----- Conversation ------------------------------------------------------
  {
    name: 'send_message',
    title: 'Send a prompt',
    description:
      'Send a prompt to a tab exactly as if the user typed it (slash commands such as /compact work too). ' +
      'By default waits until the turn finishes and returns the assistant reply, tools used, cost and the final status: ' +
      'completed | awaiting_approval (use respond_to_approval / answer_question) | queued_usage_limit | session_ended | error | timeout. ' +
      'If the tab is waiting on an approval/question, the text is delivered as the free-text answer.',
    inputSchema: obj(
      {
        tabId: TAB_ID,
        text: { type: 'string', description: 'The prompt text.' },
        images: { type: 'array', items: IMAGE_ITEM, maxItems: 10 },
        wait: { type: 'boolean', description: 'Wait for the turn to finish (default true).' },
        timeoutSec: TIMEOUT_SEC(600),
        ifBusy: {
          type: 'string',
          enum: ['wait', 'queue', 'reject'],
          description:
            'When the tab is still working on a previous turn: "wait" (default) for it to finish first, ' +
            '"queue" = send now (the CLI runs it after the current turn), "reject" = fail.',
        },
        steer: { type: 'boolean', description: 'Codex only: interrupt the running turn to steer with this prompt.' },
      },
      ['text'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'wait_for_idle',
    title: 'Wait for a tab to finish',
    description:
      'Wait until the tab is no longer busy (or needs an approval) and return the reply produced meanwhile. ' +
      'Returns immediately when the tab is already idle.',
    inputSchema: obj({ tabId: TAB_ID, timeoutSec: TIMEOUT_SEC(600) }),
    mutating: false,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'get_messages',
    title: 'Read the conversation',
    description:
      'Read messages of an open tab (live transcript) or of any past session by sessionId. ' +
      'Returns the newest `limit` messages by default; use offset to page backwards.',
    inputSchema: obj({
      tabId: TAB_ID,
      sessionId: { type: 'string', description: 'Read a past session from disk instead of an open tab.' },
      provider: { type: 'string', enum: ['claude', 'codex'], description: 'Provider of sessionId (default claude).' },
      limit: { type: 'number', minimum: 1, maximum: 500, description: 'Max messages (default 20).' },
      offset: { type: 'number', minimum: 0, description: 'Skip this many newest messages (default 0).' },
      format: { type: 'string', enum: ['text', 'blocks'], description: '"text" (default) = readable text; "blocks" = raw content blocks.' },
      includeTools: { type: 'boolean', description: 'Include tool calls and results (default true).' },
      includeThinking: { type: 'boolean', description: 'Include thinking blocks (default false).' },
    }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'get_last_response',
    title: 'Get the last reply',
    description: 'Text of the most recent assistant reply in a tab.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'cancel_response',
    title: 'Cancel the running response',
    description: 'Interrupt the in-flight response in a tab (like pressing Escape). The session stays alive.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'compact_context',
    title: 'Compact context',
    description: 'Run /compact on the tab\'s session to summarize and shrink the context window.',
    inputSchema: obj({ tabId: TAB_ID, instructions: { type: 'string', description: 'Optional focus instructions for the summary.' } }),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'schedule_message',
    title: 'Schedule a message',
    description: 'Schedule a prompt to be sent to a tab at a later time (one scheduled message per tab; scheduling again replaces it).',
    inputSchema: obj(
      {
        tabId: TAB_ID,
        text: { type: 'string', minLength: 1 },
        at: {
          type: ['string', 'number'],
          description: 'When to send: ISO date-time, epoch milliseconds, or a relative offset like "+15m" / "+2h" / "+30s".',
        },
      },
      ['text', 'at'],
    ),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'cancel_scheduled_message',
    title: 'Cancel a scheduled message',
    description: 'Cancel the scheduled message of a tab.',
    inputSchema: obj({ tabId: TAB_ID }),
    mutating: true,
    scope: 'instance',
  },

  // ----- Approvals ---------------------------------------------------------
  {
    name: 'list_pending_approvals',
    title: 'List pending approvals',
    description:
      'Tabs that are blocked waiting for the user: plan approvals (ExitPlanMode), questions (AskUserQuestion, with their options) ' +
      'and tool permission requests in supervised mode.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'respond_to_approval',
    title: 'Approve or reject',
    description:
      'Answer a pending plan / permission request. Actions: approve (bypass permissions), approve_clear_context ' +
      '(start a fresh session seeded with the plan), approve_manual (approve and switch to supervised), reject, ' +
      'feedback (reject with instructions). By default waits for the resulting turn.',
    inputSchema: obj(
      {
        tabId: TAB_ID,
        action: { type: 'string', enum: ['approve', 'approve_clear_context', 'approve_manual', 'reject', 'feedback'] },
        feedback: { type: 'string', description: 'Required for action=feedback.' },
        wait: { type: 'boolean', description: 'Wait for the turn that follows (default true).' },
        timeoutSec: TIMEOUT_SEC(600),
      },
      ['action'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'answer_question',
    title: 'Answer a question',
    description:
      'Answer a pending AskUserQuestion. Pass `answers` (one entry per question, in order, each with the chosen option label(s) or a free-text answer), ' +
      'or `text` for a single free-text reply. By default waits for the resulting turn.',
    inputSchema: obj({
      tabId: TAB_ID,
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Question text (optional; matched by position when omitted).' },
            answers: { type: 'array', items: { type: 'string' } },
          },
          required: ['answers'],
        },
      },
      text: { type: 'string', description: 'Single free-text answer.' },
      wait: { type: 'boolean', description: 'Wait for the turn that follows (default true).' },
      timeoutSec: TIMEOUT_SEC(600),
    }),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },

  // ----- Per-tab settings --------------------------------------------------
  {
    name: 'set_model',
    title: 'Change model',
    description: 'Switch the model of a tab (same as the model picker: the session continues, and the choice also becomes the default for new tabs, like in the UI). See list_models.',
    inputSchema: obj({ tabId: TAB_ID, model: { type: 'string', description: '"" = CLI default.' } }, ['model']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'set_permission_mode',
    title: 'Change permission mode',
    description: 'Full access (bypass permissions) or supervised (ask before tools). ClaUi stores this globally.',
    inputSchema: obj({ tabId: TAB_ID, mode: { type: 'string', enum: ['full-access', 'supervised'] } }, ['mode']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'set_effort',
    title: 'Change thinking effort',
    description: 'Claude tabs: low | medium | high | xhigh | max | "" (default). Codex tabs: none | minimal | low | medium | high | xhigh | max | ultra | "". Stored globally like the UI picker (applies to sessions started afterwards).',
    inputSchema: obj({ tabId: TAB_ID, effort: { type: 'string' } }, ['effort']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'set_fast_mode',
    title: 'Toggle fast mode',
    description: 'Claude: fast output mode (Opus models). Codex: fast service tier.',
    inputSchema: obj({ tabId: TAB_ID, enabled: { type: 'boolean' } }, ['enabled']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'switch_provider',
    title: 'Hand off to another provider',
    description: 'Carry the conversation context from a Claude tab to a new Codex tab or vice versa. Returns the target tab id.',
    inputSchema: obj(
      {
        tabId: TAB_ID,
        targetProvider: { type: 'string', enum: ['claude', 'codex'] },
        keepSourceOpen: { type: 'boolean', description: 'Keep the source tab open (default true).' },
      },
      ['targetProvider'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },

  // ----- History & search --------------------------------------------------
  {
    name: 'list_sessions',
    title: 'List past sessions',
    description:
      'Past conversations. source="claui" = sessions opened in ClaUi (names, summaries, provider); ' +
      'source="disk" = every Claude Code session file on disk (also ones run in the terminal).',
    inputSchema: obj({
      source: { type: 'string', enum: ['claui', 'disk'], description: 'Default "claui".' },
      workspaceOnly: { type: 'boolean', description: 'Only sessions of this window\'s workspace (default false).' },
      query: { type: 'string', description: 'Filter by name / first prompt / summary (case-insensitive).' },
      limit: { type: 'number', minimum: 1, maximum: 500, description: 'Default 50.' },
    }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'search_conversations',
    title: 'Search conversation text',
    description: 'Full-text search across all Claude Code session files on disk. Returns matching sessions with snippets.',
    inputSchema: obj({ query: { type: 'string', minLength: 2 }, limit: { type: 'number', minimum: 1, maximum: 50 } }, ['query']),
    mutating: false,
    scope: 'instance',
  },

  // ----- Folders -----------------------------------------------------------
  {
    name: 'list_groups',
    title: 'List tab folders',
    description: 'Tab folders / sub-folders of the Sessions view, with the tabs in each.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'create_group',
    title: 'Create a tab folder',
    description: 'Create a folder (or sub-folder with parentId) for organizing tabs.',
    inputSchema: obj(
      {
        label: { type: 'string', minLength: 1 },
        parentId: { type: 'string' },
        color: { type: 'string', description: 'CSS color, e.g. "#4A9FD9".' },
      },
      ['label'],
    ),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'move_tab_to_group',
    title: 'Move a tab into a folder',
    description: 'Move a tab into a folder, or out of any folder with groupId=null.',
    inputSchema: obj({ tabId: TAB_ID, groupId: { type: ['string', 'null'] } }, ['groupId']),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'delete_group',
    title: 'Delete a tab folder',
    description: 'Delete a folder. Tabs inside are kept (moved to the parent level).',
    inputSchema: obj({ groupId: { type: 'string' } }, ['groupId']),
    mutating: true,
    destructive: true,
    scope: 'instance',
  },

  // ----- Extension-level ---------------------------------------------------
  {
    name: 'get_settings',
    title: 'Read ClaUi settings',
    description:
      'Current values of claudeMirror.* settings with their type, default, allowed values and description. ' +
      'Filter with prefix (e.g. "bridge.") or explicit keys.',
    inputSchema: obj({
      prefix: { type: 'string', description: 'Key prefix after "claudeMirror.", e.g. "secretProtection."' },
      keys: { type: 'array', items: { type: 'string' } },
    }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'update_setting',
    title: 'Change a ClaUi setting',
    description: 'Set a claudeMirror.* setting (key with or without the "claudeMirror." prefix). value=null resets to default.',
    inputSchema: obj(
      {
        key: { type: 'string' },
        value: { description: 'New value (any JSON type) or null to reset.' },
        target: { type: 'string', enum: ['global', 'workspace'], description: 'Default "global" (user settings).' },
      },
      ['key', 'value'],
    ),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'list_commands',
    title: 'List ClaUi commands',
    description: 'Every ClaUi command (claudeMirror.*) with its title, runnable via execute_command.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'execute_command',
    title: 'Run a ClaUi command',
    description:
      'Run any claudeMirror.* VS Code command, optionally with arguments (e.g. claudeMirror.openWorkstreamMap, ' +
      'claudeMirror.compactSession {sourceTabId}). Commands that open pickers wait for the user in VS Code.',
    inputSchema: obj(
      {
        command: { type: 'string' },
        args: { type: 'array', description: 'Positional arguments passed to the command.' },
      },
      ['command'],
    ),
    mutating: true,
    scope: 'instance',
  },
  {
    name: 'list_ui_actions',
    title: 'List UI actions',
    description:
      'Catalog of every chat-UI action that dispatch_ui_action accepts (about 250: dashboards, analytics, achievements, ' +
      'workstream map, secret protection, worktrees, git push, MCP panel, teams, ...), with their fields. Filter by text.',
    inputSchema: obj({
      filter: { type: 'string', description: 'Case-insensitive substring of the action type / interface name.' },
      includeEvents: { type: 'boolean', description: 'Also list the event types the UI receives (for waitForEvent).' },
    }),
    mutating: false,
    scope: 'instance',
  },
  {
    name: 'dispatch_ui_action',
    title: 'Dispatch a UI action',
    description:
      'Escape hatch covering every ClaUi feature: inject any chat-UI action into a tab exactly as if the user clicked it ' +
      '(e.g. {"type":"getProjectAnalytics"}, {"type":"setVpmEnabled","enabled":true}, {"type":"gitPush"}). ' +
      'Optionally wait for the next UI event of a given type and return it (e.g. waitForEvent "projectAnalyticsData").',
    inputSchema: obj(
      {
        tabId: TAB_ID,
        action: { type: 'object', description: 'The action object; must include "type". See list_ui_actions.', properties: { type: { type: 'string' } }, required: ['type'] },
        waitForEvent: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description: 'Event type(s) to wait for after dispatching; the first match is returned.',
        },
        timeoutSec: TIMEOUT_SEC(30),
      },
      ['action'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'get_events',
    title: 'Read the event log',
    description:
      'Events since a sequence number: UI updates (assistantMessage, processBusy, turnComplete, planApprovalRequired, costUpdate, error, ...), ' +
      'user/remote actions, and tab lifecycle (tabOpened, tabClosed, tabRenamed, tabBusyChanged). ' +
      'With waitSec it long-polls until at least one matching event arrives. Pass the returned nextSeq as sinceSeq next time.',
    inputSchema: obj({
      sinceSeq: { type: 'number', minimum: 0, description: 'Return events with seq > sinceSeq (default: only new events from now when waitSec is set, else the last `limit`).' },
      tabId: TAB_ID,
      types: { type: 'array', items: { type: 'string' }, description: 'Only these event types.' },
      direction: { type: 'string', enum: ['out', 'in', 'system'] },
      waitSec: { type: 'number', minimum: 0, maximum: 300, description: 'Long-poll up to this many seconds for new events.' },
      limit: { type: 'number', minimum: 1, maximum: 1000, description: 'Default 100.' },
    }),
    mutating: false,
    scope: 'instance',
    longRunning: true,
  },
  {
    name: 'show_notification',
    title: 'Show a VS Code notification',
    description: 'Show a notification in the VS Code window (info / warning / error), optionally with buttons; returns the clicked button.',
    inputSchema: obj(
      {
        message: { type: 'string', minLength: 1 },
        level: { type: 'string', enum: ['info', 'warning', 'error'] },
        buttons: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        timeoutSec: TIMEOUT_SEC(60),
      },
      ['message'],
    ),
    mutating: true,
    scope: 'instance',
    longRunning: true,
  },

  // ----- Local tools (served by the stdio runtime) -------------------------
  {
    name: 'list_instances',
    title: 'List ClaUi windows',
    description:
      'Every open VS Code window running ClaUi with remote control on (one per window/workspace), and which one is selected for tool calls.',
    inputSchema: obj({}),
    mutating: false,
    scope: 'local',
  },
  {
    name: 'select_instance',
    title: 'Select a ClaUi window',
    description: 'Choose which VS Code window receives subsequent tool calls, by instanceId or by workspace path / name (substring).',
    inputSchema: obj({ instance: { type: 'string', description: 'instanceId, workspace path, or workspace name.' } }, ['instance']),
    mutating: false,
    scope: 'local',
  },
  {
    name: 'open_vscode_window',
    title: 'Open a VS Code window',
    description:
      'Open a folder in a new VS Code window (requires the `code` command on PATH) and wait until its ClaUi remote control is reachable; ' +
      'the new window becomes the selected instance.',
    inputSchema: obj(
      {
        folder: { type: 'string', description: 'Absolute folder path.' },
        timeoutSec: TIMEOUT_SEC(90),
      },
      ['folder'],
    ),
    mutating: true,
    scope: 'local',
    longRunning: true,
  },
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}

/** MCP `tools/list` entry for a definition (standard MCP tool annotations included). */
export function toMcpTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: !tool.mutating,
      destructiveHint: !!tool.destructive,
      idempotentHint: !tool.mutating,
      openWorldHint: false,
    },
  };
}
