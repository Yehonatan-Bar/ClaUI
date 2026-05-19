# דו"ח ביקורת תיעוד מול קוד - 2026-05-19

## היקף הבדיקה

נבדקו כל הקבצים תחת `Kingdom_of_Claudes_Beloved_MDs` ברמת מיפוי, סיווג והשוואה מול מבנה הקוד, ה-manifest וקבצי המקור הרלוונטיים.

סה"כ נמצאו 218 קבצי תיעוד:

- 138 קבצי Markdown
- 76 קבצי HTML
- 4 קבצי TXT
- 88 קבצים ברמה העליונה
- 59 קבצים תחת `html/`
- 20 קבצים תחת `New folder/`
- 43 קבצים תחת `New folder - Copy/`
- 8 קבצים תחת `plans/`

הבדיקה התמקדה בשאלה אחת: האם המסמך מתאר את מצב הפרויקט הנוכחי, או שהוא מתאר קוד, ארכיטקטורה, פיצ'רים, נתיבים, הגדרות או תוכניות שכבר אינם נכונים.

## תקציר מנהלים

מצב התיעוד אינו אחיד. יש שכבת תיעוד טובה ועדכנית יחסית עבור הרבה פיצ'רים קיימים, אבל היא מעורבבת עם מסמכי תוכנית היסטוריים, תיקיות כפולות, מסמכי HTML פרזנטציוניים ותיעוד ישן שנראה קנוני למרות שהוא כבר לא תואם לקוד.

הממצאים המרכזיים:

- קיים `TECHNICAL.md` קנוני בשורש הפרויקט: `C:/projects/claude-code-mirror/TECHNICAL.md`. הוא מחוץ להיקף `Kingdom_of_Claudes_Beloved_MDs`, ולכן לא נספר בתוך 218 קבצי התיעוד. בתוך `Kingdom_of_Claudes_Beloved_MDs` קיימים רק שני עותקים בתוך תיקיות כפולות.
- `New folder/` ו-`New folder - Copy/` הן תיקיות duplicate/staging ולא מקור אמת. חלק מהקבצים שם זהים, חלק שונים, וחלק כוללים עותקי `TECHNICAL.md` שעלולים להתחרות עם הקובץ הקנוני שבשורש.
- כמה מסמכי feature קנוניים התיישנו מול הקוד: `SESSION_VITALS.md`, `ANALYTICS_DASHBOARD.md`, `COMPLETE_FEATURE_LIST.md`, `SESSION_RESTORE.md`, `API_KEY_MANAGEMENT.md`, `PROCESS_LIFECYCLE.md`, `PROMPT_TRANSLATOR.md`, `MESSAGE_TRANSLATION.md`, `FORMSPREE_FEEDBACK.md`.
- כמה מסמכי תוכנית עדיין נמצאים לצד תיעוד מצב-נוכחי ולכן מבלבלים: מסמכי MCP הישנים, Particle Accelerator implementation plan, multi-participant plan, remote server/data capture plan, dashboard plans, Codex initial plan.
- רוב מסמכי ה-HTML בתיקיית `html/` הם artifacts של תוכניות, דיונים או מצגות, לא תיעוד קוד נוכחי. הם צריכים סימון מפורש כ-historical או מעבר לארכיון.

## שיטת הבדיקה

הבדיקה כללה:

- מיפוי כל קבצי התיעוד לפי תיקיות וסיומות.
- סריקת נתיבי source שמופיעים במסמכים ובדיקה אם הנתיבים קיימים.
- השוואת מסמכים מול `package.json`, `webpack.config.js`, מבנה `src/extension`, מבנה `src/webview`, ומבנה `server/src`.
- בדיקת command/settings מול extension manifest.
- בדיקת פיצ'רים מרכזיים מול רכיבי React, מנהלי session/process, שירותי extension וקוד server.
- סיווג מסמכים ל-current, stale, duplicate, historical, external reference.

לא בוצע שינוי קוד במסגרת הבדיקה הזו.

## רמות חומרה

- P0: תיעוד שמטעה לגבי מצב קוד נוכחי או ארכיטקטורה פעילה.
- P1: תיעוד קנוני עם פרטים שהתיישנו אבל הכיוון הכללי נכון.
- P2: תוכניות/מסמכים היסטוריים שצריכים סימון או ארכוב.
- P3: כפילויות, naming, organization, או ניקיון שמקשה על תחזוקה.

## ממצאים קריטיים

### P0 - `TECHNICAL.md` קיים בשורש, אבל יש עותקים כפולים בתוך תיקיית המסמכים

הנחיות הפרויקט דורשות לעדכן `TECHNICAL.md` עם component index, directory structure והגדרות. בפועל קיים קובץ כזה בשורש הפרויקט:

- `C:/projects/claude-code-mirror/TECHNICAL.md`

הקובץ הזה מחוץ להיקף הבדיקה המקורי של `Kingdom_of_Claudes_Beloved_MDs`, אבל הוא כנראה המקור הקנוני לפי מבנה ה-repo.

בתוך `Kingdom_of_Claudes_Beloved_MDs` אין עותק קנוני ברמה העליונה.

נמצאו רק:

- `Kingdom_of_Claudes_Beloved_MDs/New folder/TECHNICAL.md`
- `Kingdom_of_Claudes_Beloved_MDs/New folder - Copy/TECHNICAL.md`

בעיה: שני הקבצים נמצאים בתיקיות כפולות/לא-קנוניות ועלולים ליצור בלבול מול `TECHNICAL.md` שבשורש.

פעולה מומלצת:

