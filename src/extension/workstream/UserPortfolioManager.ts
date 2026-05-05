import * as fs from 'fs';
import type {
  CrossProjectResumeRecommendation,
  ProjectHealth,
  ProjectMapState,
  ProjectSummaryEntry,
  ProjectWorkstreamSummary,
  UserPortfolioState,
  WorkstreamStatus,
} from '../types/workstreamTypes';
import { WORKSTREAM_STATUS_COLORS } from '../types/workstreamTypes';
import { UserPortfolioStore } from './UserPortfolioStore';

const RECENT_ACTIVITY_DAYS = 7;
const NEEDS_ATTENTION_DAYS = 21;
const RESUME_CANDIDATE_DAYS = 30;

export class UserPortfolioManager {
  private readonly store: UserPortfolioStore;

  constructor(globalState: import('vscode').Memento) {
    this.store = new UserPortfolioStore(globalState);
  }

  async getPortfolioState(): Promise<UserPortfolioState> {
    const state = this.store.getPortfolioState();
    for (const project of state.projects) {
      try {
        project.pathExists = fs.existsSync(project.projectPath);
      } catch {
        project.pathExists = false;
      }
    }
    state.crossProjectResume = this.computeCrossProjectResume(
      state.projects.filter(p => p.pathExists !== false),
    );
    return state;
  }

  async publishProjectSummary(projectId: string, mapState: ProjectMapState): Promise<void> {
    const entry = this.buildProjectSummary(projectId, mapState);
    await this.store.upsertProjectSummary(entry);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.store.removeProject(projectId);
  }

