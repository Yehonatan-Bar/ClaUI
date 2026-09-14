# ClaUi - מדריך תכונות מפורט וקיף

**מסמך זה תיאור ממוקד של כל יכולות ClaUi, ארגון בקטגוריות סמנטיות עם הסבר מלא של כל תכונה, מקרי שימוש, וקשרים בין-תכונות.**

---

## I. ניהול מולטי-טאב וסשנים

### 1. ארכיטקטורה מולטי-סשן עצמאית

**תיאור:**
כל סשן שיחה רץ כתהליך Claude CLI עצמאי לחלוטין עם מנהל מצב משלו, מפרידה של פלט JSON, ופאנל webview ייעודי. `TabManager` מרכזי מתאם בין כל הטאבים, עוקב אחרי הטאב הפעיל, ומספק ניהול מחזור חיים מרכזי.

**מנגנונים עיקריים:**
- **הרצה מקבילה** - מספר סשנים יכולים לרוץ בו זמנית ללא חסימה; עצירת סשן אחד לא משפיעה על אחרים
- **קידוד בצבע ייחודי** - כל טאב מקבל צבע מ-8 צבעים (כחול, אדום, ירוק, כתום, סגול, תכלת, זהב, לבנים)
- **שם ממוכן באמצעות AI** - הודעה ראשונה נשלחת ל-Haiku (Claude) או `codex exec` (Codex) ליצירת שם קצר תיאורי
- **עקיפי פעילות** - אנימציה מסתובבת בכותרת הטאב עם סיכום כלים רב זמני (למשל "קריאת קובצים", "בדיקה")
- **ניצול מעצמאות** - כל הסשנים ממוצנעים ב-`SessionStore` גלובלי ב-VS Code (ID, שם, מודל, זמנים, ראשון) עם קסם של עד 100

**מערכות קשורות:**
- Session summarization וקידוד בצבע
- Plan approval and user questions
- Message translation (תמיכה בעברית)

---

### 2. היברנציה ארוכת טווח (שינה קלה והעמוקה)

**תיאור:**
טאבים שלא פעילים לאחרונה יכולים להיות "שנתים" (מושהים) לשחרור זיכרון תוך שמירה על היסטוריה מלאה לחזרה מייד.

**השיטה:**
- **קלה (Light)** - פעולות קריאה בלבד מותרות; כל פעולת כתיבה דורמת את הסשן
- **עמוקה (Deep)** - תהליך CLI בן ממש מושהה; שחזור דורש ברית מחדש

**הפעלה אוטומטית:**
- לאחר X ימים של אי פעילות (ניתן להגדרה)
- מקטין דגל "hibernated" בטאב

---

### 3. קבוצות טאבים וארגון תיקיות

**תיאור:**
צור תיקיות ותת-תיקיות צבועות לארגון טאבים קשורים; תמיכה מלאה בגרור-ושחרור להעברה בין-קבוצות.

**מאפיינים:**
- **קודדים בצבע** - תיקיות משתמשות באותה פלטה כמו טאבים
- **שמות מותאמים** - כל תיקייה מקבלת שם משלה
- **תת-תיקיות** - רמה שרירותית של הקינון
- **מצב קריסה** - זכור מצב הרחבה/כיווץ בעבור כל תיקייה

**ניצול:**
- TabGroupsTreeProvider (Sidebar TreeView)
- Persists in workspaceState

---

## II. ניהול שיחות והיסטוריה

### 4. מערכת Browse וResume

**תיאור:**
גישה לכל הסשנים הקודמים דרך QuickPick מודאלי; בחירה משחזרת את ההיסטוריה המלאה.

**תכונות:**
- **תצוגה מהירה** - שם סשן, מודל, חותמת זמן יחסית, תצוגה מקדימה של הודעה ראשונה
- **קורא שיחות** - משתמש בקובצי JSONL ישירים מ-`~/.claude/projects/` להשמעה מייד (ניתוק מעיכול ממוטן)
- **הסכנה** - `--resume <sessionId>` משוחזר באמצעות Claude CLI

**מקרי שימוש:**
- חזרה לעבודה שהועברה בטאב אחר
- אחזור קשור מתוך הודעה ישנה

---

### 5. Fork מהודעה (Branch Conversations)

**תיאור:**
לחץ כפתור "Fork" בכל הודעת משתמש להסתעפות לטאב חדש; שיחה שוכפלת עד נקודה זו.

**שיטה:**
- **Claude טאבים** - העתק טיכון חלקי JSONL; גרום ל-CLI להתחיל מחדש עם קובץ התיכון
- **Codex טאבים** - שכפול היסטוריה בממשק ב-UI; קלט מלא מלא בטאב החדש

**מקרים:**
- חקר כיווני תוצאה ממקום הביניים
- "מה אם" ניסויים

---

### 6. BTW (Side Thought) Context Menu

**תיאור:**
קליק-ימני בכל מקום לפתיחת תפריט "btw..." לשאלות מחוץ לנושא ללא הפרעה לזרימה הראשית.

**משמעות:**
- יוצר טאב חדש בעל הקשר עד להודעה שנלחץ
- לא יוצר מסכת ערך או ענף
- טיוטה מוגדלת מראש

---

### 7. עריכת הודעות שנשלחו

**תיאור:**
סמן את כל הודעת משתמש ישנה לחשוף כפתור "Edit" בעת גרירה; השנויה משולחת מחדש.

