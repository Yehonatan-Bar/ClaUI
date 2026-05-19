# Markdown Rendering

## Purpose

Renders Markdown syntax in chat messages as formatted HTML. Previously, text was displayed as plain `pre-wrap` content with only fenced code blocks extracted. Now bold, italic, headers, lists, tables, blockquotes, inline code, links, and horizontal rules are all rendered visually.

## Key Files

| File | Path | Role |
|------|------|------|
| MarkdownContent | `src/webview/components/ChatView/MarkdownContent.tsx` | Core component: parses, sanitizes, renders, linkifies |
| markdown.css | `src/webview/styles/markdown.css` | Styles for all Markdown elements (VS Code theme vars) |
| rtl.css | `src/webview/styles/rtl.css` | RTL overrides for Markdown (blockquotes, lists, code) |
| MessageBubble | `src/webview/components/ChatView/MessageBubble.tsx` | `TextBlockRenderer` delegates to `MarkdownContent` |
| filePathLinks | `src/webview/components/ChatView/filePathLinks.tsx` | Exports `FILE_PATH_REGEX` and `URL_REGEX` for reuse |

## Architecture

### Rendering Pipeline

```
Raw text (from CLI)
  |
  v
parseTextWithCodeBlocks(text)   [MessageBubble.tsx]
  |
  +-- code segments --> CodeBlock component (copy, collapse, language label, HTML preview)
  |
  +-- text segments --> MarkdownContent component
                          |
                          marked.parse(text) --> raw HTML string
                          |
                          DOMPurify.sanitize(html) --> safe HTML string
                          |
                          dangerouslySetInnerHTML --> rendered DOM
                          |
                          useEffect: linkifyCodeElements() --> backtick-wrapped paths/URLs in <code> become clickable
                          useEffect: linkifyTextNodes() --> bare file paths/URLs in text nodes become clickable
                          useEffect: event delegation --> click handler for all link types
```

### Why This Architecture

1. **Fenced code blocks are extracted BEFORE Markdown parsing.** This preserves the existing `CodeBlock` component with its copy button, collapse/expand, file path detection, and HTML preview. `marked` never sees fenced code blocks. For HTML code blocks, a "Preview" button opens the content in a new VS Code webview tab via `HtmlPreviewPanel.ts`.

2. **`marked` + `DOMPurify` instead of `react-markdown`.** The `react-markdown` ecosystem pulls in 15+ packages (~80-120KB). `marked` is a single ~40KB dependency. Combined with `DOMPurify` (~15KB), the total is ~55KB.

3. **`dangerouslySetInnerHTML` is safe** because all HTML is sanitized through DOMPurify with an explicit whitelist of allowed tags and attributes.

4. **File path detection uses DOM post-processing** instead of the React-based `renderTextWithFileLinks()`. Since `marked` produces an HTML string (not React nodes), we walk the rendered DOM's text nodes to detect and wrap file paths and URLs after render.

## MarkdownContent Component

### Configuration

- `marked` options: `gfm: true` (GitHub Flavored Markdown), `breaks: true` (newlines become `<br>`)
- Custom renderer overrides for `link` (adds `data-href` and `class="md-link"`) and `codespan` (adds `class="md-inline-code"`)
- DOMPurify whitelist: `p, br, strong, em, del, a, code, pre, h1-h6, ul, ol, li, blockquote, table, thead, tbody, tr, th, td, hr, span, div, sup, sub, input`

### Link Handling (4 types)

1. **Markdown links** (`[text](url)`) - Rendered by `marked` as `<a class="md-link" data-href="...">`. Click handler checks if URL or file path, routes to `openUrl` or `openFile`.

2. **Backtick-wrapped file paths/URLs** - Inline `<code>` elements whose entire text matches `FILE_PATH_REGEX` or `URL_REGEX` get the `file-path-link` or `url-link` class added directly to the `<code>` element by `linkifyCodeElements()`. This is the most common case since Claude wraps file paths in backticks.

3. **Bare file paths** - Detected post-render by `linkifyTextNodes()` using `FILE_PATH_REGEX`. Wrapped in `<span class="file-path-link">`. Click opens in VS Code editor.

4. **Bare URLs** - Detected post-render by `linkifyTextNodes()` using `URL_REGEX`. Wrapped in `<span class="url-link">`. Click opens in browser.

### `openFile` Target Parsing (extension-side)