- לקבוע במפורש ש-`C:/projects/claude-code-mirror/TECHNICAL.md` הוא המקור הקנוני.
- לעדכן אותו כחלק מכל שינוי מבני, בהתאם להנחיות הפרויקט.
- למחוק או להעביר לארכיון את שני העותקים בתיקיות הכפולות.
- אם רוצים שגם תיקיית `Kingdom_of_Claudes_Beloved_MDs` תכיל index, ליצור שם קובץ שמפנה ל-root `TECHNICAL.md` במקום לשכפל תוכן.

### P0 - `SESSION_VITALS.md` מתאר רכיב שלא קיים

המסמך מתאר `CostHeatBar` כחלק ממערכת Session Vitals:

- `src/webview/components/Vitals/CostHeatBar.tsx`
- Cost Heat Bar כקומפוננטה פעילה.
- טענות על memoization ועל שילוב בתוך dashboard ה-vitals.

בפועל בתיקיית `src/webview/components/Vitals` קיימים רכיבים כמו:

- `AdventureWidget.tsx`
- `SessionTimeline.tsx`
- `VitalsContainer.tsx`
- `VitalsInfoPanel.tsx`
- `WeatherWidget.tsx`

לא קיים `CostHeatBar.tsx`, ו-`VitalsContainer.tsx` לא מרנדר Cost Heat Bar.

גם `COMPLETE_FEATURE_LIST.md` מתאר "Cost Heat Bar" כחלק מחבילת Vitals.

פעולה מומלצת:

- אם הרכיב הוסר: למחוק את תיאור Cost Heat Bar מ-`SESSION_VITALS.md` ומ-`COMPLETE_FEATURE_LIST.md`.
- אם הרכיב אמור לחזור: לפתוח משימת פיתוח נפרדת ולא להשאיר אותו כתיעוד מצב נוכחי.

### P0 - Dashboard User mode מתועד לא נכון

`ANALYTICS_DASHBOARD.md` מתאר User mode עם 2 טאבים:

- Token Ratio
- Memory

`COMPLETE_FEATURE_LIST.md` מתאר במקום אחר User mode עם "1 tab".

בפועל ב-`src/webview/components/Dashboard/DashboardPanel.tsx` קיימים 3 טאבים:

- `u-ratio` - Token Ratio
- `u-memory` - Memory
- `u-particle-accelerator` - Particle Accelerator

פעולה מומלצת:

- לעדכן את `ANALYTICS_DASHBOARD.md` ל-3 טאבים.
- לעדכן את `COMPLETE_FEATURE_LIST.md` כך שלא יסתור את המסמך הקנוני.
- להוסיף תיאור קצר של Particle Accelerator tab.

### P0 - `SESSION_RESTORE.md` מתאר schema ישן

המסמך מתאר `OpenTabSnapshotEntry` עם `tabKind?: string` וערכים כמו:

- `claude`
- `codex`
- `happy`
- `search`

בפועל `src/extension/session/OpenTabsSnapshot.ts` משתמש במבנה אחר:

- `provider: ProviderId`
- `cliPathOverride?: string`
- `workspacePath?: string`
- `savedAt: string`
- `groupId?: string`
- `orderInGroup?: number`
- `tabKind?: 'chat' | 'search'`
- `searchModel?: SmartSearchModel`
- `lastFocusedAt?: string`
- `tabOrder?: number`

בעיה: המסמך מבלבל בין provider לבין tab kind. בקוד הנוכחי provider הוא שדה נפרד, ו-`tabKind` כבר אינו מזהה Claude/Codex/Happy.

פעולה מומלצת:

- לעדכן את schema במסמך.
- לתאר הפרדה בין provider, tab kind, groups/order ו-search metadata.

### P1 - `API_KEY_MANAGEMENT.md` כולל inventory ישן של spawn points

המסמך מציין "Spawn Points (9 total)" ומונה רשימה סגורה.

בפועל יש יותר צרכנים של `buildClaudeCliEnv` / `buildSanitizedEnv`, כולל רכיבים שלא מופיעים ברשימה:

- `PromptTranslator.ts`
- `VisualProgressProcessor.ts`
- `SessionSummarizer.ts`
- `CodexSessionNamer.ts`
- שימושים נוספים סביב Codex handling.

פעולה מומלצת:

- להסיר ספירה קשיחה כמו "9 total", או לעדכן אותה מתוך סריקה עדכנית.
- להוסיף כלל תחזוקה: כל spawn חדש חייב להשתמש ב-`buildClaudeCliEnv` או `buildSanitizedEnv` לפי הצורך.

### P1 - `PROCESS_LIFECYCLE.md` כולל count ישן של משתמשי `killProcessTree`

המסמך מציין ש-`killProcessTree(child)` נמצא בשימוש על ידי "all 12 CLI spawn points".

בפועל יש יותר צרכנים, כולל:

- `ClaudeProcessManager.ts`
- `CodexExecProcessManager.ts`
- `SessionNamer.ts`
- `CodexSessionNamer.ts`
- `ActivitySummarizer.ts`
- `MessageTranslator.ts`
- `TurnAnalyzer.ts`
- `PromptEnhancer.ts`
- `PromptTranslator.ts`
- `ClaudeCliCaller.ts`
- `AchievementInsightAnalyzer.ts`
- `PythonPhaseRunner.ts`
- `VisualProgressProcessor.ts`
- `SessionSummarizer.ts`

פעולה מומלצת:

- לעדכן את הרשימה.
- לשקול להפוך את המסמך לכלל architectural policy במקום inventory קשיח.

### P1 - `PROMPT_TRANSLATOR.md` ו-`MESSAGE_TRANSLATION.md` מתארים timeout/kill ישנים

המסמכים טוענים:

