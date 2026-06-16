# תוכנית יישום: לולאת ביקורת אוטומטית Claude ↔ Codex ("Review Loop")

## Context — למה אנחנו עושים את זה

היום, כשקלוד קוד מסיים פיתוח, אין מנגנון מובנה שמעביר את התוצר לביקורת חיצונית
ומסגר אותה לולאה עד לאישור. הרעיון: אחרי שתור פיתוח רגיל מסתיים, קלואי יריץ
**אוטומטית** מחזור ביקורת — קלוד כותב מסמך מסירה נקי לבודק, סשן Codex עצמאי בוחן
את **הקוד עצמו** (קריאה־בלבד על כל ה-workspace) ומחזיר חוות דעת, מסווג קל מכריע אם
זה אישור או בקשת תיקונים, וכל עוד יש תיקונים — ההערות חוזרות לקלוד והמחזור נמשך עד
שקודקס מאשר (או עד תקרת סבבים).

התוצאה הרצויה: שיפור איכות אוטומטי ("חבר בודק" בלתי תלוי) ללא שקלוד יבדוק את עצמו,
עם שקיפות מלאה למשתמש ויכולת עצירה בכל רגע.

**החלטות שאושרו על ידי המשתמש:**
1. ריצה **אוטומטית מלאה** — מסך transcript שקוף + כפתור עצירה + גבול סבבים.
2. הבודק (Codex) בוחן **גם את הקוד בפועל**, בקריאה־בלבד, על **כל ה-workspace**.
3. סשן הביניים = **מסווג קל ומהיר (Haiku)** שמחזיר פסיקה מובנית.
4. תקרת סבבים = **5** (ניתן לשינוי בהגדרות).

---

## ארכיטקטורה — שלושה תפקידים + מתזמן

| תפקיד | מימוש | נשען על קוד קיים |
|------|-------|------------------|
| **המפתח** | סשן הקלוד החי (`SessionTab`) | `sendText()`, `demux.on('assistantMessage')`, נתיב ה-`result` ב-`wireProcessEvents` |
| **הבודק** | סשן Codex רקע מתמשך (thread אחד) בקריאה־בלבד | `CodexExecProcessManager` + `CodexExecDemux` (תבנית: `CodexBackgroundSession`) |
| **המסווג** | קריאת Haiku חד־פעמית, פלט מובנה | תבנית `SessionNamer` (`claude -p --model haiku`, stdin, timeout, sanitize) |
| **המתזמן** | שירות חדש שמריץ את מכונת המצבים | חדש: `ReviewLoopOrchestrator` |

**למה Codex מקורי ולא "Consult Codex":** "Consult Codex" רק מזריק פרומפט שאומר *לקלוד*
לקרוא ל-MCP `mcp__codex__codex` — אין רציפות thread (הבודק "שוכח" בין סבבים) והפלט
עובר דרך קלוד. לעומת זאת `CodexExecProcessManager.runTurn({ threadId, forceReadOnlySandbox })`
מריץ `codex exec resume` עם thread מתמשך ו-`--sandbox read-only`, כך שהבודק צובר הקשר
ובוחן את הקוד ישירות. זו ההתאמה הנכונה (תבנית מוכחת ב-`CodexBackgroundSession`).

---

## מכונת המצבים (מנוהלת ב-`ReviewLoopOrchestrator`)

```
טריגר: תור פיתוח רגיל הסתיים בטאב → המשתמש/הגדרה מפעילים Review Loop
   │
   ▼
(1) AWAIT_DEV_HANDOVER
    הזרק לקלוד פרומפט "כתוב מסמך מסירה בין הסימנים" (ללא עבודת קוד — כבר בוצעה)
    לכוד את טקסט הסיום של התור → חלץ את התוכן שבין הסימנים
   │
   ▼
(2) AWAIT_CODEX_REVIEW
    שלח את המסמך הנקי ל-Codex (thread; ראשון=exec, אחר כך=resume; read-only; cwd=workspace root)
    לכוד את חוות הדעת (agentMessage עד turnCompleted)
   │
   ▼
(3) CLASSIFY (Haiku)  →  approved?
       │                     │
   כן (APPROVED)         לא (CHANGES_REQUESTED)
       ▼                     ▼
  DONE_APPROVED        (4) AWAIT_DEV_FIX
   (סוף, הודעת הצלחה)      הזרק לקלוד את חוות הדעת: "טפל בהערות בקוד, ואז כתוב מסמך מסירה מעודכן בין הסימנים"
                            לכוד תור → חלץ מסמך מעודכן
                            round++ → חזרה ל-(2)
```

