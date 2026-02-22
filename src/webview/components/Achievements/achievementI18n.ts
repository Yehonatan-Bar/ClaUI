/**
 * Achievement feature i18n translations.
 * Supports English and Hebrew. Add more languages by extending the `translations` object.
 */

export type AchievementLang = 'en' | 'he';

export const ACHIEVEMENT_LANG_OPTIONS: { value: AchievementLang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'Hebrew' },
];

interface AchievementTranslations {
  // Panel UI
  achievements: string;
  level: string;
  xp: string;
  unlocked: string;
  sessionGoals: string;
  startSessionToGenerate: string;
  turnOffAchievements: string;
  trophy: string;
  close: string;
  dismiss: string;
  language: string;

  // Info modal
  aboutAchievements: string;
  infoWhatAre: string;
  infoWhatAreDesc: string;
  infoHowEarn: string;
  infoHowEarnDesc: string;
  infoRarities: string;
  infoRaritiesDesc: string;
  infoGoals: string;
  infoGoalsDesc: string;
  infoLevels: string;
  infoLevelsDesc: string;
  gotIt: string;

  // Rarity names
  rarityCommon: string;
  rarityRare: string;
  rarityEpic: string;
  rarityLegendary: string;

  // Session Recap
  sessionRecap: string;
  activeClaudeTime: string;
  totalSessionDuration: string;
  bugsFixed: string;
  passingTests: string;
  newBadges: string;
  xpGained: string;
  currentLevel: string;
  none: string;

  // Achievement catalog
  achNightOwlTitle: string;
  achNightOwlDesc: string;
  achMarathonTitle: string;
  achMarathonDesc: string;
  achPolyglotTitle: string;
  achPolyglotDesc: string;
  achHotStreakTitle: string;
  achHotStreakDesc: string;
  achGreenWaveTitle: string;
  achGreenWaveDesc: string;
  achSpeedPatchTitle: string;
  achSpeedPatchDesc: string;
  achBugSlayerITitle: string;
  achBugSlayerIDesc: string;
  achBugSlayerIITitle: string;
  achBugSlayerIIDesc: string;
  achBugSlayerIIITitle: string;
  achBugSlayerIIIDesc: string;
  achCleanSweepTitle: string;
  achCleanSweepDesc: string;
  achNoUndoNinjaTitle: string;
  achNoUndoNinjaDesc: string;
  achPhoenixTitle: string;
  achPhoenixDesc: string;

  // Goal names
  goalShipItSprint: string;
  goalRuntimeRescuer: string;
  goalTestTactician: string;
  goalRefactorRitual: string;
}

