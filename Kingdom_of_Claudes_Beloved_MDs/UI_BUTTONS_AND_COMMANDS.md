# UI Buttons & Commands Reference / מדריך לחצנים ופקודות

> **EN:** A living reference for every command and UI button in ClaUi. Each entry lists the **short tooltip** (what appears on hover) and a **detailed explanation**. This document is built in **waves**, from the most central UI outward. **Wave 1 (this revision)** covers: all 46 registered commands, the **Status Bar**, the **Input Area**, and the **App-level** controls (welcome screen, setup banners, error banner, session-summary nudge).
>
> **HE:** מסמך חי המתעד כל פקודה וכל לחצן ב-ClaUi. כל ערך כולל את ה**טקסט הקצר ל-Tooltip** (מה שמופיע בריחוף) ואת ה**הסבר המפורט**. המסמך נבנה ב**גלים**, מהממשק המרכזי כלפי חוץ. **גל 1 (הגרסה הזו)** מכסה: את כל 46 הפקודות הרשומות, את שורת ה-**Status Bar**, את אזור ה-**Input**, ואת בקרות ה-**App** הכלליות (מסך הפתיחה, באנרי ההתקנה, באנר השגיאה, וההצעה לסיכום סשן).

---

## How tooltips work / איך עובדים ה-Tooltips

**EN:** Hover tooltips in the webview are driven by a single global component, `GlobalTooltip.tsx`. Any element that carries a `data-tooltip="..."` attribute automatically shows a styled tooltip after a ~400ms hover delay — there is no per-button tooltip component to wire up. Tooltip text is kept short and in **English** for consistency across the UI. A few elements use the native HTML `title=` attribute instead (also valid). Commands registered in `package.json` do not have a separate tooltip field; the command **`title`** is what VS Code shows in the Command Palette and on any toolbar/menu button bound to that command.

**HE:** ה-Tooltips בריחוף ב-webview מנוהלים על-ידי רכיב גלובלי יחיד, `GlobalTooltip.tsx`. כל אלמנט שנושא תכונה `data-tooltip="..."` מציג אוטומטית tooltip מעוצב אחרי השהיה של כ-400ms — אין צורך לחבר רכיב tooltip לכל כפתור בנפרד. טקסט ה-Tooltip נשמר קצר וב**אנגלית** לשם אחידות בממשק. כמה אלמנטים משתמשים בתכונת ה-HTML המובנית `title=` במקום (גם תקין). פקודות הרשומות ב-`package.json` אינן בעלות שדה tooltip נפרד; ה-**`title`** של הפקודה הוא מה ש-VS Code מציג ב-Command Palette ועל כל כפתור סרגל/תפריט המקושר לפקודה.

> Related detail / פירוט קשור: `Kingdom_of_Claudes_Beloved_MDs/GLOBAL_TOOLTIP_SYSTEM.md`

---

# Part 1 — Commands / חלק 1 — פקודות

All commands are registered under the `claudeMirror.*` namespace in `package.json` and prefixed **"ClaUi:"** in the Command Palette. / כל הפקודות רשומות תחת המרחב `claudeMirror.*` ב-`package.json` ומקודמות ב-**"ClaUi:"** ב-Command Palette.

## Session lifecycle / מחזור חיי הסשן

### `claudeMirror.startSession` — "ClaUi: Start New Session"
- **Tooltip:** Start a new Claude Code session
- **EN:** Spawns a fresh CLI process in a new ClaUi tab and opens the chat panel, ready for the first prompt.
- **HE:** מפעיל תהליך CLI חדש בלשונית ClaUi חדשה ופותח את חלון הצ'אט, מוכן לפקודה הראשונה.

### `claudeMirror.stopSession` — "ClaUi: Stop Session"
- **Tooltip:** Stop the active session
- **EN:** Terminates the current session's CLI process tree (via `taskkill` on Windows) while keeping the transcript visible.
- **HE:** מסיים את עץ תהליכי ה-CLI של הסשן הנוכחי (באמצעות `taskkill` ב-Windows) תוך שמירה על התמלול הגלוי.

### `claudeMirror.resumeSession` — "ClaUi: Resume Session"
- **Tooltip:** Resume a previous session
- **EN:** Reopens a past session by id and respawns the CLI with `--resume`, restoring the prior conversation context on the correct provider.
- **HE:** פותח מחדש סשן קודם לפי מזהה ומפעיל מחדש את ה-CLI עם `--resume`, ומשחזר את הקשר השיחה הקודם על הספק הנכון.

### `claudeMirror.discoverSessions` — "ClaUi: Discover All Sessions"
- **Tooltip:** Scan disk for all past sessions
- **EN:** Scans the on-disk session stores (`~/.claude/projects/`, `~/.codex/sessions/`) and lists every resumable conversation found.
- **HE:** סורק את מאגרי הסשנים בדיסק (`~/.claude/projects/`, `~/.codex/sessions/`) ומציג כל שיחה ניתנת לשחזור שנמצאה.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_DISCOVERY.md`

### `claudeMirror.showHistory` — "ClaUi: Conversation History"
- **Tooltip:** Browse previous conversations
- **EN:** Opens the conversation-history browser so you can revisit and reopen earlier chats.
- **HE:** פותח את דפדפן היסטוריית השיחות כדי לחזור ולפתוח שיחות קודמות.

### `claudeMirror.compact` — "ClaUi: Compact Context"
- **Tooltip:** Compact the conversation context
- **EN:** Triggers the CLI's context-compaction so a long conversation is summarized into a smaller footprint, freeing context-window room.
- **HE:** מפעיל דחיסת-הקשר של ה-CLI כך ששיחה ארוכה מסוכמת לטביעת-רגל קטנה יותר, ומשחרר מקום בחלון ההקשר.

### `claudeMirror.sendMessage` — "ClaUi: Send Message"
- **Tooltip:** Send a message to the session
- **EN:** Programmatic entry point that sends text to the active session — the same path the Send button uses.
- **HE:** נקודת כניסה תוכניתית ששולחת טקסט לסשן הפעיל — אותו מסלול שבו משתמש כפתור ה-Send.

### `claudeMirror.cancelRequest` — "ClaUi: Cancel Current Response"
- **Tooltip:** Cancel the current response
- **EN:** Interrupts the in-flight model turn without ending the session (same as the Cancel/Esc action in the input area).
- **HE:** קוטע את תור-המודל שמתבצע כרגע בלי לסיים את הסשן (זהה לפעולת Cancel/Esc באזור הקלט).

### `claudeMirror.toggleView` — "ClaUi: Toggle Chat/Terminal View"
- **Tooltip:** Switch between chat and terminal view
- **EN:** Flips the active tab between the rich chat UI and the raw terminal view of the same session.
- **HE:** מחליף את הלשונית הפעילה בין ממשק הצ'אט העשיר לבין תצוגת הטרמינל הגולמית של אותו סשן.

### `claudeMirror.sendFilePathToChat` — "ClaUi: Send Path to Chat"
- **Tooltip:** Send the selected file path to chat
- **EN:** Explorer/editor context action that inserts the selected file's path into the chat input — useful for referencing files in a prompt.
- **HE:** פעולת הקשר ב-Explorer/עורך שמכניסה את נתיב הקובץ הנבחר לקלט הצ'אט — שימושי להפניה לקבצים בפקודה.

## Plans & logs / תוכניות ולוגים

### `claudeMirror.openPlanDocs` — "ClaUi: Open Plan Document"
- **Tooltip:** Open plan document in browser
- **EN:** Opens the plan document generated during Plan Mode in your browser for full-page reading.
- **HE:** פותח בדפדפן את מסמך התוכנית שנוצר במצב Plan, לקריאה במסך מלא.

### `claudeMirror.openLogDirectory` — "ClaUi: Open Log Directory"
- **Tooltip:** Open the ClaUi log directory
- **EN:** Reveals the extension-managed log folder (`ClaUiLogs`) in your OS file explorer for troubleshooting.
- **HE:** חושף את תיקיית הלוגים המנוהלת על-ידי התוסף (`ClaUiLogs`) בסייר הקבצים של מערכת ההפעלה, לצורך תחקור תקלות.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_LOGGER.md`

