# Achievements / Trophy Feature

Gamification system that awards badges and XP for coding milestones while using Claude.

## Overview

The Achievements feature tracks user activity across sessions (bug fixes, test passes, coding patterns) and awards achievements when milestones are reached. It includes an XP-based leveling system, per-session goals, toast notifications, and a session recap card.

## Architecture

```
Extension (Node.js)                    Webview (React)
+----------------------+               +----------------------+
| AchievementCatalog   |               | AchievementPanel     |
|   12 definitions     |               |   Level/XP/Goals     |
+----------------------+               |   Settings (lang)    |
| AchievementStore     |               |   Info modal         |
|   globalState persist |               +----------------------+
+----------------------+               | AchievementToastStack|
| AchievementEngine    |               |   Rarity-colored     |
|   Game logic/goals   |               |   Auto-dismiss 5s    |
+----------------------+               +----------------------+
| AchievementService   | --postMsg-->  | SessionRecapCard     |
|   Lifecycle bridge   |               |   End-of-session     |
+----------------------+               +----------------------+
                                       | achievementI18n.ts   |
                                       |   EN + HE strings    |
                                       +----------------------+
```

## Key Files

### Extension Backend

| File | Path | Purpose |
|------|------|---------|
| AchievementCatalog.ts | `src/extension/achievements/` | 12 achievement definitions with id, title, description, rarity, category, xp |
| AchievementStore.ts | `src/extension/achievements/` | Persistence via VS Code `globalState` key `claudeMirror.achievements.profile` |
| AchievementEngine.ts | `src/extension/achievements/` | Core game logic: tracks bug fixes, test passes, streaks, language detection, cancel counts, session goals |
| AchievementService.ts | `src/extension/achievements/` | Bridge between Engine+Store and webview messaging. Registered per-tab |

### Webview Frontend

| File | Path | Purpose |
|------|------|---------|
| AchievementPanel.tsx | `src/webview/components/Achievements/` | Panel overlay with level, XP, unlocked count, session goals, language selector, info modal |
| AchievementToastStack.tsx | `src/webview/components/Achievements/` | Stack of rarity-colored toasts with auto-dismiss and optional sound |
| SessionRecapCard.tsx | `src/webview/components/Achievements/` | End-of-session summary showing time, bugs, tests, badges, XP, level |
| achievementI18n.ts | `src/webview/components/Achievements/` | All UI strings in English and Hebrew, with helper functions for dynamic lookups |

### Integration Points

| File | Role |
|------|------|
| store.ts | Zustand state: `achievementsEnabled`, `achievementsSound`, `achievementLanguage`, `achievementProfile`, `achievementGoals`, `achievementToasts`, `achievementPanelOpen`, `sessionRecap` |
| App.tsx | Renders Panel, ToastStack, RecapCard; Trophy button in StatusBar |
| useClaudeStream.ts | Dispatches 5 achievement message types from extension |
| MessageHandler.ts | Calls achievement hooks at every lifecycle point |
| SessionTab.ts | Creates AchievementService, manages lifecycle |
| global.css | All achievement CSS classes (lines ~1205-1450) |

## Achievement Catalog (12 achievements)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| night-owl | Night Owl | common | 10 | Coded after midnight |
| marathon | Marathon | rare | 40 | 2+ hour session |
| polyglot | Polyglot | rare | 35 | 3+ programming languages |
| hot-streak | Hot Streak | epic | 50 | 3 bug fixes in 10 min |
| green-wave | Green Wave | epic | 55 | 5 test passes in a row |
| speed-patch | Speed Patch | rare | 30 | Bug fix + test pass in 6 min |
| bug-slayer-i | Bug Slayer I | common | 25 | 5 bugs fixed total |
| bug-slayer-ii | Bug Slayer II | rare | 80 | 25 bugs fixed total |
| bug-slayer-iii | Bug Slayer III | legendary | 180 | 100 bugs fixed total |
| clean-sweep | Clean Sweep | rare | 40 | Session with 0 runtime errors |
| no-undo-ninja | No-Undo Ninja | rare | 30 | 30 min without canceling (hidden) |
| phoenix | Phoenix | epic | 60 | Recovered quickly after crash (hidden) |

## Session Goals

Each session randomly selects 2-3 goals from pools based on available data:
- **Ship It Sprint**: Fix 2 bugs
- **Runtime Rescuer**: Fix 2 runtime errors
- **Test Tactician**: Pass 5 tests
- **Refactor Ritual**: Make 3 meaningful edits

Goals reset between sessions and display progress bars in the panel.

## Leveling System

10 levels with progressive XP thresholds. XP is earned from achievement awards. Profile (totalXp, level, unlockedIds, counters) persists globally via VS Code `globalState`.

## i18n (Internationalization)

**Supported languages**: English (en), Hebrew (he)

Language is selected via a dropdown in the Achievement panel settings (gear icon). The selection is persisted to `localStorage` under the key `claui-achievement-lang` so it survives tab reloads.

All UI strings are translated:
- Panel: titles, labels, buttons
- Info modal: all explanatory sections
- Toast notifications: achievement titles and descriptions
- Session recap: all field labels
- Trophy button text in the status bar
- Goal names

**Adding a new language**: Add a new object to the `translations` record in `achievementI18n.ts` with all keys from the `AchievementTranslations` interface, and add an entry to `ACHIEVEMENT_LANG_OPTIONS`.

## Info Modal

Accessible via the (i) icon in the Achievement panel header. Shows:
1. What achievements are and their purpose
2. How to earn them (automatic tracking)
3. Rarity levels with XP ranges
4. How session goals work
5. How leveling works

Content respects the selected display language.

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.achievements.enabled` | `true` | Master toggle for the achievement system |
| `claudeMirror.achievements.sound` | `false` | Play sound on achievement toast |

## State Flow

1. User performs action (bug fix, test pass, etc.)
2. `MessageHandler` calls appropriate `AchievementService` hook
3. `AchievementEngine` evaluates rules, returns `EngineResult` with awards/progress
4. `AchievementService` persists to `AchievementStore`, broadcasts to webview
5. Webview store updates, UI re-renders (panel, toast, recap)
