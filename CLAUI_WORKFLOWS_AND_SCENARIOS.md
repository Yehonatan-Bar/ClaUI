# ClaUi - Workflows & Real-World Scenarios

**מסמך זה מייצג את יכולות ClaUi דרך עדשת תרחישי משתמש בעולם אמיתי וזרימות עבודה יומיומיות.**

---

## Workflow 1: תיקיית באג - חקירה ותיקון

### Scenario
אתה בודק באג שדווח בפרויקט. אתה רוצה לחקור את השורש שלו, ניסיון פתרונות מרובים, ותיקון בסוף.

### Interaction Flow

**Step 1: Open New Session & Describe**
1. `Ctrl+Shift+C` → new Claude tab opens
2. ClaUi auto-names tab via Haiku (e.g., "Debug connection timeout")
3. Paste error traceback via `Ctrl+V` (image) or `@` mention log file
4. Type investigation query + `Ctrl+Enter` send

**Step 2: Monitor Investigation Progress**
- **Vitals** show up: timeline turns green (read files), then blue (discussion), then purple (edits attempted)
- **Mood widget** shows smooth sailing (clear sky)
- **Activity Summarizer** updates tab title: "reading config, testing connection, analyzing logs"
- **Turn Intensity borders** grow thicker as tool activity increases

**Step 3: Test Failed Attempts**
- Claude suggests a fix; you send, testing runs, error repeats
- **TurnAnalyzer** detects frustration after 3rd error and surfaces "Frustration Alert"
- **Bug Repeat Tracker** in Dashboard alerts that same error recurred
- You fork from message #4: `Fork` button → new tab with conversation up to there
- Continue from different angle in parallel tab

**Step 4: Success & Resolution**
- Finally, fix works; all tests pass
- **Achievement** earned: "First Blood" or "Bug Squasher"
- **Session Recap Card** auto-shows: "2 bugs fixed, 4 files edited, 45 min session"
- Mood timeline turns mostly green + one rainbow (recovered)

**Step 5: Commit & Push**
- `Git` button → auto runs `git add .`, `git commit -m "Debug connection timeout"`, `git push`
- SR-PTD skill auto-triggers and generates a "Bug Fix - Connection Handling" skill document

**Step 6: Session Summary**
- ClaUi stores metrics: error count, test results, file changes, cost
- **Project Analytics** aggregates this into 30-day trend
- If you check **Workstream Map**, the session auto-clustered into "bug_fix" workstream with station labeled "Connection Timeout Fix"

---

## Workflow 2: Feature Development - Multi-Session Parallel Exploration

### Scenario
You're building a complex feature (e.g., auth middleware). You want to explore different architectural approaches in parallel.

### Interaction Flow

**Step 1: Main Exploration Tab**
1. Create first tab: "Design Auth Middleware"
2. Paste TECHNICAL.md + existing auth code via `@` mentions
3. Ask Claude for architecture recommendations
4. **Plan Approval Bar** appears → you choose "Bypass permissions" for autonomous work
5. Claude starts writing files; **Intensity borders** grow (purple for Write tool activity)

**Step 2: Parallel BTW Exploration**
- Mid-discussion, you wonder: "What about OAuth vs JWT?"
- Right-click on any message → "BTW: OAuth vs JWT tradeoffs?" 
- New tab opens with context up to that point ("BTW-1")
- Claude explores OAuth approach independently
- Both tabs run simultaneously (no blocking)

**Step 3: Architecture Review in Third Tab**
- You notice Claude's first approach is getting complex
- `Fork` from message #8 in main tab → new tab ("Design Auth Middleware - Alt")
- Ask Claude to simplify, try a different pattern
- Now you have 3 parallel branches exploring different ideas

**Step 4: Compare & Decide**
- **Tab colors** help distinguish: main (blue), BTW (coral), Alt (green)
- Review each branch's final code in its own panel
- Main tab: 120 lines, 4 new files, 30 min
- BTW tab: 80 lines, 2 files, 20 min (simpler!)
- Alt tab: 150 lines, 5 files, 35 min (over-engineered)

**Step 5: Merge Best Parts**
- Copy best implementation from BTW tab
- Paste into main tab; merge manually
- Final session: 1hr, 3 tools, 2 tests added, 3 achievements (Feature Done, Code Quality, Testing)

**Step 6: Workstream Visualization**
- Open **Workstream Map**
- All 3 tabs clustered into one "feature_auth" workstream with 3 stations:
  - Main arch (code_change)
  - OAuth exploration (decision)
  - Simplified solution (milestone)
- Map shows lines merging at final milestone

---

## Workflow 3: Long-Running Research Session with Hibernation