- `MessageTranslator` משתמש ב-timeout של 30 שניות.
- `PromptTranslator` משתמש ב-timeout של 60 שניות.
- `MessageTranslator` משתמש ב-`child.kill('SIGTERM')`.

בפועל `src/extension/session/MessageTranslator.ts`:

- מייבא ומשתמש ב-`killProcessTree`.
- משתמש ב-timeout דינמי לפי אורך הטקסט:
  - בסיס של 45 שניות.
  - תוספת לפי chunks של 1000 תווים.
  - תקרה של 120 שניות.

פעולה מומלצת:

- לעדכן את שני המסמכים.
- לציין ש-Windows process tree kill הוא חלק מההתנהגות גם בתרגום הודעות.

### P1 - `FORMSPREE_FEEDBACK.md` לא עקבי עם הקוד ועם עצמו

המסמך כולל שתי טענות שונות:

- fallback text-only כאשר attachment נכשל.
- fallback שמטמיע attachments כ-base64.

בפועל `src/extension/feedback/FormspreeService.ts` מבצע fallback text-only ללא קובץ מצורף. קיימים helper/comment סביב embedded base64, אבל `submit()` לא משתמש בהם.

פעולה מומלצת:

- לעדכן את המסמך כך שיתאר text-only fallback.
- או לחלופין, אם base64 fallback רצוי, לתקן את הקוד ולחבר את helper למסלול הפעיל.
- להסיר/לעדכן comment מתעתע בקוד אם הוא כבר לא נכון.

### P1 - `ARCHITECTURE.md` מתאר מודל tabs חלקי

המסמך מתאר את `TabManager` כמנהל `Map<string, SessionTab>` וכאילו start/resume יוצרים רק `SessionTab`.

בפועל `src/extension/session/TabManager.ts` מנהל:

- `SessionTab`
- `CodexSessionTab`
- `MultiParticipantSessionTab`

בנוסף הוא כולל אחריות על:

- Smart Search
- provider handoff
- workstream map
- particle accelerator
- open-tabs snapshot
- tab groups
- restore/order/focus metadata

פעולה מומלצת:

- לעדכן את פרק `TabManager` ב-`ARCHITECTURE.md`.
- לתאר את `ManagedTab` ואת ההפרדה בין provider, tab type, search tabs ו-multi-participant tabs.

## מסמכי תוכנית שצריכים סימון היסטורי או ארכוב

### MCP

`MCP_SUPPORT.md` הוא המסמך הקנוני והעדכני יותר. הוא מתאר את הקוד הקיים:

- `src/extension/mcp/*`
- `src/webview/components/McpPanel/*`
- command/settings רלוונטיים ב-`package.json`

לעומתו, המסמכים הבאים הם תוכניות ישנות או reference חיצוני:

- `MCP_SUPPORT_PLAN.md`
- `mcp-support-for-claui.md`
- `mcp-claude-code-guide.md`
- `mcp-claude-code-guide_2.txt`

בעיות לדוגמה:

- `MCP_SUPPORT_PLAN.md` עדיין מציין paths תחת `src/webview/components/Mcp/...`, בעוד שהקוד בפועל נמצא תחת `McpPanel`.
- `mcp-support-for-claui.md` מתאר gaps שכבר אינם נכונים אחרי מימוש MCP UI.
- מדריכי `mcp-claude-code-guide*` כוללים נתיבים כמו `server/mcp.js`, `server/stdio.js`, `server/streamableHttp.js` שהם דוגמאות חיצוניות ולא נתיבי repo.

פעולה מומלצת:

- להשאיר `MCP_SUPPORT.md` כמסמך מצב נוכחי.
- להעביר את שאר מסמכי MCP ל-archive/reference או להוסיף להם כותרת ברורה: "Historical / external reference, not current ClaUi implementation".

### Particle Accelerator

`PARTICLE_ACCELERATOR.md` הוא המסמך הקנוני הנוכחי.

`plans/PARTICLE_ACCELERATOR_IMPLEMENTATION_PLAN.md` מתאר שלב תכנון ישן, כולל שמות קבצים/רכיבים שכבר אינם מבטאים את המימוש הנוכחי, לדוגמה:

- `CommandEligibility.ts`
- `src/extension/analytics/ProjectAnalyticsStore.ts`
- חלוקת MVP/Post-MVP ישנה.

בפועל הקוד כולל:

- `src/particle-accelerator-runtime/*`
- declarative filters
- built-in definitions
- `GitSemanticFilter`
- `UserFilterLoader`
- שירותי extension תחת `src/extension/particle-accelerator/*`

פעולה מומלצת:

- לסמן את `plans/PARTICLE_ACCELERATOR_IMPLEMENTATION_PLAN.md` כהיסטורי.
- לא להפנות אליו כתיעוד מצב נוכחי.

### Multi Participant

`MULTI_PARTICIPANT.md` תואם טוב יותר לקוד הנוכחי:

- `server/src`
- `src/extension/multiparticipant`
- UI של teams/multi-participant.

לעומתו, `plans/MULTI_PARTICIPANT_AGENT_SESSION.md` מתאר קבצים שלא קיימים במבנה הנוכחי:

- `server/src/DeltaContextBuilder.ts`
- `server/src/SessionStore.ts`

בפועל קיימים רכיבים כמו:

- `server/src/PromptFormatter.ts`, כולל בניית delta context.
- `server/src/SessionPersistence.ts`

פעולה מומלצת:

- להעביר את plan לארכיון או לעדכן אותו לפי המימוש.
- להשאיר `MULTI_PARTICIPANT.md` כמקור אמת לאחר בדיקת עדכון אחרונה.

### Remote Server / Data Capture

`plans/REMOTE_SERVER_AND_DATA_CAPTURE.md` מתאר תכנון עתידי/ישן של:

- `RemoteProcessManager.ts`
- `RemoteSessionTab.ts`
- `IProcessManager.ts`
- `TranscriptRecorder.ts`

הקבצים האלה אינם קיימים. הקוד הנוכחי עבור Happy/remote provider משתמש במסלול פשוט יותר דרך provider/CLI override ו-`SessionTab`, לא `src/extension/remote`.

פעולה מומלצת:

- להעביר את המסמך לארכיון future proposals.
- לא להשאיר אותו ליד תיעוד מצב נוכחי בלי סימון.

### Codex Initial Plan

`Codex_integration.txt` הוא מסמך תכנון/התחלה ישן.

דוגמאות לחוסר התאמה:

- מציין `supportsImages: false`, בעוד שהקוד הנוכחי תומך בתמונות ב-Codex path.
- מזכיר הגדרות כמו `claudeMirror.codex.showReasoning` ו-`claudeMirror.codex.enableCommandTelemetry`, שלא קיימות כיום ב-`package.json`.
- `src/extension/webview/CodexMessageHandler.ts` כולל `supportsImages: true` ו-`sendMessageWithImages`.
- `src/extension/process/CodexExecProcessManager.ts` מטפל בקבצי תמונה זמניים.

`CODEX_INTEGRATION_PROGRESS.md` הוא log כרונולוגי שימושי, אבל גם הוא כולל חלקים ישנים לצד עדכונים מאוחרים.

פעולה מומלצת:

- להעביר את `Codex_integration.txt` לארכיון.
- להוסיף בראש `CODEX_INTEGRATION_PROGRESS.md` סטטוס current-state קצר שמסביר שהוא יומן היסטורי ולא spec עדכני.

### Dashboard Plans

`DASHBOARD_PLAN.md` וקבצי dashboard תחת `html/` הם תוכניות/מצגות, לא מקור אמת.

בפועל dashboard התפתח מעבר למה שמופיע בחלק מהתוכניות, למשל User mode כולל Particle Accelerator tab.

פעולה מומלצת:

- להשאיר `ANALYTICS_DASHBOARD.md` כמסמך קנוני אחרי תיקון.
- להעביר plan/presentation docs לארכיון או לסמן אותם כ-historical.

## תיקיות כפולות

### `New folder/`

נמצאו 20 קבצים. ביחס לקבצים מקבילים ברמה העליונה:

- 1 קובץ זהה.
- 18 קבצים שונים.
- 1 קובץ orphan: `TECHNICAL.md`.

משמעות: זו לא תיקיית backup נקייה. יש בה גרסאות שונות של מסמכים קיימים ולכן היא מסוכנת כמקור בלבול.

פעולה מומלצת:

- להשוות את 18 הקבצים השונים לפני מחיקה.
- למזג רק תוכן שעדיין רלוונטי.
- להעביר את כל התיקייה לארכיון או למחוק אחרי merge.

### `New folder - Copy/`

נמצאו 43 קבצים. ביחס לקבצים מקבילים ברמה העליונה:

- 26 קבצים זהים.
- 16 קבצים שונים.
- 1 קובץ orphan: `TECHNICAL.md`.

פעולה מומלצת:

- למחוק קבצים זהים אחרי אישור.
- לבדוק ידנית את 16 הקבצים השונים.
- למזג לתוך `C:/projects/claude-code-mirror/TECHNICAL.md` רק תוכן עדכני אם יש בעותק הזה משהו שחסר בקובץ הקנוני.

## תיקיית HTML

בתיקיית `Kingdom_of_Claudes_Beloved_MDs/html` נמצאו 59 קבצים. רובם הם:

- תוכניות implementation.
- executive summaries.
- מצגות UX/PM.
- HTML exports של מסמכי תכנון.

הבעיה אינה שהקבצים חסרי ערך, אלא שהם נמצאים ליד תיעוד טכני ויכולים להיתפס כמסמכי מצב נוכחי.

פעולה מומלצת:

- להעביר ל-`archive/html-plans/` או `references/html/`.
- להוסיף `README.md` בתיקייה שמסביר שכל הקבצים שם אינם source of truth למימוש הנוכחי.
- לקשר מהם למסמכים הקנוניים כאשר יש פיצ'ר ממומש.

חריגים שיכולים להישאר כ-reference/UX docs אם יסומנו בהתאם:

- `particle-accelerator-executive-benefits.html`
- `particle-accelerator-integration-ux-he.html`
- `workstream-map-feature-doc.html`
- מסמכי multi-participant guide ב-HTML.

## מסמכים שנראים עדכניים או סבירים לאחר בדיקה מול הקוד

המסמכים הבאים נראים תואמים בעיקרם למבנה הקוד או לפחות אינם מציגים mismatch ברור שמחייב תיקון מיידי:

- `ACTIVITY_BAR_LAUNCHER.md`
- `ACTIVITY_SUMMARIZER.md`
- `ADVENTURE_WIDGET.md`
- `AGENT_TEAMS.md`
- `BUG_REPORT_FEATURE.md`
- `CHAT_SEARCH.md`
- `CHECKPOINT_MANAGER.md`
- `CLAUDE_AUTH_LOGIN_LOGOUT.md`
- `CODEX_CONSULTATION.md`
- `CODEX_FAST_MODE.md`
- `FILE_MENTION.md`
- `GIT_PUSH_BUTTON.md`
- `GLOBAL_TOOLTIP_SYSTEM.md`
- `IMAGE_LIGHTBOX.md`
- `MARKDOWN_RENDERING.md`
- `MCP_SUPPORT.md`
- `MULTI_PARTICIPANT.md`
- `PARTICLE_ACCELERATOR.md`
- `PROJECT_30_DAYS_TAB.md`
- `PROMPT_ENHANCER.md`
- `PROVIDER_HANDOFF.md`
- `REMOTE_SESSIONS.md`
- `SESSION_DISCOVERY.md`
- `SESSION_NAMER.md`
- `SESSION_SUMMARY.md`
- `SILENT_CRASH_RESUME.md`
- `SKILL_GENERATION.md`
- `SMART_SEARCH.md`
- `SUMMARY_MODE.md`
- `TAB_GROUPS.md`
- `TAB_LAYOUT.md`
- `TYPING_PERSONALITY_THEMES.md`
- `ULTRATHINK_BUTTON.md`
- `USAGE_LIMIT_DEFERRED_SEND.md`
- `VISUAL_PROGRESS_MODE.md`
- `WORKSTREAM_MAP.md`
- `WORKSTREAM_MAP_PLAN_REWRITE.md`

הערות:

- `ACTIVITY_SUMMARIZER.md` כולל דוגמאות prompt עם paths כמו `src/auth.ts`; אלה נראות כדוגמאות ולא כנתיבי repo פעילים.
- `REMOTE_SESSIONS.md` מזכיר קבצים/הגדרות שהוסרו, אבל עושה זאת תחת section של removed legacy files ולכן זה לא mismatch בפני עצמו.
- `CLAUDE_AUTH_LOGIN_LOGOUT.md` נראה תואם לפיצ'ר, אף שבקוד קיימות הערות פנימיות ישנות שיכולות לבלבל.

## מסמכים לעדכון מיידי

מומלץ לטפל קודם ברשימה הזו כי היא משפיעה על הבנת מצב הפרויקט הנוכחי:

1. `SESSION_VITALS.md`
2. `COMPLETE_FEATURE_LIST.md`
3. `ANALYTICS_DASHBOARD.md`
4. `SESSION_RESTORE.md`
5. `API_KEY_MANAGEMENT.md`
6. `PROCESS_LIFECYCLE.md`
7. `PROMPT_TRANSLATOR.md`
8. `MESSAGE_TRANSLATION.md`
9. `FORMSPREE_FEEDBACK.md`
10. `ARCHITECTURE.md`

## מסמכים להעברה לארכיון או סימון כ-historical

מומלץ לא למחוק לפני בדיקת בעלות, אבל לא להשאיר כמסמכי מצב נוכחי:

- `MCP_SUPPORT_PLAN.md`
- `mcp-support-for-claui.md`
- `mcp-claude-code-guide.md`
- `mcp-claude-code-guide_2.txt`
- `plans/PARTICLE_ACCELERATOR_IMPLEMENTATION_PLAN.md`
- `plans/MULTI_PARTICIPANT_AGENT_SESSION.md`
- `plans/REMOTE_SERVER_AND_DATA_CAPTURE.md`
- `Codex_integration.txt`
- `DASHBOARD_PLAN.md`
- רוב הקבצים תחת `html/`
- כל `New folder/`
- כל `New folder - Copy/`

## סדר פעולה מומלץ

1. לקבוע ש-`TECHNICAL.md` בשורש הפרויקט הוא המקור הקנוני, ולעדכן/לסמן בהתאם את העותקים שבתיקיות הכפולות.
2. לתקן את 10 המסמכים ברשימת "עדכון מיידי".
3. לקבוע מדיניות ארכיון: `archive/`, `references/`, או frontmatter `status: historical`.
4. להעביר/למחוק את `New folder/` ו-`New folder - Copy/` אחרי merge של תוכן רלוונטי.
5. לסמן את קבצי `html/` כמצגות/תוכניות ולא כתיעוד implementation.
6. להוסיף בדיקת תחזוקה פשוטה: כל מסמך עם נתיב `src/...` צריך לעבור verification שהנתיב קיים או שהטקסט מסמן במפורש שמדובר בדוגמה/תוכנית היסטורית.

## מסקנה (שלב א)

אין כאן בעיה אחת של "מסמך שגוי", אלא בעיית governance של התיעוד: מקור האמת מעורבב עם טיוטות, תוכניות, עותקים ו-exported HTML. אחרי ניקוי הכפילויות וסימון historical docs, שכבת התיעוד הקיימת יכולה להיות שימושית מאוד, אבל כרגע יש כמה מסמכים קנוניים שמטעים לגבי מצב הקוד הפעיל.

הפעולה הכי חשובה היא להפריד בין שלושה סוגים:

- Current implementation docs
- Historical plans / decisions
- External references / examples

ברגע שההפרדה הזו קיימת, תיקון המסמכים הקנוניים עצמם הוא יחסית קטן וממוקד.

---

# שלב ב - ביקורת מעמיקה של שאר המסמכים

## היקף שלב ב

שלב א סיווג מסמכים ברמה גבוהה. שלב ב כולל:

1. בדיקה מעמיקה של 35+ מסמכים שסווגו כ"נראים עדכניים" אבל לא אומתו מול הקוד.
2. ניתוח 14 מסמכים שלא הוזכרו כלל בשלב א.
3. סיווג מסמכי באג, SR-PTD ומסמכי תוכנית ייחודיים.

כל מסמך נבדק אל מול:

- קיום נתיבי source שמוזכרים במסמך.
- קיום שמות הגדרות (settings) ב-`package.json`.
- קיום שמות מחלקות/פונקציות ב-`src/`.
- תביעות כמותיות (ספירות, טיימאאוטים, גדלים).

## ממצאים חדשים — P1 (פרטים שגויים, כיוון נכון)

### P1 — `ACTIVITY_SUMMARIZER.md`: timeout שגוי

המסמך טוען: "10-second timeout on Haiku process".