**זרימה:**
1. סמן הודעה שנשלחה → כפתור "Edit" מופיע
2. עריכה + שליחה מחדש
3. CLI קורא, סשן הגדול כל הודעות משנית, ההודעה שערוכה הופכת ל-ראשונה

**הנהלה:**
- Store.ts ממחוקים משנית בעבור fork/resume
- Checkpoint manager כל זה נתמך

---

### 8. מערכת היסטוריית הנתונים (3-Tier)

**תיאור:**
שלוש רמות של ניצול היסטוריה:
1. **Session** - בזיכרון בלבד, הטאב הנוכחי
2. **Project** - workspaceState, לכל workspace
3. **Global** - globalState, כל workspaces

**מנטי:**
- **שקרויות** - קיבוץ מודאלי עם 3 טאבים, חיפוש טקסט חופשי, לחץ להוסיף לממשק קלט
- **ניווט חץ** - תלחץ ArrowUp/Down בטקסט-אריה להחלפה בהיסטוריה
- **ביטול-כפול אוטומטי** - כל הודעה ששלחת שמורה, כפולות מוסרות, כסף ל-200 לכל קפה

---

## III. בחירת מודל וספקים

### 9. מרחקי מודל Claude

**מודלים נתמכים:**
- Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5
- Legacy: Opus 4.8/4.7/4.6, Sonnet 4.6/4.5

**מנטי:**
- **בוחר dropdown** בשורת הסטטוס עם תוויות ידידותיות
- **החלפה חיה** - שינוי מודל במהלך סשן בעיל וקבל/כל מצב הנוכחי
- **ניצול** - בחירה נשמרת ל-VS Code settings ומשוחזרת בעלייה

---

### 10. Codex (OpenAI GPT) Integration

**תיאור:**
Codex מלא runtime support דרך `codex exec --json` (הפעמה ראשונה) ו-`codex exec resume --json` (המשך).

**מנטי:**
- **stdin prompt** - להימנע מ-Windows מגבלת שורת פקודה (~8,191 תווים)
- **Cancel** - הורג רק בפנייה הנוכחית; סשן לוגי נשאר בתהליך
- **Speed selector** - "Default" vs "Fast" חלון זמן דיור
- **Image paste** - קבצים זמניים עם `--image` דגלים
- **Git integration** - פועל בטאבים Codex
- **Provider-specific UI** - Codex טאבים מסתירים SkillGen, Usage, וביתר תכונות Claude-בלבד

---

### 11. הנחיה מרובה

**תיאור:**
לחצן "Codex" בשורת סטטוס ובוחר נתונים גם כן יכול להחליף בין Claude ו-Codex.

**אחסון:**
- בחירה נשמרת לכל טאב (או מטוב ברירת מחדל)

---

## IV. הרשאות וביטחון

### 12. Full Access Mode

**תיאור:**
כל הכלים מופעלים; Claude משתמש `--permission-mode bypassPermissions`; Codex משתמש `--dangerously-bypass-approvals-and-sandbox`.

**שימוש:**
- עבודת סוכן אוטונומית
- מצבים עם תקציב גבוה לאחור

---

### 13. Supervised Mode

**תיאור:**
קבוצה מוגבלת של כלים (Read, Grep, Glob, WebFetch, WebSearch בלבד).

**Claude:**
- `--allowedTools` קובע מגבלה

**Codex:**
- `--sandbox read-only`

**מקרים:**
- קוד לא מהימן
- עבודה עם אדם בלולאה

---

### 14. Toggle Mode

**תיאור:**
dropdown בשורת סטטוס להחלפת מודים; חלופי ב-Claude הבא spawned או Codex turn.

---

## V. אישור תוכנית ושאלות משתמש

### 15. Plan Approval Bar

**תיאור:**
התאם את זרימת האישור 4-אפשרויות של Claude CLI:

1. **ניקוי + עקיפה** - הנעת compaction, בייפס הרשאות
2. **עקיפה בלבד** - הרשאות bypassed
3. **אישור ידני** - החלפה לפי-supervised mode לאישור כל עריכה
4. **משוב** - שלח טקסט ל-CLI

**צגון:**
- אחוז שימוש הקשר (כשזמין)
- Plan tool blocks בירוק/כחול

---

### 16. AskUserQuestion Support

**תיאור:**
כפתורים אפשרויות + קלט תשובה מותאם לכל שאלה בקריאות multi-question.

**זרימה:**
- **Full-access** - תשובות הוזרקו דרך `can_use_tool` control protocol
- **Supervised** - תשובות שלחו כהודעות משתמש

---

## VI. קלט עשיר והודעות

### 17. Image Handling

**תיאור:**
`Ctrl+V` להדבקת תמונות מחוצץ כקריטים base64.

**מנטי:**
- **תצוגה מקדימה** - מתוך-קטנה מעל הממשק קודם משליחה
- **הסרה** - לחץ X בתצוגה מקדימה
- **Codex support** - קבצים זמניים עם `--image` דגלים

---

### 18. Send While Busy & Cancellation

**תיאור:**
שלח הודעה חדשה בזמן שClaude משיב (ביטול חכם).

**מנטי:**
- **Escape** או כפתור Cancel מוקדש
- **הסבה מיידית** - סשן משיחה מיידית לאחר ביטול

