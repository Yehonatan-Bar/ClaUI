/**
 * Type definitions for Agent Teams data structures.
 * These mirror the on-disk JSON format used by Claude Code's team system.
 */

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'shutdown';

export interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  color?: string;
}

export interface TeamConfig {
  name: string;
  description?: string;
  members: TeamMember[];
}

export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface TeamTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  status: TeamTaskStatus;
  blockedBy?: number[];
  blocks?: number[];
}

export interface InboxMessage {
  from: string;
  to?: string;
  text: string;
  // Claude Code writes ISO string timestamps; older messages may use numeric ms.
  timestamp: string | number;
  read?: boolean;
  type?: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_request' | 'plan_approval_response' | 'idle_notification';
  summary?: string;
}

export interface TeamStateSnapshot {
  teamName: string;
  config: TeamConfig;
  tasks: TeamTask[];
  agentStatuses: Record<string, AgentStatus>;
  recentMessages: InboxMessage[];
  lastUpdatedAt: number;
}