const en: AchievementTranslations = {
  achievements: 'Achievements',
  level: 'Level:',
  xp: 'XP:',
  unlocked: 'Unlocked:',
  sessionGoals: 'Session Goals',
  startSessionToGenerate: 'Start a session to generate goals.',
  turnOffAchievements: 'Turn Off Achievements',
  trophy: 'Trophy',
  close: 'Close',
  dismiss: 'Dismiss',
  language: 'Language',

  aboutAchievements: 'About Achievements',
  infoWhatAre: 'What are Achievements?',
  infoWhatAreDesc: 'Achievements are badges you earn by reaching milestones while coding with Claude. They track your productivity, debugging skills, testing habits, and session patterns.',
  infoHowEarn: 'How do I earn them?',
  infoHowEarnDesc: 'Achievements are awarded automatically based on your activity: fixing bugs, passing tests, coding at night, long sessions, using multiple languages, and more. Some are hidden until you discover them!',
  infoRarities: 'Rarity Levels',
  infoRaritiesDesc: 'Common (10-25 XP) - Basic milestones. Rare (30-80 XP) - Requires dedication. Epic (50-60 XP) - Impressive feats. Legendary (180 XP) - Master-level accomplishments.',
  infoGoals: 'Session Goals',
  infoGoalsDesc: 'Each session generates 2-3 goals based on the session context. Goals reset between sessions and give you short-term targets to aim for.',
  infoLevels: 'Leveling Up',
  infoLevelsDesc: 'XP earned from achievements contributes to your level. There are 10 levels total, each requiring progressively more XP.',
  gotIt: 'Got it',

  rarityCommon: 'Common',
  rarityRare: 'Rare',
  rarityEpic: 'Epic',
  rarityLegendary: 'Legendary',

  sessionRecap: 'Session Recap',
  activeClaudeTime: 'Active Claude Time:',
  totalSessionDuration: 'Total Session Duration:',
  bugsFixed: 'Bugs fixed:',
  passingTests: 'Passing tests:',
  newBadges: 'New badges:',
  xpGained: 'XP gained:',
  currentLevel: 'Current level:',
  none: 'None',

  achNightOwlTitle: 'Night Owl',
  achNightOwlDesc: 'Worked on code after midnight.',
  achMarathonTitle: 'Marathon',
  achMarathonDesc: 'Stayed in a single session for 2+ hours.',
  achPolyglotTitle: 'Polyglot',
  achPolyglotDesc: 'Used 3+ languages in one session.',
  achHotStreakTitle: 'Hot Streak',
  achHotStreakDesc: '3 bug fixes in 10 minutes.',
  achGreenWaveTitle: 'Green Wave',
  achGreenWaveDesc: '5 test passes in a row.',
  achSpeedPatchTitle: 'Speed Patch',
  achSpeedPatchDesc: 'Bug fix + passing test within 6 minutes.',
  achBugSlayerITitle: 'Bug Slayer I',
  achBugSlayerIDesc: 'Fixed 5 bugs overall.',
  achBugSlayerIITitle: 'Bug Slayer II',
  achBugSlayerIIDesc: 'Fixed 25 bugs overall.',
  achBugSlayerIIITitle: 'Bug Slayer III',
  achBugSlayerIIIDesc: 'Fixed 100 bugs overall.',
  achCleanSweepTitle: 'Clean Sweep',
  achCleanSweepDesc: 'Ended a session with zero detected runtime errors.',
  achNoUndoNinjaTitle: 'No-Undo Ninja',
  achNoUndoNinjaDesc: '30 minutes of work without canceling generation.',
  achPhoenixTitle: 'Phoenix',
  achPhoenixDesc: 'Recovered quickly after a crash and kept going.',

  goalShipItSprint: 'Ship It Sprint',
  goalRuntimeRescuer: 'Runtime Rescuer',
  goalTestTactician: 'Test Tactician',
  goalRefactorRitual: 'Refactor Ritual',
};