---

### 19. File Mentions (@)

**תיאור:**
הקלידו `@` כדי להוציא חיפוש קובץ workspace עם Autocomplete (150ms debounce).

**שימוש:**
1. `@query` → טאב/חץ זה לבחירה → חץ להחלפת `@query` עם דרך יחסית
2. או: נימוק-כלים בחלופה עם `+` כפתור עבור מקופח
3. או: `Ctrl+Alt+Shift+C` חותך בעת עריכת workspace

**תמיכה בגודל:**
- Multi-file mentioning כשנבחרות קובצים מרובים

---

### 20. RTL Support (Hebrew & Arabic)

**תיאור:**
כל תמיכה RTL for Hebrew ו-Arabic עם detection + overrides.

**מנטי:**
- **Auto-detection** בהודעות
- **Manual LTR override** בעבור תוכן "יוצא מהרשומים"
- **CSS RTL-specific** בעבור markdown, קוד, אי-ישיר

---

### 21. Custom Controls

**תיאור:**
`Ctrl+Enter לשלוח` (אפשר להגדיר); `Enter` מוסיף קו חדש בעת הגדרה.

**ניתוח:**
- `Ctrl+Alt+Enter` קידום שליח alternate

---

## VII. Dashboard אנליטיקה עמוקה

### 22. Session Mode (7 Tabs)

**תיאור:**
Dashboard מצב סשן מתוך שלוש מצבים (Session, Project, User).

**Tab: Overview**
- 6 metric cards: turns, error rate, tool uses, top tool, bash commands, avg duration
- Duration bar per turn (colored by category)
- Tool frequency horizontal bar (top 15)
- Tool category donut chart
- Mood timeline (colored dots)
- Frustration alert (3+ frustrated turns)

**Tab: Tokens**
- Input, output, cache-create, cache-read summaries
- Stacked token bar per turn

**Tab: Tools**
- Top 15 frequency
- Category distribution

**Tab: Timeline**
- Duration bars (by category)
- Task type + outcome distribution
- Sortable, paginated (15/page)

**Tab: Commands**
- Category filters (git, npm, test, build, deploy, search, file, other)
- Searchable timeline
- Bug repeat tracker

**Tab: Context**
- Session metadata (ID, model, CWD, MCP servers, tools)
- Conversation inspector (expandable messages)
- Role filter (All/User/Assistant)
- Free-text search

**Tab: Usage**
- Live Anthropic API data (OAuth from `~/.claude/.credentials.json`)
- Billing buckets with %, daily spend, monthly limit, reset dates
- Auto-refresh toggle
- Period tabs (5h/24h/7d/14d/30d/60d)

---

### 23. Project Mode (5 Tabs)

**תיאור:**
מצטברות מחזיר כל הסשנים במרחב עבודה.

**Overview:**
- Total sessions, turns, tool uses, error rate, top model, avg duration
- Turns-per-session bar
- Aggregated tool frequency
- Model usage distribution

**30 Days:**
- Filter last 30 days only

**Sessions:**
- Searchable, sortable table
- Columns: name, date, model, turns, errors, duration, top tool
- Expandable rows

**Tokens:**
- Aggregated summary
- Per-session stacked bar

**Tools:**
- Aggregated frequency + categories

---

### 24. User Mode (3 Tabs)

**תיאור:**
Cross-session, cross-project metrics.

**Token-Usage Ratio:**
- Correlates tokens with usage %
- Cost weight: Output=5x, CacheWrite=1.25x, Input=1x, CacheRead=0.1x
- Summary cards per bucket
- Global stats bar
- Trend line chart
- 50-sample history table

**Memory:**
- Live snapshot every 2.5s
- Stat cards: VS Code RSS, Extension Host (w/ V8 heap), ClaUi CLI tree, system %
- Area chart (last 10 min)
- Bar chart (process categories)
- Per-tab CLI tree table

**Particle Accelerator:**
- Skill filter management (see below)

---

## VIII. טורנים סמנטיים וניתוח

### 25. TurnAnalyzer

**תיאור:**
לאחר כל סיבוב, ספק Haiku בעמל one-shot כדי לסווג:
- User mood (frustrated, neutral, satisfied, focused)
- Task outcome (success, partial, failure, unclear)
- Task type (feature, bug_fix, testing, refactor, documentation, deployment, research, other)
- Bug repetition
- Confidence level

**בקרות עלויות:**
- Queue (max 20 pending)
- Per-session cap (default 30)
- Timeout (default 30s)
- Toggle via settings

**Display:**
- Merged בעבור `turnSemantics` postMessage
- Used by Timeline, Commands, Dashboard

---

## IX. Vitals & Session Health

### 26. Weather Widget

**תיאור:**
Animated mood icon reflecting session state.

**States:**
- Clear sky = smooth
- Storms = many errors
- Rainbow = just recovered

---

### 27. Session Timeline (Vertical Minimap)

**תיאור:**
Color-coded minimap of all completed turns on the right side.

**Colors:**
- Green = success
- Red = error/failure
- Blue = discussion (no tools)
- Purple = write tools
- Orange = research tools
- Cyan = command tools
- Magenta = skill invocations

**Interaction:**
- Click segment to jump to turn

---

### 28. Turn Intensity Borders

**תיאור:**
Left border on assistant messages (same color as timeline).