### Scenario
You're researching a complex topic (ML model optimization). Session spans days, but you'll pause it.

### Interaction Flow

**Step 1: Deep Research Day 1**
1. Create session: "ML Model Optimization Research"
2. Claude reads papers (`@` file mentions), summarizes findings
3. **Token-Usage Ratio** shows input-heavy (research phase)
4. **Memory monitor** shows tab using 180MB
5. After 2 hours, pause for the day (tab stays open)

**Step 2: Auto-Hibernation**
- Next day, tab hasn't been touched for >24h
- ClaUi hibernates it (deep suspend)
- Memory freed; tab shows "hibernated" badge
- Sidebar still shows tab, but grayed out

**Step 3: Resume Day 2**
- Click hibernated tab → process restarts
- `--resume <sessionId>` + `--skip-replay` (history already loaded in UI)
- Takes 2 seconds (not 20 seconds of replay)
- You continue: "Build on findings from yesterday"
- Claude resumes with full context

**Step 4: Extended Session Metrics**
- Session still tracked as single entity (48hr span)
- **Project Analytics** shows longest session of month
- **Workstream Map** - one "research_optimization" workstream spanning both days
- Station 1: Day 1 research (evidence from first 6 hours)
- Station 2: Day 2 synthesis (evidence from second 6 hours)

**Step 5: Final Packaging**
- At end, click "Request Session Recap Snapshot" (manual, not auto-end)
- Recap: 48hrs, 30 turns, 8 files read, 12 tools used
- AI insight (Sonnet): "Explored 3 optimization approaches, narrowed to 2 viable, recommended performance-first"
- **Achievement**: "Marathon" (session 2+ hours)

---

## Workflow 4: Real-Time Security Scanning with SPA & DLP

### Scenario
You're building an API endpoint. As you code, AI tries to leak secrets. Security guards catch it.

### Interaction Flow

**Step 1: Setup**
- Project has `.claui/secret-protection.policy.json` configured
- **Super Particle Accelerator** hook installed (runs at PreToolUse)
- **Secret Protection** DLP broker at boundaries

**Step 2: AI Accidentally Embeds Secret**
1. Claude generates code:
   ```
   const apiKey = "sk-proj-abc123...";
   export const OPENAI_KEY = apiKey;
   ```
2. Claude tries `Write("src/config.ts", codeWithSecret)`
3. **SPA PreToolUse hook** fires: secret scanner detects "sk-proj-" pattern
4. Gate 3 triggered: path is "src/config.ts" (server-code, not public-client)
5. Policy engine decision: BLOCK (secrets in server code are still risky during development)
6. Claude receives: `"Tool use denied: secret detected in write operation (confidence 98%)"`

**Step 3: Claude Self-Corrects**
- Claude acknowledges: "I see the issue. Let me use env variable instead:"
   ```
   const apiKey = process.env.OPENAI_KEY;
   ```
7. Writes again → passes (no literal secret)
8. Suggests: `touch .env.local; echo OPENAI_KEY=... >> .env.local`
9. **Audit trail** logged this exchange

**Step 4: Audit Review**
- Click **Secret Protection** badge in status bar
- Audit tab shows:
  - Event 1: BLOCKED, PreToolUse, Write, "sk-proj-*" regex rule, confidence 98%
  - Event 2: ALLOWED (env var approach)
- **Compliance Report** generates: "1 attempted exfiltration detected and blocked, 0 successful leaks"

**Step 5: Context in Dashboard**
- **Context Tab** shows: "1 Secret Protection event" pill
- Clicking it opens the audit panel
- Incident doesn't affect session continuation; Claude self-recovered

---

## Workflow 5: Testing-Driven Development with Visual Progress

### Scenario
You're writing tests first, then implementation (TDD). ClaUi provides visual feedback on progress.

### Interaction Flow

**Step 1: Write Test Scaffold**
1. Open session: "TDD: User Validation Feature"
2. `@src/utils/validate.test.ts` (mention test file)
3. Ask Claude: "Scaffold these test cases: empty email, invalid format, duplicate user"
4. Claude writes test file
5. **Visual Progress Mode** activates (optional): turns show test cards

**Step 2: Run Tests & Watch Fail**
- `npm test` via Bash tool
- Output filtered by **Particle Accelerator**: shows only "3 failed" (reduces noise)
- **TurnAnalyzer** classifies: "task_type: testing, outcome: failure"
- Timeline shows RED segment
- **Mood widget** shows stormy clouds

**Step 3: Implement Feature**
- Claude writes `validate.ts` implementation
- **Purple turn** (Write tool heavy)
- File mentions auto-linkified: `src/utils/validate.ts` → clickable

