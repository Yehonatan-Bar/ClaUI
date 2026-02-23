# Achievements / Trophy Feature

Gamification system that awards badges and XP for coding milestones while using Claude. Includes AI-powered session insights via Sonnet.

## Overview

The Achievements feature tracks user activity across sessions (bug fixes, test passes, files touched, daily streaks, coding patterns) and awards achievements when milestones are reached. It includes an XP-based leveling system (25 levels), per-session goals, toast notifications, a session recap card, and AI-powered session insights.

## Architecture

```
Extension (Node.js)                    Webview (React)
+----------------------+               +----------------------+
| AchievementCatalog   |               | AchievementPanel     |
|   65 definitions     |               |   Level/XP/Goals     |
|   7 categories       |               |   Settings (lang)    |
+----------------------+               |   Community + Share  |
| AchievementStore     |               +----------------------+
|   globalState persist |               | CommunityPanel       |
|   8 counters          |               |   GitHub Connect     |
+----------------------+               |   Friends list       |
| AchievementEngine    |               |   Side-by-side compare|
|   Game logic/goals   | --postMsg-->  +----------------------+
|   File/lang tracking |               | ShareCard            |
|   Error cycles       |               |   Profile preview    |
+----------------------+               |   Copy markdown/badge|
| AchievementService   |               +----------------------+
|   Lifecycle bridge   |               | AchievementToastStack|
|   Streak tracking    |               |   Rarity-colored     |
+----------------------+               |   Auto-dismiss 5s    |
| InsightAnalyzer      |               +----------------------+
|   Sonnet CLI spawn   |               | SessionRecapCard     |
|   Once per day       |               |   Duration, stats    |
+----------------------+               |   AI insight display |
| GitHubSyncService    |               +----------------------+
|   GitHub Gist CRUD   |               | achievementI18n.ts   |
|   Friend lookup      |               |   EN + HE strings    |
|   Badge generation   |               +----------------------+
|   15min cache        |
+----------------------+
              |
              v
    GitHub Gist (public)        shields.io
    claui-achievements.json     Dynamic badges
```

## Key Files

### Extension Backend

| File | Path | Purpose |
|------|------|---------|
| AchievementCatalog.ts | `src/extension/achievements/` | 65 achievement definitions with id, title, description, rarity, category, xp. Categories: debugging, testing, refactor, collaboration, session, architecture, productivity |
| AchievementStore.ts | `src/extension/achievements/` | Persistence via VS Code `globalState`. Tracks 8 counters: bugFixes, testPasses, sessionsCompleted, totalEdits, consecutiveDays, lastSessionDate, totalSessionMinutes. 25 level thresholds. |
| AchievementEngine.ts | `src/extension/achievements/` | Core game logic: tracks bug fixes, test passes, streaks, language detection, cancel counts, session goals, file paths, frontend/backend classification, error cycles, config file detection, markdown file counting |
| AchievementService.ts | `src/extension/achievements/` | Bridge between Engine+Store and webview messaging. Handles daily streaks, cross-session tier achievements (bug-slayer, test-master, edit-veteran, session milestones, time-investor, streak tiers), AI insight integration, auto-sync to GitHub |
| AchievementInsightAnalyzer.ts | `src/extension/achievements/` | Spawns Sonnet CLI once per day for deeper session analysis. Returns quality, insight, coding pattern, XP bonus |
| GitHubSyncService.ts | `src/extension/achievements/` | GitHub auth via OAuth Device Flow (preferred) with PAT fallback, token storage in VS Code SecretStorage, Gist CRUD (create/update public gist), friend lookup by username convention, badge generation (shields.io + markdown table), 15min friend cache, auto-reconnect on activation, globalState persistence |

### Webview Frontend

| File | Path | Purpose |
|------|------|---------|
| AchievementPanel.tsx | `src/webview/components/Achievements/` | Panel overlay with level, XP, unlocked count, session goals, language selector, info modal, Community button, Share button |
| CommunityPanel.tsx | `src/webview/components/Achievements/` | Full overlay panel: GitHub Connect card, sync status bar, Friends tab (list + add/remove), Compare tab (side-by-side stats & achievement grid) |
| ShareCard.tsx | `src/webview/components/Achievements/` | Modal for sharing: visual profile preview (level, XP bar, achievements), Copy Markdown Card button, Copy Shields Badge button |
| AchievementToastStack.tsx | `src/webview/components/Achievements/` | Stack of rarity-colored toasts with auto-dismiss and optional sound |
| SessionRecapCard.tsx | `src/webview/components/Achievements/` | End-of-session summary showing time, bugs, tests, files, languages, badges, XP, AI insight, session quality badge, coding pattern |
| achievementI18n.ts | `src/webview/components/Achievements/` | All UI strings in English and Hebrew, with helper functions for dynamic lookups. Includes ~30 community-related strings |
| levelThresholds.ts | `src/webview/components/Achievements/` | XP level thresholds (duplicated from AchievementStore for webview use) |