**Width reflects tool activity:**
- Thin = 0 tools
- Medium = 1-3 tools
- Thick = 4+ tools

---

### 29. Adventure Widget (Pixel-Art Dungeon Crawler)

**תיאור:**
220x220 cell maze with PICO-8 palette; each CLI turn extends maze.

**Encounters:**
- Scrolls = Read
- Anvils = Edit
- Traps = 1 error
- Dragons = 3+ errors
- Treasure = Recovery

**Engine:**
- 4x4 sprites
- BFS pathfinding
- Camera tracking
- State machine (IDLE, WALKING, ENCOUNTER, RESOLUTION)

**Toggle:**
- Independent enable/disable
- Visible only when vitals enabled

---

## X. ממלאות וגיימיפיקציה

### 30. Achievement System (65 Achievements)

**תיאור:**
7 categories with tier/level progression, XP, daily streaks, and social features.

**Categories:**
1. **Debugging** (12) - First Blood, Speed Patch, Bug Squasher, Hot Streak, etc.
2. **Testing** (10) - Test First, Test Marathon, Test Driven Dev, etc.
3. **Refactoring** (8) - Tidy Up, Clean Sweep, Surgeon, etc.
4. **Session** (11) - Night Owl, Early Bird, Marathon, Deep Focus, etc.
5. **Architecture** (7+) - File/language complexity, config edits
6. **Collaboration** - Cross-session milestones
7. **Productivity** - Various cross-session achievements

**Rarity System:**
- Common (10 XP), Rare (25-40), Epic (45-70), Legendary (180-250)
- Rarity-colored toasts with optional sound

**XP & Leveling:**
- 25 levels, progressive thresholds
- Per-session goals (7 templates)
- Daily streaks (consecutive days)

**Session Recap Card:**
- Duration, bugs, tests, files, languages, badges, XP
- AI insights (Sonnet, once/day, optional)

**Community:**
- GitHub Gist publishing
- Friend system
- Side-by-side comparison
- Shields.io badges
- Markdown profile cards
- Auto-reconnect

**i18n:**
- Full English + Hebrew

---

## XI. Activity & Summarization

### 31. Activity Summarizer

**תיאור:**
לאחר N tool uses (ברירת מחדל 3), שלח enriched שם כלי ל-Haiku.

**Output:**
- Short label (3-5 מילים)
- Full 1-sentence summary

**Display:**
- Tab title activity area
- Status bar tooltip

---

### 32. Message Translation

**תיאור:**
Translate any assistant message to 10 languages (Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean).

**Method:**
- Per-message button
- One-shot Sonnet 4.6 CLI call
- Cached per message

**RTL:**
- Hebrew and Arabic auto get RTL layout

**Config:**
- Dropdown in Vitals gear
- `claudeMirror.translationLanguage` setting

---

### 33. Prompt Enhancer

**תיאור:**
AI-powered prompt rewriting via advanced prompt engineering.

**Modes:**
- **Manual** - Sparkles button, side-by-side review, edit before send
- **Auto** - Intercept Send, enhance, then send (fallback to original)

**Config:**
- Model selector (Haiku, Sonnet 4.6/4.5, Opus 4.6)
- Auto-enhance toggle

---

## XII. Codex & Expert Consultation

### 34. Codex Expert Consultation

**תיאור:**
"Consult" button in StatusBar opens input panel; question enriched with CLI context.

**Flow:**
1. User's question + Claude context
2. Claude calls `mcp__codex__codex` MCP tool
3. GPT advice streams back
4. Claude continues based on advice

---

## XIII. Text & Theme Customization

### 35. Text Settings & Fonts

**תיאור:**
Font size slider (10-32px) + family presets (Hebrew-friendly).

**Persistence:**
- VS Code config + Zustand

---

### 36. 4 Typing Personality Themes

**Terminal Hacker:**
- Green-on-black, high contrast
- Typewriter streaming
- Technical feel

**Retro:**
- CRT-inspired, vintage
- Scanline effects

**Zen:**
- Minimalist calm
- Soft animations

**Neo Zen:**
- Blue-turquoise, futuristic
- Glass effect
- No aggressive effects

**Application:**
- Instant to all messages + history
- Display-only (no model changes)

---

## XIV. Markdown & Code Rendering

### 37. GitHub Flavored Markdown

**תיאור:**
Bold, italic, headers, lists, tables, blockquotes, inline code, links, rules.

**Code Blocks:**
- Syntax highlighting (50+ languages)
- Copy button, collapse toggle, HTML preview button
- XSS protection via DOMPurify

**File Paths & URLs:**
- Auto-linkified
- Smart detection with fallback

**RTL:**
- Full directional overrides
- Dedicated rtl.css with markdown rules

---

## XV. Git & Workflow Integration

### 38. Git Push Integration

**תיאור:**
"Git" button in status bar executes `scripts/git-push.ps1` PowerShell.

**Steps:**
- `git add .`
- `git commit -m "<session-name>"`
- `git push`

**Customization:**
- Config panel (gear button)
- Custom message template
- Auto-opens config if not set

**Feedback:**
- Toast notifications

---

### 39. Auto Skill Generation (SkillGen)

**תיאור:**
SR-PTD pipeline: scan project for documentation, extract, normalize, enrich, cluster, merge, synthesize into skills.