בפועל `src/extension/session/ActivitySummarizer.ts`:

```typescript
timeoutMs: options?.timeoutMs ?? 45_000
```

ה-timeout הדיפולטי הוא **45 שניות**, לא 10.

פעולה מומלצת: לעדכן ל-"45-second timeout (configurable via timeoutMs option)".

---

### P1 — `ADVENTURE_WIDGET.md`: מימדי המבוך שגויים

המסמך טוען: "40x40 cell grid" עם "initial generation: ~300 cells from center (grid position 20,20)".

בפועל `src/webview/components/Vitals/adventure/types.ts` `DEFAULT_CONFIG`:

```typescript
mazeWidth: 220,
mazeHeight: 220
```

המבוך הוא **220x220**, לא 40x40. מרכז המבוך הוא **(110,110)**, לא (20,20).

מה שנכון: initial generation של 300 cells אושר (`dungeon.ts:86`), וה-canvas הוא 120x120px (10px per cell), וה-PICO-8 palette של 17 צבעים — כל אלה נכונים.

פעולה מומלצת: לעדכן "40x40 cell grid" ל-"220x220 cell grid" ולתקן את קואורדינטות המרכז.

---

### P1 — `CODEX_CONSULTATION.md`: מיקום כפתור שגוי

המסמך מתאר "StatusBar expanded mode: Direct button between Feedback and Git" עם CSS class `.status-bar-consult-btn`.

בפועל ב-`src/webview/components/StatusBar/StatusBar.tsx`:

- הכפתור נמצא **רק בתוך dropdown** (`status-bar-group-dropdown-item`), לא כפתור ישיר.
- CSS class `.status-bar-consult-btn` לא קיים.
- הכפתור מותנה ב-`isConnected && showCodexConsult` (ולא רק `isConnected === true`).

פעולה מומלצת: לעדכן את תיאור מיקום הכפתור ולהוסיף את תנאי `showCodexConsult`.

---

### P1 — `COMPLETE_FEATURE_LIST.md`: חסרים פיצ'רים ופרטים שגויים

ארבע בעיות:

**1. Toast duration שגוי**: המסמך אומר "5s" (section 12.2). בפועל `AchievementToastStack.tsx:53` משתמש ב-`10000` (10 שניות). `ACHIEVEMENTS.md` נכון (אומר 10s).

**2. Keybinding שלא קיים**: המסמך מציין `Ctrl+Shift+E` עבור "Prompt enhancer (manual mode)". ב-`package.json` אין כזה keybinding.

**3. Keybindings חסרים**: `Ctrl+Alt+D` (discoverSessions) ו-`Ctrl+Alt+T` (toggleTeamPanel) רשומים ב-`package.json` אך לא מופיעים בטבלה.

**4. פיצ'רים חסרים לחלוטין**: שישה פיצ'רים ממומשים שלא מוזכרים:
- Smart Search tabs
- Workstream Map + Portfolio
- Tab Groups (tab folders with color)
- Session End Summary
- Usage Limit Deferred Send
- Provider Handoff

פעולה מומלצת: לעדכן toast duration, לתקן טבלת keybindings, ולהוסיף section לכל פיצ'ר חסר.

---

### P1 — `MULTI_PARTICIPANT.md`: קבצים וסטינג חסרים

המסמך מציין 7 קבצים תחת `server/src/`, אבל בפועל יש 8:

- חסר: `server/src/PromptFormatter.ts` (לא מתועד).

המסמך מציין 6 קבצים תחת `src/extension/multiparticipant/`, בפועל יש 7:

- חסר: `src/extension/multiparticipant/PromptRenderer.ts`.

המסמך מציין 4 settings, אבל ב-`package.json` קיים גם:

- `claudeMirror.multiParticipant.defaultAgentProvider` (לא מתועד).

פעולה מומלצת: להוסיף את שלושת הפריטים החסרים.

---

### P1 — `SKILL_GENERATION.md`: קבצים חסרים בטבלה

- `src/extension/skillgen/SkillGenTypes.ts` קיים בפועל אבל חסר מטבלת הקבצים.
- `src/webview/components/SkillGen/SkillGenOnboarding.tsx` קיים בפועל אבל חסר מטבלת הקבצים. (מוזכר בפסקת הטקסט, לא בטבלה.)

פעולה מומלצת: להוסיף שני הקבצים לטבלות.

---

### P1 — `WORKSTREAM_MAP.md`: רכיב לא קיים

המסמך מתאר `CachedMapBanner.tsx` שמספק פעולות "Back" ו-"Open Workspace".

`CachedMapBanner.tsx` לא קיים תחת `src/webview/components/WorkstreamMap/`. הפונקציונליות ככל הנראה מוטמעת ברכיב אחר.

פעולה מומלצת: למצוא איזה רכיב מטפל בזה כיום ולעדכן את המסמך בהתאם.

---

### P2 (נמוך) — `GLOBAL_TOOLTIP_SYSTEM.md`: ספירות קלות שגויות

- המסמך אומר "~160 lines" עבור `GlobalTooltip.tsx`. בפועל הקובץ הוא ~185 שורות.
- המסמך אומר "14+ status bar items". בפועל יש 34 אתריבוטים `data-tooltip` ב-StatusBar.
- רשימת הרכיבים שהועברו מחסירה כמה רכיבים: `AIChip.tsx`, `CodexModelSelector.tsx`, `CodexServiceTierSelector.tsx`, `BugReportPanel.tsx`, `BabelFishPanel.tsx`.

---

### P2 (נמוך) — `TAB_LAYOUT.md`: command לא מאומת

