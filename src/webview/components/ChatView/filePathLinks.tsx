import React from 'react';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Regex to match file paths in text content.
 *
 * Matches these patterns:
 * 1. Windows absolute: C:\path\to\file.ext or C:/path/to/file.ext
 * 2. Unix absolute: /path/to/file.ext
 * 3. Relative paths: src/file.ext, ./file.ext, ../dir/file.ext
 *
 * All paths must contain at least one slash/backslash and end with a file
 * extension (dot + 1-10 alphanumeric chars). An optional :line_number suffix
 * is captured (e.g., file.ts:42 or file.ts:42:10).
 *
 * Lookahead prevents consuming trailing punctuation that is not part of the path.
 */
const FILE_PATH_REGEX =
  /(?:[A-Za-z]:[/\\](?:[^\s:*?"<>|])+\.\w{1,10}|(?:\.{0,2}\/|\/)(?:[^\s:*?"<>|])+\.\w{1,10}|(?:[a-zA-Z_][\w.-]*\/)+[a-zA-Z_][\w.-]*\.\w{1,10})(?::\d+(?::\d+)?)?(?=[\s)}\]>,;:'"!?`]|$)/g;

/**
 * Regex to match URLs in text content.
 *
 * Matches http:// and https:// URLs. Stops at whitespace or common
 * trailing punctuation that is unlikely to be part of the URL.
 * Handles balanced parentheses (common in Wikipedia URLs).
 */
const URL_REGEX =
  /https?:\/\/[^\s<>"'`]+(?:\([^\s<>"'`]*\))*[^\s<>"'`.,;:!?)}\]]/g;

/** Post the openFile message to VS Code extension host */
function openFileInEditor(filePath: string): void {
  postToExtension({ type: 'openFile', filePath });
}

/** Post the openUrl message to VS Code extension host */
function openUrlInBrowser(url: string): void {
  postToExtension({ type: 'openUrl', url });
}

/**
 * Represents a detected link in text - either a file path or a URL.
 */
interface DetectedLink {
  index: number;
  length: number;
  type: 'filePath' | 'url';
  text: string;
}

/**
 * Find all file paths and URLs in text, returning them sorted by position.
 * Overlapping matches are resolved by preferring the earlier/longer match.
 */
function detectAllLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = [];

  // Detect file paths
  FILE_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
    links.push({
      index: match.index,
      length: match[0].length,
      type: 'filePath',
      text: match[0],
    });
  }

  // Detect URLs
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    links.push({
      index: match.index,
      length: match[0].length,
      type: 'url',
      text: match[0],
    });
  }

  // Sort by position
  links.sort((a, b) => a.index - b.index);

  // Remove overlapping matches (keep the first/longer one)
  const filtered: DetectedLink[] = [];
  let lastEnd = 0;
  for (const link of links) {
    if (link.index >= lastEnd) {
      filtered.push(link);
      lastEnd = link.index + link.length;
    }
  }

  return filtered;
}

/**
 * Parse text and replace file paths and URLs with clickable links.
 * Returns an array of React nodes (strings, FilePathLink spans, and URL spans).
 */
export function renderTextWithFileLinks(text: string): React.ReactNode[] {
  const links = detectAllLinks(text);

  if (links.length === 0) {
    return [text];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const link of links) {
    // Text before the match
    if (link.index > lastIndex) {
      nodes.push(text.slice(lastIndex, link.index));
    }

    if (link.type === 'filePath') {
      nodes.push(
        <span
          key={`fp-${link.index}`}
          className="file-path-link"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              e.stopPropagation();
              openFileInEditor(link.text);
            }
          }}
          title={`Ctrl+Click to open ${link.text}`}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === ' ')) {
              openFileInEditor(link.text);
            }
          }}
        >
          {link.text}
        </span>
      );
    } else {
      // URL link - single click to open in browser
      nodes.push(
        <span
          key={`url-${link.index}`}
          className="url-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openUrlInBrowser(link.text);
          }}
          title={link.text}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              openUrlInBrowser(link.text);
            }
          }}
        >
          {link.text}
        </span>
      );
    }

    lastIndex = link.index + link.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