**8-Phase Pipeline:**
- B (Extract) - Python
- C.0-C.1 (Normalize) - Python
- C.2 (Tag Enrichment) - Claude CLI
- C.3 (Incremental Clustering) - Claude CLI
- C.4 (Cross-Bucket Merge) - Claude CLI
- C.5 (Sanity) - Python
- D (Skill Synthesis) - Claude CLI (parallelized)
- Sanity check - Python

**3-Tier Deduplication:**
1. Traceability fingerprint (exact match)
2. Trigram metadata similarity
3. AI placeholder detection

**Atomic Installation:**
- Backup/rollback support
- Installed to `~/.claude/skills/`
- Cross-process file locking

**Resume Support:**
- `.pipeline_progress.json` tracks state

**UI:**
- Full overlay panel
- Progress bar, history table
- "Generate Now" / "Cancel"

**Auto-Trigger:**
- Threshold-based (default 5 documents)
- Manual button

---

### 40. SR-PTD Bootstrap (Auto-Inject)

**תיאור:**
On activation, install bundled SR-PTD skill to `~/.claude/skills/sr-ptd-skill/`.

**Injection:**
- Smart CLAUDE.md injection for post-task documentation

**Change Detection:**
- Only overwrites when bundled version changes
- Duplicate injection prevention

---

## XVI. Account & API Management

### 41. Claude CLI Auth Integration

**תיאור:**
Login/logout/status via `claude auth status --json` and `claude auth logout`.

**Display:**
- Signed-in email + subscription type (e.g., "team")
- Located in Vitals gear panel

**10s timeout** with fallback

---

### 42. API Key Management

**תיאור:**
VS Code SecretStorage (OS keychain) for Anthropic API keys.

**UI:**
- "Set" button in Vitals gear

---

### 43. Environment Sanitization

