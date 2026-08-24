# Model Council + Free-Model Bridge for ClaUi

**TL;DR (EN):** A working, field-tested reference implementation that adds two features on top of ClaUi without touching its source: (1) chatting with **free cloud models** (OpenRouter + OpenCode Zen gateways — e.g. Ox Alpha with a 1M context, GLM-5.2 free, stealth launches) inside a ClaUi tab, and (2) a **model council** — `/council <question>` fans the question out in parallel to Claude Code, Codex, Grok and free models, renders each answer as a live tool card, and a selectable **chair** synthesizes agreements, disagreements and a final ruling. Verified live on 2026-08-24 with 5/5 engines answering. Everything here is self-contained and secret-free; keys live only in local files the user creates.

---

## מה זה

שני פיצ'רים שרצים היום בפרודקשן אצל משתמש ClaUi, ממומשים **בלי לגעת בקוד של ClaUi** — דרך נקודת ההרחבה הטבעית שלו (`claudeMirror.cliPath`):

1. **גשר מודלים חינמיים** — צ'אט מלא בטאב ClaUi מול מודלים חינמיים משני שערים (OpenRouter ו־OpenCode Zen), כולל מצב סוכן אמיתי: המודל קורא/כותב/עורך קבצים בפרויקט, ופקודות shell נעצרות מאחורי קוד אישור אנושי.
2. **מועצת מודלים** — הודעה שמתחילה ב־`/מועצה` / `/council` / `התייעצות:` נשלחת במקביל לכמה מנועים (Claude Code במנוי, Codex, Grok, וחינמיים), כל תשובה מצטיירת ככרטיס כלי חי, ויו"ר — לבחירת המשתמש — מסכם: הסכמות, מחלוקות, הכרעה.

## איך זה מתחבר ל־ClaUi (הארכיטקטורה בקצרה)

```
ClaUi ──(claudeMirror.cliPath)──► adapter shim שמדבר stream-json של Claude Code
                                        │
                                        ├── claude passthrough (ברירת המחדל השקופה)
                                        └── backend "zen" → zen-chat.mjs (הקובץ כאן)
```

- **ההתחזות**: ה־shim מקבל את אותם דגלים ש־ClaUi שולח ל־claude CLI (`--input-format stream-json`, `--resume`, `--model`), ופולט את אותם אירועים ש־ClaUi מצפה להם (`system/init`, `stream_event` עם `message_start` / `content_block_delta` / `message_stop`, `assistant`, `result`).
- **כרטיסי כלים**: הטריק שמצייר כרטיס כלי אמיתי ב־UI — פליטת הודעת assistant עם בלוק `tool_use` ומיד אחריה הודעת user עם `tool_result` על אותו `tool_use_id`. ככה כל חבר מועצה מופיע ככרטיס בזמן אמת.
- **דביקות סשן**: מיפוי קטן פר־סשן (קובץ JSON) קובע לאיזה backend שייך כל טאב, כך שהחלפת מודל בטאב אחד לא זולגת לטאבים אחרים, ו־resume חוזר תמיד לאותו מנוע.
- **העברת הקשר**: במעבר Claude→bridge מוזרק "handoff capsule" עם סיכום הטאב, כדי שהמודל החדש ימשיך מאותה נקודה.

## הקבצים כאן

| קובץ | מה הוא |
|------|--------|
| `zen-chat.mjs` | הקליינט המלא: שני פרופילים OpenAI-compatible (or/oc), היסטוריה פר־סשן על הדיסק, מצב סוכן עם tool loop, retry על 429, נפילה חיננית לצ'אט כשמודל לא תומך בכלים, קטלוג מודלים חינמיים חי (`--list`), **והמועצה** (`/מועצה`, בחירת יו"ר, שופט חיצוני). |
| `bridge-tools.mjs` | הכלים של מצב הסוכן: read/write/edit/list/search תחומים לשורש הפרויקט + `run_command` שרץ רק אחרי קוד אישור מהמשתמש. |
| `zen-connect.mjs` | חיבור חשבון מהטרמינל: OAuth PKCE מלא מול OpenRouter (פותח דפדפן, תופס callback על localhost, ממיר קוד למפתח ושומר לקובץ). |

## שימוש עצמאי (בלי האדפטר)

```bash
# רשימת המודלים החינמיים החיים משני השערים
node zen-chat.mjs --list

# חיבור OpenRouter בקליק אחד בדפדפן
node zen-connect.mjs openrouter

# צ'אט
node zen-chat.mjs "שאלה" --model zen::or/stealth/ox-alpha

# מועצה: קלוד + קודקס + גרוק + Ox Alpha במקביל, קלוד יו"ר
node zen-chat.mjs "/מועצה מונורפו או ריפוזיטוריז נפרדים?"

# מועצה עם יו"ר נבחר (יו"ר שלא חבר מועצה = שופט חיצוני)
node zen-chat.mjs "/מועצה@grok אותה שאלה"
```

מפתחות: `~/.grok-claui/openrouter-api-key.txt` / `zen-api-key.txt`, או env (`OPENROUTER_API_KEY` / `ZEN_OC_API_KEY`), או אוטומטית מ־`opencode auth login`. בלי מפתח — הכל מדלג בשקט.

הרכב מועצה: `ZEN_COUNCIL_MODELS` (עד 6, פסיקים): `claude[::model]`, `codex[::model]`, `grok[::model]`, `zen::or/...`, `zen::oc/...`. יו"ר קבוע: `ZEN_COUNCIL_CHAIR`.

## מה שווה לדעתנו לאמץ נייטיבית ב־ClaUi

1. **Provider גנרי OpenAI-compatible** — base URL + key file → פותח את ClaUi לכל שער (OpenRouter, Zen, llama.cpp מקומי...) במחיר קוד קטן.
2. **פקודת `/council`** — ה־UX של "כמה דעות + הכרעה" מתאים בול לצ'אט; הרינדור כבר קיים (כרטיסי כלים).
3. **קבוצת FREE בבורר המודלים** — משיכת הקטלוגים החיים + סינון free (הלוגיקה כאן ב־`listZenModels`, כולל דירוג איכות פשוט).
4. **התראה על מודל חינמי חדש** — השוואת קטלוג מול הרענון הקודם + toast.

## אבטחה ופרטיות

- אין סודות בקוד. מפתחות רק בקבצים מקומיים שהמשתמש יוצר / env.
- מודלים חינמיים עשויים לשמור פרומפטים ולהתאמן עליהם — ה־README והקוד מזכירים זאת למשתמש; לא מיועד לקוד רגיש.
- shell תמיד מאחורי אישור אנושי חד־פעמי; כלי קבצים תחומים לשורש הפרויקט בלבד.

## סטטוס בדיקות (24.8.2026, בשטח)

- מועצה מלאה: **5/5 מנועים ענו** (Claude Sonnet, Codex, Grok 4.6, Gemini*, Ox Alpha) + סינתזת יו"ר.
- שופט חיצוני: מחלוקת אמיתית בין שני מודלים חינמיים הוכרעה ע"י יו"ר שלא השתתף.
- E2E מול שני השערים עם מפתחות אמיתיים; נפילות (429 upstream) מוצגות ❌ בלי להפיל את המועצה.

\* חבר ה־Gemini במימוש המקורי רץ דרך גשר פרטי ולכן אינו כלול כאן; הוספת חבר מסוג חדש היא ~20 שורות ב־`parseCouncilMemberToken` + `askCouncilMember`.

---

נבנה על הסטאק של מאיר ארד יחד עם Claude Code (Fable 5). תודה על ClaUi 🙏
