import type { Workstream, Station, WorkstreamStatus } from '../types/workstreamTypes';

const STATUS_WEIGHTS: Record<WorkstreamStatus, number> = {
  blocked: 1.0,
  active: 0.8,
  uncertain: 0.6,
  research: 0.5,
  planning: 0.4,
  completed: 0.2,
  abandoned: 0.1,
};

const RECENCY_DECAY_HOURS = 72;

export class WorkstreamImportanceScorer {
  scoreWorkstream(ws: Workstream, now: number = Date.now()): number {
    const statusWeight = STATUS_WEIGHTS[ws.status] ?? 0.5;
    const recencyScore = this.computeRecency(ws.lastActivityAt, now);
    const volumeScore = Math.min(ws.metrics.totalSessions / 10, 1.0);
    const blockerBoost = ws.currentState.blockers.length > 0 ? 0.2 : 0;
    const decisionBoost = ws.currentState.pendingDecisions.length > 0 ? 0.1 : 0;
    const pinBoost = ws.userPinned ? 0.3 : 0;

    return Math.min(
      statusWeight * 0.35 +
      recencyScore * 0.25 +
      volumeScore * 0.15 +
      blockerBoost +
      decisionBoost +
      pinBoost,
      1.0,
    );
  }

  scoreAttention(ws: Workstream, now: number = Date.now()): number {
    let attention = 0;

    if (ws.status === 'blocked') { attention += 0.4; }
    if (ws.currentState.blockers.some(b => !b.resolvedAt)) { attention += 0.3; }
    if (ws.currentState.pendingDecisions.length > 0) { attention += 0.2; }
    if (ws.confidence < 0.5) { attention += 0.1; }

    const recency = this.computeRecency(ws.lastActivityAt, now);
    if (recency > 0.8 && ws.status === 'active') { attention += 0.2; }

    return Math.min(attention, 1.0);
  }

  scoreStation(station: Station, now: number = Date.now()): number {
    const typeWeights: Record<string, number> = {
      milestone: 0.9,
      blocker: 0.85,
      failure: 0.8,
      decision: 0.75,
      direction_change: 0.7,
      split_point: 0.7,
      merge_point: 0.7,
      problem: 0.6,
      code_change: 0.5,
      session: 0.3,
      uncertainty: 0.4,
      plan_step: 0.35,
    };

    const typeWeight = typeWeights[station.type] ?? 0.5;
    const recency = this.computeRecency(station.timestamp, now);
    const statusBoost = station.status === 'failed' ? 0.2 : station.status === 'pending' ? 0.1 : 0;

    return Math.min(typeWeight * 0.5 + recency * 0.3 + statusBoost + (station.attentionScore * 0.1), 1.0);
  }

  shouldShowInProjectMap(station: Station): boolean {
    return station.importanceScore >= 0.5 ||
      station.type === 'milestone' ||
      station.type === 'blocker' ||
      station.type === 'failure' ||
      station.type === 'split_point' ||
      station.type === 'merge_point';
  }

  recommendResumeWorkstream(workstreams: Workstream[]): string | undefined {
    const candidates = workstreams
      .filter(ws => ws.status === 'active' || ws.status === 'blocked')
      .sort((a, b) => {
        if (a.status === 'blocked' && b.status !== 'blocked') { return -1; }
        if (a.status !== 'blocked' && b.status === 'blocked') { return 1; }
        return b.importanceScore - a.importanceScore;
      });

    return candidates[0]?.id;
  }

  private computeRecency(isoDate: string, now: number): number {
    const age = now - new Date(isoDate).getTime();
    const hoursAgo = age / (1000 * 60 * 60);
    return Math.max(0, 1 - hoursAgo / RECENCY_DECAY_HOURS);
  }
}
