import { getAchievementDefinition, type AchievementCategory, type AchievementRarity } from './AchievementCatalog';

export interface AchievementAward {
  id: string;
  title: string;
  description: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  xp: number;
  hidden?: boolean;
}

export interface SessionGoalState {
  id: string;
  title: string;
  current: number;
  target: number;
  completed: boolean;
  metric: 'bugFixes' | 'passingTests' | 'meaningfulEdits' | 'runtimeFixes';
}

interface GoalTemplate {
  id: string;
  title: string;
  target: number;
  metric: SessionGoalState['metric'];
}

interface SessionState {
  startedAtMs: number;
  hadRuntimeError: boolean;
  runtimeErrors: number;
  meaningfulEdits: number;
  bugFixes: number;
  runtimeFixes: number;
  passingTests: number;
  consecutivePassingTests: number;
  pendingErrorFix: boolean;
  editsSinceError: number;
  bugFixTimes: number[];
  lastBugFixAtMs: number | null;
  pendingTestRun: boolean;
  lastTestPassAtMs: number | null;
  languages: Set<string>;
  cancelCount: number;
  firstPromptClassified: boolean;
  goals: SessionGoalState[];
  recapSent: boolean;
}

export interface SessionRecap {
  durationMs: number;
  bugsFixed: number;
  passingTests: number;
  highestStreak: number;
  newAchievements: string[];
  xpEarned: number;
  level: number;
}

export interface EngineResult {
  awards: AchievementAward[];
  goals: SessionGoalState[];
  recap?: SessionRecap;
  bugFixesDelta: number;
  testsDelta: number;
}

const DEBUG_GOALS: GoalTemplate[] = [
  { id: 'ship-it-sprint', title: 'Ship It Sprint', metric: 'bugFixes', target: 2 },
  { id: 'runtime-rescuer', title: 'Runtime Rescuer', metric: 'runtimeFixes', target: 2 },
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
];

const FEATURE_GOALS: GoalTemplate[] = [
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
  { id: 'refactor-ritual', title: 'Refactor Ritual', metric: 'meaningfulEdits', target: 3 },
  { id: 'ship-it-sprint', title: 'Ship It Sprint', metric: 'bugFixes', target: 2 },
];

const DEFAULT_GOALS: GoalTemplate[] = [
  { id: 'ship-it-sprint', title: 'Ship It Sprint', metric: 'bugFixes', target: 2 },
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
  { id: 'refactor-ritual', title: 'Refactor Ritual', metric: 'meaningfulEdits', target: 3 },
];

const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write']);

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().split('.').pop() || name.trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function parseLanguageSignals(rawInput: string): string[] {
  const signals: string[] = [];
  const lower = rawInput.toLowerCase();
  if (lower.includes('.ts') || lower.includes('.tsx')) signals.push('typescript');
  if (lower.includes('.js') || lower.includes('.jsx')) signals.push('javascript');
  if (lower.includes('.py')) signals.push('python');
  if (lower.includes('.go')) signals.push('go');
  if (lower.includes('.rs')) signals.push('rust');
  if (lower.includes('.java')) signals.push('java');
  if (lower.includes('.cs')) signals.push('csharp');
  if (lower.includes('.cpp') || lower.includes('.cc')) signals.push('cpp');
  if (lower.includes('.rb')) signals.push('ruby');
  if (lower.includes('.php')) signals.push('php');
  if (lower.includes('.md')) signals.push('markdown');
  return signals;
}

