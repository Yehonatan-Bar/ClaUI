import * as vscode from 'vscode';
import type {
  AchievementAwardPayload,
  AchievementGoalPayload,
  AchievementProfilePayload,
  ExtensionToWebviewMessage,
  SessionRecapPayload,
} from '../types/webview-messages';
import { getAchievementDefinition } from './AchievementCatalog';
import { AchievementEngine, type AchievementAward } from './AchievementEngine';
import { AchievementStore, levelFromXp, type AchievementProfile } from './AchievementStore';
import type { AchievementInsightAnalyzer } from './AchievementInsightAnalyzer';
import type { GitHubSyncService, ShareableProfile } from './GitHubSyncService';

type WebviewSender = (msg: ExtensionToWebviewMessage) => void;

/** Helper to create an AchievementAward from a catalog definition */
function awardFromDef(def: ReturnType<typeof getAchievementDefinition>): AchievementAward | null {
  if (!def) return null;
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    rarity: def.rarity,
    category: def.category,
    xp: def.xp,
    hidden: def.hidden,
  };
}

export class AchievementService {
  private readonly store: AchievementStore;
  private readonly engine = new AchievementEngine();
  private readonly senders = new Map<string, WebviewSender>();
  private profile: AchievementProfile;
  private readonly sessionAwards = new Map<string, string[]>();
  private readonly sessionXp = new Map<string, number>();
  private readonly lastCrashAt = new Map<string, number>();
  private insightAnalyzer: AchievementInsightAnalyzer | null = null;
  private syncService: GitHubSyncService | null = null;

  constructor(globalState: vscode.Memento, private readonly log: (msg: string) => void) {
    this.store = new AchievementStore(globalState);
    this.profile = this.store.getProfile();
  }

  setInsightAnalyzer(analyzer: AchievementInsightAnalyzer): void {
    this.insightAnalyzer = analyzer;
  }

  setSyncService(service: GitHubSyncService): void {
    this.syncService = service;
  }

  getSyncService(): GitHubSyncService | null {
    return this.syncService;
  }

  /** Build a ShareableProfile from the current achievement state */
  getCurrentProfile(): ShareableProfile | null {
    if (!this.syncService?.isConnected()) return null;
    return {
      version: 1,
      username: this.syncService.getUsername(),
      displayName: this.syncService.getDisplayName(),
      avatarUrl: this.syncService.getAvatarUrl(),
      lastUpdated: new Date().toISOString(),
      totalXp: this.profile.totalXp,
      level: this.profile.level,
      unlockedIds: [...this.profile.unlockedIds],
      stats: {
        sessionsCompleted: this.profile.counters.sessionsCompleted,
        totalSessionMinutes: this.profile.counters.totalSessionMinutes,
        bugFixes: this.profile.counters.bugFixes,
        testPasses: this.profile.counters.testPasses,
        consecutiveDays: this.profile.counters.consecutiveDays,
        totalEdits: this.profile.counters.totalEdits,
      },
    };
  }

  registerTab(tabId: string, sender: WebviewSender): void {
    this.senders.set(tabId, sender);
    sender(this.buildSettingsMessage());
    sender(this.buildSnapshotMessage(tabId));
  }

  unregisterTab(tabId: string): void {
    this.senders.delete(tabId);
    this.sessionAwards.delete(tabId);
    this.sessionXp.delete(tabId);
  }

  onConfigChanged(): void {
    const enabled = this.isEnabled();
    if (!enabled) {
      this.engine.resetAll();
      this.sessionAwards.clear();
      this.sessionXp.clear();
    }
    this.broadcastSettings();
    this.broadcastSnapshots();
  }

  onSessionStart(tabId: string): void {
    if (!this.isEnabled()) return;
    this.sessionAwards.set(tabId, []);
    this.sessionXp.set(tabId, 0);
    const goals = this.engine.startSession(tabId);
    this.send(tabId, { type: 'achievementProgress', goals: this.toGoalPayloads(goals) });

    const startAwards = this.engine.collectSessionStartAwards(tabId);
    void this.applyAwards(tabId, startAwards);

    const crashAt = this.lastCrashAt.get(tabId);
    if (crashAt && Date.now() - crashAt <= 2 * 60 * 1000) {
      const award = awardFromDef(getAchievementDefinition('phoenix'));
      if (award) {
        void this.applyAwards(tabId, [award]);
      }
    }
    this.lastCrashAt.delete(tabId);
  }

