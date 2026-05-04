import * as vscode from 'vscode';
import type {
  ProjectMapState,
  Workstream,
  Station,
  UserEdit,
  CURRENT_SCHEMA_VERSION,
} from '../types/workstreamTypes';

const KEY_PREFIX = 'workstreamMap';
const MAX_ACTIVE_WORKSTREAMS = 50;
const MAX_ACTIVE_STATIONS = 500;
const ARCHIVE_AFTER_DAYS = 90;
const SCHEMA_VERSION = 1;

function currentKey(projectId: string): string {
  return `${KEY_PREFIX}.current.${projectId}`;
}

function archivedKey(projectId: string): string {
  return `${KEY_PREFIX}.archived.${projectId}`;
}

export class WorkstreamStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly workspaceState: vscode.Memento) {}

  private enqueueWrite(op: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(op, op);
    return this.writeQueue;
  }

  getProjectMapState(projectId: string): ProjectMapState | null {
    const raw = this.workspaceState.get<unknown>(currentKey(projectId));
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const state = raw as ProjectMapState;
    if (!state.projectId || !state.workstreams) {
      return null;
    }
    return this.migrate(state);
  }

  async saveProjectMapState(state: ProjectMapState): Promise<void> {
    await this.enqueueWrite(async () => {
      state.schemaVersion = SCHEMA_VERSION;
      await this.workspaceState.update(currentKey(state.projectId), state);
    });
  }

  async applyUserEdit(projectId: string, edit: UserEdit): Promise<ProjectMapState | null> {
    return await new Promise<ProjectMapState | null>((resolve) => {
      this.enqueueWrite(async () => {
        const state = this.getProjectMapState(projectId);
        if (!state) {
          resolve(null);
          return;
        }
        state.userEdits.push(edit);
        await this.workspaceState.update(currentKey(projectId), state);
        resolve(state);
      });
    });
  }

  async archiveWorkstream(projectId: string, workstreamId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const state = this.getProjectMapState(projectId);
      if (!state) { return; }

      const wsIndex = state.workstreams.findIndex(w => w.id === workstreamId);
      if (wsIndex < 0) { return; }

      const ws = state.workstreams[wsIndex];

      // Never auto-archive blocked or pinned workstreams
      if (ws.status === 'blocked' || ws.userPinned) { return; }

      state.workstreams.splice(wsIndex, 1);
      if (!state.archivedWorkstreamIds.includes(workstreamId)) {
        state.archivedWorkstreamIds.push(workstreamId);
      }

      // Store archived workstream data separately
      const archivedList = this.getArchivedWorkstreams(projectId);
      archivedList.push(ws);
      await this.workspaceState.update(archivedKey(projectId), archivedList);
      await this.workspaceState.update(currentKey(projectId), state);
    });
  }

  getArchivedWorkstreams(projectId: string): Workstream[] {
    const raw = this.workspaceState.get<unknown>(archivedKey(projectId), []);
    if (!Array.isArray(raw)) { return []; }
    return raw as Workstream[];
  }

  async autoArchiveStaleWorkstreams(projectId: string): Promise<void> {
    const state = this.getProjectMapState(projectId);
    if (!state) { return; }

    const cutoff = Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;

    for (const ws of [...state.workstreams]) {
      if (ws.status !== 'completed') { continue; }
      if (ws.userPinned) { continue; }
      if (!ws.completedAt) { continue; }

      const completedTime = new Date(ws.completedAt).getTime();
      if (completedTime < cutoff) {
        await this.archiveWorkstream(projectId, ws.id);
      }
    }
  }

  enforceCapLimits(state: ProjectMapState): ProjectMapState {
    if (state.workstreams.length > MAX_ACTIVE_WORKSTREAMS) {
      const sorted = [...state.workstreams].sort((a, b) => {
        if (a.userPinned && !b.userPinned) { return -1; }
        if (!a.userPinned && b.userPinned) { return 1; }
        if (a.status === 'blocked' && b.status !== 'blocked') { return -1; }
        if (a.status !== 'blocked' && b.status === 'blocked') { return 1; }
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });
      state.workstreams = sorted.slice(0, MAX_ACTIVE_WORKSTREAMS);
    }

    if (state.stations.length > MAX_ACTIVE_STATIONS) {
      const sorted = [...state.stations].sort((a, b) => {
        return b.importanceScore - a.importanceScore;
      });
      state.stations = sorted.slice(0, MAX_ACTIVE_STATIONS);
    }

    return state;
  }

  async clearAll(projectId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.workspaceState.update(currentKey(projectId), undefined);
      await this.workspaceState.update(archivedKey(projectId), undefined);
    });
  }

  async waitForPendingWrites(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
  }

  private migrate(state: ProjectMapState): ProjectMapState {
    if (!state.schemaVersion || state.schemaVersion < SCHEMA_VERSION) {
      state.schemaVersion = SCHEMA_VERSION;
      state.modelRunLog = state.modelRunLog ?? [];
      state.archivedWorkstreamIds = state.archivedWorkstreamIds ?? [];
      state.userEdits = state.userEdits ?? [];
    }
    return state;
  }
}