המסמך מציין `claudeMirror.tabs.refreshList`. ב-`package.json` לא נמצא command זה. ייתכן שהוסר או שהוא internal-only.

פעולה מומלצת: לבדוק אם הפקודה קיימת ולעדכן אם לא.

---

### P2 (נמוך) — `PARTICLE_ACCELERATOR.md`: ספירת test files שגויה

המסמך טוען "11 test files". בפועל יש 7 קבצי `.test.ts` בתיקיות `filters/` ו-`security/`. אין 11 קבצים נפרדים.

## מסמכים שלא הוזכרו בשלב א — ממצאים

### מסמכים שנמצאו עדכניים לחלוטין

| מסמך | אימות |
|------|-------|
| `FILE_LOGGER.md` | כל קבצים, settings ו-keybinding מאומתים מול קוד |
| `STREAM_JSON_PROTOCOL.md` | מפרט פרוטוקול CLI חיצוני, עקבי עם `MessageHandler.ts` |
| `SKILL_VISUAL_INDICATOR.md` | כל קבצים, CSS classes ו-store fields מאומתים |
| `ACHIEVEMENTS.md` | כל 5 settings, כל קבצי backend ו-frontend מאומתים |
| `DRAG_AND_DROP_CHALLENGE.md` | קוד ניסיוני אושר כמוסר, context menu command קיים |
| `CODEX_FAST_MODE.md` | CLI flags אומתו ב-`CodexExecProcessManager.ts:267-268` |
| `CODEX_INTEGRATION_PROGRESS.md` | changelog היסטורי — כל classes/settings קיימים |

### מסמכי תוכנית שמומשו — צריכים סימון ארכיון

| מסמך | סטטוס מימוש |
|------|------------|
| `smart-search-plan.md` | מומש לחלוטין. מסמך קנוני: `SMART_SEARCH.md` |
| `tab-folders-and-session-summary-plan.md` | מומש לחלוטין. מסמכים קנוניים: `TAB_GROUPS.md`, `SESSION_SUMMARY.md` |
| `WORKSTREAM_MAP_PLAN_REWRITE.md` | מומש ברובו. חסר רכיב `AttentionBadges.tsx` |
| `USAGE_LIMIT_DEFERRED_SEND_PLAN.md` | כבר מסומן ארכיון ("Implemented on March 11, 2026") |

שלושת הראשונים עדיין לא מסומנים כ-archived ויכולים להיתפס כמסמכי מצב נוכחי.

### Reference חיצוני

`plans/deep-research-repo.md` — מחקר אבטחה על כלי AI (Amazon Q, GitHub Copilot, Codex, Cursor, MCP). לא מכיל שום התייחסות לקוד ClaUi. זהו מסמך מחקר/השראה, לא תיעוד מימוש.

## מסמכי באג ו-SR-PTD — סיווג

קיימת קטגוריה שלמה של מסמכים שאינם תיעוד מצב נוכחי אבל גם אינם טעות — הם יומני פיתוח / תיאור תהליך תיקון תקלות.

### מסמכי באג — ארכיון ייחוסי (לשמור, לא לעדכן)

| מסמך | תיאור | ערך לשמירה |
|------|-------|-----------|
| `btw_bug.md` | 8 שלבי תיקון ל-BTW overlay. כולל תיאור ארכיטקטורה נוכחית של `BackgroundSession` ו-`CodexBackgroundSession`. | גבוה — מסביר למה ה-single-phase approach קיים |
| `widget-bugs_context-widget.md` | סדרת 6 תיקוני context widget. כולל patterns חשובים (cumulative vs per-call tokens, Zustand polling). | גבוה — patterns תקפים לכל feature שצורך streaming tokens |
| `BUG_FILE_PATHS_NOT_CLICKABLE_IN_CODE.md` | תיאור תיקון `linkifyCodeElements()`. תיקון מאומת כקיים ב-`MarkdownContent.tsx`. | בינוני — מסמך קצר ומדויק |
| `BUG_EXITPLANMODE_INFINITE_LOOP.md` | 17 תיקוני ExitPlanMode. כולל טבלת "Current Defense Layers" שמתארת ארכיטקטורת הגנה עכשווית. | גבוה מאוד — הטבלה הזו היא reference ייחודי ל-WHY כל ה-flags קיימים |
| `TAB_TOOLTIP_BUG_REPORT.md` | מגבלת VS Code API — אין `tooltip` ל-`WebviewPanel`. | בינוני — מונע ניסיון חוזר של hack שלא עובד |

הערה: `BUG_EXITPLANMODE_INFINITE_LOOP.md` הוא מקרה מיוחד. הטבלה "Current Defense Layers" בסוף המסמך מתארת מצב נוכחי ולא היסטוריה. כדאי לשקול להעתיק את הטבלה הזו ל-`ARCHITECTURE.md` (שבלאו הכי צריך עדכון לפי שלב א).

### מסמכי one-time fix — ניתן למחיקה לאחר בדיקה

| מסמך | תוכן | המלצה |
|------|------|-------|
| `DOUBLE_CLICK_FOCUS_FIX_2026-03.md` | פרטי תיקון double-click, כולל git rollback command. | שמור לעוד שבועיים אם אין רגרסיות, אחר כך למחיקה. |
| `EMAIL_REWRITE_BACKUP_BRANCH_2026-03-18.md` | הוראת rollback לענף backup שאמור היה להימחק "after 1-2 days". הסתיים 2026-03-18. | **למחיקה** — ישן מ-2026-03-18, backup branch לא אמור להיות קיים. |

### מסמכי SR-PTD — ארכיון היסטורי