- **סבב 1** הוא בקשת מסמך בלבד (הפיתוח כבר נעשה ע"י המשתמש).
- **מסבב 2** משלבים *תיקון + מסמך מעודכן* בתור־מפתח אחד (חיסכון בתורים). "ההודעה
  האחרונה" שמועברת ל-Codex היא תמיד מסמך המסירה המעודכן שחולץ מהסימנים.
- עצירה: `DONE_APPROVED`, או הגעה לתקרת הסבבים (ברירת מחדל 5) → עצירה והצגת הערות
  Codex הפתוחות, או לחיצת המשתמש על Stop.

---

## הנדסת פרומפטים — פלט נקי (הנקודה הקריטית)

**מפתח → בודק (מסמך נקי):** הפרומפט המוזרק מורה לקלוד לפלוט **רק** את המסמך, עטוף
בסימנים מפורשים, ללא שום פתיח:

```
===CLAUI_HANDOVER_BEGIN===
משימה: <המשימה במילים שלך>
מה בוצע: <דיווח מפתח>
קבצים שהשתנו: <נתיבים>
איך לאמת: <צעדי אימות>
===CLAUI_HANDOVER_END===
```

המתזמן מחלץ **אך ורק** את הטקסט שבין הסימנים (`extractHandover()`), כך ש"להלן מסמך
מסירה לבודק..." או כל פטפוט אחר לעולם לא מגיע ל-Codex. Fallback: אם אין סימנים — ניקוי
פתיחים מוכרים ולקיחת הגוף, עם רישום ל-log. (חלופה נקייה ב-100% — כתיבה לקובץ —
נדחתה כי היא מתנגשת עם ה-Secret/SPA write-guard.)

**בודק → מסווג (פסיקה אמינה):** ב-`appendSystemPrompt` (דרך `-c instructions=`) מורים
ל-Codex לסיים תמיד בשורה אחת בדיוק: `VERDICT: APPROVED` או `VERDICT: CHANGES_REQUESTED`
ואחריה רשימת תיקונים ממוקדת. המסווג עובד בשתי שכבות: regex דטרמיניסטי על שורת הפסיקה,
ו-Haiku כגיבוי למקרים מעורפלים. מחזיר `{ approved: boolean, reason: string }`.

---

## קבצים חדשים

| קובץ | תפקיד |
|------|-------|
| `src/extension/review-loop/ReviewLoopOrchestrator.ts` | מכונת המצבים, מונה סבבים, עצירה, שידור אירועי transcript ל-webview |
| `src/extension/review-loop/CodexReviewerSession.ts` | סשן Codex רקע בקריאה־בלבד עם thread מתמשך (תבנית `CodexBackgroundSession`); מזריק את רובריקת הבודק + דרישת שורת ה-VERDICT |
| `src/extension/review-loop/ReviewVerdictClassifier.ts` | מסווג Haiku חד־פעמי (תבנית `SessionNamer`); regex + LLM fallback |
| `src/extension/review-loop/reviewLoopPrompts.ts` | תבניות הפרומפטים + `extractHandover()` + ניתוח VERDICT |
| `src/extension/review-loop/reviewLoopTypes.ts` | טיפוסים: מצבים, אירועי transcript, תצורה |
| `src/webview/components/ReviewLoop/ReviewLoopPanel.tsx` | פאנל transcript חי (סבב→מסמך→חוו"ד→פסיקה) + מונה + כפתור Stop |
| `Kingdom_of_Claudes_Beloved_MDs/REVIEW_LOOP.md` | מסמך פירוט (detail doc) לפי תקן התיעוד |

## שינויים בקבצים קיימים

- **`src/extension/session/SessionTab.ts`** — להוסיף `captureNextTurn(prompt, timeoutMs): Promise<{ finalText }>`:
  מזריק פרומפט דרך `control.sendText`, צובר טקסט מ-`demux.on('assistantMessage')` לפי
  `stop_reason` (לוקח את ההודעות שאינן `tool_use` כתשובה הסופית — בדיוק כמו ש-
  `HeadlessAgentRunner` כבר עושה), ומסיים על אירוע ה-`result` (נקודת ה-`event.type === 'result'`
  הקיימת ב-`wireProcessEvents`, בערך שורה 1888). בנוסף: getter ל-`reviewLoop` (כמו `btwSession`),
  יצירה/דיספוז של ה-orchestrator, ובדיקת `isBusyState()`/הקלדת משתמש לעצירת הלולאה.
- **`src/extension/webview/MessageHandler.ts`** — טיפול בהודעות חדשות `reviewLoopStart`/`reviewLoopStop`
  ושידור `reviewLoopEvent` ל-webview (תבנית טיפול `codexConsult`).
- **`src/extension/types/webview-messages.ts`** — טיפוסי ההודעות החדשים (start/stop/event).
- **`src/webview/components/StatusBar/StatusBar.tsx`** — כפתור "Review Loop" (ליד "Consult", מותנה
  ב-`isConnected` ובזמינות Codex).
- **`src/webview/App.tsx` + `src/webview/state/store.ts`** — מצב פתיחת הפאנל + רינדור `ReviewLoopPanel`.
- **`package.json`** — הגדרות:
  `claudeMirror.reviewLoop.enabled` (bool),
  `claudeMirror.reviewLoop.maxRounds` (number, ברירת מחדל 5),
  `claudeMirror.reviewLoop.reviewerModel` (Codex),
  `claudeMirror.reviewLoop.classifierModel` (ברירת מחדל `claude-haiku-4-5-20251001`),
  `claudeMirror.reviewLoop.turnTimeoutMs`.
- **`TECHNICAL.md`** — רישום ה-component החדש + הפניה ל-`REVIEW_LOOP.md`.

הערה: אין צורך לשנות CSP ב-`WebviewProvider.ts` (אין משאבים חיצוניים חדשים).

---

## UI ובקרות

- כפתור "Review Loop" ב-StatusBar מפעיל את הלולאה על הטאב הפעיל.
- `ReviewLoopPanel` מציג transcript חי: לכל סבב — מסמך המסירה, חוות דעת Codex, והפסיקה,
  עם מונה "סבב N/5", אינדיקטור מצב, וכפתור Stop בולט.
- ניתן גם לאפשר הפעלה אוטומטית בסיום כל תור (דרך `reviewLoop.enabled`) — כברירת מחדל
  כבויה, כדי שלא תרוץ לולאה בלי כוונה.

---

## מקרי קצה ושמירות

- מסמך ריק/חסר סימנים מהמפתח → ניסיון חוזר אחד, ואז עצירה עם הודעה ברורה.
- timeout לכל תור (מפתח ובודק) + ביטול in-flight דרך `cancelRequest()` (קלוד) ו-`cancelTurn()` (Codex).
- הגעה לתקרת הסבבים ללא אישור → עצירה והצגת הערות Codex הפתוחות.
- המשתמש מקליד/שולח ידנית באמצע → הלולאה נעצרת (לא דורסים פעולה ידנית).
- לא מתחילים לולאה כשהטאב `isBusyState()`.
- ניקוי משאבים: דיספוז של סשן ה-Codex והמתזמן ב-`SessionTab.dispose()` (כמו `closeBtwSession`).

---

## אימות (Verification)

1. בנייה והתקנה: `npm run deploy:local`, ואז Reload Window, ואז `npm run verify:installed`
   (חובה כי הוספנו command/settings ל-`package.json`).
2. בדיקת זרימה ידנית:
   - להריץ תור פיתוח רגיל, ללחוץ "Review Loop".
   - לוודא ב-`Output → ClaUi` שהטקסט שנשלח ל-Codex **נקי** מסימנים/פתיחים (בדיקת `extractHandover`).
   - תרחיש אישור: Codex מסיים ב-`VERDICT: APPROVED` → הלולאה נעצרת עם הודעת הצלחה.
   - תרחיש תיקונים: `VERDICT: CHANGES_REQUESTED` → ההערות חוזרות לקלוד, נוצר מסמך מעודכן, סבב חדש.
   - תרחיש תקרה: לוודא עצירה אחרי 5 סבבים.
   - כפתור Stop עוצר תור in-flight ומסיים את הלולאה.
3. עדכון תיעוד: יצירת `Kingdom_of_Claudes_Beloved_MDs/REVIEW_LOOP.md` ועדכון `TECHNICAL.md`.

---

## מצב

התוכנית **אושרה**. הצעד הנוכחי: הפקת מסמכי התכנון (MD זה + סיכום מנהלים ב-HTML).
יישום הקוד יתבצע רק לאחר אישור נפרד מהמשתמש.
