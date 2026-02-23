/**
 * Types for `codex exec --json` JSONL output.
 *
 * The schema is intentionally permissive so unknown/new event shapes do not
 * break the Codex runtime path.
 */

export interface CodexThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
  [key: string]: unknown;
}

export interface CodexTurnStartedEvent {
  type: 'turn.started';
  [key: string]: unknown;
}

export interface CodexTurnCompletedEvent {
  type: 'turn.completed';
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CodexExecItemBase {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface CodexReasoningItem extends CodexExecItemBase {
  type: 'reasoning';
  text?: string;
}

export interface CodexAgentMessageItem extends CodexExecItemBase {
  type: 'agent_message';
  text?: string;
}

export interface CodexCommandExecutionItem extends CodexExecItemBase {
  type: 'command_execution';
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

export type CodexExecKnownItem =
  | CodexReasoningItem
  | CodexAgentMessageItem
  | CodexCommandExecutionItem
  | CodexExecItemBase;

export interface CodexItemStartedEvent {
  type: 'item.started';
  item: CodexExecKnownItem;
  [key: string]: unknown;
}

export interface CodexItemCompletedEvent {
  type: 'item.completed';
  item: CodexExecKnownItem;
  [key: string]: unknown;
}

export interface CodexUnknownJsonEvent {
  type: string;
  [key: string]: unknown;
}

export type CodexExecJsonEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnCompletedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent
  | CodexUnknownJsonEvent;

