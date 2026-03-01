/**
 * File system watcher that monitors team directories for real-time updates.
 * Watches config.json, task files, and inbox files under ~/.claude/teams/ and ~/.claude/tasks/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { TeamConfig, TeamTask, InboxMessage, TeamStateSnapshot, AgentStatus } from './TeamTypes';

export class TeamWatcher extends EventEmitter {
  private teamName: string;
  private teamDir: string;
  private taskDir: string;
  private watchers: fs.FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastSnapshot: TeamStateSnapshot | null = null;
  /** Tracks which directories have active fs.watch watchers */
  private watchedDirs = new Set<string>();
  private log: (msg: string) => void;
  /**
   * Stream-detected idle agents.  Populated by SessionTab when the CLI stream
   * contains idle_notification JSON text inside assistant messages.
   * Keys are agent names, values are the timestamp (ms) when the idle was detected.
   */
  private streamIdleAgents = new Map<string, number>();

  constructor(teamName: string, log?: (msg: string) => void) {
    super();
    this.teamName = teamName;
    this.log = log || (() => {});

    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    this.teamDir = path.join(homeDir, '.claude', 'teams', teamName);
    this.taskDir = path.join(homeDir, '.claude', 'tasks', teamName);
  }

  /** Start watching for team file changes */
  start(): void {
    this.log(`[TeamWatcher] Starting watch for team "${this.teamName}"`);
    this.log(`[TeamWatcher] Team dir: ${this.teamDir}`);
    this.log(`[TeamWatcher] Task dir: ${this.taskDir}`);

    // Initial read
    this.emitSnapshot();

    // Set up fs.watch on directories (with polling fallback for Windows)
    this.watchDirectory(this.teamDir);
    this.watchDirectory(this.taskDir);

    // Also watch inboxes subdirectory
    const inboxDir = path.join(this.teamDir, 'inboxes');
    this.watchDirectory(inboxDir);

    // Polling fallback: check every N ms in case fs.watch misses events.
    // Also retries watchDirectory for dirs that didn't exist at startup.
    this.pollTimer = setInterval(() => {
      if (!this.disposed) {
        this.retryWatchDirectories();
        this.emitSnapshot();
      }
    }, 2000);
  }

  /** Stop watching and clean up */
  dispose(): void {
    this.disposed = true;
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
    this.watchedDirs.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Record that an agent sent an idle_notification through the CLI stream.
   * Called by SessionTab when it detects idle_notification JSON text in
   * assistant message content.  This serves as a backup mechanism in case
   * the file-based inbox reading misses the notification (e.g. file locks).
   */
  markAgentIdle(agentName: string): void {
    this.streamIdleAgents.set(agentName, Date.now());
    this.log(`[TeamWatcher] Stream idle detected for "${agentName}"`);
    // Force a fresh snapshot so the UI updates immediately
    this.debouncedEmit();
  }

  /**
   * Record that an agent is working (sent a non-idle message through the stream).
   * Clears any previous stream-idle marker for this agent.
   */
  markAgentWorking(agentName: string): void {
    if (this.streamIdleAgents.has(agentName)) {
      this.streamIdleAgents.delete(agentName);
      this.log(`[TeamWatcher] Stream idle cleared for "${agentName}" (now working)`);
    }
  }

  /**
   * Attempt to set up an fs.watch watcher for dirPath.
   * Skips silently if the directory does not exist yet (will be retried by the poll timer).
   * Skips if already watching this directory.
   */
  private watchDirectory(dirPath: string): void {
    if (this.watchedDirs.has(dirPath)) return;
    try {
      if (!fs.existsSync(dirPath)) {
        this.log(`[TeamWatcher] Directory does not exist yet: ${dirPath}`);
        return;
      }
      const watcher = fs.watch(dirPath, { recursive: true }, () => {
        this.debouncedEmit();
      });
      this.watchers.push(watcher);
      this.watchedDirs.add(dirPath);
      this.log(`[TeamWatcher] Watching directory: ${dirPath}`);
    } catch (err) {
      this.log(`[TeamWatcher] Failed to watch ${dirPath}: ${err}`);
    }
  }

  /** Try to set up watchers for any directories that now exist but weren't watched at startup. */
  private retryWatchDirectories(): void {
    const dirsToWatch = [
      this.teamDir,
      this.taskDir,
      path.join(this.teamDir, 'inboxes'),
    ];
    for (const dir of dirsToWatch) {
      this.watchDirectory(dir);
    }
  }

  private debouncedEmit(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      if (!this.disposed) {
        this.emitSnapshot();
      }
    }, 100);
  }

  private emitSnapshot(): void {
    try {
      const snapshot = this.buildSnapshot();
      if (!snapshot) return;

      // Only emit if something changed
      const serialized = JSON.stringify(snapshot);
      const lastSerialized = this.lastSnapshot ? JSON.stringify(this.lastSnapshot) : '';
      if (serialized === lastSerialized) return;

      this.lastSnapshot = snapshot;
      this.emit('stateChange', snapshot);
    } catch (err) {
      this.log(`[TeamWatcher] Error building snapshot: ${err}`);
    }
  }

  private buildSnapshot(): TeamStateSnapshot | null {
    // Read config
    const config = this.readConfig();
    if (!config) return null;

    // Read tasks
    const tasks = this.readTasks();

    // Read messages
    const messages = this.readInboxMessages();

    // Derive agent statuses from tasks, inbox messages, and stream-detected idles
    const agentStatuses = this.deriveAgentStatuses(config, tasks, messages);

    return {
      teamName: this.teamName,
      config,
      tasks,
      agentStatuses,
      recentMessages: messages,
      lastUpdatedAt: Date.now(),
    };
  }

  private readConfig(): TeamConfig | null {
    const configPath = path.join(this.teamDir, 'config.json');
    try {
      if (!fs.existsSync(configPath)) return null;
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as TeamConfig;
    } catch (err) {
      this.log(`[TeamWatcher] Failed to read config: ${err}`);
      return null;
    }
  }

  private readTasks(): TeamTask[] {
    const tasks: TeamTask[] = [];
    try {
      if (!fs.existsSync(this.taskDir)) return tasks;
      const files = fs.readdirSync(this.taskDir);
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'highwatermark.json') continue;
        try {
          const raw = fs.readFileSync(path.join(this.taskDir, file), 'utf-8');
          const task = JSON.parse(raw) as TeamTask;
          tasks.push(task);
        } catch { /* skip unreadable files */ }
      }
    } catch { /* directory may not exist yet */ }
    // Sort by numeric id (handle string ids from Claude Code)
    return tasks.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
  }

  private readInboxMessages(): InboxMessage[] {
    const messages: InboxMessage[] = [];
    const inboxDir = path.join(this.teamDir, 'inboxes');
    try {
      if (!fs.existsSync(inboxDir)) {
        this.log(`[TeamWatcher] Inbox dir does not exist: ${inboxDir}`);
        return messages;
      }
      const entries = fs.readdirSync(inboxDir);
      this.log(`[TeamWatcher][readInbox] entries: ${JSON.stringify(entries)}`);
      for (const entry of entries) {
        const entryPath = path.join(inboxDir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(entryPath);
        } catch (err) {
          this.log(`[TeamWatcher][readInbox] stat failed for ${entry}: ${err}`);
          continue;
        }
        if (stat.isDirectory()) {
          const files = fs.readdirSync(entryPath);
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
              const raw = fs.readFileSync(path.join(entryPath, file), 'utf-8');
              const msg = JSON.parse(raw) as InboxMessage;
              messages.push(msg);
            } catch { /* skip */ }
          }
        } else if (entryPath.endsWith('.json')) {
          // Claude Code uses flat JSON files (e.g. inboxes/team-lead.json = array of messages)
          try {
            const raw = fs.readFileSync(entryPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              this.log(`[TeamWatcher][readInbox] ${entry}: array with ${parsed.length} messages`);
              messages.push(...(parsed as InboxMessage[]));
            } else {
              messages.push(parsed as InboxMessage);
            }
          } catch (err) {
            this.log(`[TeamWatcher][readInbox] Failed to read ${entry}: ${err}`);
          }
        }
      }
    } catch (err) {
      this.log(`[TeamWatcher][readInbox] Error reading inbox dir: ${err}`);
    }
    const toMs = (ts: string | number | undefined) =>
      ts ? (typeof ts === 'string' ? new Date(ts).getTime() : ts) : 0;
    return messages.sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp)).slice(-100);
  }

  /**
   * Determine the idle_notification type from a message, checking:
   * 1. Top-level `type` field
   * 2. JSON embedded in the `text` field
   */
  private getMessageType(msg: InboxMessage): string | undefined {
    // Check top-level type
    if (msg.type) return msg.type;
    // Check JSON embedded in text
    if (msg.text) {
      try {
        const inner = JSON.parse(msg.text);
        if (inner && typeof inner === 'object' && typeof inner.type === 'string') {
          return inner.type;
        }
      } catch { /* text is plain string */ }
    }
    return undefined;
  }

  private deriveAgentStatuses(config: TeamConfig, tasks: TeamTask[], messages: InboxMessage[]): Record<string, AgentStatus> {
    const toMs = (ts: string | number | undefined) =>
      ts ? (typeof ts === 'string' ? new Date(ts).getTime() : ts) : 0;

    const statuses: Record<string, AgentStatus> = {};
    for (const member of config.members) {
      // Default to idle
      let status: AgentStatus = 'idle';
      let reason = 'default';

      // Claude Code writes internal tasks where `subject` = agent name and `owner` is absent.
      // Support both formats: explicit `owner` field (user-created tasks) and `subject`-as-name (internal tasks).
      const ownedTasks = tasks.filter(t =>
        t.owner === member.name ||
        (!t.owner && t.subject === member.name)
      );
      const hasInProgress = ownedTasks.some(t => t.status === 'in_progress');
      const hasBlocked = ownedTasks.some(t => t.status === 'blocked');

      if (hasInProgress) {
        status = 'working';
        reason = 'in_progress_task';
      } else if (hasBlocked) {
        status = 'blocked';
        reason = 'blocked_task';
      }

      // Layer 1: Override with idle if the agent's most recent inbox message is an idle_notification.
      // Claude Code embeds the notification as JSON inside the text field of a plain envelope.
      const agentMessages = messages
        .filter(m => m.from === member.name)
        .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
      const latestMsg = agentMessages[agentMessages.length - 1];
      let latestMsgType: string | undefined;
      if (latestMsg) {
        latestMsgType = this.getMessageType(latestMsg);
        if (latestMsgType === 'idle_notification') {
          status = 'idle';
          reason = 'inbox_idle_notification';
        }
      }

      // Layer 2: Stream-based idle detection (backup).
      // If the CLI stream contained an idle_notification for this agent, override to idle.
      if (status !== 'idle' && this.streamIdleAgents.has(member.name)) {
        status = 'idle';
        reason = 'stream_idle_notification';
      }

      // Layer 3: If an internal task is in_progress but the agent has sent a completion
      // message (any non-idle message after the task was created), treat as idle.
      // Internal tasks (metadata._internal) often stay in_progress after agent completes.
      if (status === 'working' && agentMessages.length > 0 && latestMsgType !== 'idle_notification') {
        // Check if any owned task is an internal one that might be stale
        const hasOnlyInternalTasks = ownedTasks
          .filter(t => t.status === 'in_progress')
          .every(t => {
            const meta = (t as unknown as { metadata?: { _internal?: boolean } }).metadata;
            return meta && meta._internal;
          });
        if (hasOnlyInternalTasks && agentMessages.length >= 1) {
          // Agent has sent messages but internal task still says in_progress.
          // Check if the latest message looks like a completion (not a status update).
          const latestText = latestMsg?.text || '';
          // If the agent sent ANY message (other than a system notification), and
          // the internal task is still in_progress, the task is likely stale.
          if (latestText.length > 0) {
            status = 'idle';
            reason = 'stale_internal_task';
          }
        }
      }

      this.log(`[TeamWatcher][status] "${member.name}": tasks=${ownedTasks.length}/${tasks.length} inProgress=${hasInProgress} msgs=${agentMessages.length} latestType="${latestMsgType || 'none'}" streamIdle=${this.streamIdleAgents.has(member.name)} => ${status} (${reason})`);

      statuses[member.name] = status;
    }
    return statuses;
  }
}