**תיאור:**
Strips `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `ANTHROPIC_API_KEY` from all spawned processes.

**Modes:**
- `buildSanitizedEnv()` for Codex
- `buildClaudeCliEnv(apiKey?)` for Claude

---

## XVII. Logging & File Management

### 44. Per-Session File Logging

**תיאור:**
Named logs: `<session-name>_<dd-hh-mm>.log`.

**Features:**
- Global extension-level logs separate
- Auto-rotate at 2MB
- Auto-rename when session name changes

**Config:**
- Enable/disable via `claudeMirror.enableFileLogging`
- Custom directory via `claudeMirror.logDirectory`
- `Ctrl+Alt+L` opens log directory

---

## XVIII. Responsive Status Bar

### 45. Dynamic Layout Stages

**Stage 1 - Full Width:**
- All controls visible

**Stage 2 - Medium:**
- Shows: History, Feedback, Plans, Babel Fish
- Vitals gear outside

**Stage 3 - Collapsed:**
- "More" dropdown
- "Tools" dropdown
- Always visible: Session Timer, Vitals, Aa

**Stage 4 - Minimal:**
- Single "Menu" dropdown
- Only Vitals gear

**Smart Behavior:**
- ResizeObserver with hysteresis
- Dropdowns open upward
- Click-outside dismiss
- Escape key support

---

## XIX. Vitals Quick-Settings

### 46. Vitals Gear Panel

**תיאור:**
Consolidated settings hub:

- Vitals feature explanations
- Claude Account (email, subscription, refresh, logout)
- API Key ("Set" button)
- Translate to (10-language dropdown)
- Adventure Widget toggle
- Semantic Analysis (toggle + model selector)
- Skill Generation toggle
- Usage Widget toggle
- Show Vitals (master toggle)

All sync bidirectionally with VS Code settings.

---

## XX. Global Tooltip System

### 47. Unified Tooltip Component

**תיאור:**
Single `GlobalTooltip` React component via `createPortal`.

**Features:**
- VS Code-themed
- Smart positioning (auto-flip, shift horizontally)
- 400ms hover delay
- `role="tooltip"`, dynamic `aria-describedby`
- Touch-device guard
- Scroll dismiss

**Usage:**
- ~25 components use `data-tooltip` attribute

---

## XXI. Advanced Mapping & Portfolio

### 48. Workstream Map (Subway-Style Visualization)

**תיאור:**
Groups sessions into logical workstreams (coherent threads with goal, status, history). SVG rendering with pan/zoom, grid background, minimap.

**Data Model:**
- **Workstream**: type (feature, bug_fix, research, refactor, infrastructure, experiment, uncategorized), status (active, completed, blocked, uncertain, research, abandoned, planning), sessions, confidence, importance/attention scores, current state synthesis, metrics, plan-reality comparison
- **Station**: meaningful event within session (1-5 per), shapes (circle, diamond, square, triangle, star, X, lock, junction)
- **ProjectMapState**: workstreams[], stations[], splits[], merges[], currentState, userEdits[]

**Classification Pipeline:**
1. Enrich sessions with metadata (files, git, prompts)
2. Ingest orphan git commits (14 days)
3. Heuristic pre-cluster (branch, file overlap, temporal proximity)
4. Sonnet AI classification
5. Label sanitization (strip "ultrathink")
6. Extract stations (1-5 per session, batched)
7. Synthesize project + per-workstream current state
8. Score importance/attention
9. Save with snapshot

**Session Scoping:**
- Open tab sessions
- Last 4 days activity
- Orphan commits (14 days)

**External Folder Import:**
- Opt-in explicit folder scanning (user selects path)
- Supported: .md, .txt, .rst, .json, .yaml, .html, .xml, .docx
- Creates one `external_folder` workstream + stations
- Dashed line distinguishes from live sessions

**SVG Layout:**
- Deterministic lane-based algorithm
- LANE_HEIGHT 90px, STATION_SPACING_X 140px
- Stations positioned evenly along paths
- Framer-motion for drawing/particles/zoom

**Visual Encoding:**
- Line colors by status (green=completed, red=blocked, blue=active, yellow=uncertain, purple=research, gray=abandoned, cyan=planning)
- Texture: solid ≥70% confidence, dashed <70%
- Station shapes by type
- Glow for recent/attention/resolved/uncertain

**Controls:**
- Pan/zoom (drag, mouse wheel, double-click reset)
- Minimap (bottom-right)
- Toggle buttons (Current State, Plan Overlay, Resolve)
- Filter buttons (Inactive, Low Confidence, Reclassify)

**Cross-Project Portfolio:**
- Top-level view across all projects (globalState)
- Project health scoring (blocked, stale, needs_attention, healthy)
- Cross-project resume recommendation
- Max 30 projects, auto-prune after 180 days

---

## XXII. Search & Retrieval

### 49. Chat Search

**תיאור:**
Cross-session text search via raw JSONL string matching.

**UI:**
- Dedicated search tabs
- Read-only tool allowlist
- Magenta slot color

---

### 50. Smart Search

**תיאור:**
Model-selection for search queries.

---

## XXIII. Particle Accelerator (Output Compression)

### 51. Particle Accelerator

**תיאור:**
Local-only command output compressor. Intercepts Bash, redacts secrets, filters noisy output, preserves exit codes, writes traces.

**Three Contexts:**
- **Extension host** - service, lifecycle, settings, hooks
- **claui-run CLI** - execution, redaction, filtering
- **Webview** - badge, settings panel, trace dashboard

**Pre-Tool-Use Hook:**
- Rewrites: `bash "git status"` → `bash "claui-run --claui-encoded-shell-command <base64url>"`
- MCP tool arguments also scanned

**Output Filtering:**
- 9 filters (user-defined, JavaScript/npm, pytest, jest/vitest, TypeScript, ESLint, git semantic, 55+ declarative, generic fallback)
- Token budgets (balanced: 8k, strict: 4k, verbose: 32k)

**Secret Redaction:**
- Env-value scanning
- Regex rules (GitHub PATs, AWS keys, JWTs, etc.)
- Fail-closed

**Command Eligibility:**
- Deny redirections, SSH, sudo, vim, npm run dev, docker run, etc.
- Allow ~80 patterns

**Codex:**
- Instruction-only mode (appends claui-run usage)

**Analytics:**
- Per-session stats (command count, tokens saved, compression ratio)
- Daily aggregate reports

**UI:**
- StatusBar badge (green=on, red=off, orange=warn)
- Settings panel
- Trace dashboard

---

## XXIV. Security & Data Protection

### 52. Super Particle Accelerator (Secret Write Guard)

**תיאור:**
Hook-based secret interception blocking AI from writing secrets. Differs from PA by protecting write operations.

**Three Contexts:**
- **Extension host** - service, settings, exceptions, audit
- **Hook scripts** - scanning, policy eval, audit writing
- **Webview** - badge, audit panel, settings

**Hook Events:**
- **PreToolUse** (Edit/Write/Bash/MCP) - Block writes
- **PermissionRequest** (Codex Bash) - Block MCP requests
- **PostToolUse** (Bash output) - Audit side effects
- **Stop** (working tree scan) - Report pre-existing

**5-Gate Deny-First Policy:**
1. No findings (allow)
2. Placeholders/low-confidence (allow)
3. Public/client path (hard deny)
4. Gitignored env file (audit only)
5. Exception match (audit only)
6. Default (deny or audit)

**Path Classification (5 Risk Levels):**
- `public-client-code` - Hard deny
- `generated-public-artifact`
- `server-code`
- `local-secret-file`
- `unknown-repository-file`

**Git State Scanning:**
- Staged, unstaged, untracked files
- Blocks `git add`/`commit`/`push` on secrets
- Verifies .env is gitignored

**Two Modes:**
- `block` - Deny writes
- `audit` - Log only (Gate 2 always denies)

**Exception System:**
- Scoped temporary approvals
- Atomic writes, max-use limits, expiry

**Audit Trail:**
- JSONL with safe redaction (max 25%, 8 chars, SHA-256 hash)

**Baseline Dedup:**
- Per-session, only report new findings

**Config:**
- 11 VS Code settings
- Entropy threshold (default 4.2)

---

### 53. Secret Protection Broker (Comprehensive DLP)

**תיאור:**
Multi-boundary, destination-aware DLP protecting 9+ boundaries (prompt, context, files, commands, terminal, MCP, browser, Git, persistence).

**13 Granular Boundaries:**
`prompt.submit`, `context.attach`, `file.read_for_context`, `command.preflight`, `command.output`, `git.diff`, `git.publish`, `mcp.request`, `mcp.response`, `browser.capture`, `persistence.write`, `telemetry.export`, `diagnostic.export`

**9 Destination Kinds:**
`local_agent`, `remote_model_provider`, `terminal_stdout_to_agent`, `local_disk`, `git_remote`, `mcp_server`, `browser_context`, `telemetry_backend`, `diagnostic_export`

**10 Scanners (6 Core + 4 Boundary-Specific):**

**Core:**
1. EnvValueScanner - Env KEY=VALUE with HMAC IDs
2. RegexRuleScanner - Provider tokens (14 built-in + rule packs)
3. EntropyScanner - Shannon entropy (opt-in, threshold 4.5)
4. PathSensitivityClassifier - File path sensitivity (6 finders)
5. StructuredPayloadScanner - JSON/YAML sensitive keys
6. PiiAndInternalTopologyScanner - Email, RFC 1918 IPs, hostnames

**Boundary-Specific:**
- ExtensionOutboundScanner
- WebviewOutboundScanner
- ServerOutboundScanner
- GitPublicationScanner

**13 Rule Packs (45 Rules):**
- Cloud: AWS (4), GCP (3), Azure (3)
- Providers: GitHub (4), OpenAI (2), Anthropic (1), Slack (4), Stripe (3)
- VCS: Git (2)
- Files: Protected paths (8)
- PII: Email, phone, SSN (3)
- Topology: Internal IPs, hostnames (4)
- Commands: Exfiltration (4)

**Destination-Aware Policy:**
- Finding x destination → action (block, redact, audit, allow)
- Mode-aware (strict, balanced, observe)
- Exception-checking

**Redaction:**
- Structured `<REDACTED type="..." id="..." />` tokens
- Overlap resolution (highest severity wins)
- Streaming with 200-char overlap buffer

**Command Risk Classifier:**
- 16 risk classes
- Cross-pipe analysis

**Project-Level Policy:**
`.claui/secret-protection.policy.json`:
- `protectedPaths`, `internalDomains`, `allowedModelProviders`, `allowedMcpServers`, `allowedGitRemotes`, `blockedCommands`, `approvalRequiredCommandClasses`, `hardBlockRules`, `allowlistedSecretHmacs`

**11 VS Code Settings:**
`enabled`, `mode`, `blockProtectedPaths`, `scanPrompts`, `scanTerminalOutput`, `scanGitPublication`, `scanMcp`, `requireBrowserCaptureApproval`, `exceptionMaxMinutes`, `auditRetentionDays`, `enableEntropyScanner`

**Audit & Compliance:**
- **AuditStore** - Date-partitioned JSONL with filters, stats, retention cleanup
- **ComplianceReporter** - SOC 2 CC6/CC7 and GDPR evidence generation

---

### 54. Workspace Access Guard (WAG)

**תיאור:**
Controls which file system paths AI agents can access.

**Architecture:**
1. Extension host - service, settings, policy, audit
2. Hook scripts - path normalization, policy eval, audit writing
3. Webview - settings panel

**Path Normalization:**
- Windows/Git Bash/WSL/tilde/relative unification
- Containment checking

**Command Path Extraction:**
- Shell tokenization
- Access-kind classification

**Policy Layers:**
1. User-approved roots (allowlist)
2. Org-level default (enterprises)
3. Deny list (system-critical)

**Audit Trail:**
- Per-boundary JSONL files

---

## XXV. MCP & Extensions

### 55. MCP Support (Model Context Protocol)

**תיאור:**
Full Phase 1A + Phase 1B for Claude tabs.

**Features:**
- Typed runtime MCP data from `system/init`
- Merged runtime/config/mutation inventory
- Overlay panel (Session, Workspace, Add, Debug tabs)
- Status bar MCP chip
- Context tab MCP pills
- Guided add/import/remove/reset/restart flows
- Project-scope diff preview
- SecretStorage-backed secrets with `${VAR}` placeholders
- Provider-aware gating (Codex/Happy read-only)

**Three Source-of-Truth:**
1. Runtime truth - Claude `system/init.mcp_servers`
2. Config truth - `.mcp.json`, `~/.claude.json`, local entries, CLI fallback
3. Mutation truth - Pending changes before restart

**CLI Services:**
- McpCliService - `claude mcp` wrapper (arg arrays only)
- McpConfigService - File + CLI fallback discovery
- McpRegistryService - Merges truth layers
- McpTemplateCatalog - GitHub, Playwright, Brave Search, Sentry, Slack, Postgres, Context7, Codex
- McpSecretsService - SecretStorage registry

**Secret Handling:**
- Config stores only `${PLACEHOLDER}`
- Real values in SecretStorage
- Re-hydrated on session start

**Message Flow:**
- Runtime init: `system/init` → typed MCP → sessionMetadata
- Webview ready: send mcpCatalog + inventory
- Mutations: preview/add/remove/import/reset/restart flows
- Session restart: preserves conversation, uses `--resume`

**Webview State:**
- `sessionMetadata.mcpServers` (runtime-only)
- `mcpInventory` (merged)
- `mcpTemplates`, `mcpDiffPreview`, `mcpPanelOpen`, `mcpSelectedTab`, etc.

**UI Surfaces:**
- Status bar chip (count, restart status, error)
- Context tab pills (status + tool count)
- MCP panel (Session/Workspace/Add/Debug tabs)

---

## XXVI. Slash Commands & Input Enhancements

### 56. Slash Commands (Inline Autocomplete & Browser)

**תיאור:**
Brings CLI's `/` slash-command experience into chat input. Typing `/` opens inline autocomplete; dedicated button opens full grouped browser.

**Commands Supported:**
- Native-routed: `/clear`, `/compact`, `/context`, `/model`, `/effort`, `/usage`, `/resume`
- CLI pass-through: everything else
- Two stages: command name → argument value

**Data Flow:**
- User types `/comp` → handleInput → useSlashCommand scans → filter catalog (sync) → SlashCommandPopup renders
- Enter/click → check slashCommandNeedsArg → run vs insert
- Keyboard: ArrowUp/Down navigate, Enter runs, Tab completes, Escape closes

**Trigger Detection:**
- Scan backward for `/` from caret
- `/` must be at position 0 or after whitespace
- Whitespace before `/` dismisses
- Space in query dismisses (user moved to arguments)

**Smart Routing (on send):**
| Command | Native Action |
|---------|---------------|
| `/clear` (aliases: `/reset`, `/new`) | useAppStore.reset() |
| `/compact` | beginManualCompact() + control protocol |
| `/context` | setContextWidgetVisible(true) |
| `/model <id>` | postToExtension setModel |
| `/effort <level>` | setSelectedClaudeEffort |
| `/usage` | reveal usage widget |
| `/resume` | openHistory |

**Compaction Feedback:**
- Manual `/compact` → pending marker + 90s timeout
- CLI `system/compact_boundary` → flip to done + postMessage
- CompactDivider renders (spinner, then "Context compacted")

**Run on Pick:**
- Picked commands bypass enhance/translate/schedule/queue paths
- Records in prompt history
- Clears input + dismisses popup

**Argument Autocomplete (Stage 2):**
- After `/`, trigger scan crosses spaces
- Popup switches to `mode: 'arg'` when command resolves
- Static `argOptions` or dynamic (e.g., `/model` builds from store)
- Select value → run `/name value` or insert

**Unavailable Commands (Headless):**
- `/fork`, `/branch`, `/rewind`, `/export`, `/copy`, `/theme`, `/login`
- All Terminal appearance & Platforms groups
- Flagged `unavailable: true`
- Greyed with "לא זמין" tag
- Cannot be run

**Full-List Browser:**
- Modal with grouped (sticky headers) commands
- Search box (ranked results, leading `/` accepted)
- Selection → CustomEvent `claui-slash-command-selected`
- Dismiss on Escape or backdrop click

**Command Catalog:**
- SLASH_COMMAND_GROUPS (grouped by category)
- Each: name, argsHint (optional), aliases, description, native route, needsValue, unavailable
- Source of truth for inline popup + browser

---

## XXVII. Usage & Deferred Send

### 57. Usage Limit & Deferred Send

**תיאור:**
When usage limits hit, messages queue (not sent); queue shows reset time; auto-send on reset.

**Visual Feedback:**
- Queue status in status bar
- Pending message count
- Option to view queued messages

---

## XXVIII. Provider Handoff

### 58. Provider Handoff (Cross-Provider Transfer)

**תיאור:**
Orchestrated transfer of conversation context between Claude and Codex.

**State Machine:**
- collecting_context → creating_target_tab → starting_target_session → arming_first_user_prompt → completed/failed

**Use Case:**
- Start research in Claude, hand off to Codex for implementation

---

## XXIX. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Open new Claude session |
| `Ctrl+Enter` | Send message |
| `Enter` | New line (Ctrl+Enter mode) |
| `Escape` | Cancel response |
| `Ctrl+Shift+M` | Toggle Chat/Terminal view |
| `Ctrl+Shift+H` | Open conversation history |
| `Ctrl+Alt+Shift+C` | Send current file path |
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+Alt+Q` | Stop current session |
| `Ctrl+Alt+K` | Compact context |
| `Ctrl+Alt+R` | Resume previous session |
| `Ctrl+Alt+Enter` | Send message (via input box) |
| `Ctrl+Alt+P` | Open plan documents |
| `Ctrl+Alt+L` | Open log directory |
| `Ctrl+Alt+A` | Toggle achievements panel |
| `Ctrl+Alt+D` | Discover sessions (disk scan) |
| `Ctrl+Alt+T` | Toggle team panel |

