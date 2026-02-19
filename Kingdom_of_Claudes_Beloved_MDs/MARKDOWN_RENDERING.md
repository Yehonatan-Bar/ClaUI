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
  +-- code segments --> CodeBlock component (copy, collapse, language label)
  |
  +-- text segments --> MarkdownContent component
                          |
                          marked.parse(text) --> raw HTML string
                          |
                          DOMPurify.sanitize(html) --> safe HTML string
                          |
                          dangerouslySetInnerHTML --> rendered DOM
                          |
                          useEffect: linkifyTextNodes() --> bare file paths/URLs become clickable
                          useEffect: event delegation --> click handler for all link types
```

### Why This Architecture

1. **Fenced code blocks are extracted BEFORE Markdown parsing.** This preserves the existing `CodeBlock` component with its copy button, collapse/expand, and file path detection. `marked` never sees fenced code blocks.

2. **`marked` + `DOMPurify` instead of `react-markdown`.** The `react-markdown` ecosystem pulls in 15+ packages (~80-120KB). `marked` is a single ~40KB dependency. Combined with `DOMPurify` (~15KB), the total is ~55KB.

3. **`dangerouslySetInnerHTML` is safe** because all HTML is sanitized through DOMPurify with an explicit whitelist of allowed tags and attributes.

4. **File path detection uses DOM post-processing** instead of the React-based `renderTextWithFileLinks()`. Since `marked` produces an HTML string (not React nodes), we walk the rendered DOM's text nodes to detect and wrap file paths and URLs after render.

## MarkdownContent Component

### Configuration

- `marked` options: `gfm: true` (GitHub Flavored Markdown), `breaks: true` (newlines become `<br>`)
- Custom renderer overrides for `link` (adds `data-href` and `class="md-link"`) and `codespan` (adds `class="md-inline-code"`)
- DOMPurify whitelist: `p, br, strong, em, del, a, code, pre, h1-h6, ul, ol, li, blockquote, table, thead, tbody, tr, th, td, hr, span, div, sup, sub, input`

### Link Handling (3 types)

1. **Markdown links** (`[text](url)`) - Rendered by `marked` as `<a class="md-link" data-href="...">`. Click handler checks if URL or file path, routes to `openUrl` or `openFile`.

2. **Bare file paths** - Detected post-render by `linkifyTextNodes()` using `FILE_PATH_REGEX`. Wrapped in `<span class="file-path-link">`. Ctrl+Click opens in VS Code editor.

3. **Bare URLs** - Detected post-render by `linkifyTextNodes()` using `URL_REGEX`. Wrapped in `<span class="url-link">`. Single click opens in browser.

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
