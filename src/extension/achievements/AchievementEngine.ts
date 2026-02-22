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

export type GoalMetric =
  | 'bugFixes'
  | 'passingTests'
  | 'meaningfulEdits'
  | 'runtimeFixes'
  | 'filesTouched'
  | 'errorFreeResults'
  | 'languages';

export interface SessionGoalState {
  id: string;
  title: string;
  current: number;
  target: number;
  completed: boolean;
  metric: GoalMetric;
}

interface GoalTemplate {
  id: string;
  title: string;
  target: number;
  metric: GoalMetric;
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
  // --- New fields for enhanced tracking ---
  filesTouched: Set<string>;
  frontendEdits: boolean;
  backendEdits: boolean;
  firstEditAtMs: number | null;
  firstTestAtMs: number | null;
  errorCycles: number;
  errorFreeResults: number;
}

export interface SessionRecap {
  durationMs: number;
  bugsFixed: number;
  passingTests: number;
  highestStreak: number;
  newAchievements: string[];
  xpEarned: number;
  level: number;
  filesTouched: number;
  languagesUsed: string[];
}

export interface SessionSnapshot {
  toolNames: string[];
  filesTouched: string[];
  bugsFixed: number;
  testsPassed: number;
  errorCount: number;
  sessionDurationMs: number;
  editCount: number;
  languages: string[];
  cancelCount: number;
}

export interface EngineResult {
  awards: AchievementAward[];
  goals: SessionGoalState[];
  recap?: SessionRecap;
  bugFixesDelta: number;
  testsDelta: number;
  editsDelta: number;
}

const DEBUG_GOALS: GoalTemplate[] = [
  { id: 'ship-it-sprint', title: 'Ship It Sprint', metric: 'bugFixes', target: 2 },
  { id: 'runtime-rescuer', title: 'Runtime Rescuer', metric: 'runtimeFixes', target: 2 },
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
  { id: 'error-free', title: 'Error Free', metric: 'errorFreeResults', target: 3 },
];

const FEATURE_GOALS: GoalTemplate[] = [
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
  { id: 'refactor-ritual', title: 'Refactor Ritual', metric: 'meaningfulEdits', target: 3 },
  { id: 'file-hopper', title: 'File Hopper', metric: 'filesTouched', target: 8 },
  { id: 'language-sampler', title: 'Language Sampler', metric: 'languages', target: 2 },
];

const DEFAULT_GOALS: GoalTemplate[] = [
  { id: 'ship-it-sprint', title: 'Ship It Sprint', metric: 'bugFixes', target: 2 },
  { id: 'test-tactician', title: 'Test Tactician', metric: 'passingTests', target: 5 },
  { id: 'refactor-ritual', title: 'Refactor Ritual', metric: 'meaningfulEdits', target: 3 },
];

const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write']);