`openFile` requests from the webview are normalized in both `MessageHandler` (Claude tabs) and `CodexMessageHandler` (Codex tabs) before opening:

- Trims wrappers/encoding noise (`\`...\``, quotes, `<...>`, `( ... )`, URI-encoded values)
- Strips leading punctuation that often precedes inline mentions (for example: `:LocalModelServer.swift#L103`)
- Supports both classic suffixes (`file.ts:42`, `file.ts:42:7`) and GitHub anchors (`file.ts#L42`, `file.ts#L42C7`, range suffixes)
- Resolves relative paths from workspace root, then falls back to basename/suffix search
- For `.xcodeproj` / `.xcworkspace` roots, also searches the parent folder so links can resolve when sources live outside the package folder

### `linkifyCodeElements()` Function

Queries all inline `<code>` elements (excluding those inside `<pre>`) and checks if their entire text content matches a file path or URL regex. If it does, the `<code>` element itself gets the `file-path-link` or `url-link` class plus data attributes (`data-path` or `data-url`), making it clickable while preserving the inline code styling. Runs before `linkifyTextNodes()`.

### `linkifyTextNodes()` Function

Walks all text nodes in the rendered container using `TreeWalker`. Skips nodes inside `<code>`, `<pre>`, and `<a>` elements to avoid double-linking. Matches are replaced with `<span>` elements containing appropriate data attributes and CSS classes. Uses fresh regex instances (copies of `FILE_PATH_REGEX` and `URL_REGEX`) to avoid `lastIndex` state issues.

## Styling

### CSS Variables (VS Code Theme Integration)

All Markdown styles use VS Code CSS variables for automatic theme adaptation:

| Element | Key Variables |
|---------|--------------|
| Headers | `--vscode-editor-foreground`, `--vscode-panel-border` |
| Links | `--vscode-textLink-foreground`, `--vscode-textLink-activeForeground` |
| Inline code | `--vscode-textCodeBlock-background`, `--vscode-editor-fontFamily` |
| Blockquotes | `--vscode-textBlockQuote-background`, `--vscode-textLink-foreground` |
| Tables | `--vscode-panel-border`, `--vscode-sideBarSectionHeader-background` |
| Horizontal rules | `--vscode-panel-border` |

### RTL Support

