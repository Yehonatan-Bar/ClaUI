# Bug: File Paths in Backticks Not Clickable

## Problem

File paths and URLs wrapped in backticks (inline code) appeared as plain text and were not clickable links. Since Claude almost always formats file paths inside backticks (e.g., `` `C:\projects\file.html` ``), most file paths in chat messages were not clickable.

## Root Cause

The `linkifyTextNodes()` function in `MarkdownContent.tsx` uses a DOM `TreeWalker` to find text nodes and wrap file paths/URLs with clickable `<span>` elements. However, at line 50, it explicitly skips text nodes inside `<code>`, `<pre>`, and `<a>` elements:

```typescript
if (tag === 'code' || tag === 'pre' || tag === 'a') return NodeFilter.FILTER_REJECT;
```

When Claude outputs a backtick-wrapped path like `` `C:\projects\file.html` ``, the `marked` library renders it as `<code>C:\projects\file.html</code>`. The TreeWalker skips the text node inside `<code>`, so the path is never linkified.

The skip was intentional to avoid mangling code samples (e.g., you wouldn't want `src/utils/helper.ts` inside a multi-word code snippet to become a link). But it had the side effect of making standalone file paths in backticks non-clickable.

## Fix

Added a new function `linkifyCodeElements()` that runs before `linkifyTextNodes()`. It:

1. Queries all inline `<code>` elements (excluding those inside `<pre>` blocks)
2. Checks if the **entire** text content of the `<code>` element matches `FILE_PATH_REGEX` or `URL_REGEX`
3. If it matches, adds the `file-path-link` or `url-link` CSS class directly to the `<code>` element, plus `data-path`/`data-url` attributes

This makes the `<code>` element itself clickable while preserving its inline code styling (background, font). The existing click handler already checks for `classList.contains('file-path-link')`, so it picks up clicks on these elements without any changes.

Only `<code>` elements whose **entire** content is a single path/URL are linkified. Multi-word code snippets that happen to contain a path substring are left alone.

## Files Modified

| File | Change |
|------|--------|
| `src/webview/components/ChatView/MarkdownContent.tsx` | Added `linkifyCodeElements()` function, called in `useEffect` before `linkifyTextNodes()` |
| `src/webview/styles/markdown.css` | Added styles for `code.file-path-link` and `code.url-link` (link color, underline, hover) |

## Visual Result

Before: `C:\projects\file.html` appeared as plain monospace text
After: `C:\projects\file.html` appears as underlined blue monospace text, clickable to open the file
