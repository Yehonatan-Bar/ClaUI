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
  infoAiInsight: string;
  infoAiInsightDesc: string;
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
  filesTouchedLabel: string;
  languagesUsedLabel: string;
  aiInsightLabel: string;
  aiXpBonusLabel: string;
  codingPatternLabel: string;

  // --- Original 12 achievements ---
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

  // --- 18 new achievements ---
  achEarlyBirdTitle: string;
  achEarlyBirdDesc: string;
  achWeekendWarriorTitle: string;
  achWeekendWarriorDesc: string;
  achDeepFocusTitle: string;
  achDeepFocusDesc: string;
  achCenturionTitle: string;
  achCenturionDesc: string;
  achPersistenceTitle: string;
  achPersistenceDesc: string;
  achFirstBloodTitle: string;
  achFirstBloodDesc: string;
  achTestMasterITitle: string;
  achTestMasterIDesc: string;
  achTestMasterIITitle: string;
  achTestMasterIIDesc: string;
  achTestMasterIIITitle: string;
  achTestMasterIIIDesc: string;
  achTestFirstTitle: string;
  achTestFirstDesc: string;
  achHeavyRefactorTitle: string;
  achHeavyRefactorDesc: string;
  achSurgeonTitle: string;
  achSurgeonDesc: string;
  achFullStackTitle: string;
  achFullStackDesc: string;
  achFileExplorerTitle: string;
  achFileExplorerDesc: string;
  achMultilingualMasterTitle: string;
  achMultilingualMasterDesc: string;
  achAllGoalsMetTitle: string;
  achAllGoalsMetDesc: string;
  achDailyStreak3Title: string;
  achDailyStreak3Desc: string;
  achDailyStreak7Title: string;
  achDailyStreak7Desc: string;

  // Goal names (original + new)
  goalShipItSprint: string;
  goalRuntimeRescuer: string;
  goalTestTactician: string;
  goalRefactorRitual: string;
  goalFileHopper: string;
  goalErrorFree: string;
  goalLanguageSampler: string;
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
  infoHowEarnDesc: 'Achievements are awarded automatically based on your activity: fixing bugs, passing tests, coding at night, long sessions, using multiple languages, daily consistency, and more. Some are hidden until you discover them!',
  infoRarities: 'Rarity Levels',
  infoRaritiesDesc: 'Common (10-25 XP) - Basic milestones. Rare (25-80 XP) - Requires dedication. Epic (45-70 XP) - Impressive feats. Legendary (180-200 XP) - Master-level accomplishments.',
  infoGoals: 'Session Goals',
  infoGoalsDesc: 'Each session generates 3-4 goals based on the session context. Goals reset between sessions and give you short-term targets to aim for.',
  infoLevels: 'Leveling Up',
  infoLevelsDesc: 'XP earned from achievements contributes to your level. There are 15 levels total, each requiring progressively more XP.',
  infoAiInsight: 'AI Session Insights',
  infoAiInsightDesc: 'Once per day, an AI analysis provides deeper insights about your coding session - quality rating, coding pattern detection, and bonus XP.',
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
  filesTouchedLabel: 'Files touched:',
  languagesUsedLabel: 'Languages:',
  aiInsightLabel: 'AI Insight',
  aiXpBonusLabel: 'AI Bonus:',
  codingPatternLabel: 'Pattern:',

  // --- Original 12 ---
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

  // --- 18 new achievements ---
  achEarlyBirdTitle: 'Early Bird',
  achEarlyBirdDesc: 'Started a session between 5am and 7am.',
  achWeekendWarriorTitle: 'Weekend Warrior',
  achWeekendWarriorDesc: 'Coded on Saturday or Sunday.',
  achDeepFocusTitle: 'Deep Focus',
  achDeepFocusDesc: '60+ min session with zero cancels and 5+ edits.',
  achCenturionTitle: 'Centurion',
  achCenturionDesc: 'Completed 100 sessions overall.',
  achPersistenceTitle: 'Persistence',
  achPersistenceDesc: 'Fixed a bug after 3+ error cycles.',
  achFirstBloodTitle: 'First Blood',
  achFirstBloodDesc: 'First bug fix within 5 minutes of session start.',
  achTestMasterITitle: 'Test Master I',
  achTestMasterIDesc: '25 total test passes overall.',
  achTestMasterIITitle: 'Test Master II',
  achTestMasterIIDesc: '100 total test passes overall.',
  achTestMasterIIITitle: 'Test Master III',
  achTestMasterIIIDesc: '500 total test passes overall.',
  achTestFirstTitle: 'Test First',
  achTestFirstDesc: 'Ran tests before making any edit in a session.',
  achHeavyRefactorTitle: 'Heavy Refactor',
  achHeavyRefactorDesc: '10+ meaningful edits in one session.',
  achSurgeonTitle: 'Surgeon',
  achSurgeonDesc: '1-2 precise edits that fixed an error.',
  achFullStackTitle: 'Full Stack',
  achFullStackDesc: 'Edited frontend and backend files in one session.',
  achFileExplorerTitle: 'File Explorer',
  achFileExplorerDesc: 'Touched 10+ files in one session.',
  achMultilingualMasterTitle: 'Multilingual Master',
  achMultilingualMasterDesc: 'Used 5+ programming languages in one session.',
  achAllGoalsMetTitle: 'All Goals Met',
  achAllGoalsMetDesc: 'Completed every session goal.',
  achDailyStreak3Title: 'Daily Streak 3',
  achDailyStreak3Desc: 'Coded 3 consecutive days.',
  achDailyStreak7Title: 'Daily Streak 7',
  achDailyStreak7Desc: 'Coded 7 consecutive days.',

  // Goals
  goalShipItSprint: 'Ship It Sprint',
  goalRuntimeRescuer: 'Runtime Rescuer',
  goalTestTactician: 'Test Tactician',
  goalRefactorRitual: 'Refactor Ritual',
  goalFileHopper: 'File Hopper',
  goalErrorFree: 'Error Free',
  goalLanguageSampler: 'Language Sampler',
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
  infoHowEarnDesc: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E0\u05D9\u05EA\u05E0\u05D9\u05DD \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05DC\u05E4\u05D9 \u05D4\u05E4\u05E2\u05D9\u05DC\u05D5\u05EA: \u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2\u05D9\u05DD, \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA, \u05E7\u05D9\u05D3\u05D5\u05D3 \u05D1\u05DC\u05D9\u05DC\u05D4, \u05E1\u05E9\u05E0\u05D9\u05DD \u05D0\u05E8\u05D5\u05DB\u05D9\u05DD, \u05E9\u05D9\u05DE\u05D5\u05E9 \u05D1\u05DE\u05E1\u05E4\u05E8 \u05E9\u05E4\u05D5\u05EA, \u05E2\u05E7\u05D1\u05D9\u05D5\u05EA \u05D9\u05D5\u05DE\u05D9\u05EA \u05D5\u05E2\u05D5\u05D3. \u05D7\u05DC\u05E7\u05DD \u05E0\u05E1\u05EA\u05E8\u05D9\u05DD \u05E2\u05D3 \u05E9\u05EA\u05D2\u05DC\u05D5!',
  infoRarities: '\u05E8\u05DE\u05D5\u05EA \u05E0\u05D3\u05D9\u05E8\u05D5\u05EA',
  infoRaritiesDesc: '\u05E8\u05D2\u05D9\u05DC (10-25 XP) - \u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA \u05D1\u05E1\u05D9\u05E1\u05D9\u05D9\u05DD. \u05E0\u05D3\u05D9\u05E8 (25-80 XP) - \u05D3\u05D5\u05E8\u05E9 \u05DE\u05E1\u05D9\u05E8\u05D5\u05EA. \u05D0\u05E4\u05D9 (45-70 XP) - \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05DE\u05E8\u05E9\u05D9\u05DE\u05D9\u05DD. \u05D0\u05D2\u05D3\u05D9 (180-200 XP) - \u05D4\u05D9\u05E9\u05D2\u05D9 \u05DE\u05D0\u05E1\u05D8\u05E8.',
  infoGoals: '\u05D9\u05E2\u05D3\u05D9 \u05E1\u05E9\u05DF',
  infoGoalsDesc: '\u05DB\u05DC \u05E1\u05E9\u05DF \u05DE\u05D9\u05D9\u05E6\u05E8 3-4 \u05D9\u05E2\u05D3\u05D9\u05DD \u05DC\u05E4\u05D9 \u05D4\u05D4\u05E7\u05E9\u05E8. \u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05DE\u05EA\u05D0\u05E4\u05E1\u05D9\u05DD \u05D1\u05D9\u05DF \u05E1\u05E9\u05E0\u05D9\u05DD \u05D5\u05E0\u05D5\u05EA\u05E0\u05D9\u05DD \u05DC\u05DA \u05DE\u05D8\u05E8\u05D5\u05EA \u05DC\u05D8\u05D5\u05D5\u05D7 \u05E7\u05E6\u05E8.',
  infoLevels: '\u05E2\u05DC\u05D9\u05D9\u05D4 \u05D1\u05E8\u05DE\u05D4',
  infoLevelsDesc: 'XP \u05DE\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05EA\u05D5\u05E8\u05DD \u05DC\u05E8\u05DE\u05D4 \u05E9\u05DC\u05DA. \u05D9\u05E9 15 \u05E8\u05DE\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC, \u05DB\u05DC \u05D0\u05D7\u05EA \u05D3\u05D5\u05E8\u05E9\u05EA \u05D9\u05D5\u05EA\u05E8 XP.',
  infoAiInsight: '\u05EA\u05D5\u05D1\u05E0\u05D5\u05EA AI \u05DC\u05E1\u05E9\u05DF',
  infoAiInsightDesc: '\u05E4\u05E2\u05DD \u05D1\u05D9\u05D5\u05DD, \u05E0\u05D9\u05EA\u05D5\u05D7 AI \u05DE\u05E1\u05E4\u05E7 \u05EA\u05D5\u05D1\u05E0\u05D5\u05EA \u05DE\u05E2\u05DE\u05D9\u05E7\u05D5\u05EA \u05E2\u05DC \u05E1\u05E9\u05DF \u05D4\u05E7\u05D9\u05D3\u05D5\u05D3 - \u05D3\u05D9\u05E8\u05D5\u05D2 \u05D0\u05D9\u05DB\u05D5\u05EA, \u05D6\u05D9\u05D4\u05D5\u05D9 \u05D3\u05E4\u05D5\u05E1\u05D9\u05DD \u05D5\u05D1\u05D5\u05E0\u05D5\u05E1 XP.',
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
  filesTouchedLabel: '\u05E7\u05D1\u05E6\u05D9\u05DD \u05E9\u05E0\u05D5\u05D2\u05E2\u05D5:',
  languagesUsedLabel: '\u05E9\u05E4\u05D5\u05EA:',
  aiInsightLabel: '\u05EA\u05D5\u05D1\u05E0\u05EA AI',
  aiXpBonusLabel: '\u05D1\u05D5\u05E0\u05D5\u05E1 AI:',
  codingPatternLabel: '\u05D3\u05E4\u05D5\u05E1:',

  // --- Original 12 ---
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

  // --- 18 new achievements ---
  achEarlyBirdTitle: '\u05DE\u05E9\u05DB\u05D9\u05DD',
  achEarlyBirdDesc: '\u05D4\u05EA\u05D7\u05DC\u05EA \u05E1\u05E9\u05DF \u05D1\u05D9\u05DF 5 \u05DC-7 \u05D1\u05D1\u05D5\u05E7\u05E8.',
  achWeekendWarriorTitle: '\u05DC\u05D5\u05D7\u05DD \u05E1\u05D5\u05E3 \u05E9\u05D1\u05D5\u05E2',
  achWeekendWarriorDesc: '\u05E7\u05D9\u05D3\u05D3\u05EA \u05D1\u05E9\u05D1\u05EA \u05D0\u05D5 \u05D1\u05D9\u05D5\u05DD \u05E8\u05D0\u05E9\u05D5\u05DF.',
  achDeepFocusTitle: '\u05E8\u05D9\u05DB\u05D5\u05D6 \u05E2\u05DE\u05D5\u05E7',
  achDeepFocusDesc: '\u05E1\u05E9\u05DF \u05E9\u05DC 60+ \u05D3\u05E7\u05D5\u05EA, \u05D0\u05E4\u05E1 \u05D1\u05D9\u05D8\u05D5\u05DC\u05D9\u05DD \u05D5-5+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA.',
  achCenturionTitle: '\u05E7\u05E0\u05D8\u05D5\u05E8\u05D9\u05D5\u05DF',
  achCenturionDesc: '\u05D4\u05E9\u05DC\u05DE\u05EA 100 \u05E1\u05E9\u05E0\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achPersistenceTitle: '\u05D4\u05EA\u05DE\u05D3\u05D4',
  achPersistenceDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA \u05D1\u05D0\u05D2 \u05D0\u05D7\u05E8\u05D9 3+ \u05DE\u05D7\u05D6\u05D5\u05E8\u05D9 \u05E9\u05D2\u05D9\u05D0\u05D4.',
  achFirstBloodTitle: '\u05D3\u05DD \u05E8\u05D0\u05E9\u05D5\u05DF',
  achFirstBloodDesc: '\u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2 \u05E8\u05D0\u05E9\u05D5\u05DF \u05EA\u05D5\u05DA 5 \u05D3\u05E7\u05D5\u05EA \u05DE\u05EA\u05D7\u05D9\u05DC\u05EA \u05D4\u05E1\u05E9\u05DF.',
  achTestMasterITitle: '\u05DE\u05D0\u05E1\u05D8\u05E8 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA I',
  achTestMasterIDesc: '25 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTestMasterIITitle: '\u05DE\u05D0\u05E1\u05D8\u05E8 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA II',
  achTestMasterIIDesc: '100 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTestMasterIIITitle: '\u05DE\u05D0\u05E1\u05D8\u05E8 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA III',
  achTestMasterIIIDesc: '500 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTestFirstTitle: '\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E7\u05D5\u05D3\u05DD',
  achTestFirstDesc: '\u05D4\u05E8\u05E6\u05EA \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05DC\u05E4\u05E0\u05D9 \u05DB\u05DC \u05E2\u05E8\u05D9\u05DB\u05D4 \u05D1\u05E1\u05E9\u05DF.',
  achHeavyRefactorTitle: '\u05E8\u05D9\u05E4\u05E7\u05D8\u05D5\u05E8 \u05DB\u05D1\u05D3',
  achHeavyRefactorDesc: '10+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05DE\u05E9\u05DE\u05E2\u05D5\u05EA\u05D9\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achSurgeonTitle: '\u05DE\u05E0\u05EA\u05D7',
  achSurgeonDesc: '1-2 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05DE\u05D3\u05D5\u05D9\u05E7\u05D5\u05EA \u05E9\u05EA\u05D9\u05E7\u05E0\u05D5 \u05E9\u05D2\u05D9\u05D0\u05D4.',
  achFullStackTitle: '\u05E4\u05D5\u05DC \u05E1\u05D8\u05D0\u05E7',
  achFullStackDesc: '\u05E2\u05E8\u05DB\u05EA \u05E7\u05D1\u05E6\u05D9 \u05E4\u05E8\u05D5\u05E0\u05D8 \u05D5\u05D1\u05E7\u05D0\u05E0\u05D3 \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achFileExplorerTitle: '\u05D7\u05D5\u05E7\u05E8 \u05E7\u05D1\u05E6\u05D9\u05DD',
  achFileExplorerDesc: '\u05E0\u05D2\u05E2\u05EA \u05D1-10+ \u05E7\u05D1\u05E6\u05D9\u05DD \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achMultilingualMasterTitle: '\u05DE\u05D0\u05E1\u05D8\u05E8 \u05E8\u05D1 \u05DC\u05E9\u05D5\u05E0\u05D9',
  achMultilingualMasterDesc: '\u05D4\u05E9\u05EA\u05DE\u05E9\u05EA \u05D1-5+ \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achAllGoalsMetTitle: '\u05DB\u05DC \u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05D4\u05D5\u05E9\u05D2\u05D5',
  achAllGoalsMetDesc: '\u05D4\u05E9\u05DC\u05DE\u05EA \u05D0\u05EA \u05DB\u05DC \u05D9\u05E2\u05D3\u05D9 \u05D4\u05E1\u05E9\u05DF.',
  achDailyStreak3Title: '\u05E8\u05E6\u05E3 \u05D9\u05D5\u05DE\u05D9 3',
  achDailyStreak3Desc: '\u05E7\u05D9\u05D3\u05D3\u05EA 3 \u05D9\u05DE\u05D9\u05DD \u05E8\u05E6\u05D5\u05E4\u05D9\u05DD.',
  achDailyStreak7Title: '\u05E8\u05E6\u05E3 \u05D9\u05D5\u05DE\u05D9 7',
  achDailyStreak7Desc: '\u05E7\u05D9\u05D3\u05D3\u05EA 7 \u05D9\u05DE\u05D9\u05DD \u05E8\u05E6\u05D5\u05E4\u05D9\u05DD.',

  // Goals
  goalShipItSprint: '\u05E1\u05E4\u05E8\u05D9\u05E0\u05D8 \u05E9\u05D9\u05DC\u05D5\u05D7',
  goalRuntimeRescuer: '\u05DE\u05E6\u05D9\u05DC \u05E8\u05D9\u05E6\u05D4',
  goalTestTactician: '\u05D8\u05E7\u05D8\u05D9\u05E7\u05DF \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA',
  goalRefactorRitual: '\u05D8\u05E7\u05E1 \u05E8\u05D9\u05E4\u05E7\u05D8\u05D5\u05E8',
  goalFileHopper: '\u05E7\u05D5\u05E4\u05E5 \u05E7\u05D1\u05E6\u05D9\u05DD',
  goalErrorFree: '\u05DC\u05DC\u05D0 \u05E9\u05D2\u05D9\u05D0\u05D5\u05EA',
  goalLanguageSampler: '\u05D8\u05D5\u05E2\u05DD \u05E9\u05E4\u05D5\u05EA',
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
  // New
  'early-bird': 'achEarlyBirdTitle',
  'weekend-warrior': 'achWeekendWarriorTitle',
  'deep-focus': 'achDeepFocusTitle',
  'centurion': 'achCenturionTitle',
  'persistence': 'achPersistenceTitle',
  'first-blood': 'achFirstBloodTitle',
  'test-master-i': 'achTestMasterITitle',
  'test-master-ii': 'achTestMasterIITitle',
  'test-master-iii': 'achTestMasterIIITitle',
  'test-first': 'achTestFirstTitle',
  'heavy-refactor': 'achHeavyRefactorTitle',
  'surgeon': 'achSurgeonTitle',
  'full-stack': 'achFullStackTitle',
  'file-explorer': 'achFileExplorerTitle',
  'multilingual-master': 'achMultilingualMasterTitle',
  'all-goals-met': 'achAllGoalsMetTitle',
  'daily-streak-3': 'achDailyStreak3Title',
  'daily-streak-7': 'achDailyStreak7Title',
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
  // New
  'early-bird': 'achEarlyBirdDesc',
  'weekend-warrior': 'achWeekendWarriorDesc',
  'deep-focus': 'achDeepFocusDesc',
  'centurion': 'achCenturionDesc',
  'persistence': 'achPersistenceDesc',
  'first-blood': 'achFirstBloodDesc',
  'test-master-i': 'achTestMasterIDesc',
  'test-master-ii': 'achTestMasterIIDesc',
  'test-master-iii': 'achTestMasterIIIDesc',
  'test-first': 'achTestFirstDesc',
  'heavy-refactor': 'achHeavyRefactorDesc',
  'surgeon': 'achSurgeonDesc',
  'full-stack': 'achFullStackDesc',
  'file-explorer': 'achFileExplorerDesc',
  'multilingual-master': 'achMultilingualMasterDesc',
  'all-goals-met': 'achAllGoalsMetDesc',
  'daily-streak-3': 'achDailyStreak3Desc',
  'daily-streak-7': 'achDailyStreak7Desc',
};

const GOAL_TITLE_MAP: Record<string, keyof AchievementTranslations> = {
  'ship-it-sprint': 'goalShipItSprint',
  'runtime-rescuer': 'goalRuntimeRescuer',
  'test-tactician': 'goalTestTactician',
  'refactor-ritual': 'goalRefactorRitual',
  'file-hopper': 'goalFileHopper',
  'error-free': 'goalErrorFree',
  'language-sampler': 'goalLanguageSampler',
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
