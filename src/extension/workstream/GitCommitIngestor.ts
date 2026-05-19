import { execSync } from 'child_process';
import * as crypto from 'crypto';
import type { EnrichedSessionData } from '../types/workstreamTypes';

const GIT_WINDOW_DAYS = 14;
const SESSION_GAP_HOURS = 4;
const MAX_GIT_SESSIONS = 10;
const COMMIT_SEPARATOR = '---GIT-COMMIT---';

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  branch?: string;
  files: string[];
}

interface CommitGroup {
  commits: GitCommit[];
  files: Set<string>;
  earliestDate: string;
  latestDate: string;
}

export class GitCommitIngestor {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  ingest(
    workspacePath: string,
    knownCommitHashes: Set<string>,
    sessionTimeWindows: Array<{ start: number; end: number }>,
    windowDays: number = GIT_WINDOW_DAYS,
  ): EnrichedSessionData[] {
    const commits = this.getRecentCommits(workspacePath, windowDays);
    if (commits.length === 0) { return []; }

    const orphans = commits.filter(c => {
      if (knownCommitHashes.has(c.hash)) { return false; }
      const commitTime = new Date(c.date).getTime();
      return !sessionTimeWindows.some(w =>
        commitTime >= w.start && commitTime <= w.end
      );
    });

    this.log(`[GitIngestor] ${commits.length} total commits, ${orphans.length} orphans (not in any ClaUi session)`);
    if (orphans.length === 0) { return []; }

    const groups = this.groupCommits(orphans);
    this.log(`[GitIngestor] Grouped into ${groups.length} synthetic sessions`);

    const sessions = groups
      .sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime())
      .slice(0, MAX_GIT_SESSIONS)
      .map(g => this.toEnrichedSession(g));

    return sessions;
  }

  private getRecentCommits(workspacePath: string, windowDays: number): GitCommit[] {
    try {
      let branch: string | undefined;
      try {
        branch = execSync('git branch --show-current', {
          cwd: workspacePath, encoding: 'utf-8', timeout: 5_000,
        }).trim() || undefined;
      } catch { /* not a git repo or no branch */ }

      const raw = execSync(
        `git log --since="${windowDays} days ago" --no-merges --format="${COMMIT_SEPARATOR}%H%x09%an%x09%aI%x09%s" --name-only`,
        { cwd: workspacePath, encoding: 'utf-8', timeout: 15_000 },
      );

      const commits = this.parseGitLog(raw);
      if (branch) {
        for (const c of commits) { c.branch = branch; }
      }
      return commits;
    } catch (e) {
      this.log(`[GitIngestor] git log failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private parseGitLog(raw: string): GitCommit[] {
    const commits: GitCommit[] = [];
    const blocks = raw.split(COMMIT_SEPARATOR).filter(b => b.trim());

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const header = lines[0]?.trim();
      if (!header) { continue; }

      const parts = header.split('\t');
      const hash = parts[0];
      const author = parts[1] ?? 'unknown';
      const date = parts[2];
      const message = parts.slice(3).join('\t');

      if (!hash || !date) { continue; }

      const files = lines.slice(1)
        .map(l => l.trim())
        .filter(l => l.length > 0);

      commits.push({ hash, author, date, message, files });
    }

    return commits;
  }

  private groupCommits(commits: GitCommit[]): CommitGroup[] {
    const sorted = [...commits].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const groups: CommitGroup[] = [];
    const assigned = new Set<string>();

    for (const commit of sorted) {
      if (assigned.has(commit.hash)) { continue; }

      let addedToGroup = false;
      for (const group of groups) {
        const latestInGroup = new Date(group.latestDate).getTime();
        const commitTime = new Date(commit.date).getTime();
        const gapHours = (commitTime - latestInGroup) / (1000 * 60 * 60);

        if (gapHours >= 0 && gapHours <= SESSION_GAP_HOURS) {
          const fileOverlap = this.computeFileOverlap(group.files, new Set(commit.files));
          if (fileOverlap > 0.2 || gapHours < 1) {
            group.commits.push(commit);
            commit.files.forEach(f => group.files.add(f));
            group.latestDate = commit.date;
            assigned.add(commit.hash);
            addedToGroup = true;
            break;
          }
        }
      }

      if (!addedToGroup) {
        groups.push({
          commits: [commit],
          files: new Set(commit.files),
          earliestDate: commit.date,
          latestDate: commit.date,
        });
        assigned.add(commit.hash);
      }
    }

    return groups.filter(g => g.commits.length > 0);
  }

  private computeFileOverlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) { return 0; }
    let intersection = 0;
    for (const f of a) {
      if (b.has(f)) { intersection++; }
    }
    return intersection / Math.min(a.size, b.size);
  }

  private toEnrichedSession(group: CommitGroup): EnrichedSessionData {
    const messages = group.commits.map(c => c.message).join('; ');
    const hashes = group.commits.map(c => c.hash.slice(0, 8)).join(', ');
    const branch = group.commits[0]?.branch;

    return {
      sessionId: `git-${crypto.randomUUID().slice(0, 12)}`,
      source: 'git_history',
      firstPrompt: messages,
      summary: `[Git commits: ${hashes}] ${messages}`,
      filesModified: [...group.files],
      filesRead: [],
      gitBranch: branch,
      gitCommit: group.commits[group.commits.length - 1].hash,
      startedAt: group.earliestDate,
      endedAt: group.latestDate,
      totalTurns: group.commits.length,
      totalCostUsd: 0,
      outcome: 'completed',
    };
  }
}