**Step 4: Run Tests Again**
- 2 tests pass, 1 still fails
- Output: "2/3 tests pass"
- **TurnAnalyzer** detects "partial success"
- Timeline shows mixed GREEN+RED
- Achievement unlocked: "Test First" (wrote tests before code)

**Step 5: Debug & Fix**
- Claude debugs the 1 failing test
- Fixes edge case in implementation
- All tests pass
- **Timeline** shows final GREEN segment
- **Mood widget** turns rainbow (just recovered from failure)
- Achievement unlocked: "Quality Gate" (all tests pass)

**Step 6: Session Analytics**
- **Dashboard Tokens Tab**: 60% of tokens were for test/debug phases (expected in TDD)
- **Project Analytics**: this session has 100% test coverage in the "testing" category
- **Workstream Map**: session clustered as "feature_user_validation" with 2 stations (test scaffold, implementation)

---

## Workflow 6: Multi-Language Project with Translation & RTL

### Scenario
You're building a feature that supports English, Hebrew, and Arabic. Messages switch languages mid-session.

### Interaction Flow

**Step 1: Setup & Language Preference**
1. Open session in Hebrew: "פיצ'ר מחשבון דולר" (Dollar Calculator Feature)
2. **Vitals Gear** → Translate to: Hebrew
3. Tab name auto-displays in Hebrew RTL

**Step 2: Claude Responds in English**
- Claude's response appears in English (default model language)
- **Message Translation Button** appears on each assistant message
- Click language button → one-shot Sonnet call
- Translated message renders, cached

**Step 3: Code Written with Multi-Language Comments**
- Claude writes `calc.ts` with comments
- Input placeholders are `messageEn`, `messageHe`, `messageAr`
- Actual strings are empty (to be filled by localization API)

**Step 4: Paste Hebrew & Arabic Content**
- You paste Hebrew market error messages via `Ctrl+V`
- **RTL detection** auto-activates for Hebrew; message renders right-to-left
- Arabic text also RTL
- Markdown rendering respects directional overrides (blockquotes, lists, code indent)

**Step 5: Test Strings**
- Claude writes test for locale strings:
   ```
   expect(getMessage('he')).toContain('שגיאה');
   expect(getMessage('ar')).toContain('خطأ');
   ```
- Tests pass
- **Intensity border** shows test phase (blue)

**Step 6: Session Artifacts**
- **Dashboard Context Tab**: shows 3 language codes in session metadata
- **Workstream Map**: station labeled "Multi-Language Feature" with evidence showing locale coverage
- **Project 30-Day Analytics**: new language count tracked

---

## Workflow 7: Prompt Optimization & Enhancement

### Scenario
You want to improve prompt quality before sending. ClaUi enhances and reviews.

### Interaction Flow

**Step 1: Manual Enhancement**
1. Type prompt: "make this code better"
2. Click sparkles button (enhance icon)
3. **Prompt Enhancer** modal opens with side-by-side:
   - Original: "make this code better"
   - Enhanced: "Refactor this code to improve readability, maintainability, and performance. Focus on: clearer variable names, reduced nesting, and modern language patterns."
4. Review enhanced version; edit if needed
5. Send enhanced version

**Step 2: Auto-Enhance Mode**
- Toggle "Auto-enhance on send" in Vitals Gear
- Type: "test this"
- Hit Send
- **Prompt Enhancer** runs silently (Haiku one-shot)
- Enhanced: "Write comprehensive unit tests covering happy path, edge cases, and error scenarios. Include test setup, fixtures, and assertions."
- Sent to Claude
- Falls back to original if enhancement fails

**Step 3: Prompt Translation**
- German colleague asks for help reviewing code
- You type prompt in English
- Use "Translate Prompt" feature (Ctrl+Alt+P area)
- Prompt translated to German via Sonnet
- Send to Claude (German prompts)

**Step 4: Prompt History**
- Click history arrows (↑/↓ in input area)
- Cycle through recent prompts
- Last 10: "test this", "refactor loops", "optimize auth", "add error handling", ...
- Click to restore any previous prompt

**Step 5: Saved Prompts**
- **Prompt History Panel** (Ctrl+Shift+H) shows:
  - Session: current tab only
  - Project: all tabs in workspace
  - Global: all workspaces
- Search: "test" → shows 7 recent test-related prompts
- Click any to insert into input

---

## Workflow 8: Achievement Hunting & Gamification

### Scenario
You're motivated by achievements. ClaUi gamifies your coding sessions.

### Interaction Flow

