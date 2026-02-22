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

  // Community / GitHub Sync
  community: string;
  share: string;
  connectGitHub: string;
  connectGitHubDesc: string;
  lastSynced: string;
  publishNow: string;
  disconnect: string;
  friends: string;
  compare: string;
  addFriend: string;
  addFriendPlaceholder: string;
  removeFriend: string;
  refreshFriends: string;
  noFriendsYet: string;
  selectFriendToCompare: string;
  achievementsLabel: string;
  you: string;
  metric: string;
  sessions: string;
  bugFixes: string;
  testsPassed: string;
  streak: string;
  copyMarkdownCard: string;
  copyShieldsBadge: string;
  copied: string;
  shareCardTitle: string;
  shareCardDesc: string;

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

  // --- 35 expansion achievements ---
  achLunchBreakTitle: string;
  achLunchBreakDesc: string;
  achSprintTitle: string;
  achSprintDesc: string;
  achHalfCenturyTitle: string;
  achHalfCenturyDesc: string;
  achIronWillTitle: string;
  achIronWillDesc: string;
  achDoubleCenturionTitle: string;
  achDoubleCenturionDesc: string;
  achZeroDayTitle: string;
  achZeroDayDesc: string;
  achBugSquasherTitle: string;
  achBugSquasherDesc: string;
  achErrorWhispererTitle: string;
  achErrorWhispererDesc: string;
  achComebackKidTitle: string;
  achComebackKidDesc: string;
  achBugSlayerIVTitle: string;
  achBugSlayerIVDesc: string;
  achTestMarathonTitle: string;
  achTestMarathonDesc: string;
  achTestDrivenDevTitle: string;
  achTestDrivenDevDesc: string;
  achQualityGateTitle: string;
  achQualityGateDesc: string;
  achGreenStreakTitle: string;
  achGreenStreakDesc: string;
  achTestMasterIVTitle: string;
  achTestMasterIVDesc: string;
  achTidyUpTitle: string;
  achTidyUpDesc: string;
  achMegaRefactorTitle: string;
  achMegaRefactorDesc: string;
  achEditVeteranITitle: string;
  achEditVeteranIDesc: string;
  achEditVeteranIITitle: string;
  achEditVeteranIIDesc: string;
  achEditVeteranIIITitle: string;
  achEditVeteranIIIDesc: string;
  achSingleFileFocusTitle: string;
  achSingleFileFocusDesc: string;
  achConfigWranglerTitle: string;
  achConfigWranglerDesc: string;
  achWideReachTitle: string;
  achWideReachDesc: string;
  achCrossStackTitle: string;
  achCrossStackDesc: string;
  achProjectArchitectTitle: string;
  achProjectArchitectDesc: string;
  achBilingualTitle: string;
  achBilingualDesc: string;
  achMarkdownAuthorTitle: string;
  achMarkdownAuthorDesc: string;
  achDocsFirstTitle: string;
  achDocsFirstDesc: string;
  achLanguageCollectorITitle: string;
  achLanguageCollectorIDesc: string;
  achLanguageCollectorIITitle: string;
  achLanguageCollectorIIDesc: string;
  achTimeInvestorITitle: string;
  achTimeInvestorIDesc: string;
  achTimeInvestorIITitle: string;
  achTimeInvestorIIDesc: string;
  achTimeInvestorIIITitle: string;
  achTimeInvestorIIIDesc: string;
  achDailyStreak14Title: string;
  achDailyStreak14Desc: string;
  achDailyStreak30Title: string;
  achDailyStreak30Desc: string;

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
  infoWhatAreDesc: 'Achievements are badges you unlock by reaching coding milestones while working with Claude. There are 65 achievements across 7 categories: Session, Debugging, Testing, Refactoring, Architecture, Collaboration, and Productivity. Each achievement awards XP that contributes to your level. Your progress is saved automatically and persists across sessions.',
  infoHowEarn: 'How do I earn them?',
  infoHowEarnDesc: 'Achievements are awarded automatically as you work. For example: fix bugs to earn Bug Slayer tiers, pass tests in a row for Green Wave, code after midnight for Night Owl, or maintain a daily streak. The system tracks bug fixes, test results, files edited, languages used, session duration, time of day, and more. Some achievements are hidden and only revealed when you unlock them.',
  infoRarities: 'Rarity Levels',
  infoRaritiesDesc: 'Each achievement has a rarity that reflects its difficulty. Common (10-25 XP): basic milestones like fixing your first few bugs. Rare (25-80 XP): requires consistent effort, such as 25 bug fixes or a 3-day streak. Epic (45-70 XP): impressive feats like 3 bug fixes in 10 minutes or 5 consecutive test passes. Legendary (150-250 XP): master-level accomplishments like 100 bug fixes or 500 test passes.',
  infoGoals: 'Session Goals',
  infoGoalsDesc: 'At the start of each session, 2-3 random goals are generated from a pool of 7 goal types (e.g., "Fix 2 bugs", "Pass 5 tests", "Touch 8 files"). Goals show a progress bar and reset between sessions. Completing all goals in a single session unlocks the "All Goals Met" achievement.',
  infoLevels: 'Leveling Up',
  infoLevelsDesc: 'Every achievement and AI bonus awards XP, which accumulates toward your level. There are 25 levels with increasing XP thresholds (Level 1 at 100 XP up to Level 25 at 14,500 XP). Your level, total XP, and unlocked achievements are saved globally and carry over between sessions and projects.',
  infoAiInsight: 'AI Session Insights',
  infoAiInsightDesc: 'Once per day, when a session ends, an AI analyzes your session metrics and provides a personalized insight. This includes a quality rating (exceptional, productive, steady, exploratory, or struggling), a detected coding pattern (deep-dive, breadth-first, iterative, planning-heavy, or test-driven), and an XP bonus of up to 25 points. The insight appears in your Session Recap card.',
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

  // Community / GitHub Sync
  community: 'Community',
  share: 'Share',
  connectGitHub: 'Connect GitHub',
  connectGitHubDesc: 'Share your achievements with other developers by publishing them to a public GitHub Gist. Other ClaUi users can discover and compare their stats with yours.',
  lastSynced: 'Last synced',
  publishNow: 'Publish',
  disconnect: 'Disconnect',
  friends: 'Friends',
  compare: 'Compare',
  addFriend: 'Add',
  addFriendPlaceholder: 'GitHub username...',
  removeFriend: 'Remove',
  refreshFriends: 'Refresh',
  noFriendsYet: 'No friends added yet. Add a GitHub username above to compare achievements.',
  selectFriendToCompare: 'Select a friend from the Friends tab to compare.',
  achievementsLabel: 'Achievements',
  you: 'You',
  metric: 'Metric',
  sessions: 'Sessions',
  bugFixes: 'Bug Fixes',
  testsPassed: 'Tests Passed',
  streak: 'Streak',
  copyMarkdownCard: 'Copy Markdown Card',
  copyShieldsBadge: 'Copy Shields Badge',
  copied: 'Copied!',
  shareCardTitle: 'Share Your Achievements',
  shareCardDesc: 'Copy a markdown card or badges for your GitHub README.',

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

  // --- 35 expansion achievements ---
  achLunchBreakTitle: 'Lunch Break',
  achLunchBreakDesc: 'Started a session between 12pm and 1pm.',
  achSprintTitle: 'Sprint',
  achSprintDesc: 'Session under 15 minutes with 3+ edits.',
  achHalfCenturyTitle: 'Half Century',
  achHalfCenturyDesc: 'Completed 50 sessions overall.',
  achIronWillTitle: 'Iron Will',
  achIronWillDesc: '3+ hour session with 10+ edits.',
  achDoubleCenturionTitle: 'Double Centurion',
  achDoubleCenturionDesc: 'Completed 200 sessions overall.',
  achZeroDayTitle: 'Zero Day',
  achZeroDayDesc: 'Fixed a bug within 2 minutes of session start.',
  achBugSquasherTitle: 'Bug Squasher',
  achBugSquasherDesc: 'Fixed 3+ bugs in one session.',
  achErrorWhispererTitle: 'Error Whisperer',
  achErrorWhispererDesc: 'Fixed a bug on the very first edit after an error.',
  achComebackKidTitle: 'Comeback Kid',
  achComebackKidDesc: '5+ runtime fixes in one session.',
  achBugSlayerIVTitle: 'Bug Slayer IV',
  achBugSlayerIVDesc: 'Fixed 250 bugs overall.',
  achTestMarathonTitle: 'Test Marathon',
  achTestMarathonDesc: '10+ test passes in one session.',
  achTestDrivenDevTitle: 'Test Driven Dev',
  achTestDrivenDevDesc: 'Bug fix + test pass within 3 minutes.',
  achQualityGateTitle: 'Quality Gate',
  achQualityGateDesc: 'Session with more test passes than bug fixes (min 2 tests).',
  achGreenStreakTitle: 'Green Streak',
  achGreenStreakDesc: '10 consecutive test passes.',
  achTestMasterIVTitle: 'Test Master IV',
  achTestMasterIVDesc: '1,000 total test passes.',
  achTidyUpTitle: 'Tidy Up',
  achTidyUpDesc: '5+ edits with zero runtime errors.',
  achMegaRefactorTitle: 'Mega Refactor',
  achMegaRefactorDesc: '25+ edits in one session.',
  achEditVeteranITitle: 'Edit Veteran I',
  achEditVeteranIDesc: '500 total edits overall.',
  achEditVeteranIITitle: 'Edit Veteran II',
  achEditVeteranIIDesc: '2,000 total edits overall.',
  achEditVeteranIIITitle: 'Edit Veteran III',
  achEditVeteranIIIDesc: '5,000 total edits overall.',
  achSingleFileFocusTitle: 'Single File Focus',
  achSingleFileFocusDesc: '5+ edits all in one file.',
  achConfigWranglerTitle: 'Config Wrangler',
  achConfigWranglerDesc: 'Edited a config file.',
  achWideReachTitle: 'Wide Reach',
  achWideReachDesc: 'Touched 20+ files in one session.',
  achCrossStackTitle: 'Cross Stack',
  achCrossStackDesc: 'Frontend + backend + config files in one session.',
  achProjectArchitectTitle: 'Project Architect',
  achProjectArchitectDesc: 'Touched 30+ files in one session.',
  achBilingualTitle: 'Bilingual',
  achBilingualDesc: '2+ programming languages in one session.',
  achMarkdownAuthorTitle: 'Markdown Author',
  achMarkdownAuthorDesc: 'Edited 3+ Markdown files.',
  achDocsFirstTitle: 'Docs First',
  achDocsFirstDesc: 'First file edited was a .md file.',
  achLanguageCollectorITitle: 'Language Collector I',
  achLanguageCollectorIDesc: '7+ languages in one session.',
  achLanguageCollectorIITitle: 'Language Collector II',
  achLanguageCollectorIIDesc: '10+ languages in one session.',
  achTimeInvestorITitle: 'Time Investor I',
  achTimeInvestorIDesc: '500 total session minutes.',
  achTimeInvestorIITitle: 'Time Investor II',
  achTimeInvestorIIDesc: '2,000 total session minutes.',
  achTimeInvestorIIITitle: 'Time Investor III',
  achTimeInvestorIIIDesc: '5,000 total session minutes.',
  achDailyStreak14Title: 'Daily Streak 14',
  achDailyStreak14Desc: 'Coded 14 consecutive days.',
  achDailyStreak30Title: 'Daily Streak 30',
  achDailyStreak30Desc: 'Coded 30 consecutive days.',

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
  infoWhatAreDesc: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05D4\u05DD \u05EA\u05D2\u05D9\u05DD \u05E9\u05E0\u05E4\u05EA\u05D7\u05D9\u05DD \u05DB\u05E9\u05DE\u05D2\u05D9\u05E2\u05D9\u05DD \u05DC\u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA \u05D1\u05E7\u05D9\u05D3\u05D5\u05D3 \u05E2\u05DD Claude. \u05D9\u05E9 65 \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05D1-7 \u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D5\u05EA: \u05E1\u05E9\u05DF, \u05D3\u05D9\u05D1\u05D0\u05D2, \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA, \u05E8\u05D9\u05E4\u05E7\u05D8\u05D5\u05E8, \u05D0\u05E8\u05DB\u05D9\u05D8\u05E7\u05D8\u05D5\u05E8\u05D4, \u05E9\u05D9\u05EA\u05D5\u05E3 \u05E4\u05E2\u05D5\u05DC\u05D4 \u05D5\u05E4\u05E8\u05D5\u05D3\u05D5\u05E7\u05D8\u05D9\u05D1\u05D9\u05D5\u05EA. \u05DB\u05DC \u05D4\u05D9\u05E9\u05D2 \u05DE\u05E2\u05E0\u05D9\u05E7 XP \u05E9\u05EA\u05D5\u05E8\u05DD \u05DC\u05E8\u05DE\u05D4 \u05E9\u05DC\u05DA. \u05D4\u05D4\u05EA\u05E7\u05D3\u05DE\u05D5\u05EA \u05E0\u05E9\u05DE\u05E8\u05EA \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05D5\u05E0\u05E9\u05DE\u05E8\u05EA \u05D1\u05D9\u05DF \u05E1\u05E9\u05E0\u05D9\u05DD.',
  infoHowEarn: '\u05D0\u05D9\u05DA \u05DE\u05E8\u05D5\u05D5\u05D9\u05D7\u05D9\u05DD?',
  infoHowEarnDesc: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E0\u05D9\u05EA\u05E0\u05D9\u05DD \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05EA\u05D5\u05DA \u05DB\u05D3\u05D9 \u05E2\u05D1\u05D5\u05D3\u05D4. \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4: \u05EA\u05E7\u05E0\u05D5 \u05D1\u05D0\u05D2\u05D9\u05DD \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E8\u05D5\u05D5\u05D9\u05D7 \u05D3\u05E8\u05D2\u05D5\u05EA \u05E9\u05DC "\u05E6\u05D9\u05D9\u05D3 \u05D1\u05D0\u05D2\u05D9\u05DD", \u05E2\u05D1\u05E8\u05D5 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05D1\u05E8\u05E6\u05E3 \u05DC"\u05D2\u05DC \u05D9\u05E8\u05D5\u05E7", \u05E7\u05D3\u05D3\u05D5 \u05D0\u05D7\u05E8\u05D9 \u05D7\u05E6\u05D5\u05EA \u05DC"\u05D9\u05E0\u05E9\u05D5\u05E3 \u05DC\u05D9\u05DC\u05D4", \u05D0\u05D5 \u05E9\u05DE\u05E8\u05D5 \u05E2\u05DC \u05E8\u05E6\u05E3 \u05D9\u05D5\u05DE\u05D9. \u05D4\u05DE\u05E2\u05E8\u05DB\u05EA \u05E2\u05D5\u05E7\u05D1\u05EA \u05D0\u05D7\u05E8 \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD, \u05EA\u05D5\u05E6\u05D0\u05D5\u05EA \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA, \u05E7\u05D1\u05E6\u05D9\u05DD \u05E9\u05E0\u05E2\u05E8\u05DB\u05D5, \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA, \u05DE\u05E9\u05DA \u05E1\u05E9\u05DF, \u05E9\u05E2\u05D4 \u05D1\u05D9\u05D5\u05DD \u05D5\u05E2\u05D5\u05D3. \u05D7\u05DC\u05E7 \u05DE\u05D4\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E0\u05E1\u05EA\u05E8\u05D9\u05DD \u05D5\u05E0\u05D7\u05E9\u05E4\u05D9\u05DD \u05E8\u05E7 \u05DB\u05E9\u05DE\u05E9\u05D9\u05D2\u05D9\u05DD \u05D0\u05D5\u05EA\u05DD!',
  infoRarities: '\u05E8\u05DE\u05D5\u05EA \u05E0\u05D3\u05D9\u05E8\u05D5\u05EA',
  infoRaritiesDesc: '\u05DC\u05DB\u05DC \u05D4\u05D9\u05E9\u05D2 \u05D9\u05E9 \u05D3\u05E8\u05D2\u05EA \u05E0\u05D3\u05D9\u05E8\u05D5\u05EA \u05E9\u05DE\u05E9\u05E7\u05E4\u05EA \u05D0\u05EA \u05D4\u05E7\u05D5\u05E9\u05D9. \u05E8\u05D2\u05D9\u05DC (10-25 XP): \u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA \u05D1\u05E1\u05D9\u05E1\u05D9\u05D9\u05DD \u05DB\u05DE\u05D5 \u05EA\u05D9\u05E7\u05D5\u05DF \u05D4\u05D1\u05D0\u05D2\u05D9\u05DD \u05D4\u05E8\u05D0\u05E9\u05D5\u05E0\u05D9\u05DD. \u05E0\u05D3\u05D9\u05E8 (25-80 XP): \u05D3\u05D5\u05E8\u05E9 \u05DE\u05D0\u05DE\u05E5 \u05E2\u05E7\u05D1\u05D9, \u05DB\u05DE\u05D5 25 \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D0\u05D5 \u05E8\u05E6\u05E3 \u05E9\u05DC 3 \u05D9\u05DE\u05D9\u05DD. \u05D0\u05E4\u05D9 (45-70 XP): \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05DE\u05E8\u05E9\u05D9\u05DE\u05D9\u05DD \u05DB\u05DE\u05D5 3 \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1-10 \u05D3\u05E7\u05D5\u05EA \u05D0\u05D5 5 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E8\u05E6\u05E3. \u05D0\u05D2\u05D3\u05D9 (150-250 XP): \u05D4\u05D9\u05E9\u05D2\u05D9 \u05DE\u05D0\u05E1\u05D8\u05E8 \u05DB\u05DE\u05D5 100 \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D0\u05D5 500 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA.',
  infoGoals: '\u05D9\u05E2\u05D3\u05D9 \u05E1\u05E9\u05DF',
  infoGoalsDesc: '\u05D1\u05EA\u05D7\u05D9\u05DC\u05EA \u05DB\u05DC \u05E1\u05E9\u05DF \u05E0\u05D1\u05D7\u05E8\u05D9\u05DD 2-3 \u05D9\u05E2\u05D3\u05D9\u05DD \u05D0\u05E7\u05E8\u05D0\u05D9\u05D9\u05DD \u05DE\u05EA\u05D5\u05DA 7 \u05E1\u05D5\u05D2\u05D9\u05DD (\u05DC\u05DE\u05E9\u05DC: "\u05EA\u05E7\u05DF 2 \u05D1\u05D0\u05D2\u05D9\u05DD", "\u05E2\u05D1\u05D5\u05E8 5 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA", "\u05D2\u05E2 \u05D1-8 \u05E7\u05D1\u05E6\u05D9\u05DD"). \u05DB\u05DC \u05D9\u05E2\u05D3 \u05DE\u05E6\u05D9\u05D2 \u05E4\u05E1 \u05D4\u05EA\u05E7\u05D3\u05DE\u05D5\u05EA \u05D5\u05DE\u05EA\u05D0\u05E4\u05E1 \u05D1\u05D9\u05DF \u05E1\u05E9\u05E0\u05D9\u05DD. \u05D4\u05E9\u05DC\u05DE\u05EA \u05DB\u05DC \u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3 \u05DE\u05E2\u05E0\u05D9\u05E7\u05D4 \u05D0\u05EA \u05D4\u05D4\u05D9\u05E9\u05D2 "\u05DB\u05DC \u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05D4\u05D5\u05E9\u05D2\u05D5".',
  infoLevels: '\u05E2\u05DC\u05D9\u05D9\u05D4 \u05D1\u05E8\u05DE\u05D4',
  infoLevelsDesc: '\u05DB\u05DC \u05D4\u05D9\u05E9\u05D2 \u05D5\u05D1\u05D5\u05E0\u05D5\u05E1 AI \u05DE\u05E2\u05E0\u05D9\u05E7\u05D9\u05DD XP, \u05E9\u05E0\u05E6\u05D1\u05E8 \u05DC\u05E7\u05E8\u05D0\u05EA \u05E8\u05DE\u05D4. \u05D9\u05E9 25 \u05E8\u05DE\u05D5\u05EA \u05E2\u05DD \u05E1\u05E4\u05D9\u05DD \u05E2\u05D5\u05DC\u05D9\u05DD (\u05E8\u05DE\u05D4 1 \u05D1-100 XP \u05E2\u05D3 \u05E8\u05DE\u05D4 25 \u05D1-14,500 XP). \u05D4\u05E8\u05DE\u05D4, \u05D4-XP \u05D4\u05DB\u05D5\u05DC\u05DC \u05D5\u05D4\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E9\u05E0\u05E4\u05EA\u05D7\u05D5 \u05E0\u05E9\u05DE\u05E8\u05D9\u05DD \u05D2\u05DC\u05D5\u05D1\u05DC\u05D9\u05EA \u05D5\u05E2\u05D5\u05D1\u05E8\u05D9\u05DD \u05D1\u05D9\u05DF \u05E1\u05E9\u05E0\u05D9\u05DD \u05D5\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD.',
  infoAiInsight: '\u05EA\u05D5\u05D1\u05E0\u05D5\u05EA AI \u05DC\u05E1\u05E9\u05DF',
  infoAiInsightDesc: '\u05E4\u05E2\u05DD \u05D1\u05D9\u05D5\u05DD, \u05D1\u05E1\u05D9\u05D5\u05DD \u05E1\u05E9\u05DF, AI \u05DE\u05E0\u05EA\u05D7 \u05D0\u05EA \u05DE\u05D3\u05D3\u05D9 \u05D4\u05E1\u05E9\u05DF \u05D5\u05DE\u05E1\u05E4\u05E7 \u05EA\u05D5\u05D1\u05E0\u05D4 \u05D0\u05D9\u05E9\u05D9\u05EA. \u05D4\u05EA\u05D5\u05D1\u05E0\u05D4 \u05DB\u05D5\u05DC\u05DC\u05EA \u05D3\u05D9\u05E8\u05D5\u05D2 \u05D0\u05D9\u05DB\u05D5\u05EA (\u05D9\u05D5\u05E6\u05D0 \u05DE\u05DF \u05D4\u05DB\u05DC\u05DC, \u05E4\u05E8\u05D5\u05D3\u05D5\u05E7\u05D8\u05D9\u05D1\u05D9, \u05D9\u05E6\u05D9\u05D1, \u05D7\u05E7\u05E8\u05E0\u05D9 \u05D0\u05D5 \u05DE\u05EA\u05E7\u05E9\u05D4), \u05D6\u05D9\u05D4\u05D5\u05D9 \u05D3\u05E4\u05D5\u05E1 \u05E7\u05D9\u05D3\u05D5\u05D3 (\u05E6\u05DC\u05D9\u05DC\u05D4 \u05DC\u05E2\u05D5\u05DE\u05E7, \u05E8\u05D5\u05D7\u05D1\u05D9, \u05D0\u05D9\u05D8\u05E8\u05D8\u05D9\u05D1\u05D9, \u05EA\u05DB\u05E0\u05D5\u05DF-\u05DB\u05D1\u05D3 \u05D0\u05D5 \u05DE\u05D5\u05E0\u05D7\u05D4-\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA), \u05D5\u05D1\u05D5\u05E0\u05D5\u05E1 XP \u05E9\u05DC \u05E2\u05D3 25 \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA. \u05D4\u05EA\u05D5\u05D1\u05E0\u05D4 \u05DE\u05D5\u05E4\u05D9\u05E2\u05D4 \u05D1\u05DB\u05E8\u05D8\u05D9\u05E1 \u05E1\u05D9\u05DB\u05D5\u05DD \u05D4\u05E1\u05E9\u05DF.',
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

  // Community / GitHub Sync
  community: '\u05E7\u05D4\u05D9\u05DC\u05D4',
  share: '\u05E9\u05D9\u05EA\u05D5\u05E3',
  connectGitHub: '\u05D7\u05D1\u05E8 GitHub',
  connectGitHubDesc: '\u05E9\u05EA\u05E3 \u05D0\u05EA \u05D4\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E9\u05DC\u05DA \u05E2\u05DD \u05DE\u05E4\u05EA\u05D7\u05D9\u05DD \u05D0\u05D7\u05E8\u05D9\u05DD \u05E2\u05DC \u05D9\u05D3\u05D9 \u05E4\u05E8\u05E1\u05D5\u05DD \u05DC-GitHub Gist \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9. \u05DE\u05E9\u05EA\u05DE\u05E9\u05D9 ClaUi \u05D0\u05D7\u05E8\u05D9\u05DD \u05D9\u05D5\u05DB\u05DC\u05D5 \u05DC\u05D2\u05DC\u05D5\u05EA \u05D5\u05DC\u05D4\u05E9\u05D5\u05D5\u05EA \u05D0\u05EA \u05D4\u05E1\u05D8\u05D8\u05D9\u05E1\u05D8\u05D9\u05E7\u05D5\u05EA \u05E9\u05DC\u05D4\u05DD \u05DE\u05D5\u05DC\u05DA.',
  lastSynced: '\u05E1\u05E0\u05DB\u05E8\u05DF \u05D0\u05D7\u05E8\u05D5\u05DF',
  publishNow: '\u05E4\u05E8\u05E1\u05DD',
  disconnect: '\u05E0\u05EA\u05E7',
  friends: '\u05D7\u05D1\u05E8\u05D9\u05DD',
  compare: '\u05D4\u05E9\u05D5\u05D5\u05D0\u05D4',
  addFriend: '\u05D4\u05D5\u05E1\u05E3',
  addFriendPlaceholder: '\u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9 GitHub...',
  removeFriend: '\u05D4\u05E1\u05E8',
  refreshFriends: '\u05E8\u05E2\u05E0\u05DF',
  noFriendsYet: '\u05E2\u05D3\u05D9\u05D9\u05DF \u05DC\u05D0 \u05E0\u05D5\u05E1\u05E4\u05D5 \u05D7\u05D1\u05E8\u05D9\u05DD. \u05D4\u05D5\u05E1\u05E3 \u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9 GitHub \u05DC\u05DE\u05E2\u05DC\u05D4 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E9\u05D5\u05D5\u05EA \u05D4\u05D9\u05E9\u05D2\u05D9\u05DD.',
  selectFriendToCompare: '\u05D1\u05D7\u05E8 \u05D7\u05D1\u05E8 \u05DE\u05DC\u05E9\u05D5\u05E0\u05D9\u05EA \u05D4\u05D7\u05D1\u05E8\u05D9\u05DD \u05DC\u05D4\u05E9\u05D5\u05D5\u05D0\u05D4.',
  achievementsLabel: '\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD',
  you: '\u05D0\u05EA\u05D4',
  metric: '\u05DE\u05D3\u05D3',
  sessions: '\u05E1\u05E9\u05E0\u05D9\u05DD',
  bugFixes: '\u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05D1\u05D0\u05D2\u05D9\u05DD',
  testsPassed: '\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA',
  streak: '\u05E8\u05E6\u05E3',
  copyMarkdownCard: '\u05D4\u05E2\u05EA\u05E7 \u05DB\u05E8\u05D8\u05D9\u05E1 Markdown',
  copyShieldsBadge: '\u05D4\u05E2\u05EA\u05E7 \u05EA\u05D2 Shields',
  copied: '\u05D4\u05D5\u05E2\u05EA\u05E7!',
  shareCardTitle: '\u05E9\u05EA\u05E3 \u05D0\u05EA \u05D4\u05D4\u05D9\u05E9\u05D2\u05D9\u05DD \u05E9\u05DC\u05DA',
  shareCardDesc: '\u05D4\u05E2\u05EA\u05E7 \u05DB\u05E8\u05D8\u05D9\u05E1 Markdown \u05D0\u05D5 \u05EA\u05D2\u05D9\u05DD \u05DC-README \u05E9\u05DC\u05DA \u05D1-GitHub.',

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

  // --- 35 expansion achievements ---
  achLunchBreakTitle: '\u05D4\u05E4\u05E1\u05E7\u05EA \u05E6\u05D4\u05E8\u05D9\u05D9\u05DD',
  achLunchBreakDesc: '\u05D4\u05EA\u05D7\u05DC\u05EA \u05E1\u05E9\u05DF \u05D1\u05D9\u05DF 12 \u05DC-1 \u05D1\u05E6\u05D4\u05E8\u05D9\u05D9\u05DD.',
  achSprintTitle: '\u05E1\u05E4\u05E8\u05D9\u05E0\u05D8',
  achSprintDesc: '\u05E1\u05E9\u05DF \u05DE\u05D4\u05D9\u05E8 \u05E9\u05DC \u05E4\u05D7\u05D5\u05EA \u05DE-15 \u05D3\u05E7\u05D5\u05EA \u05E2\u05DD 3+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA.',
  achHalfCenturyTitle: '\u05D7\u05E6\u05D9 \u05DE\u05D0\u05D4',
  achHalfCenturyDesc: '\u05D4\u05E9\u05DC\u05DE\u05EA 50 \u05E1\u05E9\u05E0\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achIronWillTitle: '\u05E8\u05E6\u05D5\u05DF \u05D1\u05E8\u05D6\u05DC',
  achIronWillDesc: '\u05E1\u05E9\u05DF \u05E9\u05DC 3+ \u05E9\u05E2\u05D5\u05EA \u05E2\u05DD 10+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA.',
  achDoubleCenturionTitle: '\u05E7\u05E0\u05D8\u05D5\u05E8\u05D9\u05D5\u05DF \u05DB\u05E4\u05D5\u05DC',
  achDoubleCenturionDesc: '\u05D4\u05E9\u05DC\u05DE\u05EA 200 \u05E1\u05E9\u05E0\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achZeroDayTitle: '\u05D9\u05D5\u05DD \u05D0\u05E4\u05E1',
  achZeroDayDesc: '\u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2 \u05EA\u05D5\u05DA 2 \u05D3\u05E7\u05D5\u05EA \u05DE\u05EA\u05D7\u05D9\u05DC\u05EA \u05D4\u05E1\u05E9\u05DF.',
  achBugSquasherTitle: '\u05DE\u05D5\u05D7\u05E5 \u05D1\u05D0\u05D2\u05D9\u05DD',
  achBugSquasherDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA 3+ \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achErrorWhispererTitle: '\u05DC\u05D5\u05D7\u05E9 \u05E9\u05D2\u05D9\u05D0\u05D5\u05EA',
  achErrorWhispererDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA \u05D1\u05D0\u05D2 \u05D1\u05E2\u05E8\u05D9\u05DB\u05D4 \u05D4\u05E8\u05D0\u05E9\u05D5\u05E0\u05D4 \u05D0\u05D7\u05E8\u05D9 \u05E9\u05D2\u05D9\u05D0\u05D4.',
  achComebackKidTitle: '\u05D9\u05DC\u05D3 \u05D4\u05D7\u05D6\u05E8\u05D4',
  achComebackKidDesc: '5+ \u05EA\u05D9\u05E7\u05D5\u05E0\u05D9 \u05E9\u05D2\u05D9\u05D0\u05D5\u05EA \u05E8\u05D9\u05E6\u05D4 \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achBugSlayerIVTitle: '\u05E6\u05D9\u05D9\u05D3 \u05D1\u05D0\u05D2\u05D9\u05DD IV',
  achBugSlayerIVDesc: '\u05EA\u05D9\u05E7\u05E0\u05EA 250 \u05D1\u05D0\u05D2\u05D9\u05DD \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTestMarathonTitle: '\u05DE\u05E8\u05EA\u05D5\u05DF \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA',
  achTestMarathonDesc: '10+ \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achTestDrivenDevTitle: '\u05E4\u05D9\u05EA\u05D5\u05D7 \u05DE\u05D1\u05D5\u05E1\u05E1 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA',
  achTestDrivenDevDesc: '\u05EA\u05D9\u05E7\u05D5\u05DF \u05D1\u05D0\u05D2 + \u05D1\u05D3\u05D9\u05E7\u05D4 \u05E2\u05D5\u05D1\u05E8\u05EA \u05EA\u05D5\u05DA 3 \u05D3\u05E7\u05D5\u05EA.',
  achQualityGateTitle: '\u05E9\u05E2\u05E8 \u05D0\u05D9\u05DB\u05D5\u05EA',
  achQualityGateDesc: '\u05E1\u05E9\u05DF \u05E2\u05DD \u05D9\u05D5\u05EA\u05E8 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05DE\u05D1\u05D0\u05D2\u05D9\u05DD (\u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD 2).',
  achGreenStreakTitle: '\u05E8\u05E6\u05E3 \u05D9\u05E8\u05D5\u05E7',
  achGreenStreakDesc: '10 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E8\u05E6\u05E3.',
  achTestMasterIVTitle: '\u05DE\u05D0\u05E1\u05D8\u05E8 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA IV',
  achTestMasterIVDesc: '1,000 \u05D1\u05D3\u05D9\u05E7\u05D5\u05EA \u05E2\u05D5\u05D1\u05E8\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTidyUpTitle: '\u05E1\u05D9\u05D3\u05D5\u05E8',
  achTidyUpDesc: '5+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D5\u05D0\u05E4\u05E1 \u05E9\u05D2\u05D9\u05D0\u05D5\u05EA \u05E8\u05D9\u05E6\u05D4.',
  achMegaRefactorTitle: '\u05DE\u05D2\u05D4 \u05E8\u05D9\u05E4\u05E7\u05D8\u05D5\u05E8',
  achMegaRefactorDesc: '25+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achEditVeteranITitle: '\u05D5\u05EA\u05D9\u05E7 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA I',
  achEditVeteranIDesc: '500 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achEditVeteranIITitle: '\u05D5\u05EA\u05D9\u05E7 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA II',
  achEditVeteranIIDesc: '2,000 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achEditVeteranIIITitle: '\u05D5\u05EA\u05D9\u05E7 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA III',
  achEditVeteranIIIDesc: '5,000 \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achSingleFileFocusTitle: '\u05DE\u05D9\u05E7\u05D5\u05D3 \u05D1\u05E7\u05D5\u05D1\u05E5 \u05D0\u05D7\u05D3',
  achSingleFileFocusDesc: '5+ \u05E2\u05E8\u05D9\u05DB\u05D5\u05EA \u05D1\u05E7\u05D5\u05D1\u05E5 \u05D9\u05D7\u05D9\u05D3.',
  achConfigWranglerTitle: '\u05D0\u05DC\u05D5\u05E3 \u05E7\u05D5\u05E0\u05E4\u05D9\u05D2\u05D5\u05E8\u05E6\u05D9\u05D4',
  achConfigWranglerDesc: '\u05E2\u05E8\u05D9\u05DB\u05EA \u05E7\u05D5\u05D1\u05E5 \u05E7\u05D5\u05E0\u05E4\u05D9\u05D2\u05D5\u05E8\u05E6\u05D9\u05D4.',
  achWideReachTitle: '\u05D8\u05D5\u05D5\u05D7 \u05E8\u05D7\u05D1',
  achWideReachDesc: '\u05E0\u05D2\u05E2\u05EA \u05D1-20+ \u05E7\u05D1\u05E6\u05D9\u05DD \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achCrossStackTitle: '\u05D7\u05D5\u05E6\u05D4 \u05E9\u05DB\u05D1\u05D5\u05EA',
  achCrossStackDesc: '\u05E2\u05E8\u05D9\u05DB\u05EA \u05E4\u05E8\u05D5\u05E0\u05D8 + \u05D1\u05E7\u05D0\u05E0\u05D3 + \u05E7\u05D5\u05E0\u05E4\u05D9\u05D2\u05D5\u05E8\u05E6\u05D9\u05D4 \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achProjectArchitectTitle: '\u05D0\u05E8\u05DB\u05D9\u05D8\u05E7\u05D8 \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8',
  achProjectArchitectDesc: '\u05E0\u05D2\u05E2\u05EA \u05D1-30+ \u05E7\u05D1\u05E6\u05D9\u05DD \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achBilingualTitle: '\u05D3\u05D5-\u05DC\u05E9\u05D5\u05E0\u05D9',
  achBilingualDesc: '\u05E9\u05D9\u05DE\u05D5\u05E9 \u05D1-2+ \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achMarkdownAuthorTitle: '\u05DB\u05D5\u05EA\u05D1 \u05DE\u05D0\u05E8\u05E7\u05D3\u05D0\u05D5\u05DF',
  achMarkdownAuthorDesc: '\u05E2\u05E8\u05D9\u05DB\u05EA 3+ \u05E7\u05D1\u05E6\u05D9 Markdown.',
  achDocsFirstTitle: '\u05EA\u05D9\u05E2\u05D5\u05D3 \u05E7\u05D5\u05D3\u05DD',
  achDocsFirstDesc: '\u05D4\u05E7\u05D5\u05D1\u05E5 \u05D4\u05E8\u05D0\u05E9\u05D5\u05DF \u05E9\u05E0\u05E2\u05E8\u05DA \u05D4\u05D9\u05D4 \u05E7\u05D5\u05D1\u05E5 .md.',
  achLanguageCollectorITitle: '\u05D0\u05E1\u05E4\u05DF \u05E9\u05E4\u05D5\u05EA I',
  achLanguageCollectorIDesc: '7+ \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achLanguageCollectorIITitle: '\u05D0\u05E1\u05E4\u05DF \u05E9\u05E4\u05D5\u05EA II',
  achLanguageCollectorIIDesc: '10+ \u05E9\u05E4\u05D5\u05EA \u05EA\u05DB\u05E0\u05D5\u05EA \u05D1\u05E1\u05E9\u05DF \u05D0\u05D7\u05D3.',
  achTimeInvestorITitle: '\u05DE\u05E9\u05E7\u05D9\u05E2 \u05D6\u05DE\u05DF I',
  achTimeInvestorIDesc: '500 \u05D3\u05E7\u05D5\u05EA \u05E1\u05E9\u05DF \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTimeInvestorIITitle: '\u05DE\u05E9\u05E7\u05D9\u05E2 \u05D6\u05DE\u05DF II',
  achTimeInvestorIIDesc: '2,000 \u05D3\u05E7\u05D5\u05EA \u05E1\u05E9\u05DF \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achTimeInvestorIIITitle: '\u05DE\u05E9\u05E7\u05D9\u05E2 \u05D6\u05DE\u05DF III',
  achTimeInvestorIIIDesc: '5,000 \u05D3\u05E7\u05D5\u05EA \u05E1\u05E9\u05DF \u05D1\u05E1\u05DA \u05D4\u05DB\u05DC.',
  achDailyStreak14Title: '\u05E8\u05E6\u05E3 \u05D9\u05D5\u05DE\u05D9 14',
  achDailyStreak14Desc: '\u05E7\u05D9\u05D3\u05D3\u05EA 14 \u05D9\u05DE\u05D9\u05DD \u05E8\u05E6\u05D5\u05E4\u05D9\u05DD.',
  achDailyStreak30Title: '\u05E8\u05E6\u05E3 \u05D9\u05D5\u05DE\u05D9 30',
  achDailyStreak30Desc: '\u05E7\u05D9\u05D3\u05D3\u05EA 30 \u05D9\u05DE\u05D9\u05DD \u05E8\u05E6\u05D5\u05E4\u05D9\u05DD.',

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
  // Expansion
  'lunch-break': 'achLunchBreakTitle',
  'sprint': 'achSprintTitle',
  'half-century': 'achHalfCenturyTitle',
  'iron-will': 'achIronWillTitle',
  'double-centurion': 'achDoubleCenturionTitle',
  'zero-day': 'achZeroDayTitle',
  'bug-squasher': 'achBugSquasherTitle',
  'error-whisperer': 'achErrorWhispererTitle',
  'comeback-kid': 'achComebackKidTitle',
  'bug-slayer-iv': 'achBugSlayerIVTitle',
  'test-marathon': 'achTestMarathonTitle',
  'test-driven-dev': 'achTestDrivenDevTitle',
  'quality-gate': 'achQualityGateTitle',
  'green-streak': 'achGreenStreakTitle',
  'test-master-iv': 'achTestMasterIVTitle',
  'tidy-up': 'achTidyUpTitle',
  'mega-refactor': 'achMegaRefactorTitle',
  'edit-veteran-i': 'achEditVeteranITitle',
  'edit-veteran-ii': 'achEditVeteranIITitle',
  'edit-veteran-iii': 'achEditVeteranIIITitle',
  'single-file-focus': 'achSingleFileFocusTitle',
  'config-wrangler': 'achConfigWranglerTitle',
  'wide-reach': 'achWideReachTitle',
  'cross-stack': 'achCrossStackTitle',
  'project-architect': 'achProjectArchitectTitle',
  'bilingual': 'achBilingualTitle',
  'markdown-author': 'achMarkdownAuthorTitle',
  'docs-first': 'achDocsFirstTitle',
  'language-collector-i': 'achLanguageCollectorITitle',
  'language-collector-ii': 'achLanguageCollectorIITitle',
  'time-investor-i': 'achTimeInvestorITitle',
  'time-investor-ii': 'achTimeInvestorIITitle',
  'time-investor-iii': 'achTimeInvestorIIITitle',
  'daily-streak-14': 'achDailyStreak14Title',
  'daily-streak-30': 'achDailyStreak30Title',
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
  // Expansion
  'lunch-break': 'achLunchBreakDesc',
  'sprint': 'achSprintDesc',
  'half-century': 'achHalfCenturyDesc',
  'iron-will': 'achIronWillDesc',
  'double-centurion': 'achDoubleCenturionDesc',
  'zero-day': 'achZeroDayDesc',
  'bug-squasher': 'achBugSquasherDesc',
  'error-whisperer': 'achErrorWhispererDesc',
  'comeback-kid': 'achComebackKidDesc',
  'bug-slayer-iv': 'achBugSlayerIVDesc',
  'test-marathon': 'achTestMarathonDesc',
  'test-driven-dev': 'achTestDrivenDevDesc',
  'quality-gate': 'achQualityGateDesc',
  'green-streak': 'achGreenStreakDesc',
  'test-master-iv': 'achTestMasterIVDesc',
  'tidy-up': 'achTidyUpDesc',
  'mega-refactor': 'achMegaRefactorDesc',
  'edit-veteran-i': 'achEditVeteranIDesc',
  'edit-veteran-ii': 'achEditVeteranIIDesc',
  'edit-veteran-iii': 'achEditVeteranIIIDesc',
  'single-file-focus': 'achSingleFileFocusDesc',
  'config-wrangler': 'achConfigWranglerDesc',
  'wide-reach': 'achWideReachDesc',
  'cross-stack': 'achCrossStackDesc',
  'project-architect': 'achProjectArchitectDesc',
  'bilingual': 'achBilingualDesc',
  'markdown-author': 'achMarkdownAuthorDesc',
  'docs-first': 'achDocsFirstDesc',
  'language-collector-i': 'achLanguageCollectorIDesc',
  'language-collector-ii': 'achLanguageCollectorIIDesc',
  'time-investor-i': 'achTimeInvestorIDesc',
  'time-investor-ii': 'achTimeInvestorIIDesc',
  'time-investor-iii': 'achTimeInvestorIIIDesc',
  'daily-streak-14': 'achDailyStreak14Desc',
  'daily-streak-30': 'achDailyStreak30Desc',
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
