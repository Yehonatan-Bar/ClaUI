import React, { useState, useCallback, useMemo } from 'react';

/** Lines shown when code block is collapsed */
const COLLAPSED_LINE_COUNT = 4;

interface CodeBlockProps {
  code: string;
  language?: string;
}

/**
 * Renders a fenced code block with language label, copy button, and
 * collapse/expand for long blocks. Blocks longer than COLLAPSED_LINE_COUNT
 * start collapsed to keep the chat compact.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => code.split('\n'), [code]);
  const isLong = lines.length > COLLAPSED_LINE_COUNT;
  const [expanded, setExpanded] = useState(!isLong);

  const visibleCode = expanded ? code : lines.slice(0, COLLAPSED_LINE_COUNT).join('\n');
  const hiddenLineCount = lines.length - COLLAPSED_LINE_COUNT;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in webview context
      // Fall back to selection-based copy
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || 'text'}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isLong && (
            <span className="code-block-line-count">
              {lines.length} lines
            </span>
          )}
          <button
            className="copy-button"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className={`code-block-content${!expanded ? ' code-block-collapsed' : ''}`}>
        <code>{visibleCode}</code>
      </pre>
      {isLong && (
        <button
          className="code-block-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show ${hiddenLineCount} more lines`}
        </button>
      )}
    </div>
  );
};