**Step 1: Daily Streak**
- Day 1: 1 session → 10 XP → "Day 1 Streak" achievement
- Day 2: 1 session → 10 XP → streak continues, progress bar fills
- Day 7: 7 consecutive days → unlock "Hot Streak" achievement (Rare, 40 XP)

**Step 2: Bug-Fixing Spree**
- Session 1: Fix 1 bug → "First Blood" (10 XP)
- Session 2: Fix 2 bugs → "Speed Patch" (15 XP)
- Session 3: Fix 3 bugs + all tests pass → "Quality Gate" (25 XP) + "Bug Squasher" (40 XP)
- Total: 90 XP this day

**Step 3: Level Progression**
- XP accumulates toward next level
- Currently Level 5 (out of 25)
- Progress bar shows 67% to Level 6
- Next level goal: reach Level 10

**Step 4: Session Goals**
- When new session opens, 7 template goals auto-assign:
  - "Fix 2 bugs" (progress: 0/2)
  - "Test coverage > 80%" (progress: 65%)
  - "No frustrated turns" (progress: on track)
  - "Refactor 1 file" (progress: 0/1)
  - etc.
- **Achievement Panel** shows goals in real-time

**Step 5: Achievement Toast Notifications**
- Complete a goal → **Rarity-colored toast** appears:
  - ✅ "Quality Gate" (Epic, golden)
  - ✅ "Test Marathon" (Rare, silver)
  - 🎉 Celebratory confetti animation (optional sound)

**Step 6: Community & Social**
- Click "Achievement Panel" → "Community" tab
- Enter GitHub username of friend
- See their achievements, XP, level, compare grids
- "Share Profile" → generates markdown badge for GitHub README:
  ```
  ![Coding Achievements](https://img.shields.io/badge/ClaUi_Level_10-150XP-gold)
  ```

**Step 7: Session Recap with Achievements**
- Session ends → **Session Recap Card** auto-shows:
  - Duration: 2h 15m
  - Bugs fixed: 3
  - Tests passed: 12
  - Files modified: 7
  - Languages touched: JavaScript, Python
  - Achievements earned:
    - "Bug Squasher Tier II" (Rare, 40 XP)
    - "Code Quality" (Rare, 35 XP)
  - Total XP gained: 75 XP
  - Coding pattern: "Methodical Debugger" (from AI analysis)

---

## Workflow 9: Cross-Device Handoff & Resume

### Scenario
You start a session on desktop, pause, and want to continue on laptop (via Happy Coder relay).

### Interaction Flow

**Step 1: Desktop Session**
1. Work on feature for 1 hour
2. At natural pause, note session ID
3. ClaUi stores full context in `~/.claude/projects/<hash>`

**Step 2: Mobile/Laptop via Happy Coder**
1. Open Claude app on phone/laptop
2. Use Happy Coder relay CLI (cross-device bridge)
3. Reference desktop session ID
4. Prompt: "Resume last session on auth middleware"
5. Happy Coder fetches desktop session context
6. ClaUi (on phone) loads session, continues

**Step 3: Context Continuity**
- Full turn history restored
- Model/effort/permission mode carries over
- Files context preloaded
- You type: "Continue from where we left off"
- Claude resumes seamlessly

**Step 4: Sync Back to Desktop**
- Mobile session ends
- `--resume` captures session ID again
- Desktop: `claude -p --resume <mobile-id>`
- Merges mobile turns into desktop tab
- Full audit trail preserved

---

## Workflow 10: Security-Critical Development with WAG & SPA

### Scenario
You're building an internal admin tool. You want to block access to sensitive paths and prevent secret leaks.

### Interaction Flow

**Step 1: Setup Access Policies**
1. Project has `Workspace Access Guard` enabled
2. `.claui/workspace-access-guard.policy.json`:
   ```json
   {
     "userApprovedRoots": ["/project/src", "/project/tests"],
     "deniedRoots": ["/etc", "/root/.ssh", "/home/sensitive-user"],
     "deniedCommands": ["rm -rf /", "sudo"]
   }
   ```
3. SPA (Super Particle Accelerator) also enabled

**Step 2: AI Attempts Restricted Access**
1. Claude tries: `Read("/etc/passwd")`
2. **WAG PreToolUse hook** evaluates path
3. `/etc/passwd` not in `userApprovedRoots` → BLOCK
4. Claude receives: "Workspace Access Guard: path not in approved roots. See audit log."
5. Audit entry logged

**Step 3: Correct Access**
- Claude self-corrects: `Read("/project/src/auth.ts")`
- Path `/project/src/auth.ts` is within approved root
- Allowed
- File is read successfully

