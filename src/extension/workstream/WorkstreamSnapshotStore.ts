import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { ProjectMapState, WorkstreamMapSnapshot } from '../types/workstreamTypes';

const SNAPSHOT_KEY_PREFIX = 'workstreamMap.snapshots';
const MAX_SNAPSHOTS = 20;

function snapshotKey(projectId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}.${projectId}`;
}

function hashObject(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export class WorkstreamSnapshotStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  getSnapshots(projectId: string): WorkstreamMapSnapshot[] {
    const raw = this.workspaceState.get<unknown>(snapshotKey(projectId), []);
    if (!Array.isArray(raw)) { return []; }
    return raw as WorkstreamMapSnapshot[];
  }

  getLatestSnapshot(projectId: string): WorkstreamMapSnapshot | undefined {
    const snapshots = this.getSnapshots(projectId);
    return snapshots[snapshots.length - 1];
  }

  async captureSnapshot(state: ProjectMapState): Promise<WorkstreamMapSnapshot> {
    const snapshot: WorkstreamMapSnapshot = {
      id: crypto.randomUUID(),
      projectId: state.projectId,
      createdAt: new Date().toISOString(),
      workstreamHashes: {},
      stationHashes: {},
      currentStateHash: hashObject(state.currentState),
    };

    for (const ws of state.workstreams) {
      snapshot.workstreamHashes[ws.id] = hashObject({
        status: ws.status,
        sessionIds: ws.sessionIds,
        currentState: ws.currentState,
        label: ws.label,
      });
    }

    for (const st of state.stations) {
      snapshot.stationHashes[st.id] = hashObject({
        type: st.type,
        status: st.status,
        label: st.label,
        workstreamId: st.workstreamId,
      });
    }

    const snapshots = this.getSnapshots(state.projectId);
    snapshots.push(snapshot);
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
    }
    await this.workspaceState.update(snapshotKey(state.projectId), snapshots);

    return snapshot;
  }

  diffSnapshots(
    older: WorkstreamMapSnapshot,
    newer: WorkstreamMapSnapshot
  ): {
    newWorkstreamIds: string[];
    changedWorkstreamIds: string[];
    removedWorkstreamIds: string[];
    newStationIds: string[];
    changedStationIds: string[];
    removedStationIds: string[];
    currentStateChanged: boolean;
  } {
    const newWorkstreamIds: string[] = [];
    const changedWorkstreamIds: string[] = [];
    const removedWorkstreamIds: string[] = [];
    const newStationIds: string[] = [];
    const changedStationIds: string[] = [];
    const removedStationIds: string[] = [];

    for (const id of Object.keys(newer.workstreamHashes)) {
      if (!(id in older.workstreamHashes)) {
        newWorkstreamIds.push(id);
      } else if (newer.workstreamHashes[id] !== older.workstreamHashes[id]) {
        changedWorkstreamIds.push(id);
      }
    }
    for (const id of Object.keys(older.workstreamHashes)) {
      if (!(id in newer.workstreamHashes)) {
        removedWorkstreamIds.push(id);
      }
    }

    for (const id of Object.keys(newer.stationHashes)) {
      if (!(id in older.stationHashes)) {
        newStationIds.push(id);
      } else if (newer.stationHashes[id] !== older.stationHashes[id]) {
        changedStationIds.push(id);
      }
    }
    for (const id of Object.keys(older.stationHashes)) {
      if (!(id in newer.stationHashes)) {
        removedStationIds.push(id);
      }
    }

    return {
      newWorkstreamIds,
      changedWorkstreamIds,
      removedWorkstreamIds,
      newStationIds,
      changedStationIds,
      removedStationIds,
      currentStateChanged: older.currentStateHash !== newer.currentStateHash,
    };
  }
}
