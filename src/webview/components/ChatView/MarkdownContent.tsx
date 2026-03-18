import React, { useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { postToExtension } from '../../hooks/useClaudeStream';
import { FILE_PATH_REGEX, URL_REGEX } from './filePathLinks';
import { detectRtl } from '../../hooks/useRtlDetection';

// Configure marked options
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Custom renderer for links and inline code
const renderer = new marked.Renderer();

renderer.link = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${title}"` : '';
  const escapedHref = href.replace(/"/g, '&quot;');
  return `<a href="${escapedHref}"${titleAttr} class="md-link" data-href="${escapedHref}">${text}</a>`;
};

renderer.codespan = function ({ text }) {
  return `<code class="md-inline-code">${text}</code>`;
};

marked.use({ renderer });

// DOMPurify configuration
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'del', 'a', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'span', 'div', 'sup', 'sub', 'input',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'data-href', 'type', 'checked', 'disabled'],
};

/**
 * Find inline <code> elements (not inside <pre>) whose entire text is a file path
 * or URL, and make them clickable by adding link classes and data attributes.
 * This handles the common case where Claude wraps file paths in backticks.
 */
function linkifyCodeElements(container: HTMLElement): void {
  const codeElements = container.querySelectorAll('code:not(pre code)');

  for (const codeEl of Array.from(codeElements)) {
    const text = (codeEl.textContent || '').trim();
    if (!text) continue;

    // Test if the entire text is a file path
    const fileRegex = new RegExp(FILE_PATH_REGEX.source);
    const fileMatch = fileRegex.exec(text);
    if (fileMatch && fileMatch.index === 0 && fileMatch[0] === text) {
      const el = codeEl as HTMLElement;
      el.classList.add('file-path-link');
      el.dataset.path = text;
      el.title = `Click to open ${text}`;
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
      continue;
    }

    // Test if the entire text is a URL
    const urlRegex = new RegExp(URL_REGEX.source);
    const urlMatch = urlRegex.exec(text);
    if (urlMatch && urlMatch.index === 0 && urlMatch[0] === text) {
      const el = codeEl as HTMLElement;
      el.classList.add('url-link');
      el.dataset.url = text;
      el.title = text;
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
    }
  }
}

/**
 * Walk text nodes in a container and wrap file paths / URLs with clickable spans.
 * Skips nodes inside <code>, <pre>, and <a> elements.
 */
function linkifyTextNodes(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (tag === 'code' || tag === 'pre' || tag === 'a') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    if (!text.trim()) continue;

    // Collect all matches with fresh regex instances
    const fileRegex = new RegExp(FILE_PATH_REGEX.source, FILE_PATH_REGEX.flags);
    const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);

    const matches: Array<{ index: number; length: number; type: 'file' | 'url'; text: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = fileRegex.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length, type: 'file', text: match[0] });
    }
    while ((match = urlRegex.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length, type: 'url', text: match[0] });
    }

    if (matches.length === 0) continue;

    // Sort by position, remove overlaps
    matches.sort((a, b) => a.index - b.index);
    const filtered = matches.filter((m, i) => {
      if (i === 0) return true;
      const prev = matches[i - 1];
      return m.index >= prev.index + prev.length;
    });

    // Build replacement fragment
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    for (const m of filtered) {
      if (m.index > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
      }
      const span = document.createElement('span');
      span.className = m.type === 'file' ? 'file-path-link' : 'url-link';
      span.textContent = m.text;
      span.setAttribute('role', 'link');
      span.tabIndex = 0;
      if (m.type === 'file') {
        span.dataset.path = m.text;
        span.title = `Click to open ${m.text}`;
      } else {
        span.dataset.url = m.text;
        span.title = m.text;
      }
      fragment.appendChild(span);
      lastEnd = m.index + m.length;
    }

    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

interface MarkdownContentProps {
  text: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ text }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const sanitizedHtml = useMemo(() => {
    const rawHtml = marked.parse(text, { async: false }) as string;
    let html = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
    // Highlight "ultrathink" keyword with randomly-chosen glow variant
    html = html.replace(
      /\b(ultrathink)\b/gi,
      () => {
        const v = Math.floor(Math.random() * 6) + 1;
        return `<span class="ultrathink-glow ut-glow-v${v}">ultrathink</span>`;
      }
    );
    return html;
  }, [text]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Linkify file paths and URLs in inline <code> elements (backtick-wrapped paths)
    linkifyCodeElements(container);

    // Linkify bare file paths and URLs in text nodes
    linkifyTextNodes(container);

    // Per-paragraph bidi: detect RTL if any Hebrew/Arabic characters are present
    container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th').forEach((el) => {
      const text = el.textContent || '';
      el.setAttribute('dir', detectRtl(text) ? 'rtl' : 'auto');
    });

    // Event delegation for clickable elements
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Markdown links
      const mdLink = target.closest('a.md-link') as HTMLAnchorElement | null;
      if (mdLink) {
        e.preventDefault();
        e.stopPropagation();
        const href = mdLink.dataset.href || mdLink.href;
        if (/^https?:\/\//.test(href)) {
          postToExtension({ type: 'openUrl', url: href });
        } else {
          postToExtension({ type: 'openFile', filePath: href });
        }
        return;
      }

      // File path links (single click)
      if (target.classList.contains('file-path-link')) {
        e.preventDefault();
        e.stopPropagation();
        postToExtension({ type: 'openFile', filePath: target.dataset.path || target.textContent || '' });
        return;
      }

      // URL links (single click)
      if (target.classList.contains('url-link')) {
        e.preventDefault();
        e.stopPropagation();
        postToExtension({ type: 'openUrl', url: target.dataset.url || target.textContent || '' });
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [sanitizedHtml]);

  return (
    <div
      ref={containerRef}
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