### Integration Points

| File | Role |
|------|------|
| store.ts | Zustand state: `achievementsEnabled`, `achievementsSound`, `achievementLanguage`, `achievementProfile`, `achievementGoals`, `achievementToasts`, `achievementPanelOpen`, `sessionRecap`, `communityPanelOpen`, `githubSyncStatus`, `communityFriends`, `friendActionPending` |
| App.tsx | Renders Panel, CommunityPanel, ShareCard, ToastStack, RecapCard; Trophy button in StatusBar |
| useClaudeStream.ts | Dispatches achievement + community message types from extension (`githubSyncStatus`, `communityData`, `friendActionResult`, `shareCardCopied`) |
| MessageHandler.ts | Calls achievement hooks at every lifecycle point; handles 6 community message types (`githubSync`, `addFriend`, `removeFriend`, `refreshFriends`, `getCommunityData`, `copyShareCard`); watches `achievements.githubSync` config |
| extension.ts | Creates AchievementInsightAnalyzer + GitHubSyncService, wires both to AchievementService |
| WebviewProvider.ts | CSP `img-src` includes `https://avatars.githubusercontent.com` for friend avatars |
| global.css | All achievement + community CSS classes including friend cards, compare view, share card modal |

## Achievement Catalog (65 achievements)

### Session (11)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| night-owl | Night Owl | common | 10 | Coded after midnight (0-5am) |
| early-bird | Early Bird | common | 10 | Session between 5am-7am |
| weekend-warrior | Weekend Warrior | common | 15 | Saturday or Sunday |
| lunch-break | Lunch Break | common | 10 | Session started 12pm-1pm |
| marathon | Marathon | rare | 40 | 2+ hour session |
| deep-focus | Deep Focus | rare | 35 | 60+ min, 0 cancels, 5+ edits |
| sprint | Sprint | rare | 30 | Session < 15min with 3+ edits |
| half-century | Half Century | rare | 40 | 50 sessions completed (cross-session) |
| iron-will | Iron Will | epic | 70 | 3+ hour session with 10+ edits |
| centurion | Centurion | legendary | 200 | 100th session overall |
| double-centurion | Double Centurion | legendary | 250 | 200 sessions completed (cross-session) |

### Debugging (11)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| first-blood | First Blood | rare | 25 | Bug fix within 5 min of start |
| speed-patch | Speed Patch | rare | 30 | Bug fix + test pass in 6 min |
| zero-day | Zero Day | rare | 35 | Bug fix within 2 min of session start |
| bug-squasher | Bug Squasher | rare | 35 | 3+ bugs fixed in one session |
| hot-streak | Hot Streak | epic | 50 | 3 bug fixes in 10 min |
| persistence | Persistence | epic | 55 | Fix after 3+ error cycles |
| error-whisperer | Error Whisperer | epic | 55 | Fixed bug on first edit after error |
| phoenix | Phoenix | epic | 60 | Recovered quickly after crash (hidden) |
| comeback-kid | Comeback Kid | rare | 35 | 5+ runtime fixes in one session (hidden) |
| bug-slayer-i | Bug Slayer I | common | 25 | 5 bugs fixed total |
| bug-slayer-ii | Bug Slayer II | rare | 80 | 25 bugs fixed total |
| bug-slayer-iii | Bug Slayer III | legendary | 180 | 100 bugs fixed total |
| bug-slayer-iv | Bug Slayer IV | legendary | 220 | 250 bugs fixed total |

### Testing (10)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| test-first | Test First | rare | 40 | Ran tests before any edit |
| test-marathon | Test Marathon | rare | 35 | 10+ test passes in one session |
| test-driven-dev | Test Driven Dev | rare | 40 | Bug fix + test pass within 3 min |
| quality-gate | Quality Gate | rare | 30 | Session with more test passes than bug fixes (min 2 tests) |
| green-wave | Green Wave | epic | 55 | 5 test passes in a row |
| green-streak | Green Streak | epic | 65 | 10 consecutive test passes |
| test-master-i | Test Master I | common | 20 | 25 lifetime test passes |
| test-master-ii | Test Master II | rare | 60 | 100 lifetime test passes |
| test-master-iii | Test Master III | legendary | 200 | 500 lifetime test passes |
| test-master-iv | Test Master IV | legendary | 250 | 1,000 total test passes |

