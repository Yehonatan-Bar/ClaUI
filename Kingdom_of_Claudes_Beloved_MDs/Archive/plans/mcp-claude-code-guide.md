# מדריך מפתח מקיף: Model Context Protocol (MCP) ב-Claude Code

---

## 1. מה זה MCP?

Model Context Protocol (MCP) הוא תקן פתוח (open standard) שפותח על ידי Anthropic ומאפשר לאפליקציות AI להתחבר למערכות חיצוניות — מסדי נתונים, API-ים, כלים, ושירותים — דרך ממשק אחיד ותקני. MCP הועבר בדצמבר 2025 לניהול של Linux Foundation כתקן ניטרלי, ומאומץ כיום על ידי כל הפלטפורמות הגדולות: OpenAI, Google, Microsoft, ועוד.

**האנלוגיה הכי טובה:** MCP הוא כמו USB-C עבור אפליקציות AI — חיבור תקני אחד שמאפשר גישה לכל כלי חיצוני.

### הבעיה שנפתרת

לפני MCP, כל פלטפורמת AI הייתה עם שיטה משלה לחיבור כלים: OpenAI Function Calling, LangChain Tool Abstraction, Anthropic Tool Use — כולם פתרו את אותה בעיה בצורה שונה. אם רצית שהחיפוש במסד הנתונים שלך יעבוד עם Claude, ChatGPT, וגם עם agent מותאם אישית — היית צריך שלוש אינטגרציות שונות.

עם MCP: **כתוב שרת אחד, וכל client תואם MCP יכול להשתמש בו.**

---

## 2. ארכיטקטורה

MCP עובד על מודל client-server עם שלוש שכבות:

```
┌──────────────┐   JSON-RPC   ┌──────────────┐
│  Claude Code  │ ◄──────────► │  MCP Server   │
│   (client)    │  stdio/HTTP  │  (e.g. GitHub)│
└──────────────┘              └──────────────┘
```

**רכיבים מרכזיים:**