Message containers use `dir="auto"` (browser's first-strong-character algorithm) instead of the old any-Hebrew-char heuristic. MarkdownContent also applies `dir="auto"` to each block-level element (p, li, headings, td) so each paragraph independently detects its direction.

When an element resolves to RTL:

- `.markdown-content` text aligns right
- Lists (`ul`, `ol`) use `padding-right` instead of `padding-left`
- Blockquote border moves from left to right
- Code blocks and tables remain LTR (technical content)
- Task list checkboxes swap margin direction

## What Stays Plain Text

- **Streaming text** (`StreamingText.tsx`) - Shows raw text with blinking cursor during streaming. Markdown formatting appears when the message is finalized.
- **Tool results** (`ToolResultRenderer`) - Continue using `renderTextWithFileLinks()` for plain text with clickable links.

## Dependencies

| Package | Version | Size (minified) | Purpose |
|---------|---------|-----------------|---------|
| `marked` | latest | ~40KB | Markdown to HTML parser |
| `dompurify` | latest | ~15KB | HTML sanitizer (XSS prevention) |
| `@types/dompurify` | latest | dev only | TypeScript type definitions |

## Supported Markdown Features

| Feature | Syntax | Rendered |
|---------|--------|----------|
| Bold | `**text**` | **text** |
| Italic | `*text*` | *text* |
| Strikethrough | `~~text~~` | ~~text~~ |
| Inline code | `` `code` `` | `code` |
| Headers | `# H1` through `###### H6` | Styled headers with size hierarchy |
| Unordered lists | `- item` | Bulleted list |
| Ordered lists | `1. item` | Numbered list |
| Task lists | `- [x] done` | Checkbox list (GFM) |
| Blockquotes | `> text` | Bordered quote block |
| Tables | GFM pipe syntax | Bordered table with header |
| Horizontal rule | `---` | Thin divider line |
| Links | `[text](url)` | Clickable link |
| Nested elements | Combinations | Supported via standard Markdown nesting |

Fenced code blocks (` ``` `) are handled separately by `CodeBlock`, not by `MarkdownContent`.

---

# Merged from IMAGE_LIGHTBOX.md

# Image Lightbox

Full-screen overlay for viewing images at their natural size. Triggered by double-clicking any image in the webview.

## What It Does

Users paste images into the chat input but can only see them as tiny 64x64 thumbnails. Images in message bubbles are capped at 400px. The lightbox lets users double-click any image to see it full-size in a dark overlay.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/ImageLightbox/ImageLightbox.tsx` | Lightbox overlay component (portal-based) |
| `src/webview/components/ImageLightbox/index.ts` | Barrel export |
| `src/webview/state/store.ts` | `lightboxImageSrc` state field + `setLightboxImageSrc` setter |
| `src/webview/App.tsx` | Mounts `<ImageLightbox />` at app root |
| `src/webview/components/ChatView/MessageBubble.tsx` | `onDoubleClick` on `ImageBlockRenderer` img |
| `src/webview/components/InputArea/InputArea.tsx` | `onDoubleClick` on pending image thumbnails |
| `src/webview/styles/global.css` | `.image-lightbox-overlay` styles + `cursor: zoom-in` |

## How It Works

1. **Store**: `lightboxImageSrc: string | null` in Zustand. When non-null, lightbox renders.
2. **Trigger**: `onDoubleClick` on `<img>` elements calls `setLightboxImageSrc(dataUri)` via `useAppStore.getState()`.
3. **Overlay**: `ImageLightbox` reads the store field. When non-null, renders a fixed overlay via `createPortal` to `document.body`.
4. **Close**: Click on backdrop or press Escape sets `lightboxImageSrc` to `null`.

## CSS

- `.image-lightbox-overlay`: `position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.85)`
- `.image-lightbox-overlay img`: `max-width: 90vw; max-height: 90vh; object-fit: contain`
- `.message-image img, .pending-image-thumb img`: `cursor: zoom-in`

## Accessibility

- `role="dialog"` and `aria-label="Image preview"` on the overlay
- Escape key closes the lightbox
- `cursor: zoom-in` on images, `cursor: zoom-out` on overlay backdrop

---

# Merged from TYPING_PERSONALITY_THEMES.md

# Typing Personality Themes

## מטרת הפיצ'ר

הפיצ'ר **Typing Personality Themes** מאפשר למשתמש לבחור "אישיות תצוגה" עבור רינדור התשובות בצ'אט.
המטרה היא לתת חוויית קריאה מותאמת לסגנון אישי, מבלי לשנות את התוכן עצמו של Claude.

כלומר: הטקסט ש-Claude מחזיר נשאר אותו טקסט, אבל המראה, תחושת האנימציה והאווירה הוויזואלית משתנים.

---

## מה המשתמש רואה בממשק

### 1. נקודת גישה לפיצ'ר

ב־Status Bar של הצ'אט יש כפתור `Aa` (Text Settings).

בלחיצה עליו נפתח פאנל ההגדרות, שבו מופיעים:

- גודל טקסט (`Size`)
- משפחת פונט (`Font`)
- שדה חדש: `Theme`

### 2. אפשרויות Theme

בשדה `Theme` יש 4 אפשרויות:

1. `Terminal Hacker`
2. `Retro`
3. `Zen`
4. `Neo Zen`

הבחירה מתבצעת מתוך Dropdown פשוט.

---

## פירוט מלא לכל Theme

## Terminal Hacker

### כיוון עיצובי

מראה "טרמינל האקר":

- צבעוניות ירוק על שחור
- קונטרסט גבוה
- תחושה טכנית, חדה ומהירה

### התנהגות טקסט בזמן Streaming

ב־Streaming של תשובות, הטקסט מוצג בתחושת "הדפסה" (typewriter-like):

- התוכן נבנה בהדרגה
- הסמן (cursor) מודגש ובעל נוכחות גבוהה
- מתקבלת תחושה של טרמינל חי

### מה מקבל המשתמש

חוויה דינמית, "חיה", שמתאימה למי שמעדיף תחושת CLI/האקר קלאסית.

---

## Retro

### כיוון עיצובי

מראה רטרו נוסטלגי:

- פלטת צבעים בהשראת מסכי CRT
- אווירה וינטג'
- טיפוגרפיה מונוספייס עם אופי ישן

### אפקטים ויזואליים

- פסי סריקה עדינים (scanlines)
- שכבת עומק קלה המדמה מסך ישן
- מראה "מכאני" יותר ופחות מודרני

### מה מקבל המשתמש

חוויה ייחודית ומובחנת, עם אופי ויזואלי עשיר ומעט משחקי.

---

## Zen

### כיוון עיצובי

מראה נקי ומרגיע:

- מינימליסטי
- צבעוניות רגועה
- פחות רעש ויזואלי

### התנהגות אנימציות

- אנימציות עדינות ורכות יותר
- מעברים חלקים בין מצבים
- קצב "נשימה" איטי ונעים יותר באלמנטים חיים

### מה מקבל המשתמש

חוויית קריאה יציבה, רגועה ונעימה לאורך זמן.

---

## Neo Zen

### כיוון עיצובי

מראה שמבוסס על Zen אבל עם נגיעה עתידנית ועדינה:

- פלטה קרירה ועדינה בגווני כחול-טורקיז
- מראה חלק יותר עם תחושת "glass" רכה
- עדיין מינימליסטי, בלי אפקטים בולטים או אגרסיביים

### התנהגות אנימציות

- מעברים מעט חלקים יותר (easing רך)
- דגש קל על glow עדין בסמן/אינדיקטורים
- שומר על קצב רגוע לקריאה ממושכת

### מה מקבל המשתמש

תחושת Zen מודרנית יותר: נקי, שקט, אבל עם אופי טכנולוגי רך.

---

## התנהגות בזמן שימוש

## שינוי Theme בזמן אמת

כאשר המשתמש מחליף Theme:

- השינוי מוחל מיידית על ה־Webview
- אין צורך בריענון
- אין צורך בסגירה/פתיחה של חלון הצ'אט

## השפעה על היסטוריה והודעות קיימות

ה־Theme משפיע על שכבת התצוגה, לכן:

- גם הודעות קיימות מקבלות את המראה החדש
- גם הודעות חדשות נצבעות לפי אותו Theme

## השפעה על תוכן

הפיצ'ר לא משנה תוכן:

- לא משנה טקסטים של Claude
- לא משנה Markdown/קוד
- לא משנה לוגיקה של שיחה

רק מציג אותם בצורה שונה.

---

## שמירת ההעדפה (Persistence)

בחירת Theme נשמרת בהגדרות התוסף (`claudeMirror.typingTheme`).

התוצאה בפועל:

- אם סוגרים את הטאב ופותחים שוב, ה־Theme נשאר
- אם סוגרים את VS Code ופותחים שוב, ה־Theme נשאר
- אם משנים את ההגדרה דרך Settings של VS Code, ה־Webview מסתנכרן

---

## חוויית משתמש צפויה מקצה לקצה

תסריט טיפוסי:

1. משתמש פותח Text Settings (`Aa`)
2. בוחר `Theme = Retro`
3. מיד רואה שינוי ויזואלי בצ'אט
4. ממשיך לשוחח; ה־Streaming וההודעות מוצגים בסגנון Retro
5. סוגר ופותח מחדש את הסשן/VS Code
6. מקבל שוב את אותו Theme שנשמר

---

## גבולות הפיצ'ר ומה הוא לא עושה

- הפיצ'ר לא מחליף מודל Claude
- הפיצ'ר לא משפיע על עלות/טוקנים
- הפיצ'ר לא משנה Permission Mode
- הפיצ'ר לא משנה את תוכן ההודעות, רק את אופן ההצגה

---

## בדיקות קבלה מומלצות

1. לפתוח `Aa` ולוודא ששדה `Theme` קיים.
2. לבחור כל אחת מ־4 האפשרויות ולוודא שינוי מיידי.
3. לשלוח הודעה ולוודא שה־Streaming נראה בהתאם ל־Theme הנבחר.
4. לסגור ולפתוח מחדש VS Code ולוודא שה־Theme נשמר.
5. לשנות Theme דרך Settings של VS Code ולוודא שהצ'אט מתעדכן.

---

## סיכום

Typing Personality Themes הוא פיצ'ר UX שמעשיר את חוויית הקריאה בצ'אט:

- נותן שליטה למשתמש על "האווירה" של התשובות
- מגיב מיידית בזמן אמת
- נשמר בין סשנים
- מבודד לשכבת התצוגה בלבד, בלי לשנות לוגיקה עסקית או תוכן
