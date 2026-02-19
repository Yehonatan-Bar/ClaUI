export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementCategory =
  | 'debugging'
  | 'testing'
  | 'refactor'
  | 'collaboration'
  | 'session';

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
};

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG[id];
}