const he: AchievementTranslations = {
  achievements: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD',
  level: '\u05E8\u05DE\u05D4:',
  xp: 'XP:',
  unlocked: '\u05E0\u05E4\u05EA\u05D7\u05D5:',
  sessionGoals: '\u05D9\u05E2\u05D3\u05D9 \u05E1\u05E9\u05DF',
  startSessionToGenerate: '\u05D4\u05EA\u05D7\u05DC \u05E1\u05E9\u05DF \u05DB\u05D3\u05D9 \u05DC\u05D9\u05E6\u05D5\u05E8 \u05D9\u05E2\u05D3\u05D9\u05DD.',
  turnOffAchievements: '\u05DB\u05D1\u05D4 \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD',
  trophy: '\u05D2\u05D1\u05D9\u05E2',
  close: '\u05E1\u05D2\u05D5\u05E8',
  dismiss: '\u05E1\u05D2\u05D5\u05E8',
  language: '\u05E9\u05E4\u05D4',

  aboutAchievements: '\u05D0\u05D5\u05D3\u05D5\u05EA \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD',
  infoWhatAre: '\u05DE\u05D4\u05DD \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD?',
  infoWhatAreDesc: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05D4\u05DD \u05EA\u05D2\u05D9\u05DD \u05E9\u05DE\u05E8\u05D5\u05D5\u05D9\u05D7\u05D9\u05DD \u05DB\u05E9\u05DE\u05D2\u05D9\u05E2\u05D9\u05DD \u05DC\u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA \u05D1\u05E2\u05D1\u05D5\u05D3\u05D4 \u05E2\u05DD Claude. \u05D4\u05DD \u05E2\u05D5\u05E7\u05D1\u05D9\u05DD \u05D0\u05D7\u05E8 \u05D4\u05E4\u05E8\u05D5\u05D3\u05D5\u05E7\u05D8\u05D9\u05D1\u05D9\u05D5\u05EA, \u05DB\u05D9\u05E9\u05D5\u05E8\u05D9 \u05D3\u05D9\u05D1\u05D0\u05D2, \u05D4\u05E8\u05D2\u05DC\u05D9 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05D5\u05D3\u05E4\u05D5\u05E1\u05D9 \u05E1\u05E9\u05DF.',
  infoHowEarn: '\u05D0\u05D9\u05DA \u05DE\u05E8\u05D5\u05D5\u05D9\u05D7\u05D9\u05DD?',
  infoHowEarnDesc: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E0\u05D9\u05EA\u05E0\u05D9\u05DD \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05DC\u05E4\u05D9 \u05D4\u05E4\u05E2\u05D9\u05DC\u05D5\u05EA: \u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2\u05D9\u05DD, \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA, \u05E7\u05D9\u05D3\u05D5\u05D3 \u05D1\u05DC\u05D9\u05DC\u05D4, \u05E1\u05E9\u05E0\u05D9\u05DD \u05D0\u05E8\u05D5\u05DB\u05D9\u05DD, \u05E9\u05D9\u05DE\u05D5\u05E9 \u05D1\u05DE\u05E1\u05E4\u05E8 \u05E9\u05E4\u05D5\u05EA \u05D5\u05E2\u05D5\u05D3. \u05D7\u05DC\u05E7\u05DD \u05E0\u05E1\u05EA\u05E8\u05D9\u05DD \u05E2\u05D3 \u05E9\u05EA\u05D2\u05DC\u05D5!',
  infoRarities: '\u05E8\u05DE\u05D5\u05EA \u05E0\u05D3\u05D9\u05E8\u05D5\u05EA',
  infoRaritiesDesc: '\u05E8\u05D2\u05D9\u05DC (10-25 XP) - \u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA \u05D1\u05E1\u05D9\u05E1\u05D9\u05D9\u05DD. \u05E0\u05D3\u05D9\u05E8 (30-80 XP) - \u05D3\u05D5\u05E8\u05E9 \u05DE\u05E1\u05D9\u05E8\u05D5\u05EA. \u05D0\u05E4\u05D9 (50-60 XP) - \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05DE\u05E8\u05E9\u05D9\u05DE\u05D9\u05DD. \u05D0\u05D2\u05D3\u05D9 (180 XP) - \u05D4\u05D9\u05E9\u05D2\u05D9 \u05DE\u05D0\u05E1\u05D8\u05E8.',
  infoGoals: '\u05D9\u05E2\u05D3\u05D9 \u05E1\u05E9\u05DF',
  infoGoalsDesc: '\u05DB\u05DC \u05E1\u05E9\u05DF \u05DE\u05D9\u05D9\u05E6\u05E8 2-3 \u05D9\u05E2\u05D3\u05D9\u05DD \u05DC\u05E4\u05D9 \u05D4\u05D4\u05E7\u05E9\u05E8. \u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05DE\u05EA\u05D0\u05E4\u05E1\u05D9\u05DD \u05D1\u05D9\u05DF \u05E1\u05E9\u05E0\u05D9\u05DD \u05D5\u05E0\u05D5\u05EA\u05E0\u05D9\u05DD \u05DC\u05DA \u05DE\u05D8\u05E8\u05D5\u05EA \u05DC\u05D8\u05D5\u05D5\u05D7 \u05E7\u05E6\u05E8.',
  infoLevels: '\u05E2\u05DC\u05D9\u05D9\u05D4 \u05D1\u05E8\u05DE\u05D4',
  infoLevelsDesc: 'XP \u05DE\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05EA\u05D5\u05E8\u05DD \u05DC\u05E8\u05DE\u05D4 \u05E9\u05DC\u05DA. \u05D9\u05E9 10 \u05E8\u05DE\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC, \u05DB\u05DC \u05D0\u05D7\u05EA \u05D3\u05D5\u05E8\u05E9\u05EA \u05D9\u05D5\u05EA\u05E8 XP.',
  gotIt: '\u05D4\u05D1\u05E0\u05EA\u05D9',

  rarityCommon: '\u05E8\u05D2\u05D9\u05DC',
  rarityRare: '\u05E0\u05D3\u05D9\u05E8',
  rarityEpic: '\u05D0\u05E4\u05D9',
  rarityLegendary: '\u05D0\u05D2\u05D3\u05D9',

  sessionRecap: '\u05E1\u05D9\u05DB\u05D5\u05DD \u05E1\u05E9\u05DF',
  activeClaudeTime: '\u05D6\u05DE\u05DF \u05E4\u05E2\u05D9\u05DC \u05E9\u05DC Claude:',
  totalSessionDuration: '\u05DE\u05E9\u05DA \u05D4\u05E1\u05E9\u05DF \u05D4\u05DB\u05D5\u05DC\u05DC:',
  bugsFixed: '\u05D1\u05D0\u05D2\u05D9\u05DD \u05E9\u05EA\u05D5\u05E7\u05E0\u05D5:',
  passingTests: '\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA:',
  newBadges: '\u05EA\u05D2\u05D9\u05DD \u05D7\u05D3\u05E9\u05D9\u05DD:',
  xpGained: 'XP \u05E9\u05E0\u05E6\u05D1\u05E8:',
  currentLevel: '\u05E8\u05DE\u05D4 \u05E0\u05D5\u05DB\u05D7\u05D9\u05EA:',
  none: '\u05D0\u05D9\u05DF',

  achNightOwlTitle: '\u05D9\u05E0\u05E9\u05D5\u05E3 \u05DC\u05D9\u05DC\u05D4',
  achNightOwlDesc: '\u05E2\u05D1\u05D3\u05EA \u05E2\u05DC \u05E7\u05D5\u05D3 \u05D0\u05D7\u05E8\u05D9 \u05D7\u05E6\u05D5\u05EA.',
  achMarathonTitle: '\u05DE\u05E8\u05EA\u05D5\u05DF',
  achMarathonDesc: '\u05E0\u05E9\u05D0\u05E8\u05EA \u05D1\u05E1\u05E9\u05DF \u05D9\u05D7\u05D9\u05D3 \u05DC\u05DE\u05E2\u05DC\u05D4 \u05DE\u05E9\u05E2\u05EA\u05D9\u05D9\u05DD.',
  achPolyglotTitle: '\u05E4\u05D5\u05DC\u05D9\u05D2\u05DC\u05D5\u05D8',
  achPolyglotDesc: '\u05D4\u05E9\u05EA\u05DE\u05E9\u05EA \u05D1-3+ \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achHotStreakTitle: '\u05E8\u05E6\u05E3 \u05D7\u05DD',
  achHotStreakDesc: '3 \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1-10 \u05D3\u05E7\u05D5\u05EA.',
  achGreenWaveTitle: '\u05D2\u05DC \u05D9\u05E8\u05D5\u05E7',
  achGreenWaveDesc: '5 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E8\u05E6\u05E3.',
  achSpeedPatchTitle: '\u05EA\u05D9\u05E7\u05D5\u05DF \u05DE\u05D4\u05D9\u05E8',
  achSpeedPatchDesc: '\u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2 + \u05D1\u05D3\u05D9\u05E7\u05D4 \u05E2\u05D5\u05D1\u05E8\u05EA \u05EA\u05D5\u05DA 6 \u05D3\u05E7\u05D5\u05EA.',
  achBugSlayerITitle: '\u05E6\u05D9\u05D9\u05D3 \u05D1\u05D0\u05D2\u05D9\u05DD I',
  achBugSlayerIDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA 5 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achBugSlayerIITitle: '\u05E6\u05D9\u05D9\u05D3 \u05D1\u05D0\u05D2\u05D9\u05DD II',
  achBugSlayerIIDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA 25 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achBugSlayerIIITitle: '\u05E6\u05D9\u05D9\u05D3 \u05D1\u05D0\u05D2\u05D9\u05DD III',
  achBugSlayerIIIDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA 100 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achCleanSweepTitle: '\u05E0\u05D9\u05E7\u05D9\u05D5\u05DF \u05DE\u05DC\u05D0',
  achCleanSweepDesc: '\u05E1\u05D9\u05D9\u05DE\u05EA \u05E1\u05E9\u05DF \u05D1\u05DC\u05D9 \u05E9\u05D2\u05D9\u05D0\u05D5\u05EA \u05E8\u05D9\u05E6\u05D4.',
  achNoUndoNinjaTitle: '\u05E0\u05D9\u05E0\u05D2\u05B4\u05D4 \u05DC\u05DC\u05D0 \u05D1\u05D9\u05D8\u05D5\u05DC',
  achNoUndoNinjaDesc: '30 \u05D3\u05E7\u05D5\u05EA \u05E2\u05D1\u05D5\u05D3\u05D4 \u05D1\u05DC\u05D9 \u05DC\u05D1\u05D8\u05DC \u05D9\u05D9\u05E6\u05D5\u05E8.',
  achPhoenixTitle: '\u05E4\u05E0\u05D9\u05E7\u05E1',
  achPhoenixDesc: '\u05D4\u05EA\u05D0\u05D5\u05E9\u05E9\u05EA \u05DE\u05D4\u05E8 \u05D0\u05D7\u05E8\u05D9 \u05E7\u05E8\u05D9\u05E1\u05D4 \u05D5\u05D4\u05DE\u05E9\u05DB\u05EA.',

  goalShipItSprint: '\u05E1\u05E4\u05E8\u05D9\u05E0\u05D8 \u05E9\u05D9\u05DC\u05D5\u05D7',
  goalRuntimeRescuer: '\u05DE\u05E6\u05D9\u05DC \u05E8\u05D9\u05E6\u05D4',
  goalTestTactician: '\u05D8\u05E7\u05D8\u05D9\u05E7\u05DF \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA',
  goalRefactorRitual: '\u05D8\u05E7\u05E1 \u05E8\u05D9\u05E4\u05E7\u05D8\u05D5\u05E8',
};

