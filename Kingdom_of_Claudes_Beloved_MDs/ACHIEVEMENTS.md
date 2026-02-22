# Achievements / Trophy Feature

Gamification system that awards badges and XP for coding milestones while using Claude. Includes AI-powered session insights via Sonnet.

## Overview

The Achievements feature tracks user activity across sessions (bug fixes, test passes, files touched, daily streaks, coding patterns) and awards achievements when milestones are reached. It includes an XP-based leveling system (15 levels), per-session goals, toast notifications, a session recap card, and AI-powered session insights.

## Architecture

```
Extension (Node.js)                    Webview (React)
+----------------------+               +----------------------+
| AchievementCatalog   |               | AchievementPanel     |
|   30 definitions     |               |   Level/XP/Goals     |
|   7 categories       |               |   Settings (lang)    |
+----------------------+               |   Info modal         |
| AchievementStore     |               +----------------------+
|   globalState persist |               | AchievementToastStack|
|   8 counters          |               |   Rarity-colored     |
+----------------------+               |   Auto-dismiss 5s    |
| AchievementEngine    |               +----------------------+
|   Game logic/goals   | --postMsg-->  | SessionRecapCard     |
|   File/lang tracking |               |   Duration, stats    |
|   Error cycles       |               |   Files, languages   |
+----------------------+               |   AI insight display |
| AchievementService   |               +----------------------+
|   Lifecycle bridge   |               | achievementI18n.ts   |
|   Streak tracking    |               |   EN + HE strings    |
+----------------------+               +----------------------+
| InsightAnalyzer      |
|   Sonnet CLI spawn   |
|   Once per day       |
+----------------------+
```

## Key Files

### Extension Backend

| File | Path | Purpose |
|------|------|---------|
| AchievementCatalog.ts | `src/extension/achievements/` | 30 achievement definitions with id, title, description, rarity, category, xp. Categories: debugging, testing, refactor, collaboration, session, architecture, productivity |
| AchievementStore.ts | `src/extension/achievements/` | Persistence via VS Code `globalState`. Tracks 8 counters: bugFixes, testPasses, sessionsCompleted, totalEdits, consecutiveDays, lastSessionDate, totalSessionMinutes |
| AchievementEngine.ts | `src/extension/achievements/` | Core game logic: tracks bug fixes, test passes, streaks, language detection, cancel counts, session goals, file paths, frontend/backend classification, error cycles |
| AchievementService.ts | `src/extension/achievements/` | Bridge between Engine+Store and webview messaging. Handles daily streaks, cross-session tier achievements, AI insight integration |
| AchievementInsightAnalyzer.ts | `src/extension/achievements/` | Spawns Sonnet CLI once per day for deeper session analysis. Returns quality, insight, coding pattern, XP bonus |

### Webview Frontend

| File | Path | Purpose |
|------|------|---------|
| AchievementPanel.tsx | `src/webview/components/Achievements/` | Panel overlay with level, XP, unlocked count, session goals, language selector, info modal (includes AI insight section) |
| AchievementToastStack.tsx | `src/webview/components/Achievements/` | Stack of rarity-colored toasts with auto-dismiss and optional sound |
| SessionRecapCard.tsx | `src/webview/components/Achievements/` | End-of-session summary showing time, bugs, tests, files, languages, badges, XP, AI insight, session quality badge, coding pattern |
| achievementI18n.ts | `src/webview/components/Achievements/` | All UI strings in English and Hebrew, with helper functions for dynamic lookups |

### Integration Points

| File | Role |
|------|------|
| store.ts | Zustand state: `achievementsEnabled`, `achievementsSound`, `achievementLanguage`, `achievementProfile`, `achievementGoals`, `achievementToasts`, `achievementPanelOpen`, `sessionRecap`, `sessionActivityElapsedMs`, `sessionActivityRunningSinceMs` |
| App.tsx | Renders Panel, ToastStack, RecapCard; Trophy button in StatusBar |
| useClaudeStream.ts | Dispatches achievement message types from extension |
| MessageHandler.ts | Calls achievement hooks at every lifecycle point; watches `achievements.aiInsight` config |
| extension.ts | Creates AchievementInsightAnalyzer, wires to AchievementService |
| global.css | All achievement CSS classes including quality badges and insight styles |

## Achievement Catalog (30 achievements)

### Session (5)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| night-owl | Night Owl | common | 10 | Coded after midnight (0-5am) |
| early-bird | Early Bird | common | 10 | Session between 5am-7am |
| weekend-warrior | Weekend Warrior | common | 15 | Saturday or Sunday |
| marathon | Marathon | rare | 40 | 2+ hour session |
| deep-focus | Deep Focus | rare | 35 | 60+ min, 0 cancels, 5+ edits |
| centurion | Centurion | legendary | 200 | 100th session overall |

### Debugging (5)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| hot-streak | Hot Streak | epic | 50 | 3 bug fixes in 10 min |
| speed-patch | Speed Patch | rare | 30 | Bug fix + test pass in 6 min |
| first-blood | First Blood | rare | 25 | Bug fix within 5 min of start |
| persistence | Persistence | epic | 55 | Fix after 3+ error cycles |
| phoenix | Phoenix | epic | 60 | Recovered quickly after crash (hidden) |

### Bug Slayer Tiers (3)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| bug-slayer-i | Bug Slayer I | common | 25 | 5 bugs fixed total |
| bug-slayer-ii | Bug Slayer II | rare | 80 | 25 bugs fixed total |
| bug-slayer-iii | Bug Slayer III | legendary | 180 | 100 bugs fixed total |

