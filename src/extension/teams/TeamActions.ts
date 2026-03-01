/**
 * Handles user-initiated team operations by writing to team files.
 * These actions are triggered from the webview UI.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TeamTask } from './TeamTypes';

export class TeamActions {
  private teamDir: string;
  private taskDir: string;
  private log: (msg: string) => void;

  constructor(teamName: string, log?: (msg: string) => void) {
    this.log = log || (() => {});
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    this.teamDir = path.join(homeDir, '.claude', 'teams', teamName);
    this.taskDir = path.join(homeDir, '.claude', 'tasks', teamName);
  }

  /** Send a message to a specific agent's inbox */
  sendMessage(agentName: string, content: string): void {
    this.log(`[TeamActions] Sending message to ${agentName}`);
    const inboxDir = path.join(this.teamDir, 'inboxes', agentName);
    fs.mkdirSync(inboxDir, { recursive: true });

    const msg = {
      from: 'user',
      to: agentName,
      text: content,
      timestamp: Date.now(),
      type: 'message',
    };

    const filename = `user-${Date.now()}.json`;
    fs.writeFileSync(path.join(inboxDir, filename), JSON.stringify(msg, null, 2), 'utf-8');
  }

  /** Create a new task in the task directory */
  createTask(task: Omit<TeamTask, 'id'>): void {
    this.log(`[TeamActions] Creating task: ${task.subject}`);
    fs.mkdirSync(this.taskDir, { recursive: true });

    // Read highwatermark for next task ID
    const hwmPath = path.join(this.taskDir, 'highwatermark.json');
    let nextId = 1;
    try {
      if (fs.existsSync(hwmPath)) {
        const raw = JSON.parse(fs.readFileSync(hwmPath, 'utf-8'));
        nextId = (raw.value ?? 0) + 1;
      }
    } catch { /* start at 1 */ }

    const fullTask: TeamTask = { ...task, id: nextId };
    const taskPath = path.join(this.taskDir, `${nextId}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(fullTask, null, 2), 'utf-8');

    // Update highwatermark
    fs.writeFileSync(hwmPath, JSON.stringify({ value: nextId }), 'utf-8');
  }

  /** Update an existing task */
  updateTask(taskId: number, updates: Partial<TeamTask>): void {
    this.log(`[TeamActions] Updating task #${taskId}`);
    const taskPath = path.join(this.taskDir, `${taskId}.json`);

    try {
      const raw = fs.readFileSync(taskPath, 'utf-8');
      const task = JSON.parse(raw) as TeamTask;
      const updated = { ...task, ...updates, id: taskId };
      fs.writeFileSync(taskPath, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (err) {
      this.log(`[TeamActions] Failed to update task #${taskId}: ${err}`);
    }
  }

  /** Send a shutdown request to an agent */
  shutdownAgent(agentName: string): void {
    this.log(`[TeamActions] Requesting shutdown for ${agentName}`);
    const inboxDir = path.join(this.teamDir, 'inboxes', agentName);
    fs.mkdirSync(inboxDir, { recursive: true });

    const msg = {
      from: 'user',
      to: agentName,
      text: 'User requested shutdown from ClaUi',
      timestamp: Date.now(),
      type: 'shutdown_request',
    };

    const filename = `shutdown-${Date.now()}.json`;
    fs.writeFileSync(path.join(inboxDir, filename), JSON.stringify(msg, null, 2), 'utf-8');
  }
}