  computeCrossProjectResume(projects?: ProjectSummaryEntry[]): CrossProjectResumeRecommendation | null {
    const all = projects ?? this.store.getPortfolioState().projects;
    const cutoff = Date.now() - RESUME_CANDIDATE_DAYS * 24 * 60 * 60 * 1000;

    const candidates = all.filter(p =>
      new Date(p.lastActivityAt).getTime() > cutoff
    );

    if (candidates.length === 0) { return null; }

    // Priority 1: projects with blocked workstreams
    const blocked = candidates.filter(p => p.blockedWorkstreams > 0);
    // Priority 2: projects with active workstreams and recent activity
    const active = candidates.filter(p => p.activeWorkstreams > 0);

    const pick = blocked.length > 0
      ? blocked.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())[0]
      : active.length > 0
        ? active.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())[0]
        : candidates.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())[0];

    if (!pick) { return null; }

    const topWs = pick.topWorkstreams[0];
    if (!topWs) {
      return {
        projectId: pick.projectId,
        projectName: pick.projectName,
        workstreamId: '',
        workstreamLabel: '',
        reason: pick.blockedWorkstreams > 0 ? 'Has blocked workstreams' : 'Most recent active project',
        confidence: 0.6,
      };
    }

    const reason = pick.blockedWorkstreams > 0
      ? `${pick.blockedWorkstreams} blocked workstream${pick.blockedWorkstreams > 1 ? 's' : ''} need attention`
      : pick.overallHealth === 'needs_attention'
        ? 'Needs attention'
        : 'Most recent active work';

    return {
      projectId: pick.projectId,
      projectName: pick.projectName,
      workstreamId: topWs.id,
      workstreamLabel: topWs.label,
      reason,
      confidence: 0.7,
    };
  }

  private buildProjectSummary(projectId: string, mapState: ProjectMapState): ProjectSummaryEntry {
    const ws = mapState.workstreams;
    const now = new Date().toISOString();

    const statusCounts = {
      active: 0,
      blocked: 0,
      completed: 0,
      uncertain: 0,
    };
    for (const w of ws) {
      if (w.status === 'active') { statusCounts.active++; }
      else if (w.status === 'blocked') { statusCounts.blocked++; }
      else if (w.status === 'completed') { statusCounts.completed++; }
      else if (w.status === 'uncertain') { statusCounts.uncertain++; }
    }

    const topWorkstreams = this.pickTopWorkstreams(ws, mapState);

    const lastActivityAt = ws.length > 0
      ? ws.reduce((latest, w) =>
          new Date(w.lastActivityAt) > new Date(latest) ? w.lastActivityAt : latest,
        ws[0].lastActivityAt)
      : now;

    const totalSessions = ws.reduce((sum, w) => sum + w.metrics.totalSessions, 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentSessions = ws.reduce((sum, w) => {
      if (new Date(w.lastActivityAt).getTime() > sevenDaysAgo) {
        return sum + w.metrics.totalSessions;
      }
      return sum;
    }, 0);

    const { health, reasons } = this.computeHealth(statusCounts, lastActivityAt);

    const openBlockerCount = ws.reduce((sum, w) =>
      sum + w.currentState.blockers.filter(b => !b.resolvedAt).length, 0);

    return {
      projectId,
      projectPath: mapState.workspacePath,
      projectName: mapState.projectLabel,
      lastActivityAt,
      lastClassifiedAt: mapState.lastClassifiedAt,
      lastOpenedAt: mapState.lastOpenedAt ?? now,
      activeWorkstreams: statusCounts.active,
      blockedWorkstreams: statusCounts.blocked,
      completedWorkstreams: statusCounts.completed,
      uncertainWorkstreams: statusCounts.uncertain,
      totalWorkstreams: ws.length,
      topWorkstreams,
      overallHealth: health,
      healthReasons: reasons,
      totalSessions,
      recentSessions,
      currentStateSummary: mapState.currentState.summary,
      recommendedNextAction: mapState.currentState.recommendedNextAction ?? '',
      openBlockerCount,
      cachedMapState: mapState,
    };
  }

  private pickTopWorkstreams(
    workstreams: ProjectMapState['workstreams'],
    mapState: ProjectMapState,
  ): ProjectWorkstreamSummary[] {
    const priorityOrder: WorkstreamStatus[] = ['blocked', 'active', 'uncertain', 'research', 'planning'];
    const sorted = [...workstreams].sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a.status);
      const bIdx = priorityOrder.indexOf(b.status);
      const aPri = aIdx >= 0 ? aIdx : 99;
      const bPri = bIdx >= 0 ? bIdx : 99;
      if (aPri !== bPri) { return aPri - bPri; }
      return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    });

    return sorted.slice(0, 3).map(w => ({
      id: w.id,
      label: w.label,
      status: w.status,
      confidence: w.confidence,
      lastActivityAt: w.lastActivityAt,
      phase: w.currentState.phase,
      colorToken: w.visual.colorToken || WORKSTREAM_STATUS_COLORS[w.status] || '#9CA3AF',
      stationCount: mapState.stations.filter(s => s.workstreamId === w.id).length,
    }));
  }

  private computeHealth(
    counts: { active: number; blocked: number; completed: number; uncertain: number },
    lastActivityAt: string,
  ): { health: ProjectHealth; reasons: string[] } {
    const reasons: string[] = [];
    const daysSinceActivity = (Date.now() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000);

    if (counts.blocked > 0) {
      reasons.push(`${counts.blocked} blocked workstream${counts.blocked > 1 ? 's' : ''}`);
      return { health: 'blocked', reasons };
    }

    if (daysSinceActivity >= NEEDS_ATTENTION_DAYS) {
      reasons.push(`No activity in ${Math.floor(daysSinceActivity)} days`);
      return { health: 'stale', reasons };
    }

    if (counts.uncertain > 0 || daysSinceActivity >= RECENT_ACTIVITY_DAYS) {
      if (counts.uncertain > 0) { reasons.push(`${counts.uncertain} uncertain workstream${counts.uncertain > 1 ? 's' : ''}`); }
      if (daysSinceActivity >= RECENT_ACTIVITY_DAYS) { reasons.push(`Last activity ${Math.floor(daysSinceActivity)} days ago`); }
      return { health: 'needs_attention', reasons };
    }

    reasons.push('All workstreams on track');
    return { health: 'healthy', reasons };
  }
}