const FRONTEND_EXTENSIONS = new Set(['.tsx', '.jsx', '.html', '.css', '.scss', '.vue', '.svelte']);
const BACKEND_EXTENSIONS = new Set(['.py', '.go', '.rs', '.java', '.cs', '.rb', '.php']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.config']);

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

/** Extract a file path from tool input JSON (best-effort) */
function extractFilePath(rawInput: string): string | null {
  try {
    const obj = JSON.parse(rawInput);
    return obj.file_path || obj.path || obj.filePath || null;
  } catch {
    // Try regex extraction for file_path in non-JSON inputs
    const match = rawInput.match(/["']?(?:file_path|path)["']?\s*[:=]\s*["']([^"']+)["']/);
    return match ? match[1] : null;
  }
}

/** Classify a file extension as frontend, backend, or unknown */
function classifyFileType(filePath: string): 'frontend' | 'backend' | 'unknown' {
  const lower = filePath.toLowerCase();
  const ext = '.' + (lower.split('.').pop() || '');

  if (FRONTEND_EXTENSIONS.has(ext)) return 'frontend';
  if (BACKEND_EXTENSIONS.has(ext)) return 'backend';

  // .ts files: check path-based heuristics
  if (ext === '.ts') {
    if (/(?:component|page|view|ui|widget|layout|style)/i.test(lower)) return 'frontend';
    if (/(?:server|api|route|controller|service|middleware|handler|model|migration)/i.test(lower)) return 'backend';
  }

  return 'unknown';
}

function isConfigFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const ext = '.' + (lower.split('.').pop() || '');
  return CONFIG_EXTENSIONS.has(ext);
}

function hasConfigFile(filesTouched: Set<string>): boolean {
  for (const f of filesTouched) {
    if (isConfigFile(f)) return true;
  }
  return false;
}

function countMarkdownFiles(filesTouched: Set<string>): number {
  let count = 0;
  for (const f of filesTouched) {
    if (f.toLowerCase().endsWith('.md')) count++;
  }
  return count;
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

function goalCurrent(metric: GoalMetric, session: SessionState): number {
  if (metric === 'bugFixes') return session.bugFixes;
  if (metric === 'passingTests') return session.passingTests;
  if (metric === 'meaningfulEdits') return session.meaningfulEdits;
  if (metric === 'runtimeFixes') return session.runtimeFixes;
  if (metric === 'filesTouched') return session.filesTouched.size;
  if (metric === 'errorFreeResults') return session.errorFreeResults;
  if (metric === 'languages') return session.languages.size;
  return 0;
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
      // New fields
      filesTouched: new Set<string>(),
      frontendEdits: false,
      backendEdits: false,
      firstEditAtMs: null,
      firstTestAtMs: null,
      errorCycles: 0,
      errorFreeResults: 0,
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
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0, editsDelta: 0 };
    }

    const awards: AchievementAward[] = [];
    const normalized = normalizeToolName(toolName);
    const lowerInput = rawInput.toLowerCase();
    let editsDelta = 0;

    for (const lang of parseLanguageSignals(rawInput)) {
      session.languages.add(lang);
    }

    // Track file paths from tool inputs
    const filePath = extractFilePath(rawInput);
    if (filePath) {
      session.filesTouched.add(filePath);
      const fileType = classifyFileType(filePath);
      if (fileType === 'frontend') session.frontendEdits = true;
      if (fileType === 'backend') session.backendEdits = true;
    }

    if (EDIT_TOOLS.has(normalized)) {
      session.meaningfulEdits += 1;
      editsDelta = 1;
      if (session.firstEditAtMs === null) {
        session.firstEditAtMs = Date.now();
      }
      if (session.pendingErrorFix) {
        session.editsSinceError += 1;
      }
    }

    if (normalized === 'bash' || normalized === 'terminal' || normalized === 'run') {
      if (includesAny(lowerInput, ['test', 'pytest', 'vitest', 'jest', 'mocha', 'go test', 'cargo test', 'npm run test'])) {
        session.pendingTestRun = true;
        if (session.firstTestAtMs === null) {
          session.firstTestAtMs = Date.now();
        }
      }
    }

    // Language-based achievements
    if (session.languages.size >= 2) {
      const bilingual = this.createAward('bilingual');
      if (bilingual) awards.push(bilingual);
    }
    if (session.languages.size >= 3) {
      const award = this.createAward('polyglot');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 5) {
      const award = this.createAward('multilingual-master');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 7) {
      const award = this.createAward('language-collector-i');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 10) {
      const award = this.createAward('language-collector-ii');
      if (award) awards.push(award);
    }

    // File-based achievements
    if (session.filesTouched.size >= 10) {
      const award = this.createAward('file-explorer');
      if (award) awards.push(award);
    }
    if (session.filesTouched.size >= 20) {
      const award = this.createAward('wide-reach');
      if (award) awards.push(award);
    }
    if (session.filesTouched.size >= 30) {
      const award = this.createAward('project-architect');
      if (award) awards.push(award);
    }

    // Config file detection
    if (filePath && isConfigFile(filePath)) {
      const award = this.createAward('config-wrangler');
      if (award) awards.push(award);
    }

    // Full-stack detection
    if (session.frontendEdits && session.backendEdits) {
      const award = this.createAward('full-stack');
      if (award) awards.push(award);
    }

    return {
      awards,
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
      editsDelta,
    };
  }

  recordAssistantText(tabId: string, contentText: string): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0, editsDelta: 0 };
    }
    for (const lang of parseCodeFenceLanguages(contentText)) {
      session.languages.add(lang);
    }
    const awards: AchievementAward[] = [];
    if (session.languages.size >= 2) {
      const bilingual = this.createAward('bilingual');
      if (bilingual) awards.push(bilingual);
    }
    if (session.languages.size >= 3) {
      const award = this.createAward('polyglot');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 5) {
      const award = this.createAward('multilingual-master');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 7) {
      const award = this.createAward('language-collector-i');
      if (award) awards.push(award);
    }
    if (session.languages.size >= 10) {
      const award = this.createAward('language-collector-ii');
      if (award) awards.push(award);
    }
    return {
      awards,
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
      editsDelta: 0,
    };
  }

  recordResult(
    tabId: string,
    success: boolean
  ): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0, editsDelta: 0 };
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
      session.errorCycles += 1;
    } else {
      // Track error-free results for goal
      session.errorFreeResults += 1;

      if (session.pendingTestRun) {
        session.pendingTestRun = false;
        session.passingTests += 1;
        testsDelta = 1;
        session.consecutivePassingTests += 1;
        session.lastTestPassAtMs = now;
      }

      if (session.pendingErrorFix && session.editsSinceError > 0) {
        // Anti-cheese: bug fix requires meaningful edit after a real error.
        const editCount = session.editsSinceError;
        session.pendingErrorFix = false;
        session.editsSinceError = 0;
        session.bugFixes += 1;
        session.runtimeFixes += 1;
        bugFixesDelta = 1;
        session.lastBugFixAtMs = now;
        session.bugFixTimes.push(now);
        session.bugFixTimes = session.bugFixTimes.filter((ts) => now - ts <= 10 * 60 * 1000);

        // First blood: first bug fix within 5 minutes of session start
        if (session.bugFixes === 1 && (now - session.startedAtMs) <= 5 * 60 * 1000) {
          const award = this.createAward('first-blood');
          if (award) awards.push(award);
        }

        // Persistence: fix after 3+ error cycles
        if (session.errorCycles >= 3) {
          const award = this.createAward('persistence');
          if (award) awards.push(award);
        }

        // Surgeon: 1-2 precise edits fixed the error
        if (editCount >= 1 && editCount <= 2) {
          const award = this.createAward('surgeon');
          if (award) awards.push(award);
        }

        // Error Whisperer: fixed on very first edit after the error
        if (editCount === 1) {
          const award = this.createAward('error-whisperer');
          if (award) awards.push(award);
        }

        // Zero Day: bug fix within 2 minutes of session start
        if (session.bugFixes >= 1 && (now - session.startedAtMs) <= 2 * 60 * 1000) {
          const award = this.createAward('zero-day');
          if (award) awards.push(award);
        }

        // Reset error cycles on successful fix
        session.errorCycles = 0;
      }

      if (session.lastBugFixAtMs && session.lastTestPassAtMs) {
        const delta = Math.abs(session.lastTestPassAtMs - session.lastBugFixAtMs);
        if (delta <= 6 * 60 * 1000) {
          const speedPatch = this.createAward('speed-patch');
          if (speedPatch) awards.push(speedPatch);
        }
        // Test Driven Dev: bug fix + test pass within 3 minutes
        if (delta <= 3 * 60 * 1000) {
          const tdd = this.createAward('test-driven-dev');
          if (tdd) awards.push(tdd);
        }
      }
    }

    if (session.consecutivePassingTests >= 5) {
      const award = this.createAward('green-wave');
      if (award) awards.push(award);
    }
    // Green Streak: 10 consecutive test passes
    if (session.consecutivePassingTests >= 10) {
      const award = this.createAward('green-streak');
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
      editsDelta: 0,
    };
  }

  recordLocalError(tabId: string): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0, editsDelta: 0 };
    }
    session.hadRuntimeError = true;
    session.runtimeErrors += 1;
    session.pendingErrorFix = true;
    session.editsSinceError = 0;
    session.consecutivePassingTests = 0;
    session.errorCycles += 1;
    return {
      awards: [],
      goals: this.progressGoals(session),
      bugFixesDelta: 0,
      testsDelta: 0,
      editsDelta: 0,
    };
  }

  collectSessionStartAwards(tabId: string): AchievementAward[] {
    const session = this.sessions.get(tabId);
    if (!session) return [];

    const awards: AchievementAward[] = [];
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sunday, 6=Saturday

    // Night Owl: midnight to 5am
    if (hour >= 0 && hour < 5) {
      const award = this.createAward('night-owl');
      if (award) awards.push(award);
    }

    // Early Bird: 5am to 7am
    if (hour >= 5 && hour < 7) {
      const award = this.createAward('early-bird');
      if (award) awards.push(award);
    }

    // Lunch Break: 12pm to 1pm
    if (hour >= 12 && hour < 13) {
      const award = this.createAward('lunch-break');
      if (award) awards.push(award);
    }

    // Weekend Warrior: Saturday or Sunday
    if (day === 0 || day === 6) {
      const award = this.createAward('weekend-warrior');
      if (award) awards.push(award);
    }

    return awards;
  }

  /** Capture session data for AI insight analysis before endSession deletes it */
  getSessionSnapshot(tabId: string): SessionSnapshot | null {
    const session = this.sessions.get(tabId);
    if (!session) return null;

    return {
      toolNames: [], // Will be populated by service from turn records
      filesTouched: Array.from(session.filesTouched),
      bugsFixed: session.bugFixes,
      testsPassed: session.passingTests,
      errorCount: session.runtimeErrors,
      sessionDurationMs: Date.now() - session.startedAtMs,
      editCount: session.meaningfulEdits,
      languages: Array.from(session.languages),
      cancelCount: session.cancelCount,
    };
  }

  endSession(
    tabId: string,
    awardedInSession: string[]
  ): EngineResult {
    const session = this.sessions.get(tabId);
    if (!session || session.recapSent) {
      return { awards: [], goals: [], bugFixesDelta: 0, testsDelta: 0, editsDelta: 0 };
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

    // Deep Focus: 60+ min, 0 cancels, 5+ edits
    const durationMs = now - session.startedAtMs;
    if (durationMs >= 60 * 60 * 1000 && session.cancelCount === 0 && session.meaningfulEdits >= 5) {
      const award = this.createAward('deep-focus');
      if (award) awards.push(award);
    }

    // Heavy Refactor: 10+ edits
    if (session.meaningfulEdits >= 10) {
      const award = this.createAward('heavy-refactor');
      if (award) awards.push(award);
    }

    // Test First: tests ran before any edit
    if (session.firstTestAtMs !== null &&
        (session.firstEditAtMs === null || session.firstTestAtMs < session.firstEditAtMs)) {
      const award = this.createAward('test-first');
      if (award) awards.push(award);
    }

    // Sprint: short but productive session (< 15 min, 3+ edits)
    if (durationMs < 15 * 60 * 1000 && session.meaningfulEdits >= 3) {
      const award = this.createAward('sprint');
      if (award) awards.push(award);
    }

    // Iron Will: 3+ hour session with 10+ edits
    if (durationMs >= 3 * 60 * 60 * 1000 && session.meaningfulEdits >= 10) {
      const award = this.createAward('iron-will');
      if (award) awards.push(award);
    }

    // Bug Squasher: 3+ bugs in one session
    if (session.bugFixes >= 3) {
      const award = this.createAward('bug-squasher');
      if (award) awards.push(award);
    }

    // Comeback Kid: 5+ runtime fixes in one session (hidden)
    if (session.runtimeFixes >= 5) {
      const award = this.createAward('comeback-kid');
      if (award) awards.push(award);
    }

    // Test Marathon: 10+ test passes in one session
    if (session.passingTests >= 10) {
      const award = this.createAward('test-marathon');
      if (award) awards.push(award);
    }

    // Quality Gate: more test passes than bug fixes (min 2 tests)
    if (session.passingTests > session.bugFixes && session.passingTests >= 2) {
      const award = this.createAward('quality-gate');
      if (award) awards.push(award);
    }

    // Tidy Up: 5+ edits, zero runtime errors
    if (!session.hadRuntimeError && session.meaningfulEdits >= 5) {
      const award = this.createAward('tidy-up');
      if (award) awards.push(award);
    }

    // Mega Refactor: 25+ edits in one session
    if (session.meaningfulEdits >= 25) {
      const award = this.createAward('mega-refactor');
      if (award) awards.push(award);
    }

    // Single File Focus: 5+ edits all in one file
    if (session.filesTouched.size === 1 && session.meaningfulEdits >= 5) {
      const award = this.createAward('single-file-focus');
      if (award) awards.push(award);
    }

    // Cross Stack: frontend + backend + config files
    if (session.frontendEdits && session.backendEdits && hasConfigFile(session.filesTouched)) {
      const award = this.createAward('cross-stack');
      if (award) awards.push(award);
    }

    // Markdown Author: 3+ markdown files edited
    if (countMarkdownFiles(session.filesTouched) >= 3) {
      const award = this.createAward('markdown-author');
      if (award) awards.push(award);
    }

    // Docs First: first file edited was a markdown file (hidden)
    if (session.filesTouched.size > 0) {
      const firstFile = Array.from(session.filesTouched)[0];
      if (firstFile.toLowerCase().endsWith('.md')) {
        const award = this.createAward('docs-first');
        if (award) awards.push(award);
      }
    }

    // All Goals Met: every session goal completed
    const allGoals = this.progressGoals(session);
    if (allGoals.length > 0 && allGoals.every((g) => g.completed)) {
      const award = this.createAward('all-goals-met');
      if (award) awards.push(award);
    }

    session.recapSent = true;

    const recap: SessionRecap = {
      durationMs,
      bugsFixed: session.bugFixes,
      passingTests: session.passingTests,
      highestStreak: session.bugFixTimes.length,
      newAchievements: awardedInSession,
      xpEarned: 0,
      level: 1,
      filesTouched: session.filesTouched.size,
      languagesUsed: Array.from(session.languages),
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
      editsDelta: 0,
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