- **MCP Client** — Claude Code פועל כ-client. הוא מגלה כלים זמינים בתחילת הסשן ומפעיל אותם לפי הצורך
- **MCP Server** — מכיל את הלוגיקה לגישה למשאב חיצוני (GitHub API, דפדפן Playwright, מנוע חיפוש Brave וכו')
- **Transport** — שכבת התקשורת (stdio, SSE, או HTTP Streamable)
- **JSON-RPC 2.0** — הפרוטוקול שבו מועברות ההודעות

### שלושת הפרימיטיבים של MCP

| פרימיטיב | תיאור | דוגמה |
|-----------|--------|--------|
| **Tools** | פונקציות שה-AI יכול לקרוא להן | `create_issue`, `query_database` |
| **Resources** | נתונים שהשרת חושף לקריאה | קבצי תיעוד, סכמות, JSON |
| **Prompts** | תבניות prompt שנגישות כפקודות | `/mcp__server__analyze_code` |

---

## 3. סוגי Transport

MCP תומך בשלושה מצבי תקשורת:

### stdio (ברירת מחדל)

השרת רץ כ-child process. Claude Code מתקשר דרך stdin/stdout. זה המצב הפשוט ביותר עם latency של פחות מ-5ms.

```bash
claude mcp add github-server -- npx -y @modelcontextprotocol/server-github
```

### SSE (Server-Sent Events)

מתחבר לשרת מרוחק דרך HTTP. מתאים לשרתי צוות משותפים.

```bash
claude mcp add --transport sse analytics-server https://mcp.example.com/sse
```

### HTTP Streamable (מומלץ לשרתים מרוחקים)

הפורמט החדש מאז מפרט MCP 2025-03, משתמש ב-endpoint HTTP בודד עם streaming דו-כיווני. זהו **התקן המומלץ מ-2026 והלאה**.

```bash
claude mcp add --transport http my-server https://mcp.example.com/mcp
```

**כלל אצבע:** `stdio` לשרתים מקומיים, `http` לשרתים מרוחקים.

---

## 4. הגדרת שרתי MCP ב-Claude Code

### הוספת שרת באמצעות CLI

```bash
# שרת בסיסי (stdio)
claude mcp add <name> <command> [args...]

# עם משתני סביבה
claude mcp add <name> --env KEY1=value1 --env KEY2=value2 -- <command> [args...]

# שרת HTTP מרוחק
claude mcp add --transport http <name> <url>

# שרת SSE עם headers
claude mcp add --transport sse <name> --header "Authorization: Bearer TOKEN" <url>
```

### הוספה באמצעות JSON

```bash
claude mcp add-json weather-api '{"type":"http","url":"https://api.weather.com/mcp"}'

claude mcp add-json local-server '{"type":"stdio","command":"node","args":["./server.js"],"env":{"API_KEY":"abc"}}'
```

### ייבוא מ-Claude Desktop

```bash
claude mcp add-from-claude-desktop
```

### פקודות ניהול

```bash
claude mcp list          # הצגת כל השרתים
claude mcp get <name>    # פרטים על שרת ספציפי
claude mcp remove <name> # הסרת שרת
/mcp                     # בדיקת סטטוס בתוך סשן (slash command)
```

---

## 5. Scopes — היקפי הגדרה

Claude Code תומך בשלושה היקפים להגדרת שרתים:

### local (ברירת מחדל)

זמין רק לך בפרויקט הנוכחי. מתאים לשרתים ניסיוניים או credentials רגישים.

```bash
claude mcp add --scope local my-server -- npx my-mcp-server
```

### project

משותף לכל חברי הצוות דרך קובץ `.mcp.json` בשורש הפרויקט. מתאים לכלים שכל הצוות צריך.

```bash
claude mcp add --scope project playwright npx @playwright/mcp@latest
```

### user

זמין לך בכל הפרויקטים. נשמר ב-`~/.claude.json`. מתאים לכלים אישיים שבשימוש תדיר.

```bash
claude mcp add --scope user --transport http hubspot https://mcp.hubspot.com/anthropic
```

### סדר עדיפות

כאשר שרתים עם אותו שם קיימים במספר היקפים:

```
local > project > user
```

**טיפ:** Claude Code דורש אישור לפני שימוש בשרתי `project` מקובץ `.mcp.json`. ניתן לאפס את הבחירות עם `claude mcp reset-project-choices`.

---

## 6. קובצי הגדרה

### `~/.claude.json` (user scope)

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

### `.mcp.json` (project scope — שורש הפרויקט)

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

### הרחבת משתני סביבה

קובצי `.mcp.json` תומכים בתחביר הבא:

- `${VAR}` — מתרחב לערך של המשתנה
- `${VAR:-default}` — ערך ברירת מחדל אם המשתנה לא קיים

זה מאפשר לשתף הגדרות צוותיות בלי לחשוף סודות ב-Git.

---

## 7. שרתי MCP פופולריים

### GitHub

```bash
claude mcp add-json github '{
  "type": "http",
  "url": "https://api.githubcopilot.com/mcp",
  "headers": {"Authorization": "Bearer YOUR_TOKEN"}
}'
```

חושף 20+ כלים: ניהול Issues, Pull Requests, חיפוש קוד, קריאת קבצים.

### Playwright (אוטומציית דפדפן)

```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```

מאפשר צילומי מסך, ניווט, אינטראקציה עם DOM.

### Brave Search

```bash
claude mcp add brave -- npx -y @anthropic/server-brave-search
export BRAVE_API_KEY=your_key
```

### Sentry (ניטור שגיאות)

```bash
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
```

### שרתים נוספים בולטים

- **Figma** — עיצוב וקריאת קבצי עיצוב
- **Slack** — שליחה וקריאה של הודעות
- **Asana** — ניהול משימות
- **Supabase / PostgreSQL** — שאילתות מסד נתונים
- **Context7** — תיעוד ספריות מעודכן

לרשימה מלאה: [mcp.so](https://mcp.so) ו-[smithery.ai](https://smithery.ai)

---

## 8. MCP Tool Search — גילוי כלים דינמי

כאשר יש הרבה שרתי MCP מוגדרים, הגדרות הכלים יכולות לצרוך חלק משמעותי מחלון ההקשר. Tool Search פותר את זה על ידי טעינת כלים on-demand.

### איך זה עובד

- כלי MCP נטענים בעיכוב (deferred) ולא מראש
- Claude משתמש בכלי חיפוש כדי לגלות כלים רלוונטיים
- רק הכלים שצריכים בפועל נטענים ל-context

### הפעלה

Tool Search מופעל אוטומטית כשתיאורי הכלים צורכים יותר מ-10% מחלון ההקשר. ניתן לשלוט בהתנהגות עם:

```bash
export ENABLE_TOOL_SEARCH=true   # הפעלה ידנית
export ENABLE_TOOL_SEARCH=false  # כיבוי
```

**דרישות:** Sonnet 4 ומעלה, או Opus 4 ומעלה. מודלים של Haiku לא תומכים ב-Tool Search.

**טיפ למפתחי שרתים:** השדה `instructions` בשרת הופך לחשוב מאוד עם Tool Search. כתבו הוראות ברורות שמסבירות מתי לחפש את הכלים שלכם.

---

## 9. Resources ו-Prompts

### Resources — משאבים

שרתי MCP יכולים לחשוף משאבים שניתן לפנות אליהם עם `@` (בדומה להפניות לקבצים):

```
> @my-resource כתוב לי סיכום של המסמך הזה
```

- הקלידו `@` ב-prompt כדי לראות משאבים זמינים
- משאבים מופיעים לצד קבצים בתפריט ההשלמה

### Prompts — תבניות

שרתים יכולים לחשוף prompts שנגישים כפקודות `/`:

```
/mcp__servername__promptname arg1 arg2
```

הקלידו `/` כדי לראות את כל הפקודות הזמינות, כולל אלה משרתי MCP.

---

## 10. בניית שרת MCP מותאם אישית

### TypeScript

#### הקמת פרויקט

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod@3
npm install -D typescript @types/node
```

#### `package.json`

```json
{
  "type": "module",
  "bin": { "my-server": "./build/index.js" },
  "scripts": { "build": "tsc && chmod 755 build/index.js" }
}
```

#### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

#### `src/index.ts` — שרת בסיסי

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from
  "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// יצירת השרת
const server = new McpServer({
  name: "my-custom-server",
  version: "1.0.0",
});

// רישום כלי (Tool)
server.tool(
  "get_project_info",                    // שם הכלי
  "Get information about a project",     // תיאור (חשוב ל-LLM!)
  {
    projectId: z.string().describe("The project ID to look up"),
  },
  async ({ projectId }) => {
    // הלוגיקה שלך כאן
    const info = await fetchProjectInfo(projectId);
    return {
      content: [
        { type: "text", text: JSON.stringify(info) }
      ],
    };
  }
);

// חיבור ל-transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

> **חשוב:** בשרתי stdio, לעולם **אל תשתמשו ב-`console.log()`** — זה כותב ל-stdout ופוגע בפרוטוקול. השתמשו ב-**`console.error()`** עבור debug output.

### Python

#### הקמת פרויקט

```bash
mkdir my-mcp-server && cd my-mcp-server
uv init && uv venv
source .venv/bin/activate
uv add "mcp[cli]" httpx
```

#### `server.py` — שרת בסיסי

```python
from mcp.server.fastmcp import FastMCP

# FastMCP קורא docstrings ו-type hints
# כדי ליצור את ה-JSON schema אוטומטית
mcp = FastMCP("my-custom-server")

@mcp.tool()
async def get_project_info(project_id: str) -> str:
    """Get information about a project by its ID.
    
    Args:
        project_id: The unique identifier for the project
    """
    # הלוגיקה שלך כאן
    info = await fetch_project_info(project_id)
    return json.dumps(info)

# הפעלה עם transport stdio
if __name__ == "__main__":
    mcp.run(transport="stdio")
```

> **Python טיפ:** FastMCP משתמש ב-docstrings וב-type hints כדי ליצור אוטומטית את ה-schema שה-LLM צריך. **docstrings טובים הם חובה** — הם הדרך שבה המודל מחליט אם להשתמש בכלי שלך.

### חיבור השרת ל-Claude Code

```bash
# TypeScript
claude mcp add my-server -- node /path/to/build/index.js

# Python
claude mcp add my-server -- python /path/to/server.py
```

---

## 11. הוספת HTTP Streamable Transport

לשרתים שצריכים לרוץ מרוחקים:

### TypeScript

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "my-remote-server",
  version: "1.0.0",
});

// ... רישום כלים ...

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => {
  console.error("MCP server running on port 3000");
});
```

---

## 12. בדיקות ודיבאגינג

### MCP Inspector

כלי ויזואלי רשמי לבדיקת שרתים:

```bash
npx @modelcontextprotocol/inspector node ./build/index.js
# או לשרת Python:
npx @modelcontextprotocol/inspector python server.py
```

מאפשר לקרוא לכלים, לצפות במשאבים, ולבדוק prompts — **בלי צורך ב-Claude Code**.

### דיבאג מתוך Claude Code

```bash
# הפעלה עם מידע מפורט על חיבורי MCP
claude --mcp-debug
```

בתוך הסשן:

```
/mcp    # הצגת סטטוס כל השרתים
```

### בדיקת JSON-RPC ידנית

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | node ./build/index.js
```

### בדיקות יחידה (Python)

```python
import pytest

@pytest.mark.asyncio
async def test_get_project_info():
    result = await call_tool("get_project_info", {"project_id": "123"})
    data = json.loads(result[0].text)
    assert data["name"] == "My Project"

@pytest.mark.asyncio
async def test_project_not_found():
    result = await call_tool("get_project_info", {"project_id": "999"})
    assert "not found" in result[0].text.lower()
```

---

## 13. Claude Code כשרת MCP

Claude Code יכול גם **לחשוף את הכלים שלו** לקליינטים אחרים:

```bash
claude mcp serve
```

זה חושף כלים כמו Bash, Read, Write, Edit, LS, GrepTool, GlobTool ועוד — לשימוש של Claude Desktop, Cursor, או כל MCP client אחר.

**חשוב:** רק הכלים הפנימיים של Claude Code נחשפים. שרתי MCP שמחוברים ל-Claude Code **לא** עוברים דרך (אין MCP passthrough).

---

## 14. ניהול Token Output

כשכלי MCP מייצרים פלטים גדולים:

- **סף אזהרה:** 10,000 tokens
- **מגבלה ברירת מחדל:** 25,000 tokens
- **הגדרה מותאמת:**

```bash
export MAX_MCP_OUTPUT_TOKENS=50000
```

**טיפ:** אם אתם מתמודדים עם אזהרות תדירות, שקלו להוסיף pagination או סינון בצד השרת.

---

## 15. אבטחה — שיטות עבודה מומלצות

### ניהול Credentials

- השתמשו במשתני סביבה עבור tokens ו-API keys
- **לעולם אל תשמרו סודות ב-`.mcp.json`** שנכנס ל-Git
- השתמשו ב-`${VAR}` expansion כדי להפנות למשתני סביבה

### הרשאות Claude Code

- Claude Code מבקש אישור לפני כל קריאת MCP
- ניתן להגדיר auto-approval דרך מערכת ההרשאות
- שרתי `project` דורשים אישור מפורש בפעם הראשונה

### ניהול ארגוני

לארגונים שדורשים שליטה מרכזית:

- **`managed-mcp.json`** — סט קבוע של שרתים שמשתמשים לא יכולים לשנות
- **Allowlists/Denylists** — שליטה על אילו שרתים מורשים

### אבטחת שרתים

- חיפוש אבטחה שבוצע ב-2025 מצא חולשות command injection ב-43% משרתי MCP שנבדקו
- השתמשו רק בשרתים ממקורות מהימנים
- בדקו את קוד המקור של שרתי צד שלישי לפני שימוש

---

## 16. Elicitation — בקשת קלט מהמשתמש

שרתי MCP יכולים לבקש קלט מובנה מהמשתמש באמצע משימה:

```
שרת MCP → Claude Code → דיאלוג אינטראקטיבי למשתמש → תשובה חוזרת לשרת
```

זה שימושי כשהשרת צריך מידע שלא ניתן לקבל אוטומטית (למשל: בחירת workspace, אישור פעולה מסוכנת).

---

## 17. פרסום השרת

### npm (TypeScript)

```bash
npm publish
# המשתמשים יתקינו עם:
claude mcp add my-server -- npx -y @myorg/my-mcp-server
```

### PyPI (Python)

```bash
pip install build twine
python -m build
twine upload dist/*
```

### רשימה ב-directories

- [MCP Directory](https://mcpdirectory.app)
- [mcp.so](https://mcp.so)
- [smithery.ai](https://smithery.ai)

---

## 18. פתרון בעיות נפוצות

| בעיה | פתרון |
|-------|--------|
| שרת לא מתחבר | בדקו `node -v` (צריך 18+). וודאו נתיבים מוחלטים |
| `console.log` שובר את הפרוטוקול | בשרתי stdio, השתמשו רק ב-`console.error()` |
| שינויים לא נכנסים לתוקף | **הפעילו מחדש** את Claude Code אחרי כל שינוי |
| כלים לא מופיעים | בדקו עם `/mcp` בתוך הסשן |
| Token overflow | הפחיתו מספר שרתים, הפעילו Tool Search, או הגדילו `MAX_MCP_OUTPUT_TOKENS` |
| Headers לא עובדים עם stdio | Headers רלוונטיים רק ל-SSE/HTTP. ב-stdio השתמשו ב-env vars |
| שרת project דורש אישור | זה תקין — מטעמי אבטחה. `claude mcp reset-project-choices` לאיפוס |

---

## 19. סיכום — זרימת עבודה מומלצת

1. **התחילו פשוט** — הוסיפו את שרת GitHub כשרת ראשון
2. **הוסיפו בהדרגה** — שרת נוסף שמתאים לצורכי הפרויקט שלכם
3. **הגדירו project scope** — כדי שכל הצוות ישתמש באותם כלים
4. **הפעילו Tool Search** — כשיש הרבה שרתים מוגדרים
5. **בנו שרת מותאם** — כשצריכים אינטגרציה ייחודית למערכת הפנימית
6. **בדקו עם MCP Inspector** — לפני שמחברים ל-Claude Code
7. **פרסמו ושתפו** — ב-npm/PyPI ורשמו ב-MCP directories

---

*מדריך זה מעודכן למרץ 2026. MCP SDK גרסה 2.x בפיתוח — עקבו אחרי [modelcontextprotocol.io](https://modelcontextprotocol.io) לעדכונים.*