ארבעה מסמכי SR-PTD (`SR-PTD_2026-02-23_*`, `SR-PTD_2026-02-25_*`, `SR-PTD_2026-03-02_*`, `SR-PTD_2026-03-18_*`) הם post-task documentation מתוכנן. מסמכים אלה הם **ארכיוניים בעיצובם** — תיאור מה נעשה, למה, ומה נלמד. הם אינם מסמכי מצב נוכחי ואינם צריכים עדכון.

## מה שהתחזק בשלב ב

35 מסמכים שסווגו כ"נראים עדכניים" בשלב א אומתו בפועל:

- 28 מסמכים: **CURRENT** — כל פרטי הקוד מאומתים.
- 7 מסמכים: **STALE-P1** — כיוון נכון, פרטים ספציפיים שגויים (timeout, מימדים, ספירות, קבצים חסרים).
- 0 מסמכים: **STALE-P0** — לא נמצא מסמך שמטעה ברמה קריטית בין המסמכים שסווגו כ"עדכניים".

## טבלת מסמכים STALE שנמצאה בשלב ב

| מסמך | רמה | תיאור הבעיה |
|------|-----|------------|
| `ACTIVITY_SUMMARIZER.md` | P1 | timeout: "10s" → בפועל 45s |
| `ADVENTURE_WIDGET.md` | P1 | maze: "40x40" → בפועל 220x220; center: (20,20) → (110,110) |
| `CODEX_CONSULTATION.md` | P1 | כפתור: "direct in expanded mode" → בפועל רק ב-dropdown; CSS class לא קיים |
| `COMPLETE_FEATURE_LIST.md` | P1 | toast 5s→10s; keybinding Ctrl+Shift+E לא קיים; 6 פיצ'רים חסרים |
| `MULTI_PARTICIPANT.md` | P1 | 2 קבצים ו-1 setting לא מתועדים |
| `SKILL_GENERATION.md` | P1 | 2 קבצים חסרים מטבלות |
| `WORKSTREAM_MAP.md` | P1 | `CachedMapBanner.tsx` מוזכר אבל לא קיים |
| `GLOBAL_TOOLTIP_SYSTEM.md` | P2 | ספירות קלות שגויות, רשימת רכיבים חלקית |
| `TAB_LAYOUT.md` | P2 | `claudeMirror.tabs.refreshList` לא אומת |
| `PARTICLE_ACCELERATOR.md` | P2 | test file count: "11" → בפועל 7 |

## מסמכים להעברה לארכיון / סימון (תוספת לרשימה משלב א)

| מסמך | סיבה |
|------|------|
| `smart-search-plan.md` | מומש. מסמך קנוני קיים: `SMART_SEARCH.md` |
| `tab-folders-and-session-summary-plan.md` | מומש. מסמכים קנוניים קיימים |
| `WORKSTREAM_MAP_PLAN_REWRITE.md` | תוכנית מימוש. מסמך קנוני קיים: `WORKSTREAM_MAP.md` |
| `EMAIL_REWRITE_BACKUP_BRANCH_2026-03-18.md` | backup note מ-2026-03-18, אמור היה להימחק |

## מסמכים לעדכון מיידי — רשימה מלאה (שלב א + שלב ב)

1. `SESSION_VITALS.md` — `CostHeatBar.tsx` לא קיים (P0)
2. `COMPLETE_FEATURE_LIST.md` — כמה פיצ'רים חסרים + פרטים שגויים (P0/P1)
3. `ANALYTICS_DASHBOARD.md` — User mode מתואר כ-2 טאבים, בפועל 3 (P0)
4. `SESSION_RESTORE.md` — schema ישן (P0)
5. `ARCHITECTURE.md` — `TabManager` מתואר חלקית (P1)
6. `API_KEY_MANAGEMENT.md` — spawn points inventory ישן (P1)
7. `PROCESS_LIFECYCLE.md` — killProcessTree users count ישן (P1)
8. `PROMPT_TRANSLATOR.md` — timeout ישן (P1)
9. `MESSAGE_TRANSLATION.md` — timeout ישן + kill method ישן (P1)
10. `FORMSPREE_FEEDBACK.md` — fallback behavior לא עקבי (P1)
11. `ACTIVITY_SUMMARIZER.md` — timeout "10s" → 45s (P1)
12. `ADVENTURE_WIDGET.md` — maze dimensions "40x40" → 220x220 (P1)
13. `CODEX_CONSULTATION.md` — button placement wrong (P1)
14. `MULTI_PARTICIPANT.md` — קבצים ו-setting חסרים (P1)
15. `SKILL_GENERATION.md` — קבצים חסרים (P1)
16. `WORKSTREAM_MAP.md` — `CachedMapBanner.tsx` לא קיים (P1)

## מסקנה כוללת

לאחר שני שלבי ביקורת שכיסו 75+ מסמכים:

**המצב הכולל טוב יותר ממה שנראה בהתחלה.** רוב המסמכים הקנוניים (28 מתוך 35 שנבדקו בעומק) תואמים את הקוד. הבעיות העיקריות הן:

1. **10 מסמכים ברמת P0/P1** שמטעים לגבי מצב הקוד הנוכחי (כיסינו 10 בשלב א ועוד 7 בשלב ב, עם חפיפה ב-COMPLETE_FEATURE_LIST.md).
2. **כמה מסמכי תוכנית ממומשת** שעדיין לא קיבלו סימון ארכיון.
3. **קטגוריה מוסתרת** של מסמכי באג שיש להם ערך ארכיוני גבוה (במיוחד `BUG_EXITPLANMODE_INFINITE_LOOP.md`) ולא זוהתה כקטגוריה נפרדת בשלב א.

הפעולה היעילה ביותר כרגע: לתקן את 16 המסמכים ברשימת "עדכון מיידי" מלמעלה.