const translations: Record<AchievementLang, AchievementTranslations> = { en, he };

export function t(lang: AchievementLang): AchievementTranslations {
  return translations[lang] ?? translations.en;
}

/** Map an achievement ID to its translated title */
const ACH_TITLE_MAP: Record<string, keyof AchievementTranslations> = {
  'night-owl': 'achNightOwlTitle',
  'marathon': 'achMarathonTitle',
  'polyglot': 'achPolyglotTitle',
  'hot-streak': 'achHotStreakTitle',
  'green-wave': 'achGreenWaveTitle',
  'speed-patch': 'achSpeedPatchTitle',
  'bug-slayer-i': 'achBugSlayerITitle',
  'bug-slayer-ii': 'achBugSlayerIITitle',
  'bug-slayer-iii': 'achBugSlayerIIITitle',
  'clean-sweep': 'achCleanSweepTitle',
  'no-undo-ninja': 'achNoUndoNinjaTitle',
  'phoenix': 'achPhoenixTitle',
};

const ACH_DESC_MAP: Record<string, keyof AchievementTranslations> = {
  'night-owl': 'achNightOwlDesc',
  'marathon': 'achMarathonDesc',
  'polyglot': 'achPolyglotDesc',
  'hot-streak': 'achHotStreakDesc',
  'green-wave': 'achGreenWaveDesc',
  'speed-patch': 'achSpeedPatchDesc',
  'bug-slayer-i': 'achBugSlayerIDesc',
  'bug-slayer-ii': 'achBugSlayerIIDesc',
  'bug-slayer-iii': 'achBugSlayerIIIDesc',
  'clean-sweep': 'achCleanSweepDesc',
  'no-undo-ninja': 'achNoUndoNinjaDesc',
  'phoenix': 'achPhoenixDesc',
};

const GOAL_TITLE_MAP: Record<string, keyof AchievementTranslations> = {
  'ship-it-sprint': 'goalShipItSprint',
  'runtime-rescuer': 'goalRuntimeRescuer',
  'test-tactician': 'goalTestTactician',
  'refactor-ritual': 'goalRefactorRitual',
};

export function tAchTitle(lang: AchievementLang, id: string, fallback: string): string {
  const key = ACH_TITLE_MAP[id];
  if (!key) return fallback;
  const tr = t(lang);
  return tr[key] ?? fallback;
}

export function tAchDesc(lang: AchievementLang, id: string, fallback: string): string {
  const key = ACH_DESC_MAP[id];
  if (!key) return fallback;
  const tr = t(lang);
  return tr[key] ?? fallback;
}

export function tGoalTitle(lang: AchievementLang, id: string, fallback: string): string {
  const key = GOAL_TITLE_MAP[id];
  if (!key) return fallback;
  const tr = t(lang);
  return tr[key] ?? fallback;
}
