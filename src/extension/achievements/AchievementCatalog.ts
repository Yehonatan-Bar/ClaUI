export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementCategory =
  | 'debugging'
  | 'testing'
  | 'refactor'
  | 'collaboration'
  | 'session'
  | 'architecture'
  | 'productivity';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  xp: number;
  hidden?: boolean;
}

export const ACHIEVEMENT_CATALOG: Record<string, AchievementDefinition> = {
  'night-owl': {
    id: 'night-owl',
    title: 'Night Owl',
    description: 'Worked on code after midnight.',
    rarity: 'common',
    category: 'session',
    xp: 10,
  },
  'marathon': {
    id: 'marathon',
    title: 'Marathon',
    description: 'Stayed in a single session for 2+ hours.',
    rarity: 'rare',
    category: 'session',
    xp: 40,
  },
  'polyglot': {
    id: 'polyglot',
    title: 'Polyglot',
    description: 'Used 3+ languages in one session.',
    rarity: 'rare',
    category: 'collaboration',
    xp: 35,
  },
  'hot-streak': {
    id: 'hot-streak',
    title: 'Hot Streak',
    description: '3 bug fixes in 10 minutes.',
    rarity: 'epic',
    category: 'debugging',
    xp: 50,
  },
  'green-wave': {
    id: 'green-wave',
    title: 'Green Wave',
    description: '5 test passes in a row.',
    rarity: 'epic',
    category: 'testing',
    xp: 55,
  },
  'speed-patch': {
    id: 'speed-patch',
    title: 'Speed Patch',
    description: 'Bug fix + passing test within 6 minutes.',
    rarity: 'rare',
    category: 'debugging',
    xp: 30,
  },
  'bug-slayer-i': {
    id: 'bug-slayer-i',
    title: 'Bug Slayer I',
    description: 'Fixed 5 bugs overall.',
    rarity: 'common',
    category: 'debugging',
    xp: 25,
  },
  'bug-slayer-ii': {
    id: 'bug-slayer-ii',
    title: 'Bug Slayer II',
    description: 'Fixed 25 bugs overall.',
    rarity: 'rare',
    category: 'debugging',
    xp: 80,
  },
  'bug-slayer-iii': {
    id: 'bug-slayer-iii',
    title: 'Bug Slayer III',
    description: 'Fixed 100 bugs overall.',
    rarity: 'legendary',
    category: 'debugging',
    xp: 180,
  },
  'clean-sweep': {
    id: 'clean-sweep',
    title: 'Clean Sweep',
    description: 'Ended a session with zero detected runtime errors.',
    rarity: 'rare',
    category: 'refactor',
    xp: 40,
  },
  'no-undo-ninja': {
    id: 'no-undo-ninja',
    title: 'No-Undo Ninja',
    description: '30 minutes of work without canceling generation.',
    rarity: 'rare',
    category: 'session',
    xp: 30,
    hidden: true,
  },
  'phoenix': {
    id: 'phoenix',
    title: 'Phoenix',
    description: 'Recovered quickly after a crash and kept going.',
    rarity: 'epic',
    category: 'debugging',
    xp: 60,
    hidden: true,
  },

  // --- Session (new) ---
  'early-bird': {
    id: 'early-bird',
    title: 'Early Bird',
    description: 'Started a session between 5am and 7am.',
    rarity: 'common',
    category: 'session',
    xp: 10,
  },
  'weekend-warrior': {
    id: 'weekend-warrior',
    title: 'Weekend Warrior',
    description: 'Coded on Saturday or Sunday.',
    rarity: 'common',
    category: 'session',
    xp: 15,
  },
  'deep-focus': {
    id: 'deep-focus',
    title: 'Deep Focus',
    description: '60+ min session with zero cancels and 5+ edits.',
    rarity: 'rare',
    category: 'session',
    xp: 35,
  },
  'centurion': {
    id: 'centurion',
    title: 'Centurion',
    description: 'Completed 100 sessions overall.',
    rarity: 'legendary',
    category: 'session',
    xp: 200,
  },

  // --- Debugging (new) ---
  'persistence': {
    id: 'persistence',
    title: 'Persistence',
    description: 'Fixed a bug after 3+ error cycles.',
    rarity: 'epic',
    category: 'debugging',
    xp: 55,
  },
  'first-blood': {
    id: 'first-blood',
    title: 'First Blood',
    description: 'First bug fix within 5 minutes of session start.',
    rarity: 'rare',
    category: 'debugging',
    xp: 25,
  },

  // --- Testing (new) ---
  'test-master-i': {
    id: 'test-master-i',
    title: 'Test Master I',
    description: '25 total test passes overall.',
    rarity: 'common',
    category: 'testing',
    xp: 20,
  },
  'test-master-ii': {
    id: 'test-master-ii',
    title: 'Test Master II',
    description: '100 total test passes overall.',
    rarity: 'rare',
    category: 'testing',
    xp: 60,
  },
  'test-master-iii': {
    id: 'test-master-iii',
    title: 'Test Master III',
    description: '500 total test passes overall.',
    rarity: 'legendary',
    category: 'testing',
    xp: 200,
  },
  'test-first': {
    id: 'test-first',
    title: 'Test First',
    description: 'Ran tests before making any edit in a session.',
    rarity: 'rare',
    category: 'testing',
    xp: 40,
  },

  // --- Refactor (new) ---
  'heavy-refactor': {
    id: 'heavy-refactor',
    title: 'Heavy Refactor',
    description: '10+ meaningful edits in one session.',
    rarity: 'rare',
    category: 'refactor',
    xp: 35,
  },
  'surgeon': {
    id: 'surgeon',
    title: 'Surgeon',
    description: '1-2 precise edits that fixed an error.',
    rarity: 'epic',
    category: 'refactor',
    xp: 45,
  },

  // --- Architecture (new category) ---
  'full-stack': {
    id: 'full-stack',
    title: 'Full Stack',
    description: 'Edited frontend and backend files in one session.',
    rarity: 'rare',
    category: 'architecture',
    xp: 40,
  },
  'file-explorer': {
    id: 'file-explorer',
    title: 'File Explorer',
    description: 'Touched 10+ files in one session.',
    rarity: 'rare',
    category: 'architecture',
    xp: 30,
  },

  // --- Collaboration (new) ---
  'multilingual-master': {
    id: 'multilingual-master',
    title: 'Multilingual Master',
    description: 'Used 5+ programming languages in one session.',
    rarity: 'epic',
    category: 'collaboration',
    xp: 60,
  },

  // --- Productivity (new category) ---
  'all-goals-met': {
    id: 'all-goals-met',
    title: 'All Goals Met',
    description: 'Completed every session goal.',
    rarity: 'epic',
    category: 'productivity',
    xp: 50,
  },
  'daily-streak-3': {
    id: 'daily-streak-3',
    title: 'Daily Streak 3',
    description: 'Coded 3 consecutive days.',
    rarity: 'rare',
    category: 'productivity',
    xp: 35,
  },
  'daily-streak-7': {
    id: 'daily-streak-7',
    title: 'Daily Streak 7',
    description: 'Coded 7 consecutive days.',
    rarity: 'epic',
    category: 'productivity',
    xp: 70,
  },

  // ========== EXPANSION: 35 new achievements ==========

  // --- Session (5 new) ---
  'lunch-break': {
    id: 'lunch-break',
    title: 'Lunch Break',
    description: 'Started a session between 12pm and 1pm.',
    rarity: 'common',
    category: 'session',
    xp: 10,
  },
  'sprint': {
    id: 'sprint',
    title: 'Sprint',
    description: 'Completed a productive session in under 15 minutes with 3+ edits.',
    rarity: 'rare',
    category: 'session',
    xp: 30,
  },
  'half-century': {
    id: 'half-century',
    title: 'Half Century',
    description: 'Completed 50 sessions overall.',
    rarity: 'rare',
    category: 'session',
    xp: 40,
  },
  'iron-will': {
    id: 'iron-will',
    title: 'Iron Will',
    description: '3+ hour session with 10+ edits.',
    rarity: 'epic',
    category: 'session',
    xp: 70,
  },
  'double-centurion': {
    id: 'double-centurion',
    title: 'Double Centurion',
    description: 'Completed 200 sessions overall.',
    rarity: 'legendary',
    category: 'session',
    xp: 250,
  },

  // --- Debugging (5 new) ---
  'zero-day': {
    id: 'zero-day',
    title: 'Zero Day',
    description: 'Fixed a bug within 2 minutes of session start.',
    rarity: 'rare',
    category: 'debugging',
    xp: 35,
  },
  'bug-squasher': {
    id: 'bug-squasher',
    title: 'Bug Squasher',
    description: 'Fixed 3+ bugs in a single session.',
    rarity: 'rare',
    category: 'debugging',
    xp: 35,
  },
  'error-whisperer': {
    id: 'error-whisperer',
    title: 'Error Whisperer',
    description: 'Fixed a bug on the very first edit attempt after the error.',
    rarity: 'epic',
    category: 'debugging',
    xp: 55,
  },
  'comeback-kid': {
    id: 'comeback-kid',
    title: 'Comeback Kid',
    description: 'Fixed 5+ runtime errors in a single session.',
    rarity: 'rare',
    category: 'debugging',
    xp: 35,
    hidden: true,
  },
  'bug-slayer-iv': {
    id: 'bug-slayer-iv',
    title: 'Bug Slayer IV',
    description: 'Fixed 250 bugs overall.',
    rarity: 'legendary',
    category: 'debugging',
    xp: 220,
  },

  // --- Testing (5 new) ---
  'test-marathon': {
    id: 'test-marathon',
    title: 'Test Marathon',
    description: 'Ran 10+ tests in a single session.',
    rarity: 'rare',
    category: 'testing',
    xp: 35,
  },
  'test-driven-dev': {
    id: 'test-driven-dev',
    title: 'Test Driven Dev',
    description: 'Fixed a bug and ran a passing test within 3 minutes.',
    rarity: 'rare',
    category: 'testing',
    xp: 40,
  },
  'quality-gate': {
    id: 'quality-gate',
    title: 'Quality Gate',
    description: 'Ended session with more test passes than bug fixes.',
    rarity: 'rare',
    category: 'testing',
    xp: 30,
  },
  'green-streak': {
    id: 'green-streak',
    title: 'Green Streak',
    description: '10 consecutive test passes without a failure.',
    rarity: 'epic',
    category: 'testing',
    xp: 65,
  },
  'test-master-iv': {
    id: 'test-master-iv',
    title: 'Test Master IV',
    description: '1,000 total test passes overall.',
    rarity: 'legendary',
    category: 'testing',
    xp: 250,
  },

  // --- Refactor (5 new) ---
  'tidy-up': {
    id: 'tidy-up',
    title: 'Tidy Up',
    description: 'Made 5+ edits in a session with zero runtime errors.',
    rarity: 'common',
    category: 'refactor',
    xp: 20,
  },
  'mega-refactor': {
    id: 'mega-refactor',
    title: 'Mega Refactor',
    description: '25+ meaningful edits in a single session.',
    rarity: 'epic',
    category: 'refactor',
    xp: 55,
  },
  'edit-veteran-i': {
    id: 'edit-veteran-i',
    title: 'Edit Veteran I',
    description: '500 total edits overall.',
    rarity: 'rare',
    category: 'refactor',
    xp: 40,
  },
  'edit-veteran-ii': {
    id: 'edit-veteran-ii',
    title: 'Edit Veteran II',
    description: '2,000 total edits overall.',
    rarity: 'epic',
    category: 'refactor',
    xp: 65,
  },
  'edit-veteran-iii': {
    id: 'edit-veteran-iii',
    title: 'Edit Veteran III',
    description: '5,000 total edits overall.',
    rarity: 'legendary',
    category: 'refactor',
    xp: 200,
  },

  // --- Architecture (5 new) ---
  'single-file-focus': {
    id: 'single-file-focus',
    title: 'Single File Focus',
    description: 'Made 5+ edits all within a single file.',
    rarity: 'common',
    category: 'architecture',
    xp: 15,
  },
  'config-wrangler': {
    id: 'config-wrangler',
    title: 'Config Wrangler',
    description: 'Edited a configuration file (JSON, YAML, TOML, or INI).',
    rarity: 'common',
    category: 'architecture',
    xp: 10,
  },
  'wide-reach': {
    id: 'wide-reach',
    title: 'Wide Reach',
    description: 'Touched 20+ files in one session.',
    rarity: 'epic',
    category: 'architecture',
    xp: 50,
  },
  'cross-stack': {
    id: 'cross-stack',
    title: 'Cross Stack',
    description: 'Touched frontend, backend, and config files in one session.',
    rarity: 'rare',
    category: 'architecture',
    xp: 40,
  },
  'project-architect': {
    id: 'project-architect',
    title: 'Project Architect',
    description: 'Touched 30+ files in one session.',
    rarity: 'epic',
    category: 'architecture',
    xp: 75,
  },

  // --- Collaboration (5 new) ---
  'bilingual': {
    id: 'bilingual',
    title: 'Bilingual',
    description: 'Used 2 programming languages in one session.',
    rarity: 'common',
    category: 'collaboration',
    xp: 15,
  },
  'markdown-author': {
    id: 'markdown-author',
    title: 'Markdown Author',
    description: 'Edited 3+ Markdown files in one session.',
    rarity: 'common',
    category: 'collaboration',
    xp: 15,
  },
  'docs-first': {
    id: 'docs-first',
    title: 'Docs First',
    description: 'The first file edited in the session was a Markdown file.',
    rarity: 'rare',
    category: 'collaboration',
    xp: 25,
    hidden: true,
  },
  'language-collector-i': {
    id: 'language-collector-i',
    title: 'Language Collector I',
    description: 'Used 7+ programming languages in one session.',
    rarity: 'epic',
    category: 'collaboration',
    xp: 70,
  },
  'language-collector-ii': {
    id: 'language-collector-ii',
    title: 'Language Collector II',
    description: 'Used 10+ programming languages in one session.',
    rarity: 'epic',
    category: 'collaboration',
    xp: 75,
  },

  // --- Productivity (5 new) ---
  'time-investor-i': {
    id: 'time-investor-i',
    title: 'Time Investor I',
    description: 'Accumulated 500 minutes of total session time.',
    rarity: 'common',
    category: 'productivity',
    xp: 20,
  },
  'time-investor-ii': {
    id: 'time-investor-ii',
    title: 'Time Investor II',
    description: 'Accumulated 2,000 minutes of total session time.',
    rarity: 'rare',
    category: 'productivity',
    xp: 45,
  },
  'time-investor-iii': {
    id: 'time-investor-iii',
    title: 'Time Investor III',
    description: 'Accumulated 5,000 minutes of total session time.',
    rarity: 'epic',
    category: 'productivity',
    xp: 65,
  },
  'daily-streak-14': {
    id: 'daily-streak-14',
    title: 'Daily Streak 14',
    description: 'Coded 14 consecutive days.',
    rarity: 'epic',
    category: 'productivity',
    xp: 75,
  },
  'daily-streak-30': {
    id: 'daily-streak-30',
    title: 'Daily Streak 30',
    description: 'Coded 30 consecutive days.',
    rarity: 'legendary',
    category: 'productivity',
    xp: 200,
  },
};

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG[id];
}