### Refactor (8)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| tidy-up | Tidy Up | common | 20 | 5+ edits, zero runtime errors |
| clean-sweep | Clean Sweep | rare | 40 | Session with 0 runtime errors |
| heavy-refactor | Heavy Refactor | rare | 35 | 10+ edits in one session |
| surgeon | Surgeon | epic | 45 | 1-2 precise edits fixed an error |
| mega-refactor | Mega Refactor | epic | 55 | 25+ edits in one session |
| edit-veteran-i | Edit Veteran I | rare | 40 | 500 total edits (cross-session) |
| edit-veteran-ii | Edit Veteran II | epic | 65 | 2,000 total edits |
| edit-veteran-iii | Edit Veteran III | legendary | 200 | 5,000 total edits |

### Architecture (7)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| single-file-focus | Single File Focus | common | 15 | 5+ edits all in one file |
| config-wrangler | Config Wrangler | common | 10 | Edited a config file (.json/.yaml/.toml/.ini/.env) |
| file-explorer | File Explorer | rare | 30 | 10+ files touched in one session |
| full-stack | Full Stack | rare | 40 | Frontend + backend edits in one session |
| cross-stack | Cross Stack | rare | 40 | Frontend + backend + config files in one session |
| wide-reach | Wide Reach | epic | 50 | 20+ files touched in one session |
| project-architect | Project Architect | epic | 75 | 30+ files touched in one session |

### Collaboration (7)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| bilingual | Bilingual | common | 15 | 2+ programming languages in one session |
| markdown-author | Markdown Author | common | 15 | 3+ Markdown files edited |
| polyglot | Polyglot | rare | 35 | 3+ programming languages |
| docs-first | Docs First | rare | 25 | First file edited was a .md file (hidden) |
| multilingual-master | Multilingual Master | epic | 60 | 5+ languages in one session |
| language-collector-i | Language Collector I | epic | 70 | 7+ languages in one session |
| language-collector-ii | Language Collector II | epic | 75 | 10+ languages in one session |

### Productivity (8)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| time-investor-i | Time Investor I | common | 20 | 500 total session minutes |
| all-goals-met | All Goals Met | epic | 50 | Completed every session goal |
| daily-streak-3 | Daily Streak 3 | rare | 35 | 3 consecutive days |
| daily-streak-7 | Daily Streak 7 | epic | 70 | 7 consecutive days |
| time-investor-ii | Time Investor II | rare | 45 | 2,000 total session minutes |
| time-investor-iii | Time Investor III | epic | 65 | 5,000 total session minutes |
| daily-streak-14 | Daily Streak 14 | epic | 75 | 14 consecutive days |
| daily-streak-30 | Daily Streak 30 | legendary | 200 | 30 consecutive days |

### Hidden Achievements (4)

| ID | Title | Rarity | XP | Trigger |
|----|-------|--------|-----|---------|
| no-undo-ninja | No-Undo Ninja | rare | 30 | 30 min without canceling |
| phoenix | Phoenix | epic | 60 | Recovered quickly after crash |
| comeback-kid | Comeback Kid | rare | 35 | 5+ runtime fixes in one session |
| docs-first | Docs First | rare | 25 | First file edited was a .md file |

### Rarity Distribution

| Rarity | Count | XP Range |
|--------|-------|----------|
| Common | 12 | 10-25 XP |
| Rare | 24 | 25-80 XP |
| Epic | 21 | 45-75 XP |
| Legendary | 8 | 150-250 XP |
| **Total** | **65** | |

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

25 levels with progressive XP thresholds:
```
[0, 100, 250, 450, 700, 1000, 1400, 1850, 2350, 2900,
 3500, 4200, 5000, 5900, 6900, 8000, 9200, 10500, 11500, 12200,
 12800, 13300, 13700, 14000, 14500]
```

Levels 1-15 unchanged from original. Levels 16-25 extend to 14,500 XP max, reachable through achievements + daily AI insight bonuses over time.

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
- **Config**: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`, `.config`
- **Full Stack** achievement triggers when both frontend and backend edits detected
- **Cross Stack** achievement triggers when frontend + backend + config edits detected

## Daily Streak Tracking

Uses `toLocaleDateString('en-CA')` for YYYY-MM-DD local-time dates. On session end:
- Same day = no change
- Yesterday = increment `consecutiveDays`
- Older = reset to 1

Awards `daily-streak-3` (>=3 days), `daily-streak-7` (>=7 days), `daily-streak-14` (>=14 days), and `daily-streak-30` (>=30 days).

## i18n (Internationalization)

**Supported languages**: English (en), Hebrew (he)

Language is selected via a dropdown in the Achievement panel settings (gear icon). The selection is persisted to `localStorage` under the key `claui-achievement-lang`.

All UI strings are translated:
- Panel: titles, labels, buttons
- Info modal: all explanatory sections including AI insight
- Toast notifications: achievement titles and descriptions
- Session recap: all field labels (files, languages, AI insight, quality, pattern, XP bonus)
- Goal names (all 7 goals)
- All 65 achievement titles and descriptions

**Adding a new language**: Add a new object to the `translations` record in `achievementI18n.ts` with all keys from the `AchievementTranslations` interface, and add an entry to `ACHIEVEMENT_LANG_OPTIONS`.

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.achievements.enabled` | `true` | Master toggle for the achievement system |
| `claudeMirror.achievements.sound` | `false` | Play sound on achievement toast |
| `claudeMirror.achievements.aiInsight` | `true` | Enable AI-powered session insights (once per day) |
| `claudeMirror.achievements.githubSync` | `false` | Auto-sync achievements to GitHub Gist after each session |
| `claudeMirror.achievements.githubOAuthClientId` | publisher-provided client ID | GitHub OAuth App Client ID for browser-based sign-in (Device Flow). Published builds can ship a default so users do not need manual setup. Override for custom/self-hosted OAuth apps. If empty, connect falls back to PAT input |