**Step 4: Audit & Compliance**
- **Secret Protection Audit Panel** shows all events
- Event 1: BLOCKED, Read, `/etc/passwd`, "not in approved roots"
- Event 2: ALLOWED, Read, `/project/src/auth.ts`
- **Compliance Report**: "0 successful unauthorized accesses, 1 attempted blocked"

**Step 5: Organizational Policy**
- If enterprise org, **default org policy** provides:
  - Built-in Windows denied paths (C:\Windows\System32, etc.)
  - Required internal domain patterns
  - Command class restrictions
- ClaUi merges user choices with org policy

---

## Workflow 11: Team Collaboration & Shared Workstream

### Scenario
You're part of a team working on a complex feature. Multiple people run Claude sessions; ClaUi tracks shared progress.

### Interaction Flow

**Step 1: Your Session**
1. Open: "Frontend Auth UI"
2. Work for 2 hours: 30 turns, 5 files modified
3. End session

**Step 2: Colleague's Session (Same Project)**
1. Colleague opens: "Backend Auth Validation"
2. Works 3 hours: 45 turns, 8 files modified
3. References some of your files

**Step 3: Workstream Clustering**
- Both sessions end
- **Workstream Manager** runs classification
- **Heuristic Pre-Cluster**: detects:
  - Overlap on files: `auth.ts`, `types.ts`, `config.ts` (>50% match)
  - Branch: both on `feature/auth`
  - Temporal: 30min apart
- **Sonnet Classification**: groups into single "feature_auth" workstream
- Creates 2 stations:
  - Station 1: Frontend UI (your session)
  - Station 2: Backend Validation (colleague's)

**Step 4: Workstream Map Visualization**
- Open **Workstream Map**
- One workstream line: "Auth Refactoring"
- Two stations along it (positions by time)
- Connected by single line (indicates related sessions)
- Station evidence includes both contributors

**Step 5: Cross-Session Metrics**
- Open **Project Analytics**
- Filter: "feature_auth" workstream
- Aggregated: 5h, 75 turns, 13 files, 2 people
- Cost summary: $0.42
- Tool breakdown: 60% Read, 20% Edit, 10% Test, 10% Bash

**Step 6: Resume Recommendation**
- Next day, **Workstream Map** suggests:
  - "Resume: Auth Refactoring - Backend Validation needs attention"
  - Current state: "Testing phase incomplete; needs 2 integration tests"
  - Next action: "Complete test coverage, then merge branches"

---

## Workflow 12: Accessibility & Multi-Modal

### Scenario
You're using ClaUi with accessibility needs. Text size, fonts, colors are customizable.

### Interaction Flow

**Step 1: Font Size & Family**
1. Click "Aa" button in status bar
2. Font size slider: 10-32px (default 14px)
3. Increase to 20px (for readability)
4. Font family: select "Courier New" (monospace, disability-friendly)
5. Apply → all messages, input, UI relayout

**Step 2: Typing Personality Theme**
1. Click "Aa" → Theme selector
2. Current: "Terminal Hacker" (green-on-black)
3. Switch to "Zen" (minimalist, soft)
4. All UI colors transition: softer, less aggressive
5. Animations: smoother, slower

**Step 3: Status Bar Responsiveness**
1. Collapse sidebar → status bar shrinks
2. Auto-collapses to "More" dropdown
3. All controls still accessible
4. Keyboard: still use all shortcuts

**Step 4: Dark Mode Integration**
1. VS Code dark mode → ClaUi respects theme variables
2. Colors adapt to background (high contrast maintained)

**Step 5: Screen Reader Compatibility**
1. Messages have `role="article"` + semantic HTML
2. Buttons have `aria-label` (e.g., "Send message")
3. Dropdowns: `aria-expanded`, `aria-labelledby`
4. Tooltips: `role="tooltip"`, `aria-describedby`
5. Screen reader announces: "Claude response, 3 paragraphs"

---

## Summary: Feature Interplay

Each workflow demonstrates how ClaUi's 200+ features work together seamlessly:

- **Analytics** inform **Achievement** progress
- **Vitals** + **Turn Analysis** drive **Session Recap Cards**
- **Particle Accelerator** + **Secret Protection** + **WAG** form a security boundary
- **Workstream Map** clusters **individual sessions** into **cohesive stories**
- **Multi-Tab architecture** enables **parallel exploration** and **compare workflows**
- **Slash Commands** + **File Mentions** + **Prompt Enhancement** optimize **input velocity**
- **I18n** + **RTL** + **Accessibility** ensure **inclusion**
- **Gamification** + **Social** features drive **sustained engagement**

The result: ClaUi transforms AI agent interaction from a linear chat into a rich, observable, secure, and deeply personalized IDE experience.