### Testing (4)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| green-wave | Green Wave | epic | 55 | 5 test passes in a row |
| test-first | Test First | rare | 40 | Ran tests before any edit |
| test-master-i | Test Master I | common | 20 | 25 lifetime test passes |
| test-master-ii | Test Master II | rare | 60 | 100 lifetime test passes |
| test-master-iii | Test Master III | legendary | 200 | 500 lifetime test passes |

### Refactor (3)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| clean-sweep | Clean Sweep | rare | 40 | Session with 0 runtime errors |
| heavy-refactor | Heavy Refactor | rare | 35 | 10+ edits in one session |
| surgeon | Surgeon | epic | 45 | 1-2 precise edits fixed an error |

### Architecture (2)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| full-stack | Full Stack | rare | 40 | Frontend + backend edits in one session |
| file-explorer | File Explorer | rare | 30 | 10+ files touched in one session |

### Collaboration (2)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| polyglot | Polyglot | rare | 35 | 3+ programming languages |
| multilingual-master | Multilingual Master | epic | 60 | 5+ languages in one session |

### Productivity (3)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| all-goals-met | All Goals Met | epic | 50 | Completed every session goal |
| daily-streak-3 | Daily Streak 3 | rare | 35 | 3 consecutive days |
| daily-streak-7 | Daily Streak 7 | epic | 70 | 7 consecutive days |

### Hidden (2)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| no-undo-ninja | No-Undo Ninja | rare | 30 | 30 min without canceling |
| phoenix | Phoenix | epic | 60 | Recovered quickly after crash |

## Session Goals

Each session randomly selects 2-3 goals from 7 templates:
- **Ship It Sprint**: Fix 2 bugs
- **Runtime Rescuer**: Fix 2 runtime errors
- **Test Tactician**: Pass 5 tests
- **Refactor Ritual**: Make 3 meaningful edits
- **File Hopper**: Touch 8 files
- **Error Free**: 3 error-free results in a row
- **Language Sampler**: Use 2 programming languages

Goals reset between sessions and display progress bars in the panel.

## Leveling System

15 levels with progressive XP thresholds:
`[0, 100, 250, 450, 700, 1000, 1400, 1850, 2350, 2900, 3500, 4200, 5000, 5900, 6900]`

XP is earned from achievement awards and AI XP bonuses. Profile (totalXp, level, unlockedIds, counters) persists globally via VS Code `globalState`.

## AI Session Insight Analyzer

At the end of each session, the system can spawn a one-shot Sonnet CLI process to analyze session metrics:

- **Rate limited**: Once per calendar day (stored in globalState)
- **Minimum session**: 2 minutes
- **Timeout**: 45 seconds
- **Model**: `claude-sonnet-4-6`

### Input Metrics
Duration, files touched, languages, bug fixes, test passes, errors, edits, cancellations.

### Output JSON
```json
{
  "sessionQuality": "exceptional|productive|steady|exploratory|struggling",
  "insight": "1-2 sentence observation about the session",
  "codingPattern": "deep-dive|breadth-first|iterative|planning-heavy|test-driven",
  "xpBonus": 0-25
}
```

### Integration
- Initial recap sent immediately when session ends
- AI insight fires async; enriched recap sent when result arrives
- XP bonus applied to profile and displayed in recap

## File Tracking

The engine extracts file paths from tool use JSON (`file_path`, `path` fields + regex fallback). Files are classified:
- **Frontend**: `.tsx`, `.jsx`, `.html`, `.css`, `.scss`, `.vue`, `.svelte` + `src/webview` path
- **Backend**: `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php` + `src/extension` path
- **Full Stack** achievement triggers when both frontend and backend edits detected

## Daily Streak Tracking

Uses `toLocaleDateString('en-CA')` for YYYY-MM-DD local-time dates. On session end:
- Same day = no change
- Yesterday = increment `consecutiveDays`
- Older = reset to 1

Awards `daily-streak-3` (>=3 days) and `daily-streak-7` (>=7 days).

## i18n (Internationalization)

**Supported languages**: English (en), Hebrew (he)

Language is selected via a dropdown in the Achievement panel settings (gear icon). The selection is persisted to `localStorage` under the key `claui-achievement-lang`.

All UI strings are translated:
- Panel: titles, labels, buttons
- Info modal: all explanatory sections including AI insight
- Toast notifications: achievement titles and descriptions
- Session recap: all field labels (files, languages, AI insight, quality, pattern, XP bonus)
- Goal names (all 7 goals)
- All 30 achievement titles and descriptions

**Adding a new language**: Add a new object to the `translations` record in `achievementI18n.ts` with all keys from the `AchievementTranslations` interface, and add an entry to `ACHIEVEMENT_LANG_OPTIONS`.

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.achievements.enabled` | `true` | Master toggle for the achievement system |
| `claudeMirror.achievements.sound` | `false` | Play sound on achievement toast |
| `claudeMirror.achievements.aiInsight` | `true` | Enable AI-powered session insights (once per day) |

## State Flow

1. User performs action (bug fix, test pass, file edit, etc.)
2. `MessageHandler` calls appropriate `AchievementService` hook
3. `AchievementEngine` evaluates rules, returns `EngineResult` with awards/progress/editsDelta
4. `AchievementService` persists to `AchievementStore`, checks cross-session tiers, broadcasts to webview
5. Webview store updates, UI re-renders (panel, toast, recap)
6. On session end: daily streak check, session snapshot captured, AI insight spawned (async)
7. Enriched recap sent to webview when AI insight completes
