import type * as vscode from 'vscode';

const STORAGE_KEY = 'claudeMirror.achievements.profile';

export interface AchievementCounters {
  bugFixes: number;
  testPasses: number;
  sessionsCompleted: number;
}

export interface AchievementProfile {
  totalXp: number;
  level: number;
  unlockedIds: string[];
  counters: AchievementCounters;
}

export const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1850, 2350, 2900];

function defaultProfile(): AchievementProfile {
  return {
    totalXp: 0,
    level: 1,
    unlockedIds: [],
    counters: {
      bugFixes: 0,
      testPasses: 0,
      sessionsCompleted: 0,
    },
  };
}

export function levelFromXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
    }
  }
  return level;
}

export class AchievementStore {
  constructor(private readonly globalState: vscode.Memento) {}

  getProfile(): AchievementProfile {
    const raw = this.globalState.get<AchievementProfile | null>(STORAGE_KEY, null);
    if (!raw) {
      return defaultProfile();
    }

    return {
      totalXp: raw.totalXp || 0,
      level: raw.level || 1,
      unlockedIds: Array.isArray(raw.unlockedIds) ? raw.unlockedIds : [],
      counters: {
        bugFixes: raw.counters?.bugFixes || 0,
        testPasses: raw.counters?.testPasses || 0,
        sessionsCompleted: raw.counters?.sessionsCompleted || 0,
      },
    };
  }

  async saveProfile(profile: AchievementProfile): Promise<void> {
    await this.globalState.update(STORAGE_KEY, profile);
  }
}