  onSessionEnd(tabId: string): void {
    if (!this.isEnabled()) return;
    if (!this.engine.hasSession(tabId)) return;

    // Capture session snapshot BEFORE endSession deletes the session
    const snapshot = this.engine.getSessionSnapshot(tabId);

    this.profile.counters.sessionsCompleted += 1;

    // --- Daily streak tracking ---
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const lastDate = this.profile.counters.lastSessionDate;
    if (lastDate !== today) {
      if (lastDate) {
        const lastMs = new Date(lastDate + 'T00:00:00').getTime();
        const todayMs = new Date(today + 'T00:00:00').getTime();
        const diffDays = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));
        if (diffDays === 1) {
          this.profile.counters.consecutiveDays += 1;
        } else {
          this.profile.counters.consecutiveDays = 1;
        }
      } else {
        this.profile.counters.consecutiveDays = 1;
      }
      this.profile.counters.lastSessionDate = today;
    }

    // Session duration tracking
    if (snapshot) {
      this.profile.counters.totalSessionMinutes += Math.floor(snapshot.sessionDurationMs / 60_000);
    }

    const sessionAwardTitles = this.sessionAwards.get(tabId) || [];
    const end = this.engine.endSession(tabId, sessionAwardTitles);

    void this.handleEngineResult(tabId, end).then(async () => {
      // --- Cross-session achievements ---
      const crossAwards: AchievementAward[] = [];

      // Session count achievements
      if (this.profile.counters.sessionsCompleted >= 50) {
        const a = awardFromDef(getAchievementDefinition('half-century'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.sessionsCompleted >= 100) {
        const a = awardFromDef(getAchievementDefinition('centurion'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.sessionsCompleted >= 200) {
        const a = awardFromDef(getAchievementDefinition('double-centurion'));
        if (a) crossAwards.push(a);
      }

      // Daily streak achievements
      if (this.profile.counters.consecutiveDays >= 3) {
        const a = awardFromDef(getAchievementDefinition('daily-streak-3'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.consecutiveDays >= 7) {
        const a = awardFromDef(getAchievementDefinition('daily-streak-7'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.consecutiveDays >= 14) {
        const a = awardFromDef(getAchievementDefinition('daily-streak-14'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.consecutiveDays >= 30) {
        const a = awardFromDef(getAchievementDefinition('daily-streak-30'));
        if (a) crossAwards.push(a);
      }

      // Time Investor achievements
      if (this.profile.counters.totalSessionMinutes >= 500) {
        const a = awardFromDef(getAchievementDefinition('time-investor-i'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.totalSessionMinutes >= 2000) {
        const a = awardFromDef(getAchievementDefinition('time-investor-ii'));
        if (a) crossAwards.push(a);
      }
      if (this.profile.counters.totalSessionMinutes >= 5000) {
        const a = awardFromDef(getAchievementDefinition('time-investor-iii'));
        if (a) crossAwards.push(a);
      }

      if (crossAwards.length > 0) {
        await this.applyAwards(tabId, crossAwards);
      }

      // --- Build and send recap ---
      if (end.recap) {
        const recap: SessionRecapPayload = {
          ...end.recap,
          xpEarned: this.sessionXp.get(tabId) || 0,
          level: this.profile.level,
        };

        // Send recap immediately (AI insight will update it later if available)
        this.send(tabId, { type: 'sessionRecap', recap });

        // --- AI Insight (async, best-effort) ---
        if (this.insightAnalyzer && snapshot && this.isInsightEnabled()) {
          this.log('[Achievements] Attempting AI session insight...');
          this.insightAnalyzer.analyzeSession(snapshot).then(async (insight) => {
            if (insight) {
              this.log(`[Achievements] AI insight: quality=${insight.sessionQuality} pattern=${insight.codingPattern} bonus=${insight.xpBonus}`);

              // Apply XP bonus
              if (insight.xpBonus > 0) {
                this.profile.totalXp += insight.xpBonus;
                this.profile.level = levelFromXp(this.profile.totalXp);
                this.sessionXp.set(tabId, (this.sessionXp.get(tabId) || 0) + insight.xpBonus);
                await this.persistProfile();
              }

              // Send updated recap with AI data
              const enrichedRecap: SessionRecapPayload = {
                ...recap,
                xpEarned: this.sessionXp.get(tabId) || 0,
                level: this.profile.level,
                aiInsight: insight.insight,
                sessionQuality: insight.sessionQuality,
                codingPattern: insight.codingPattern,
                aiXpBonus: insight.xpBonus,
              };
              this.send(tabId, { type: 'sessionRecap', recap: enrichedRecap });
              this.broadcastSnapshots();
            }
          }).catch((err) => {
            this.log(`[Achievements] AI insight error: ${err}`);
          });
        }
      }

      await this.persistProfile();
      this.sessionAwards.delete(tabId);
      this.sessionXp.delete(tabId);
      this.broadcastSnapshots();

      // Auto-sync to GitHub (silent, best-effort)
      const shareableProfile = this.getCurrentProfile();
      if (shareableProfile && this.syncService) {
        this.syncService.syncIfNeeded(shareableProfile).catch(() => {});
      }
    });
  }

  onSessionCrash(tabId: string): void {
    if (!this.isEnabled()) return;
    this.lastCrashAt.set(tabId, Date.now());
  }

  onCancel(tabId: string): void {
    if (!this.isEnabled()) return;
    this.engine.recordCancel(tabId);
  }

  onUserPrompt(tabId: string, text: string): void {
    if (!this.isEnabled()) return;
    const goals = this.engine.classifyFirstPrompt(tabId, text);
    this.send(tabId, { type: 'achievementProgress', goals: this.toGoalPayloads(goals) });
  }

  onToolUse(tabId: string, toolName: string, rawInput: string): void {
    if (!this.isEnabled()) return;
    const result = this.engine.recordToolUse(tabId, toolName, rawInput);
    void this.handleEngineResult(tabId, result);
  }

  onAssistantText(tabId: string, assistantText: string): void {
    if (!this.isEnabled()) return;
    const result = this.engine.recordAssistantText(tabId, assistantText);
    void this.handleEngineResult(tabId, result);
  }

  onResult(tabId: string, success: boolean): void {
    if (!this.isEnabled()) return;
    const result = this.engine.recordResult(tabId, success);
    void this.handleEngineResult(tabId, result);
  }

  onRuntimeError(tabId: string): void {
    if (!this.isEnabled()) return;
    const result = this.engine.recordLocalError(tabId);
    void this.handleEngineResult(tabId, result);
  }

  buildSettingsMessage(): ExtensionToWebviewMessage {
    return {
      type: 'achievementsSettings',
      enabled: this.isEnabled(),
      sound: this.isSoundEnabled(),
    };
  }

  buildSnapshotMessage(tabId: string): ExtensionToWebviewMessage {
    const goals = this.isEnabled() ? this.engine.getGoals(tabId) : [];
    return {
      type: 'achievementsSnapshot',
      profile: this.toProfilePayload(),
      goals: this.toGoalPayloads(goals),
    };
  }

  private async handleEngineResult(
    tabId: string,
    result: {
      awards: AchievementAward[];
      goals: {
        id: string;
        title: string;
        current: number;
        target: number;
        completed: boolean;
      }[];
      bugFixesDelta: number;
      testsDelta: number;
      editsDelta?: number;
    }
  ): Promise<void> {
    if (!this.isEnabled()) return;

    if (result.bugFixesDelta > 0) {
      this.profile.counters.bugFixes += result.bugFixesDelta;
    }
    if (result.testsDelta > 0) {
      this.profile.counters.testPasses += result.testsDelta;
    }
    if (result.editsDelta && result.editsDelta > 0) {
      this.profile.counters.totalEdits += result.editsDelta;
    }

    // --- Tiered cross-session achievements ---
    const tierAwards: AchievementAward[] = [];

    // Bug Slayer tiers
    if (this.profile.counters.bugFixes >= 5) {
      const a = awardFromDef(getAchievementDefinition('bug-slayer-i'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.bugFixes >= 25) {
      const a = awardFromDef(getAchievementDefinition('bug-slayer-ii'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.bugFixes >= 100) {
      const a = awardFromDef(getAchievementDefinition('bug-slayer-iii'));
      if (a) tierAwards.push(a);
    }

    // Bug Slayer IV
    if (this.profile.counters.bugFixes >= 250) {
      const a = awardFromDef(getAchievementDefinition('bug-slayer-iv'));
      if (a) tierAwards.push(a);
    }

    // Test Master tiers
    if (this.profile.counters.testPasses >= 25) {
      const a = awardFromDef(getAchievementDefinition('test-master-i'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.testPasses >= 100) {
      const a = awardFromDef(getAchievementDefinition('test-master-ii'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.testPasses >= 500) {
      const a = awardFromDef(getAchievementDefinition('test-master-iii'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.testPasses >= 1000) {
      const a = awardFromDef(getAchievementDefinition('test-master-iv'));
      if (a) tierAwards.push(a);
    }

    // Edit Veteran tiers
    if (this.profile.counters.totalEdits >= 500) {
      const a = awardFromDef(getAchievementDefinition('edit-veteran-i'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.totalEdits >= 2000) {
      const a = awardFromDef(getAchievementDefinition('edit-veteran-ii'));
      if (a) tierAwards.push(a);
    }
    if (this.profile.counters.totalEdits >= 5000) {
      const a = awardFromDef(getAchievementDefinition('edit-veteran-iii'));
      if (a) tierAwards.push(a);
    }

    await this.applyAwards(tabId, [...result.awards, ...tierAwards]);
    this.send(tabId, { type: 'achievementProgress', goals: this.toGoalPayloads(result.goals) });
    await this.persistProfile();
    this.broadcastSnapshots();
  }

  private async applyAwards(tabId: string, awards: AchievementAward[]): Promise<void> {
    if (!this.isEnabled()) return;
    let changed = false;
    for (const award of awards) {
      if (this.profile.unlockedIds.includes(award.id)) {
        continue;
      }
      this.profile.unlockedIds.push(award.id);
      this.profile.totalXp += award.xp;
      this.profile.level = levelFromXp(this.profile.totalXp);
      this.sessionXp.set(tabId, (this.sessionXp.get(tabId) || 0) + award.xp);
      this.sessionAwards.set(tabId, [...(this.sessionAwards.get(tabId) || []), award.title]);
      changed = true;

      this.send(tabId, {
        type: 'achievementAwarded',
        achievement: this.toAwardPayload(award),
        profile: this.toProfilePayload(),
      });

      this.log(`[Achievements] unlocked ${award.id} (+${award.xp} XP)`);
    }

    if (changed) {
      await this.persistProfile();
    }
  }

  private async persistProfile(): Promise<void> {
    await this.store.saveProfile(this.profile);
  }

  private broadcastSettings(): void {
    const settings = this.buildSettingsMessage();
    for (const send of this.senders.values()) {
      send(settings);
    }
  }

  private broadcastSnapshots(): void {
    for (const tabId of this.senders.keys()) {
      this.send(tabId, this.buildSnapshotMessage(tabId));
    }
  }

  private send(tabId: string, msg: ExtensionToWebviewMessage): void {
    const sender = this.senders.get(tabId);
    if (!sender) return;
    sender(msg);
  }

  private isEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    return config.get<boolean>('achievements.enabled', true);
  }

  private isSoundEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    return config.get<boolean>('achievements.sound', false);
  }

  private isInsightEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    return config.get<boolean>('achievements.aiInsight', true);
  }

  private toProfilePayload(): AchievementProfilePayload {
    return {
      totalXp: this.profile.totalXp,
      level: this.profile.level,
      totalAchievements: this.profile.unlockedIds.length,
      unlockedIds: [...this.profile.unlockedIds],
    };
  }

  private toAwardPayload(award: AchievementAward): AchievementAwardPayload {
    return {
      id: award.id,
      title: award.title,
      description: award.description,
      rarity: award.rarity,
      category: award.category,
      xp: award.xp,
      hidden: award.hidden,
    };
  }

  private toGoalPayloads(
    goals: {
      id: string;
      title: string;
      current: number;
      target: number;
      completed: boolean;
    }[]
  ): AchievementGoalPayload[] {
    return goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      current: goal.current,
      target: goal.target,
      completed: goal.completed,
    }));
  }
}
