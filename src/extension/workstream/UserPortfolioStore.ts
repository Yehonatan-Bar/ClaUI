import type * as vscode from 'vscode';
import type { ProjectSummaryEntry, UserPortfolioState } from '../types/workstreamTypes';

const STORAGE_KEY = 'workstreamMap.portfolio';
const MAX_PROJECTS = 30;
const STALE_DAYS = 180;

export class UserPortfolioStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly globalState: vscode.Memento) {}

  getPortfolioState(): UserPortfolioState {
    const raw = this.globalState.get<UserPortfolioState>(STORAGE_KEY);
    if (!raw) {
      return { projects: [], crossProjectResume: null, lastUpdatedAt: new Date().toISOString() };
    }
    return raw;
  }

  getProjectSummary(projectId: string): ProjectSummaryEntry | undefined {
    const state = this.getPortfolioState();
    return state.projects.find(p => p.projectId === projectId);
  }

  async upsertProjectSummary(entry: ProjectSummaryEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = this.getPortfolioState();
      const idx = state.projects.findIndex(p => p.projectId === entry.projectId);
      if (idx >= 0) {
        state.projects[idx] = entry;
      } else {
        state.projects.push(entry);
      }

      this.pruneStaleProjects(state);
      this.enforceMaxProjects(state);

      state.lastUpdatedAt = new Date().toISOString();
      await this.globalState.update(STORAGE_KEY, state);
    });
    await this.writeQueue;
  }

  async removeProject(projectId: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = this.getPortfolioState();
      state.projects = state.projects.filter(p => p.projectId !== projectId);
      state.lastUpdatedAt = new Date().toISOString();
      await this.globalState.update(STORAGE_KEY, state);
    });
    await this.writeQueue;
  }

  async savePortfolioState(state: UserPortfolioState): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.globalState.update(STORAGE_KEY, state);
    });
    await this.writeQueue;
  }

  private pruneStaleProjects(state: UserPortfolioState): void {
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    state.projects = state.projects.filter(p => {
      const classifiedAt = new Date(p.lastClassifiedAt).getTime();
      return classifiedAt > cutoff;
    });
  }

  private enforceMaxProjects(state: UserPortfolioState): void {
    if (state.projects.length <= MAX_PROJECTS) { return; }
    state.projects.sort((a, b) =>
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
    state.projects = state.projects.slice(0, MAX_PROJECTS);
  }
}