## Feedback & achievements / משוב והישגים

### `claudeMirror.sendFeedback` — "ClaUi: Send Feedback"
- **Tooltip:** Send feedback to the ClaUi team
- **EN:** Opens the feedback flow (bug report / feature request / email) that submits via Formspree.
- **HE:** פותח את זרימת המשוב (דיווח באג / בקשת פיצ'ר / אימייל) שנשלחת דרך Formspree.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/FORMSPREE_FEEDBACK.md`, `BUG_REPORT_FEATURE.md`

### `claudeMirror.toggleAchievements` — "ClaUi: Toggle Achievements"
- **Tooltip:** Show/hide the Achievements panel
- **EN:** Opens or closes the gamified Achievements panel that tracks usage milestones.
- **HE:** פותח או סוגר את פאנל ההישגים הממוחק (gamified) שעוקב אחרי אבני-דרך בשימוש.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/ACHIEVEMENTS.md`

## Panels & dashboards / פאנלים ולוחות מחוונים

### `claudeMirror.toggleTeamPanel` — "ClaUi: Toggle Agent Teams Panel"
- **Tooltip:** Show/hide the Agent Teams panel
- **EN:** Opens the Agent Teams panel showing tasks, messages, and activity across collaborating agents.
- **HE:** פותח את פאנל צוותי הסוכנים המציג משימות, הודעות ופעילות בין סוכנים משתפי-פעולה.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/AGENT_TEAMS.md`

### `claudeMirror.toggleMcpPanel` — "ClaUi: MCP Servers"
- **Tooltip:** Open the MCP servers panel
- **EN:** Opens the MCP (Model Context Protocol) panel to view, add, and debug configured MCP servers.
- **HE:** פותח את פאנל ה-MCP (Model Context Protocol) לצפייה, הוספה ותחקור של שרתי MCP מוגדרים.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/MCP_SUPPORT.md`

### `claudeMirror.openWorktreePanel` — "ClaUi: Worktrees Dashboard"
- **Tooltip:** Open the Git worktrees dashboard
- **EN:** Opens a dashboard listing every Git worktree and the sessions running on each.
- **HE:** פותח לוח מחוונים המציג כל worktree של Git ואת הסשנים הרצים על כל אחד.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/WORKTREE_SUPPORT.md`

### `claudeMirror.openWorkstreamMap` — "ClaUi: Open Workstream Map"
- **Tooltip:** Open the Workstream Map
- **EN:** Opens the Workstream Map, a visual subway-style map of the current project's sessions and branches.
- **HE:** פותח את ה-Workstream Map — מפה ויזואלית בסגנון רכבת-תחתית של הסשנים והענפים בפרויקט הנוכחי.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/WORKSTREAM_MAP.md`

### `claudeMirror.openWorkstreamPortfolio` — "ClaUi: Open Workstream Portfolio"
- **Tooltip:** Open the multi-project Workstream Portfolio
- **EN:** Opens the portfolio view that aggregates Workstream Maps across multiple projects.
- **HE:** פותח את תצוגת התיק (portfolio) שמאחדת מפות Workstream על פני מספר פרויקטים.

### `claudeMirror.smartSearch.open` — "ClaUi: Open Smart Search"
- **Tooltip:** Open Smart Search
- **EN:** Opens a Smart Search tab — an AI agent that finds past sessions by meaning, not just keywords.
- **HE:** פותח לשונית Smart Search — סוכן AI שמוצא סשנים קודמים לפי משמעות, לא רק לפי מילות מפתח.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/SMART_SEARCH.md`

## Worktrees / עצי-עבודה

### `claudeMirror.createWorktreeSession` — "ClaUi: New Worktree Session"
- **Tooltip:** Start a session in a new Git worktree
- **EN:** Creates a new Git worktree and starts a session inside it, isolating the work from your main checkout.
- **HE:** יוצר worktree חדש של Git ומתחיל בו סשן, ומבודד את העבודה מה-checkout הראשי.

### `claudeMirror.moveSessionToWorktree` — "ClaUi: Move Current Session to Worktree"
- **Tooltip:** Move this session into a worktree
- **EN:** Relocates the current session into a (new or existing) worktree so its changes are isolated on a separate branch/folder.
- **HE:** מעביר את הסשן הנוכחי ל-worktree (חדש או קיים) כך שהשינויים שלו מבודדים בענף/תיקייה נפרדים.

## Providers & accounts / ספקים וחשבונות

### `claudeMirror.authenticateHappy` — "ClaUi: Authenticate Happy Coder"
- **Tooltip:** Authenticate the Happy provider
- **EN:** Runs the auth flow for the Happy (remote) provider so its sessions can connect.
- **HE:** מריץ את זרימת האימות לספק Happy (מרוחק) כדי שהסשנים שלו יוכלו להתחבר.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/REMOTE_SESSIONS.md`

### `claudeMirror.switchProviderWithContext` — "ClaUi: Switch Provider (Carry Context)"
- **Tooltip:** Switch provider, carrying context over
- **EN:** Hands the current conversation off to a different provider (e.g., Claude ↔ Codex), packaging context so the new provider continues where you left off.
- **HE:** מעביר את השיחה הנוכחית לספק אחר (למשל Claude ↔ Codex), ואורז את ההקשר כך שהספק החדש ממשיך מהמקום שבו הפסקת.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/PROVIDER_HANDOFF.md`

### `claudeMirror.compactSession` — "ClaUi: Compact Session to New Tab"
- **Tooltip:** Compact session: summarize into a prompt, copy it, and open a fresh tab with it pre-filled (saves tokens)
- **EN:** Summarizes the current session into one self-contained continuation prompt, copies it to the clipboard, and opens a fresh tab with the prompt pre-filled in the input (not sent). Lets you continue the same task in a new, low-token session. Distinct from `claudeMirror.compact` (in-place CLI compaction).
- **HE:** מסכם את הסשן הנוכחי לפרומפט המשך אחד ועצמאי, מעתיק אותו ללוח, ופותח לשונית חדשה עם הפרומפט ממולא בתיבת הקלט (בלי לשלוח). מאפשר להמשיך את אותה משימה בסשן חדש וחסכוני בטוקנים. שונה מ-`claudeMirror.compact` (דחיסת הקשר במקום).
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/COMPACT_SESSION.md`

### `claudeMirror.switchClaudeAccountWithContext` — "ClaUi: Switch Claude Account (Carry Context)"
- **Tooltip:** Switch Claude account, carrying context over
- **EN:** Moves the current conversation to a different Claude account profile while preserving context (useful for separate billing/orgs).
- **HE:** מעביר את השיחה הנוכחית לפרופיל חשבון Claude אחר תוך שמירת ההקשר (שימושי לחיוב/ארגונים נפרדים).
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_ACCOUNT_PROFILES.md`

### `claudeMirror.newClaudeTabWithAccount` — "ClaUi: New Claude Tab With Account"
- **Tooltip:** Open a new Claude tab with a chosen account
- **EN:** Opens a fresh Claude tab bound to a specific account profile you pick.
- **HE:** פותח לשונית Claude חדשה הקשורה לפרופיל חשבון מסוים שתבחר.

### `claudeMirror.claudeAccounts.manage` — "ClaUi: Manage Claude Accounts"
- **Tooltip:** Manage saved Claude accounts
- **EN:** Opens the account manager to add, rename, or remove stored Claude account profiles.
- **HE:** פותח את מנהל החשבונות להוספה, שינוי שם או הסרה של פרופילי חשבון Claude שמורים.

### `claudeMirror.claudeAccounts.login` — "ClaUi: Claude Account Login"
- **Tooltip:** Log in to a Claude account
- **EN:** Starts the login flow for a Claude account profile.
- **HE:** מתחיל את זרימת ההתחברות לפרופיל חשבון Claude.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_AUTH_LOGIN_LOGOUT.md`

### `claudeMirror.claudeAccounts.logout` — "ClaUi: Claude Account Logout"
- **Tooltip:** Log out of a Claude account
- **EN:** Logs out the selected Claude account profile.
- **HE:** מנתק את פרופיל חשבון Claude הנבחר.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_AUTH_LOGIN_LOGOUT.md`

### `claudeMirror.carryCodexToClaudeCode` — "ClaUi: Carry Codex Session to Claude Code"
- **Tooltip:** Hand a Codex session over to Claude Code
- **EN:** Packages the current Codex conversation and continues it in a Claude Code session, carrying the context across.
- **HE:** אורז את שיחת ה-Codex הנוכחית וממשיך אותה בסשן Claude Code, תוך העברת ההקשר.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/PROVIDER_HANDOFF.md`

## Multi-participant / ריבוי-משתתפים

### `claudeMirror.createMultiParticipantSession` — "ClaUi: Create Multi-Participant Session"
- **Tooltip:** Create a shared multi-participant session
- **EN:** Creates a new shared room (by name + number) where several humans, each with their own agent, collaborate through a coordination server.
- **HE:** יוצר חדר משותף חדש (לפי שם + מספר) שבו כמה אנשים, כל אחד עם הסוכן שלו, משתפים פעולה דרך שרת תיאום.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/MULTI_PARTICIPANT.md`

### `claudeMirror.joinMultiParticipantSession` — "ClaUi: Join Multi-Participant Session"
- **Tooltip:** Join an existing shared session by number
- **EN:** Joins an existing multi-participant room by its session number.
- **HE:** מצטרף לחדר ריבוי-משתתפים קיים לפי מספר הסשן שלו.

### `claudeMirror.leaveMultiParticipantSession` — "ClaUi: Leave Multi-Participant Session"
- **Tooltip:** Leave the shared session
- **EN:** Disconnects you from the current multi-participant room.
- **HE:** מנתק אותך מחדר ריבוי-המשתתפים הנוכחי.

## Tabs / לשוניות

### `claudeMirror.tabs.focus` — "ClaUi: Focus Tab"
- **Tooltip:** Focus a specific tab
- **EN:** Brings the specified ClaUi tab into focus (used by the tab rail and programmatic navigation).
- **HE:** מביא את לשונית ClaUi שצוינה למיקוד (משמש את מסילת הלשוניות וניווט תוכניתי).

### `claudeMirror.tabs.close` — "ClaUi: Close Tab"
- **Tooltip:** Close a tab
- **EN:** Closes the specified ClaUi tab and disposes its session resources.
- **HE:** סוגר את לשונית ClaUi שצוינה ומשחרר את משאבי הסשן שלה.

### `claudeMirror.tabs.reorder` — "ClaUi: Reorder Tabs"
- **Tooltip:** Reorder tabs
- **EN:** Applies a new ordering to ClaUi tabs (backs the drag-to-reorder rail).
- **HE:** מחיל סדר חדש על לשוניות ClaUi (עומד מאחורי מסילת הגרירה-לסידור).

### `claudeMirror.tabs.moveToGroup` — "ClaUi: Move Tab to Folder"
- **Tooltip:** Move a tab into a folder
- **EN:** Moves a given tab into a chosen folder/group in the Sessions tree.
- **HE:** מעביר לשונית נתונה לתיקייה/קבוצה נבחרת בעץ הסשנים.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/TAB_GROUPS.md`

### `claudeMirror.tabs.removeFromGroup` — "ClaUi: Remove Tab from Folder"
- **Tooltip:** Remove a tab from its folder
- **EN:** Removes a given tab from its folder, returning it to the top level.
- **HE:** מסיר לשונית נתונה מהתיקייה שלה ומחזיר אותה לרמה העליונה.

### `claudeMirror.tabs.moveActiveToGroup` — "ClaUi: Move This Tab to Folder"
- **Tooltip:** Move the active tab into a folder
- **EN:** Same as Move-to-Folder, applied to the currently active tab.
- **HE:** כמו העברה-לתיקייה, מוחל על הלשונית הפעילה כעת.

### `claudeMirror.tabs.removeActiveFromGroup` — "ClaUi: Remove This Tab from Folder"
- **Tooltip:** Remove the active tab from its folder
- **EN:** Same as Remove-from-Folder, applied to the currently active tab.
- **HE:** כמו הסרה-מתיקייה, מוחל על הלשונית הפעילה כעת.

### `claudeMirror.tabs.openLayoutMenu` — "ClaUi: Tab Layout Settings" `$(gear)`
- **Tooltip:** Tab layout settings
- **EN:** Opens a QuickPick to choose horizontal vs. vertical tab layout (also reachable from the Status Bar and Settings).
- **HE:** פותח QuickPick לבחירה בין פריסת לשוניות אופקית לאנכית (נגיש גם מה-Status Bar ומההגדרות).
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/TAB_LAYOUT.md`

## Folders (tab groups) / תיקיות (קבוצות לשוניות)

### `claudeMirror.groups.create` — "ClaUi: New Folder" `$(new-folder)`
- **Tooltip:** Create a new folder
- **EN:** Creates a new top-level folder in the Sessions tree to organize tabs.
- **HE:** יוצר תיקייה חדשה ברמה העליונה בעץ הסשנים לארגון לשוניות.
- > Detail: `Kingdom_of_Claudes_Beloved_MDs/TAB_GROUPS.md`

### `claudeMirror.groups.createSubfolder` — "ClaUi: New Sub-folder"
- **Tooltip:** Create a sub-folder
- **EN:** Creates a nested folder inside an existing folder.
- **HE:** יוצר תיקייה מקוננת בתוך תיקייה קיימת.

### `claudeMirror.groups.rename` — "ClaUi: Rename Folder"
- **Tooltip:** Rename a folder
- **EN:** Renames the selected folder.
- **HE:** משנה את שם התיקייה הנבחרת.

### `claudeMirror.groups.changeColor` — "ClaUi: Change Folder Color"
- **Tooltip:** Change a folder's color
- **EN:** Picks a new color for the folder; member tabs recolor their native VS Code tab icons to match.
- **HE:** בוחר צבע חדש לתיקייה; הלשוניות החברות צובעות מחדש את אייקוני הלשונית המקוריים של VS Code בהתאמה.

### `claudeMirror.groups.delete` — "ClaUi: Delete Folder"
- **Tooltip:** Delete a folder
- **EN:** Deletes the folder, prompting whether to cascade-delete its tabs or reparent them to the top level.
- **HE:** מוחק את התיקייה, ושואל אם למחוק גם את הלשוניות שבה או להעבירן לרמה העליונה.

---

# Part 2 — Status Bar / חלק 2 — שורת המצב

**EN:** The bottom Status Bar (`StatusBar.tsx`) groups controls under dropdown buttons (**Session**, **Tools**, **View**, collapsing to **More**/**Menu** in narrow layouts) plus always-visible right-side metrics. Every button below already carries a `data-tooltip`. / **HE:** שורת המצב התחתונה (`StatusBar.tsx`) מקבצת בקרות תחת כפתורי נפתח (**Session**, **Tools**, **View**, שמתכווצים ל-**More**/**Menu** בפריסות צרות) ועוד מדדים גלויים תמיד בצד ימין. כל כפתור למטה כבר נושא `data-tooltip`.

## Session group / קבוצת Session
| Button | Tooltip | EN | HE |
|---|---|---|---|
| History | Conversation History (Ctrl+Shift+H) | Open the conversation-history browser. | פתח את דפדפן היסטוריית השיחות. |
| Plans | Open plan document in browser | Open the Plan Mode document full-page. | פתח את מסמך מצב Plan במסך מלא. |
| Prompts | Prompt History | Browse and reuse your previous prompts. | עיין ומחזר פקודות קודמות שלך. |
| Search | Search chat messages (Ctrl+Shift+F) | Open the in-chat search bar. | פתח את שורת החיפוש בתוך הצ'אט. |
| Multi-Participant | (long: real-time collaboration…) | Open the shared multi-participant session view. | פתח את תצוגת סשן ריבוי-המשתתפים המשותף. |
| Dashboard | Analytics Dashboard | Open the analytics dashboard (usage, tools, tokens). | פתח את לוח האנליטיקה (שימוש, כלים, טוקנים). |
| Workstream Map | Workstream Map | Open the visual map of sessions/branches. | פתח את המפה הוויזואלית של סשנים/ענפים. |
| Worktrees | Git worktrees dashboard… | Open the worktrees dashboard. | פתח את לוח ה-worktrees. |
| Teams | Agent Teams Panel | Open the Agent Teams panel (shown when a team is active). | פתח את פאנל צוותי הסוכנים (מוצג כשצוות פעיל). |
| 🏆 count | — | Open the Achievements panel (shown when achievements are enabled). | פתח את פאנל ההישגים (מוצג כשההישגים מופעלים). |

## Tools group / קבוצת Tools
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Git | Git: add, commit & push / setup needed | One-click stage+commit+push; opens setup if not configured. | הוספה+commit+push בלחיצה; פותח הגדרה אם לא הוגדר. |
| Git `*` | Git push settings | Open Git push settings panel. | פתח את פאנל הגדרות ה-Git push. |
| Snippet | Insert snippet at cursor / set it up | Insert your saved snippet; opens config if empty. | הכנס את ה-snippet השמור; פותח הגדרה אם ריק. |
| Snippet `*` | Edit custom snippet text | Open the snippet editor. | פתח את עורך ה-snippet. |
| Consult Codex | Consult Codex GPT expert | Ask a Codex/GPT expert about the current work. | התייעץ עם מומחה Codex/GPT לגבי העבודה הנוכחית. |
| Run Review Now | Run a Claude + Codex review now | Launch a one-off Claude+Codex review (when auto-review is off). | הפעל סקירת Claude+Codex חד-פעמית (כשאוטו-סקירה כבויה). |
| Auto-review toggle | Auto-start the review loop after each work turn | Global default: auto-run review after every turn. | ברירת מחדל גלובלית: הרצת סקירה אוטומטית אחרי כל תור. |
| Auto-review (skip session) | Skip auto-review for THIS session only | Turn off auto-review for the current session only. | כבה אוטו-סקירה עבור הסשן הנוכחי בלבד. |
| Auto-review (launch now) | Launch a review loop for the current session now! | Start a review loop immediately. | הפעל לולאת סקירה מיד. |
| Goal | Set autonomous goal / Goal active… | Set an objective the AI works toward autonomously. | הגדר יעד שה-AI עובד להשגתו באופן אוטונומי. |
| Smart Search (Opus/Sonnet/Haiku/GPT…) | Search past sessions using <model> | Open Smart Search with the chosen model. | פתח Smart Search עם המודל הנבחר. |
| Babel Fish | Babel Fish translation settings | Open translation settings for messages. | פתח את הגדרות התרגום להודעות. |
| SkillDocs n/N | — | Open the Skill generation panel. | פתח את פאנל יצירת ה-Skills. |
| SkillDocs `!` | How Skills work | Open the Skills info/help. | פתח מידע/עזרה על Skills. |
| Report Bug | Open bug report | Open the bug-report form. | פתח את טופס דיווח הבאג. |
| Feature Request | Request a new feature | Open the feature-request form. | פתח את טופס בקשת הפיצ'ר. |
| Email Feedback | Send email feedback | Send feedback by email. | שלח משוב באימייל. |
| Full Bug Report | Collect diagnostics and send full report | Gather diagnostics and submit a full report. | אסוף דיאגנוסטיקה ושלח דוח מלא. |

> Detail: `CODEX_CONSULTATION.md`, `REVIEW_LOOP.md`, `GIT_PUSH_BUTTON.md`, `CUSTOM_SNIPPET_BUTTON.md`, `SMART_SEARCH.md`, `MESSAGE_TRANSLATION.md`, `SKILL_GENERATION.md`, `BUG_REPORT_FEATURE.md`

## View group + right-side metrics / קבוצת View + מדדי צד-ימין
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Vitals | Show/Hide Session Vitals | Toggle the floating Session Vitals widget. | הפעל/כבה את ווידג'ט ה-Session Vitals הצף. |
| Vitals ⚙ | Vitals settings | Open Vitals settings. | פתח את הגדרות ה-Vitals. |
| Horizontal / Vertical | (tab layout description) | Choose horizontal or vertical tab layout. | בחר פריסת לשוניות אופקית או אנכית. |
| Usage metric | Usage Data | Open the subscription usage popover. | פתח את חלונית נתוני השימוש במנוי. |
| Usage ↻ | Refresh | Refresh usage data. | רענן את נתוני השימוש. |
| Show/Hide strip | Show/Hide context strip | Toggle the context-usage strip above the input. | הפעל/כבה את פס ניצול-ההקשר מעל הקלט. |
| Session clock | Claude active processing time… | Live timer of active processing since first prompt. | טיימר חי של זמן עיבוד פעיל מאז הפקודה הראשונה. |
| MCP chip | Open MCP inventory | Open the MCP servers panel. | פתח את פאנל שרתי ה-MCP. |
| Send capsule manually | Copy capsule prompt for manual send | (Handoff fallback) copy the context capsule to send by hand. | (גיבוי handoff) העתק את קפסולת ההקשר לשליחה ידנית. |

> Detail: `SESSION_VITALS.md`, `TAB_LAYOUT.md`, `MCP_SUPPORT.md`, `PROVIDER_HANDOFF.md`

---

# Part 3 — Input Area / חלק 3 — אזור הקלט

**EN:** The chat input (`InputArea.tsx`) wraps the textarea with action buttons. Every button already carries a `data-tooltip`. / **HE:** קלט הצ'אט (`InputArea.tsx`) עוטף את ה-textarea בכפתורי פעולה. כל כפתור כבר נושא `data-tooltip`.

| Button | Tooltip | EN | HE |
|---|---|---|---|
| 🔍 Search chat | Search chat (Ctrl+Shift+F) | Toggle the in-chat search bar. | הפעל/כבה את שורת החיפוש בצ'אט. |
| Compact Session | Compact session: summarize into a prompt, copy it, and open a fresh tab with it pre-filled (saves tokens) | Summarize the session into a continuation prompt, copy it, and open a fresh tab with it pre-filled. | סכם את הסשן לפרומפט המשך, העתק אותו, ופתח לשונית חדשה עם הפרומפט ממולא. |
| Clear | Clear session and start fresh | Reset the conversation and restart the session. | אפס את השיחה והפעל מחדש את הסשן. |
| Ultrathink lock 🔒 | Lock ultrathink on every prompt | Keep "ultrathink" prepended to every prompt. | שמור על "ultrathink" בתחילת כל פקודה. |
| Ultrathink ⚡ | Ultrathink – boost reasoning power | Cycle ultrathink off → single → locked. | החלף ultrathink כבוי → חד-פעמי → נעול. |
| Browse 📎 | Browse files to paste their paths | Open the file picker to insert file paths. | פתח את בורר הקבצים להכנסת נתיבי קבצים. |
| Enhance ✨ | Enhance prompt (Ctrl+Shift+E) | Rewrite/improve the current prompt via AI. | שכתב/שפר את הפקודה הנוכחית בעזרת AI. |
| Enhance ⚙ | Enhancer settings | Open enhancer settings (auto-enhance, model). | פתח הגדרות שיפור (אוטו-שיפור, מודל). |
| Cancel / Stop | Cancel current response (Esc) | Interrupt the in-flight response (or steer Codex). | קטע את התגובה המתבצעת (או הכוון את Codex). |
| ▲▲ / ▲ / ▼ / ▼▼ | Jump/prev/next/jump prompt navigation | Navigate between user prompts / conversation edges. | נווט בין פקודות המשתמש / קצוות השיחה. |
| Send | Send message (Ctrl+Enter) | Send the message (label changes: Steer/Schedule/Translate). | שלח את ההודעה (התווית משתנה: Steer/Schedule/Translate). |
| Send ⚙ | Send settings | Open send settings (translate, auto-send, schedule). | פתח הגדרות שליחה (תרגום, אוטו-שליחה, תזמון). |
| Toggles in popovers | Enable/Disable <feature> | Toggle auto-enhance / translation / auto-send / scheduling. | הפעל/כבה אוטו-שיפור / תרגום / אוטו-שליחה / תזמון. |
| Remove image x | Remove image | Remove a pending pasted image. | הסר תמונה ממתינה שהודבקה. |
| Cancel scheduled | Cancel scheduled message | Cancel a queued/scheduled message. | בטל הודעה מתוזמנת/בתור. |
| Goal clear x | Clear goal (/goal clear) | Clear the active autonomous goal. | נקה את היעד האוטונומי הפעיל. |

> Detail: `ULTRATHINK_BUTTON.md`, `PROMPT_ENHANCER.md`, `PROMPT_TRANSLATOR.md`, `FILE_MENTION.md`, `CHAT_SEARCH.md`, `USAGE_LIMIT_DEFERRED_SEND.md`

---

# Part 4 — App-level controls / חלק 4 — בקרות ברמת ה-App

**EN:** Top-level controls in `App.tsx`: the welcome screen, CLI setup banners, the error banner, and idle/session nudges. Tooltips were **added in Wave 1** to the setup/error/nudge buttons that previously lacked them. / **HE:** בקרות ברמה העליונה ב-`App.tsx`: מסך הפתיחה, באנרי התקנת CLI, באנר השגיאה והצעות לסיכום/חוסר-פעילות. ב**גל 1 נוספו** Tooltips לכפתורי ההתקנה/שגיאה/הצעה שלא היו להם קודם.

| Button | Tooltip | EN | HE |
|---|---|---|---|
| Start Session (welcome) | Start a new Claude Code session | Start the first session from the welcome screen. | התחל את הסשן הראשון ממסך הפתיחה. |
| Conversation History (welcome) | Browse previous conversations | Open conversation history. | פתח את היסטוריית השיחות. |
| New Session (ended bar) | Start a new session | Restart after a session ends. | הפעל מחדש לאחר סיום סשן. |
| History (ended bar) | Browse previous conversations | Open conversation history. | פתח את היסטוריית השיחות. |
| Switch to Codex | Open a Codex tab and use Codex instead of Claude | (Claude-missing banner) fall back to Codex. | (באנר Claude חסר) מעבר ל-Codex. |
| Copy Install Command | Copies: npm install -g @anthropic-ai/claude-code | Copy the Claude CLI install command. | העתק את פקודת ההתקנה של Claude CLI. |
| Claude Code Docs | Open the Claude Code documentation in your browser | Open the docs site. | פתח את אתר התיעוד. |
| Set CLI Path | Open settings to set the path to the claude executable | Jump to the CLI-path setting. | קפוץ להגדרת נתיב ה-CLI. |
| Auto-setup Codex CLI | Automatically install and configure the Codex CLI | Run automated Codex setup. | הרץ התקנת Codex אוטומטית. |
| Auto-detect Codex CLI | Search common locations for an existing codex executable | Detect an installed codex binary. | אתר קובץ codex מותקן. |
| Open Install Guide | Open the Codex install guide on GitHub | Open Codex install docs. | פתח את תיעוד התקנת Codex. |
| Browse for codex executable | Pick the codex executable manually with a file dialog | Pick the codex binary by hand. | בחר ידנית את קובץ codex. |
| Open Codex Path Setting | Open settings to set the Codex CLI path | Jump to the Codex-path setting. | קפוץ להגדרת נתיב Codex. |
| Open Setup/Login Terminal | Open a terminal to install or sign in to Codex | Open a terminal for Codex setup/login. | פתח טרמינל להתקנה/התחברות ל-Codex. |
| Dismiss (banners) | Dismiss this notice | Hide the setup banner. | הסתר את באנר ההתקנה. |
| Show more / Show less | Show the full / Collapse the error message | Expand or collapse a long error. | הרחב או כווץ שגיאה ארוכה. |
| Dismiss (error x) | Dismiss | Clear the error banner. | נקה את באנר השגיאה. |
| Disable permanently | Never show the live activity summary again | Permanently disable the activity summary. | כבה לצמיתות את סיכום הפעילות החי. |
| Session Summary (nudge) | Generate a summary of this session so far | Produce a session recap. | הפק תקציר סשן. |
| Later (nudge) | Hide this nudge and ask again later | Defer the summary nudge. | דחה את ההצעה לסיכום. |
| Dismiss (nudge) | Dismiss this nudge | Hide the summary nudge. | הסתר את ההצעה לסיכום. |

> Detail: `ACTIVITY_SUMMARIZER.md`, `SESSION_SUMMARY.md`

---

# Part 5 — Chat View (Wave 2) / חלק 5 — תצוגת הצ'אט (גל 2)

**EN:** The conversation surface in `src/webview/components/ChatView/`: message bubbles and their per-message actions, code/tool/agent blocks, the plan-approval & question bar, in-chat search, prompt history, file/URL links, and the "btw…" side-thought feature. Most buttons here were already tooltipped; **Wave 2** filled the remaining gaps (Plan Approval Bar, the btw popup & context menu, Prompt History tabs, and the inline Team widget). / **HE:** משטח השיחה ב-`src/webview/components/ChatView/`: בועות הודעה ופעולות per-message, בלוקי קוד/כלי/סוכן, באנר אישור-התוכנית והשאלות, חיפוש בתוך הצ'אט, היסטוריית פקודות, קישורי קבצים/URL, ופיצ'ר ה"btw…" למחשבות-צד. רוב הכפתורים כאן כבר היו מתויגים; **גל 2** מילא את הפערים שנותרו (באנר אישור התוכנית, חלונית ה-btw ותפריט ההקשר, תאבי היסטוריית הפקודות, וווידג'ט הצוות המוטבע).

## Message bubble actions / פעולות בועת ההודעה (`MessageBubble.tsx`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Copy | Copy to clipboard | Copy the message text. | העתק את טקסט ההודעה. |
| Auto / LTR | Force left alignment / Restore automatic alignment | Toggle forced left-to-right alignment for this message. | החלף יישור-לשמאל כפוי עבור ההודעה הזו. |
| Expand/collapse all | Expand/Collapse all blocks | Open or close every tool block in the message. | פתח או סגור את כל בלוקי הכלים בהודעה. |
| Edit | Edit and resend this message | Edit a user message and resend it. | ערוך הודעת משתמש ושלח אותה מחדש. |
| Fork | Fork conversation from this message | Branch a new conversation from this point. | פצל שיחה חדשה מנקודה זו. |
| Revert | Revert file changes from this prompt onwards | Undo file changes made from this prompt onward. | בטל שינויי קבצים שבוצעו מפקודה זו והלאה. |
| Redo | Re-apply file changes | Re-apply previously reverted file changes. | החל מחדש שינויי קבצים שבוטלו. |
| Translate | (dynamic) Translate / Show original / Retry | Translate the message or toggle original/translated. | תרגם את ההודעה או החלף בין מקור/תרגום. |
| Send (edit) | Send edited message | Send the edited message. | שלח את ההודעה הערוכה. |
| Cancel (edit) | Cancel editing | Discard the edit. | בטל את העריכה. |

## Code, tool, agent & team blocks / בלוקי קוד, כלי, סוכן וצוות
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Preview (CodeBlock) | Preview rendered HTML | Render an HTML code block in a preview. | רנדר בלוק קוד HTML בתצוגה מקדימה. |
| Copy (CodeBlock) | Copy to clipboard | Copy the code. | העתק את הקוד. |
| Show more/less (CodeBlock) | Expand/Collapse code block | Expand or collapse a long code block. | הרחב או כווץ בלוק קוד ארוך. |
| Tool header (ToolUseBlock) | Click to expand/collapse | Toggle a tool-use block open/closed. | פתח/סגור בלוק שימוש-בכלי. |
| Agent header (AgentSpawnBlock) | Click to expand/collapse | Toggle a spawned-agent block. | פתח/סגור בלוק סוכן שהופעל. |
| Team header (TeamInlineWidget) | Click to expand/collapse | Toggle the inline team widget. | פתח/סגור את ווידג'ט הצוות המוטבע. |
| **Open Team Panel** *(Wave 2)* | Open the Agent Teams management panel | Open the full Agent Teams panel. | פתח את פאנל צוותי הסוכנים המלא. |

## Plan Approval & Question bar *(Wave 2)* / באנר אישור תוכנית ושאלות (`PlanApprovalBar.tsx`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Plan option 1 | Approve the plan, clear the context window, and stop asking permission for each action | Approve + clear context + bypass permissions. | אשר + נקה הקשר + עקוף הרשאות. |
| Plan option 2 | Approve the plan and stop asking permission for each action | Approve + bypass permissions. | אשר + עקוף הרשאות. |
| Plan option 3 | Approve the plan but review and confirm each edit manually | Approve, confirm edits manually. | אשר, אשר כל עריכה ידנית. |
| Plan option 4 | Reject for now and type changes you want Claude to make | Open free-text feedback. | פתח משוב בטקסט חופשי. |
| Question option | (the option's own description) | Choose an answer to Claude's question. | בחר תשובה לשאלת Claude. |
| Submit (multi-select) | Submit your selected answers | Submit multiple selected answers. | שלח מספר תשובות נבחרות. |
| Custom answer… | Write a free-text answer instead of choosing an option | Type a custom answer. | הקלד תשובה מותאמת אישית. |
| Send (custom answer) | Send your custom answer (Enter) | Send the typed answer. | שלח את התשובה שהוקלדה. |
| Send (plan feedback) | Send your feedback to Claude (Enter) | Send plan feedback. | שלח משוב על התוכנית. |

## In-chat search & prompt history / חיפוש בצ'אט והיסטוריית פקודות
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Session / Project (ChatSearchBar) | Search current session / all project sessions | Set the search scope. | קבע את היקף החיפוש. |
| ↑ / ↓ (ChatSearchBar) | Previous/Next match (Shift+Enter / Enter) | Jump between matches. | קפוץ בין התאמות. |
| x (ChatSearchBar) | Close (Esc) | Close the search bar. | סגור את שורת החיפוש. |
| x (PromptHistoryPanel) | Close (Esc) | Close the prompt history panel. | סגור את פאנל היסטוריית הפקודות. |
| Session / Project / Global tabs *(Wave 2)* | Prompts from current session / all sessions / all projects | Choose which prompt-history scope to show. | בחר את היקף היסטוריית הפקודות להצגה. |
| Prompt item | (the full prompt text) | Insert a past prompt into the input. | הכנס פקודה קודמת לקלט. |

## Links, scroll & "btw…" side-thought *(Wave 2)* / קישורים, גלילה ומחשבת-צד "btw…"
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Scroll to bottom (MessageList) | Scroll to bottom | Jump to the latest message. | קפוץ להודעה האחרונה. |
| Open session → (MarkdownContent) | Open this session in a new ClaUi tab | Open a Smart Search result session. | פתח סשן מתוצאת Smart Search. |
| File path / URL link (filePathLinks) | Click to open … | Open a file in the editor / a URL in the browser. | פתח קובץ בעורך / כתובת בדפדפן. |
| btw… (context menu) | Start a side thought (by the way…) | Open the btw compose popup. | פתח את חלונית כתיבת ה-btw. |
| Copy link / Copy / Paste (context menu) | Copy link / Copy selection / Paste from clipboard | Clipboard actions in the custom context menu. | פעולות לוח בתפריט ההקשר המותאם. |
| New Tab (btw compose) | Open this side thought in a new tab | Send the side thought to a new tab. | שלח את מחשבת-הצד ללשונית חדשה. |
| Send (btw compose) | Start a background BTW session (Ctrl+Enter) | Run the side thought as a background session. | הרץ את מחשבת-הצד כסשן רקע. |
| Cancel (btw compose) | Cancel (Esc) | Close the btw popup. | סגור את חלונית ה-btw. |
| Send (btw chat) | Send message (Enter) | Send a message in the btw chat. | שלח הודעה בצ'אט ה-btw. |
| Close (btw) | Close | Close the btw overlay. | סגור את שכבת ה-btw. |

> **EN:** *btw…* ("by the way") lets you branch a quick side-thought without losing your main chat: either open it in a new tab or run it as a background session you can keep chatting with in a floating overlay. / **HE:** *btw…* ("דרך אגב") מאפשר לפצל מחשבת-צד מהירה בלי לאבד את הצ'אט הראשי: לפתוח אותה בלשונית חדשה או להריץ כסשן רקע שאפשר להמשיך לשוחח איתו בשכבה צפה.

> Detail: `CHAT_SEARCH.md`, `MARKDOWN_RENDERING.md`, `MESSAGE_TRANSLATION.md`, `CHECKPOINT_MANAGER.md` (revert/redo), `FORK_CONTEXT_TRUNCATION_SPEC.md`, `AGENT_TEAMS.md`

---

# Part 6 — Feature panels & selectors (Wave 3) / חלק 6 — פאנלים ובוררים (גל 3)

**EN:** The large feature panels and the model/provider selectors. Most close/header buttons were already tooltipped; **Wave 3** added `data-tooltip` to the remaining action, tab, toggle, and option buttons. Selectors (Model, Provider, Permission Mode, Codex/Claude effort & tier) are native `<select>` controls that already carry a `data-tooltip` on the control itself. / **HE:** הפאנלים הגדולים ובוררי המודל/ספק. רוב כפתורי הסגירה/כותרת כבר היו מתויגים; **גל 3** הוסיף `data-tooltip` לכל כפתורי הפעולה/תאב/מתג/אפשרות שנותרו. הבוררים (Model, Provider, Permission Mode, effort/tier של Codex/Claude) הם פקדי `<select>` מקוריים שכבר נושאים `data-tooltip` על הפקד עצמו.

## Analytics Dashboard / לוח אנליטיקה (`Dashboard/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Session / Project / User | Show <scope> analytics | Switch the dashboard data scope. | החלף את היקף נתוני הלוח. |
| Tab buttons | Open <tab> tab | Navigate to a dashboard tab. | נווט לתאב בלוח. |
| Prev / Next (TurnTable) | Previous / Next page | Paginate the turns table. | דפדוף בטבלת התורים. |
| Category chips (Commands) | Toggle <category> commands | Filter the command list. | סנן את רשימת הפקודות. |
| Role chips / Expand All / Collapse All (Context) | Show <role> messages / Expand / Collapse all messages | Filter and expand context messages. | סנן והרחב הודעות הקשר. |
| Sample Points / time-range / Resample / Clear (TokenRatio) | Toggle markers / Show <range> / Recompute now / Delete all data | Control the token-ratio chart and data. | שלוט בגרף יחס-הטוקנים ובנתונים. |
| Guard On/Off, Add Folder, Add Workspace, Remove, Path, Command, Check (Tools) | Toggle guard / add / remove / test access | Manage the Workspace Access Guard allow-list and test it. | נהל את רשימת-ההיתר של שומר הגישה ובדוק אותה. |
| Refresh / period tabs (Usage) | Reload usage data / Show <period> usage | Refresh and scope usage stats. | רענן ובחר טווח לנתוני שימוש. |

> Detail: `ANALYTICS_DASHBOARD.md`, `PROJECT_30_DAYS_TAB.md`, `WORKSPACE_ACCESS_GUARD.md`

## MCP panel / פאנל MCP (`McpPanel/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Refresh / Close | Reload MCP inventory / Close MCP panel | Refresh or close the panel. | רענן או סגור את הפאנל. |
| Restart session / Apply later | Restart to reload MCP / Postpone restart | Apply MCP config changes now or later. | החל שינויי MCP עכשיו או מאוחר יותר. |
| Tabs (Session/Workspace/Add/Debug) | Switch <tab> | Navigate MCP panel tabs. | נווט בין תאבי פאנל ה-MCP. |
| Preview / Add server (Add wizard) | Preview the .mcp.json diff / Save the server | Preview config and add a server. | תצוגה מקדימה והוספת שרת. |
| Open / Copy / Reset approvals (Debug) | Open config / Copy command / Clear approvals | Debug MCP config and approvals. | תחקור הגדרות ואישורי MCP. |
| Open config / Remove (Workspace) | Open config file / Remove server | Manage workspace MCP servers. | נהל שרתי MCP של סביבת העבודה. |
| Import / Template / Custom (QuickAdd) | Import from Claude Desktop / Add <template> / Add custom server | Quick-add MCP servers. | הוספה מהירה של שרתי MCP. |

> Detail: `MCP_SUPPORT.md`

## Worktrees & Merge / עצי-עבודה ומיזוג (`Worktree/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Open / + New session / Open folder / Refresh | Focus tab / Start session here / Open folder / Reload list | Manage worktrees and their sessions. | נהל את ה-worktrees והסשנים שלהם. |
| Resolve / Abort | Open conflict resolver / Abort merge & restore | Handle a paused merge. | טפל במיזוג מושהה. |
| Create / Cancel / Discard and remove | Create worktree / Keep worktree / Force-remove | Create or force-remove a worktree. | צור או הסר-בכוח worktree. |
| Strategy cards (Merge) | Merge commit / Squash / Fast-forward | Choose a merge strategy. | בחר אסטרטגיית מיזוג. |
| Merge / Undo / Discard / Abort / Open conflicts | Run merge / Revert / Rewrite history / Abort / Open files | Drive the merge wizard. | הפעל את אשף המיזוג. |
| Ask Claude to help resolve / Send (assistant) | Start a Claude conflict-resolve session / Send message | Use the AI merge assistant. | השתמש בעוזר המיזוג ב-AI. |

> Detail: `WORKTREE_SUPPORT.md`

## Workstream Map / מפת הזרמים (`WorkstreamMap/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Back / All Projects | Go back one level / View portfolio | Navigate the map hierarchy. | נווט בהיררכיית המפה. |
| Current State / Plan Overlay / Resolve / Inactive / Low Confidence | Toggle <layer/filter> | Toggle map overlays and filters. | החלף שכבות ומסננים במפה. |
| Import Folder / Reclassify / Build / Retry | Import external folder / Rebuild map / Build / Retry | Build or refresh the map. | בנה או רענן את המפה. |
| Apply (NL command) | Apply natural-language edit to map | Run a natural-language map edit. | הפעל עריכת מפה בשפה טבעית. |
| Rename / Mark Complete / Mark Abandoned / Pin / Hide (Resolve toolbar) | Rename / Complete / Abandon / Pin / Hide station | Edit a workstream in resolve mode. | ערוך זרם במצב resolve. |
| Re-Classify / Dismiss / Open project | Rebuild map / Dismiss highlights / Open project | Confidence review & resume actions. | פעולות סקירת-ביטחון וחזרה. |

> Detail: `WORKSTREAM_MAP.md`

## Agent Teams / צוותי סוכנים (`Teams/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Tabs (Topology/Tasks/Messages/Activity) | View team <tab> | Navigate team panel tabs. | נווט בתאבי פאנל הצוות. |
| Minimize (status widget) | Minimize widget | Collapse the floating team widget. | כווץ את ווידג'ט הצוות הצף. |
| + Add Task / Add / Cancel | Show form / Create task / Cancel | Add a team task. | הוסף משימת צוות. |
| Send (Messages) | Send message to agent | Message a team agent. | שלח הודעה לסוכן בצוות. |
| Shutdown (Activity) | Shut down this agent | Stop a team agent. | עצור סוכן בצוות. |

> Detail: `AGENT_TEAMS.md`

## Multi-Participant / ריבוי-משתתפים (`MultiParticipant/`)
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Mode Join/Create, Provider Claude/Codex (Join dialog) | Join / Create session, Use <provider> | Configure the join/create dialog. | הגדר את דיאלוג ההצטרפות/יצירה. |
| Cancel / Submit (Join) | Close dialog / Create or join | Close or submit the dialog. | סגור או שלח את הדיאלוג. |
| Send (MP input) | Send message | Send a message in the shared room. | שלח הודעה בחדר המשותף. |
| Emoji reactions (message) | React with <emoji> | Add an emoji reaction. | הוסף תגובת אימוג'י. |
| Deny / Allow N / Always Allow / Force (Approval & Guard) | Deny / Allow a budget / Always allow pair / Force (unsafe) | Handle agent-to-agent approval requests. | טפל בבקשות אישור בין-סוכנים. |

> Detail: `MULTI_PARTICIPANT.md`

## SkillGen, Achievements, Review Loop, Accelerators, Settings, Bug Report
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Open guide / Cancel (SkillGen) | Open visual guide / Cancel generation | Skill generation controls. | בקרות יצירת Skills. |
| Language / Enable / Skip (SkillGen onboarding) | Show in <lang> / Enable SkillDocs / Skip | First-run SkillDocs choices. | בחירות הפעלה ראשונה של SkillDocs. |
| Got it / Turn off (Achievements) | Close info / Turn off achievements | Achievements info controls. | בקרות מידע הישגים. |
| Connect GitHub / Friends / Compare / Add friend / Publish (Community) | Connect account / tabs / add friend / publish profile | Community/social actions. | פעולות קהילה/חברתי. |
| Show more/less (PA trace) | Show all / fewer traces | Expand the trace list. | הרחב את רשימת ה-traces. |
| Enable/Disable / hooks / Clear Data / Refresh (PA settings) | Toggle feature / install hook / clear data / refresh | Particle Accelerator settings. | הגדרות Particle Accelerator. |
| Enable / Disable / Close (Super-PA) | Enable / Disable protection / Close | Super Particle Accelerator controls. | בקרות Super Particle Accelerator. |
| Close / tabs (Settings) | Close panel / Show <tab> tab | Settings panel navigation. | ניווט בפאנל ההגדרות. |
| Quick/AI tabs, Send, Preview, Submit, Approve/Reject script (Bug Report) | Switch mode / send / preview / submit / run-or-reject script | Bug-report flow controls. | בקרות זרימת דיווח הבאג. |

> Detail: `SKILL_GENERATION.md`, `ACHIEVEMENTS.md`, `REVIEW_LOOP.md`, `PARTICLE_ACCELERATOR.md`, `SUPER_PARTICLE_ACCELERATOR.md`, `BUG_REPORT_FEATURE.md`

## Vitals info & misc widgets / Vitals ווידג'טים שונים
| Button | Tooltip | EN | HE |
|---|---|---|---|
| Feature toggles (Vitals info) | Toggle <feature> | Enable/disable Adventure, Weather, semantic analysis, SkillGen, Usage widget, session restore, Vitals, activity summary. | הפעל/כבה את הפיצ'רים השונים. |
| Copy image (Image Lightbox menu) | Copy image with annotations to clipboard | Copy an annotated image. | העתק תמונה עם הערות. |
| Refresh (Audit Log) | Reload audit events and report | Refresh the audit log. | רענן את יומן הביקורת. |
| Send (Smart Search) | Send search query (Ctrl+Enter) | Submit a Smart Search query. | שלח שאילתת Smart Search. |
| Example query (empty state) | Use example: <query> | Fill the input with an example. | מלא את הקלט בדוגמה. |
| File mention item | Mention <path> | Insert an @file mention. | הכנס אזכור @file. |

> Detail: `SESSION_VITALS.md`, `IMAGE_LIGHTBOX.md`, `SMART_SEARCH.md`, `FILE_MENTION.md`

## Selectors / בוררים (`ModelSelector/`, `ProviderSelector/`, `PermissionModeSelector/`)
**EN:** Model, Provider, Permission Mode, and the Codex/Claude effort & service-tier selectors are native `<select>` dropdowns. Each already carries a `data-tooltip` on the `<select>` element describing what it controls, so hovering the control shows the tooltip; the individual `<option>`s are native and self-labeled. No button changes were needed here. / **HE:** בוררי Model, Provider, Permission Mode, ו-effort/service-tier של Codex/Claude הם תפריטי `<select>` מקוריים. כל אחד כבר נושא `data-tooltip` על אלמנט ה-`<select>` המתאר מה הוא שולט בו, כך שריחוף מעל הפקד מציג את ה-tooltip; ה-`<option>` עצמם מקוריים וברורים. לא נדרשו שינויי כפתורים כאן.

> Detail: `CLAUDE_MODEL_CONTROLS.md`, `CODEX_FAST_MODE.md`

---

## Coverage / כיסוי

**EN:** **Done (Wave 1):** 46 commands, Status Bar, Input Area, App-level controls. **Done (Wave 2):** the Chat view — message bubbles, code/tool/agent/team blocks, Plan Approval & Question bar, in-chat search, prompt history, file/URL links, "btw…" feature. **Done (Wave 3):** all feature panels — Dashboard, MCP, Worktree/Merge, Workstream Map, Teams, Multi-Participant, SkillGen, Achievements/Community, Review Loop, Particle/Super-Particle Accelerator, Settings, Bug Report, Vitals info & misc widgets — plus the Model/Provider/Permission selectors. **Result:** every interactive button across the webview now shows a hover tooltip (`data-tooltip` or native `title`); selectors carry a control-level `data-tooltip`.

**HE:** **בוצע (גל 1):** 46 פקודות, Status Bar, אזור הקלט, ובקרות ה-App. **בוצע (גל 2):** תצוגת הצ'אט — בועות הודעה, בלוקי קוד/כלי/סוכן/צוות, באנר אישור התוכנית והשאלות, חיפוש בצ'אט, היסטוריית פקודות, קישורי קבצים/URL, ופיצ'ר ה"btw…". **בוצע (גל 3):** כל הפאנלים — Dashboard, MCP, Worktree/Merge, Workstream Map, Teams, Multi-Participant, SkillGen, Achievements/Community, Review Loop, Particle/Super-Particle Accelerator, Settings, Bug Report, Vitals וווידג'טים שונים — וכן בוררי Model/Provider/Permission. **תוצאה:** כל כפתור אינטראקטיבי ב-webview מציג כעת tooltip בריחוף (`data-tooltip` או `title` מקורי); הבוררים נושאים `data-tooltip` ברמת הפקד.
