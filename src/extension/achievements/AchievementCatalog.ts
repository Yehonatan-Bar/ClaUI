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
};

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG[id];
}