function parseCodeFenceLanguages(text: string): string[] {
  const found = new Set<string>();
  const re = /```([a-zA-Z0-9_+-]+)/g;
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    found.add(match[1].toLowerCase());
    match = re.exec(text);
  }
  return Array.from(found);
}

function makeGoals(templates: GoalTemplate[]): SessionGoalState[] {
  return templates.map((g) => ({
    id: g.id,
    title: g.title,
    current: 0,
    target: g.target,
    completed: false,
    metric: g.metric,
  }));
}

function goalCurrent(metric: SessionGoalState['metric'], session: SessionState): number {
  if (metric === 'bugFixes') return session.bugFixes;
  if (metric === 'passingTests') return session.passingTests;
  if (metric === 'meaningfulEdits') return session.meaningfulEdits;
  return session.runtimeFixes;
}

export class AchievementEngine {
  private readonly sessions = new Map<string, SessionState>();

  startSession(tabId: string): SessionGoalState[] {
    const now = Date.now();
    const session: SessionState = {
      startedAtMs: now,
      hadRuntimeError: false,
      runtimeErrors: 0,
      meaningfulEdits: 0,
      bugFixes: 0,
      runtimeFixes: 0,
      passingTests: 0,
      consecutivePassingTests: 0,
      pendingErrorFix: false,
      editsSinceError: 0,
      bugFixTimes: [],
      lastBugFixAtMs: null,
      pendingTestRun: false,
      lastTestPassAtMs: null,
      languages: new Set<string>(),
      cancelCount: 0,
      firstPromptClassified: false,
      goals: makeGoals(DEFAULT_GOALS),
      recapSent: false,
    };

    this.sessions.set(tabId, session);
    return this.progressGoals(session);
  }

  recordCancel(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session) return;
    session.cancelCount += 1;
  }

  classifyFirstPrompt(tabId: string, text: string): SessionGoalState[] {
    const session = this.sessions.get(tabId);
    if (!session || session.firstPromptClassified) {
      return session ? this.progressGoals(session) : [];
    }
    session.firstPromptClassified = true;
    const lower = text.toLowerCase();
    if (includesAny(lower, ['bug', 'debug', 'error', 'fix', 'crash', 'failing'])) {
      session.goals = makeGoals(DEBUG_GOALS);
    } else if (includesAny(lower, ['feature', 'implement', 'build', 'add', 'design'])) {
      session.goals = makeGoals(FEATURE_GOALS);
    }
    return this.progressGoals(session);
  }

  recordToolUse(
    tabId: string,
    toolName: string,
    rawInput: string
  ): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0 };
    }

    const awards: AchievementAward[] = [];
    const normalized = normalizeToolName(toolName);
    const lowerInput = rawInput.toLowerCase();

    for (const lang of parseLanguageSignals(rawInput)) {
      session.languages.add(lang);
    }

    if (EDIT_TOOLS.has(normalized)) {
      session.meaningfulEdits += 1;
      if (session.pendingErrorFix) {
        session.editsSinceError += 1;
      }
    }

    if (normalized === 'bash' || normalized === 'terminal' || normalized === 'run') {
      if (includesAny(lowerInput, ['test', 'pytest', 'vitest', 'jest', 'mocha', 'go test', 'cargo test', 'npm run test'])) {
        session.pendingTestRun = true;
      }
    }

    if (session.languages.size >= 3) {
      const award = this.createAward('polyglot');
      if (award) awards.push(award);
    }

    return {
      awards,
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
    };
  }

  recordAssistantText(tabId: string, contentText: string): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0 };
    }
    for (const lang of parseCodeFenceLanguages(contentText)) {
      session.languages.add(lang);
    }
    const awards: AchievementAward[] = [];
    if (session.languages.size >= 3) {
      const award = this.createAward('polyglot');
      if (award) awards.push(award);
    }
    return {
      awards,
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
    };
  }

  recordResult(
    tabId: string,
    success: boolean
  ): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0 };
    }

    const now = Date.now();
    const awards: AchievementAward[] = [];
    let bugFixesDelta = 0;
    let testsDelta = 0;

    if (!success) {
      session.hadRuntimeError = true;
      session.runtimeErrors += 1;
      session.pendingErrorFix = true;
      session.editsSinceError = 0;
      session.consecutivePassingTests = 0;
    } else {
      if (session.pendingTestRun) {
        session.pendingTestRun = false;
        session.passingTests += 1;
        testsDelta = 1;
        session.consecutivePassingTests += 1;
        session.lastTestPassAtMs = now;
      }

      if (session.pendingErrorFix && session.editsSinceError > 0) {
        // Anti-cheese: bug fix requires meaningful edit after a real error.
        session.pendingErrorFix = false;
        session.editsSinceError = 0;
        session.bugFixes += 1;
        session.runtimeFixes += 1;
        bugFixesDelta = 1;
        session.lastBugFixAtMs = now;
        session.bugFixTimes.push(now);
        session.bugFixTimes = session.bugFixTimes.filter((ts) => now - ts <= 10 * 60 * 1000);
      }

      if (session.lastBugFixAtMs && session.lastTestPassAtMs) {
        const delta = Math.abs(session.lastTestPassAtMs - session.lastBugFixAtMs);
        if (delta <= 6 * 60 * 1000) {
          const speedPatch = this.createAward('speed-patch');
          if (speedPatch) awards.push(speedPatch);
        }
      }
    }

    if (session.consecutivePassingTests >= 5) {
      const award = this.createAward('green-wave');
      if (award) awards.push(award);
    }

    if (session.bugFixTimes.length >= 3) {
      const award = this.createAward('hot-streak');
      if (award) awards.push(award);
    }

    const marathon = this.tryMarathon(session, now);
    if (marathon) awards.push(marathon);
    const noUndo = this.tryNoUndo(session, now);
    if (noUndo) awards.push(noUndo);

    return {
      awards,
      goals: this.progressGoals(session),
      bugFixesDelta,
      testsDelta,
    };
  }

  recordLocalError(tabId: string): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0 };
    }
    session.hadRuntimeError = true;
    session.runtimeErrors += 1;
    session.pendingErrorFix = true;
    session.editsSinceError = 0;
    session.consecutivePassingTests = 0;
    return {
      awards: [],
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
    };
  }

  collectSessionStartAwards(tabId: string): AchievementAward[] {
    const session = this.sessions.get(tabId);
    if (!session) return [];
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 0 && hour < 5) {
      const award = this.createAward('night-owl');
      return award ? [award] : [];
    }
    return [];
  }

  endSession(
    tabId: string,
    awardedInSession: string[]
  ): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session || session.recapSent) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0 };
    }

    const now = Date.now();
    const awards: AchievementAward[] = [];
    const marathon = this.tryMarathon(session, now);
    if (marathon) awards.push(marathon);
    const noUndo = this.tryNoUndo(session, now);
    if (noUndo) awards.push(noUndo);

    if (!session.hadRuntimeError && session.meaningfulEdits >= 1) {
      const clean = this.createAward('clean-sweep');
      if (clean) awards.push(clean);
    }

    session.recapSent = true;

    const recap: SessionRecap = {
      durationMs: now - session.startedAtMs,
      bugsFixed: session.bugFixes,
      passingTests: session.passingTests,
      highestStreak: session.bugFixTimes.length,
      newAchievements: awardedInSession,
      xpEarned: 0,
      level: 1,
    };

    this.sessions.delete(tabId);
    return {
      awards,
      goals: [],
      recap: {
        ...recap,
      },
      bugFixesDelta: 0,
      testsDelta: 0,
    };
  }

  getGoals(tabId: string): SessionGoalState[] {
    const session = this.sessions.get(tabId);
    if (!session) return [];
    return this.progressGoals(session);
  }

  hasSession(tabId: string): boolean {
    return this.sessions.has(tabId);
  }

  resetAll(): void {
    this.sessions.clear();
  }

  private progressGoals(session: SessionState): SessionGoalState[] {
    return session.goals.map((goal) => {
      const current = goalCurrent(goal.metric, session);
      return {
        ...goal,
        current,
        completed: current >= goal.target,
      };
    });
  }

  private tryMarathon(session: SessionState, now: number): AchievementAward | null {
    if (now - session.startedAtMs >= 2 * 60 * 60 * 1000) {
      return this.createAward('marathon');
    }
    return null;
  }

  private tryNoUndo(session: SessionState, now: number): AchievementAward | null {
    if (session.cancelCount === 0 && session.meaningfulEdits >= 2 && now - session.startedAtMs >= 30 * 60 * 1000) {
      return this.createAward('no-undo-ninja');
    }
    return null;
  }

  private createAward(id: string): AchievementAward | null {
    const definition = getAchievementDefinition(id);
    if (!definition) return null;
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      rarity: definition.rarity,
      category: definition.category,
      xp: definition.xp,
      hidden: definition.hidden,
    };
  }
}
