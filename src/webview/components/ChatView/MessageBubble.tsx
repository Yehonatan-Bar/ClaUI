import React, { useState, useCallback } from 'react';
import type { ChatMessage } from '../../state/store';
import type { ContentBlock } from '../../../extension/types/stream-json';
import { CodeBlock } from './CodeBlock';
import { ToolUseBlock } from './ToolUseBlock';
import { useRtlDetection } from '../../hooks/useRtlDetection';
import { renderTextWithFileLinks } from './filePathLinks';

interface MessageBubbleProps {
  message: ChatMessage;
  isBusy?: boolean;
  onEditAndResend?: (messageId: string, newText: string) => void;
}

/**
 * Renders a single completed message (user or assistant).
 * User messages show an Edit button on hover (hidden while assistant is busy).
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isBusy, onEditAndResend }) => {
  const isUser = message.role === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Defensive: normalize content to array in case it arrives as a string
  const contentBlocks: ContentBlock[] = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content) }];

  const textContent = extractTextContent(contentBlocks);
  const { direction } = useRtlDetection(textContent);

  // Only text-only user messages are editable (not images)
  const hasOnlyText = isUser && contentBlocks.every((b) => b.type === 'text');
  const canEdit = hasOnlyText && !isBusy && !!onEditAndResend;

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!textContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textContent;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [textContent]);

  const handleEditClick = () => {
    setEditText(textContent);
    setIsEditing(true);
    // Focus the textarea after render
    requestAnimationFrame(() => editTextareaRef.current?.focus());
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditText('');
  };

  const handleEditSend = () => {
    const trimmed = editText.trim();
    if (!trimmed || !onEditAndResend) return;
    setIsEditing(false);
    setEditText('');
    onEditAndResend(message.id, trimmed);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSend();
    }
    if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-role">
        {isUser ? 'You' : 'Assistant'}
        {message.model && (
          <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>
            {message.model}
          </span>
        )}
        {textContent && (
          <button
            className="copy-message-btn"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
        {canEdit && !isEditing && (
          <button
            className="edit-message-btn"
            onClick={handleEditClick}
            title="Edit and resend this message"
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="edit-message-area">
          <textarea
            ref={editTextareaRef}
            className="edit-message-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            rows={3}
          />
          <div className="edit-message-buttons">
            <button className="edit-message-send" onClick={handleEditSend} disabled={!editText.trim()}>
              Send
            </button>
            <button className="edit-message-cancel" onClick={handleEditCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div dir={direction}>
          {contentBlocks.map((block, index) => (
            <ContentBlockRenderer key={index} block={block} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Renders a single content block based on its type */
const ContentBlockRenderer: React.FC<{ block: ContentBlock }> = ({ block }) => {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer text={block.text || ''} />;

    case 'image':
      return <ImageBlockRenderer block={block} />;

    case 'tool_use':
      return (
        <ToolUseBlock
          toolName={block.name || 'unknown'}
          input={block.input}
          isStreaming={false}
        />
      );

    case 'tool_result':
      return (
        <ToolResultRenderer
          content={block.content}
          isError={block.is_error}
        />
      );

    default:
      return null;
  }
};

/** Renders an image content block */
const ImageBlockRenderer: React.FC<{ block: ContentBlock }> = ({ block }) => {
  if (!block.source?.data || !block.source?.media_type) return null;

  return (
    <div className="message-image">
      <img
        src={`data:${block.source.media_type};base64,${block.source.data}`}
        alt="Attached image"
      />
    </div>
  );
};

/** Renders text content, splitting out code blocks */
const TextBlockRenderer: React.FC<{ text: string }> = ({ text }) => {
  const segments = parseTextWithCodeBlocks(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <CodeBlock
            key={index}
            code={segment.content}
            language={segment.language}
          />
        ) : (
          <div
            key={index}
            className="text-content"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {renderTextWithFileLinks(segment.content)}
          </div>
        )
      )}
    </>
  );
};

/** Renders a tool_result block with collapsible body (collapsed by default) */
const ToolResultRenderer: React.FC<{
  content?: string | ContentBlock[];
  isError?: boolean;
}> = ({ content, isError }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (!content) return null;

  const textContent =
    typeof content === 'string'
      ? content
      : content
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join('\n');

  return (
    <div
      className="tool-use-block"
      style={
        isError
          ? { borderColor: 'var(--vscode-inputValidation-errorBorder, #be1100)' }
          : undefined
      }
    >
      <div
        className="tool-use-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer' }}
      >
        <span className={`tool-collapse-indicator${isCollapsed ? '' : ' expanded'}`} />
        <span style={{ opacity: 0.7 }}>
          {isError ? 'Error' : 'Result'}
        </span>
      </div>
      {!isCollapsed && (
        <div className="tool-use-body">{renderTextWithFileLinks(textContent)}</div>
      )}
    </div>
  );
};

// --- Helpers ---

interface TextSegment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

/** Parse text into alternating text/code segments */
function parseTextWithCodeBlocks(text: string): TextSegment[] {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }
    // Code block
    segments.push({
      type: 'code',
      content: match[2],
      language: match[1] || undefined,
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

/** Extract all text content from a content block array for RTL detection */
function extractTextContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join(' ');
}