## State Flow

1. User performs action (bug fix, test pass, file edit, etc.)
2. `MessageHandler` calls appropriate `AchievementService` hook
3. `AchievementEngine` evaluates rules, returns `EngineResult` with awards/progress/editsDelta
4. `AchievementService` persists to `AchievementStore`, checks cross-session tiers, broadcasts to webview
5. Webview store updates, UI re-renders (panel, toast, recap)
6. On session end: daily streak check, session snapshot captured, AI insight spawned (async)
7. Enriched recap sent to webview when AI insight completes
8. If GitHub sync enabled: auto-publish `ShareableProfile` to public Gist (silent, best-effort)

## Community / GitHub Sync

Social sharing layer for achievements using GitHub Gists. No backend server needed.

### How It Works

1. **Authentication (preferred)**: Uses GitHub OAuth Device Flow with only `gist` scope. In published builds, the extension can ship a default OAuth App Client ID so users can click Connect without any manual settings step. GitHub opens in the browser, the user approves access, and the extension polls for the access token. The token is stored securely in VS Code's encrypted `SecretStorage` and persists across restarts (auto-reconnect on activation).
2. **PAT fallback**: If `claudeMirror.achievements.githubOAuthClientId` is not configured, connect falls back to PAT input (`gist` scope only) using VS Code password input. PAT is validated the same way (`GET /user` + `x-oauth-scopes`) and stored in `SecretStorage`.
3. **Publishing**: Creates/updates a public Gist with description `"ClaUi Developer Achievements"` and filename `claui-achievements.json`
4. **Discovery**: Friends are found by convention -- `GET /users/{username}/gists` and filter by description
5. **Auto-sync**: After each session end, if `githubSync` setting is enabled and user is connected
6. **Badges**: Uses shields.io dynamic badges pointing to the raw Gist URL
7. **Auto-reconnect**: On extension activation, if a stored GitHub token exists in `SecretStorage`, the service validates it against `GET /user` and restores the connection silently. Revoked tokens are cleaned up; network errors preserve the stored token for next restart.

### ShareableProfile Schema

```typescript
interface ShareableProfile {
  version: 1;
  username: string;
  displayName: string;
  avatarUrl: string;
  lastUpdated: string;       // ISO 8601
  totalXp: number;
  level: number;
  unlockedIds: string[];
  stats: {
    sessionsCompleted: number;
    totalSessionMinutes: number;
    bugFixes: number;
    testPasses: number;
    consecutiveDays: number;
    totalEdits: number;
  };
}
```

### Key Design Decisions

- **Minimal permissions** -- Uses GitHub OAuth Device Flow requesting only `gist` scope (PAT fallback also requires only `gist`)
- **Better UX** -- Primary connect flow is browser-based GitHub sign-in (Device Flow), so most users do not need to create or paste a PAT
- **Persistent auth** -- OAuth/PAT token stored in VS Code's encrypted SecretStorage; auto-reconnects on restart
- **Opt-in only** -- `githubSync` defaults to `false`; user must explicitly connect
- **Silent sync** -- Network failures never break the extension; local data is always source of truth
- **15min cache** -- Friend profiles cached to respect GitHub rate limits (60/hr unauthenticated)
- **Schema versioning** -- `version: 1` field enables future backward-compatible changes
- **Discovery by convention** -- Gist description "ClaUi Developer Achievements" eliminates need for a registry
- **CSP updated** -- `img-src` allows `https://avatars.githubusercontent.com` for friend avatars
- **Scope validation** -- On connect, checks `x-oauth-scopes` header to verify the token has `gist` scope before accepting it

### Message Types (10 new)

**Webview -> Extension**: `githubSync`, `addFriend`, `removeFriend`, `refreshFriends`, `getCommunityData`, `copyShareCard`

**Extension -> Webview**: `githubSyncStatus`, `communityData`, `friendActionResult`, `shareCardCopied`