Mac: Replace `Ctrl` with `Cmd`

---

## סיכום

**ClaUi מלא >200 יכולות בודדות** המארגנות ל**39+ קטגוריות תכונות ראשיות** המתחילות CLI סוכן AI להיות IDE חזותי מלא עם:

- **ניהול מולטי-סשן** - טאבים עצמאיים מקבילים עם ניצול
- **אנליטיקה עמוקה** - סשן, פרויקט, מדד משתמש עם ניתוח סמנטי
- **גיימיפיקציה** - הישגים, XP, streaks, תכונות חברתיות
- **ביטחון** - SPA write blocking, boundary-aware DLP, path access control
- **כלים זרימה עבודה** - Git integration, prompt enhancement, skill generation, workstream mapping
- **איכות AI** - turn analysis, activity summarization, message translation, prompt enhancing
- **ספקים כפולים** - Claude + Codex support עם provider handoff
- **קלט מתקדם** - image paste, file mentions, autocomplete, RTL support
- **אופטימיזציה פלט** - Particle Accelerator filtering, command compression
- **התאמה עמוקה** - fonts, themes, typing personalities, extensive settings

כל תכונה מתוכננת סביב **friction מינימלית**, **ברירות מחדל security-first**, and **observability עמוק** לתוך AI agent behavior.
