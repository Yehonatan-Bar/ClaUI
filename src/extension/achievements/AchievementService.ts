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

type WebviewSender = (msg: ExtensionToWebviewMessage) => void;

export class AchievementService {
  private readonly store: AchievementStore;
  private readonly engine = new AchievementEngine();
  private readonly senders = new Map<string, WebviewSender>();
  private profile: AchievementProfile;
  private readonly sessionAwards = new Map<string, string[]>();
  private readonly sessionXp = new Map<string, number>();
  private readonly lastCrashAt = new Map<string, number>();

  constructor(globalState: vscode.Memento, private readonly log: (msg: string) => void) {
    this.store = new AchievementStore(globalState);
    this.profile = this.store.getProfile();
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
      const phoenix = getAchievementDefinition('phoenix');
      if (phoenix) {
        void this.applyAwards(tabId, [{
          id: phoenix.id,
          title: phoenix.title,
          description: phoenix.description,
          rarity: phoenix.rarity,
          category: phoenix.category,
          xp: phoenix.xp,
          hidden: phoenix.hidden,
        }]);
      }
    }
    this.lastCrashAt.delete(tabId);
  }

  onSessionEnd(tabId: string): void {
    if (!this.isEnabled()) return;
    if (!this.engine.hasSession(tabId)) return;

    this.profile.counters.sessionsCompleted += 1;
    const sessionAwardTitles = this.sessionAwards.get(tabId) || [];
    const end = this.engine.endSession(tabId, sessionAwardTitles);
    void this.handleEngineResult(tabId, end).then(async () => {
      if (end.recap) {
        const recap: SessionRecapPayload = {
          ...end.recap,
          xpEarned: this.sessionXp.get(tabId) || 0,
          level: this.profile.level,
        };
        this.send(tabId, { type: 'sessionRecap', recap });
      }
      await this.persistProfile();
      this.sessionAwards.delete(tabId);
      this.sessionXp.delete(tabId);
      this.broadcastSnapshots();
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
    }
  ): Promise<void> {
    if (!this.isEnabled()) return;

    if (result.bugFixesDelta > 0) {
      this.profile.counters.bugFixes += result.bugFixesDelta;
    }
    if (result.testsDelta > 0) {
      this.profile.counters.testPasses += result.testsDelta;
    }

    const bugTierAwards: AchievementAward[] = [];
    if (this.profile.counters.bugFixes >= 5) {
      const a = getAchievementDefinition('bug-slayer-i');
      if (a) {
        bugTierAwards.push({
          id: a.id,
          title: a.title,
          description: a.description,
          rarity: a.rarity,
          category: a.category,
          xp: a.xp,
          hidden: a.hidden,
        });
      }
    }
    if (this.profile.counters.bugFixes >= 25) {
      const a = getAchievementDefinition('bug-slayer-ii');
      if (a) {
        bugTierAwards.push({
          id: a.id,
          title: a.title,
          description: a.description,
          rarity: a.rarity,
          category: a.category,
          xp: a.xp,
          hidden: a.hidden,
        });
      }
    }
    if (this.profile.counters.bugFixes >= 100) {
      const a = getAchievementDefinition('bug-slayer-iii');
      if (a) {
        bugTierAwards.push({
          id: a.id,
          title: a.title,
          description: a.description,
          rarity: a.rarity,
          category: a.category,
          xp: a.xp,
          hidden: a.hidden,
        });
      }
    }

    await this.applyAwards(tabId, [...result.awards, ...bugTierAwards]);
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
