import { spawn } from 'child_process';
import type {
  ProjectMapState,
  ResumeState,
  WorkstreamMapSnapshot,
} from '../types/workstreamTypes';
import type { WorkstreamSnapshotStore } from './WorkstreamSnapshotStore';

const RESUME_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ResumeStateBuilder {
  constructor(private readonly snapshotStore: WorkstreamSnapshotStore) {}

  shouldShowResumeView(state: ProjectMapState): boolean {
    if (!state.lastOpenedAt) { return true; }
    const elapsed = Date.now() - new Date(state.lastOpenedAt).getTime();
    return elapsed >= RESUME_THRESHOLD_MS;
  }

  async buildResumeState(
    state: ProjectMapState,
    cliPath?: string,
    workspacePath?: string,
  ): Promise<ResumeState | undefined> {
    const lastSnapshot = this.snapshotStore.getLatestSnapshot(state.projectId);
    if (!lastSnapshot) { return undefined; }

    const currentSnapshot = await this.snapshotStore.captureSnapshot(state);
    const diff = this.snapshotStore.diffSnapshots(lastSnapshot, currentSnapshot);

    if (
      diff.newWorkstreamIds.length === 0 &&
      diff.changedWorkstreamIds.length === 0 &&
      diff.newStationIds.length === 0 &&
      !diff.currentStateChanged
    ) {
      return undefined;
    }

    const resume: ResumeState = {
      since: lastSnapshot.createdAt,
      newWorkstreamIds: diff.newWorkstreamIds,
      changedWorkstreamIds: diff.changedWorkstreamIds,
      newStationIds: diff.newStationIds,
      resolvedBlockerIds: this.findResolvedBlockers(state, lastSnapshot),
      newBlockerIds: this.findNewBlockers(state, lastSnapshot),
      newlyCompletedWorkstreamIds: this.findNewlyCompleted(state, lastSnapshot),
      summary: '',
      recommendedResumeWorkstreamId: state.currentState.recommendedResumeWorkstreamId,
    };

    // If changes are non-trivial, use Sonnet for a summary
    const changeCount = resume.newWorkstreamIds.length +
      resume.changedWorkstreamIds.length +
      resume.newStationIds.length +
      resume.resolvedBlockerIds.length +
      resume.newBlockerIds.length;

    if (changeCount > 3 && cliPath && workspacePath) {
      resume.summary = await this.synthesizeResumeSummary(resume, state, cliPath, workspacePath);
    } else {
      resume.summary = this.buildLocalSummary(resume, state);
    }

    return resume;
  }

  private findResolvedBlockers(state: ProjectMapState, snapshot: WorkstreamMapSnapshot): string[] {
    const resolved: string[] = [];
    for (const ws of state.workstreams) {
      for (const b of ws.currentState.blockers) {
        if (b.resolvedAt && new Date(b.resolvedAt) > new Date(snapshot.createdAt)) {
          resolved.push(b.id);
        }
      }
    }
    return resolved;
  }

  private findNewBlockers(state: ProjectMapState, snapshot: WorkstreamMapSnapshot): string[] {
    const newBlockers: string[] = [];
    for (const ws of state.workstreams) {
      for (const b of ws.currentState.blockers) {
        if (!b.resolvedAt && new Date(b.createdAt) > new Date(snapshot.createdAt)) {
          newBlockers.push(b.id);
        }
      }
    }
    return newBlockers;
  }

  private findNewlyCompleted(state: ProjectMapState, snapshot: WorkstreamMapSnapshot): string[] {
    return state.workstreams
      .filter(ws =>
        ws.status === 'completed' &&
        ws.completedAt &&
        new Date(ws.completedAt) > new Date(snapshot.createdAt)
      )
      .map(ws => ws.id);
  }

  private buildLocalSummary(resume: ResumeState, state: ProjectMapState): string {
    const parts: string[] = [];

    if (resume.newWorkstreamIds.length > 0) {
      const labels = resume.newWorkstreamIds
        .map(id => state.workstreams.find(w => w.id === id)?.label)
        .filter(Boolean);
      parts.push(`${labels.length} new workstream${labels.length > 1 ? 's' : ''}: ${labels.join(', ')}`);
    }
    if (resume.newlyCompletedWorkstreamIds.length > 0) {
      parts.push(`${resume.newlyCompletedWorkstreamIds.length} workstream${resume.newlyCompletedWorkstreamIds.length > 1 ? 's' : ''} completed`);
    }
    if (resume.newBlockerIds.length > 0) {
      parts.push(`${resume.newBlockerIds.length} new blocker${resume.newBlockerIds.length > 1 ? 's' : ''}`);
    }
    if (resume.resolvedBlockerIds.length > 0) {
      parts.push(`${resume.resolvedBlockerIds.length} blocker${resume.resolvedBlockerIds.length > 1 ? 's' : ''} resolved`);
    }
    if (resume.changedWorkstreamIds.length > 0) {
      parts.push(`${resume.changedWorkstreamIds.length} workstream${resume.changedWorkstreamIds.length > 1 ? 's' : ''} changed`);
    }

    return parts.length > 0 ? parts.join('. ') + '.' : 'No significant changes since last visit.';
  }

  private async synthesizeResumeSummary(
    resume: ResumeState,
    state: ProjectMapState,
    cliPath: string,
    workspacePath: string,
  ): Promise<string> {
    const prompt = `Summarize these project changes since the user's last visit in 2-3 concise sentences.
Focus on: what is now blocked, what was completed, and what should be resumed.

Changes:
- New workstreams: ${resume.newWorkstreamIds.length}
- Changed workstreams: ${resume.changedWorkstreamIds.length}
- New stations: ${resume.newStationIds.length}
- New blockers: ${resume.newBlockerIds.length}
- Resolved blockers: ${resume.resolvedBlockerIds.length}
- Completed workstreams: ${resume.newlyCompletedWorkstreamIds.length}

Current project summary: ${state.currentState.summary}
Recommended resume: ${state.currentState.recommendedNextAction ?? 'none'}

Respond with ONLY the summary text, no JSON.`;

    return new Promise((resolve) => {
      const args = ['-p', prompt, '--output-format', 'text', '-m', 'sonnet'];
      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        env: { ...process.env },
        timeout: 30000,
      });

      let stdout = '';
      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });

      proc.on('close', () => {
        resolve(stdout.trim() || this.buildLocalSummary(resume, state));
      });

      proc.on('error', () => {
        resolve(this.buildLocalSummary(resume, state));
      });
    });
  }
}
