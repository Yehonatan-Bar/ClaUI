import React, { useState, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../../state/store';
import { useAppStore } from '../../state/store';
import type { TurnCategory } from '../../../extension/types/webview-messages';
import type { ContentBlock } from '../../../extension/types/stream-json';
import { CodeBlock } from './CodeBlock';
import { ToolUseBlock } from './ToolUseBlock';
import { AGENT_TOOLS } from './AgentSpawnBlock';
import { TEAM_TOOLS } from './TeamInlineWidget';
import { DiffViewer } from './DiffViewer';
import { MarkdownContent } from './MarkdownContent';
import { renderTextWithFileLinks } from './filePathLinks';
import { postToExtension } from '../../hooks/useClaudeStream';
import { deriveTurnFromAssistantMessage } from '../../utils/turnVitals';
import { resolveDir } from '../../hooks/useRtlDetection';
import { getClaudeModelLabel } from '../../utils/claudeModelDisplay';

interface MessageBubbleProps {
  message: ChatMessage;
  isBusy?: boolean;
  onEditAndResend?: (messageId: string, newText: string) => void;
  onFork?: (messageId: string, messageText: string) => void;
  onCheckpointRevert?: (messageId: string) => void;
  onCheckpointRedo?: (messageId: string) => void;
}

/**
 * Renders a single completed message (user or assistant).
 * User messages show an Edit button on hover (hidden while assistant is busy).
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isBusy, onEditAndResend, onFork, onCheckpointRevert, onCheckpointRedo }) => {
  const isUser = message.role === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Defensive: normalize content to array in case it arrives as a string
  const contentBlocks: ContentBlock[] = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content) }];

  const textContent = extractTextContent(contentBlocks);
  const providerCapabilities = useAppStore((s) => s.providerCapabilities);

  // Only text-only user messages are editable (not images)
  const hasOnlyText = isUser && contentBlocks.every((b) => b.type === 'text');
  const canEdit = hasOnlyText && !isBusy && !!onEditAndResend;
  const canFork = isUser && hasOnlyText && !!onFork && providerCapabilities.supportsFork;

  // Checkpoint revert/redo state
  const checkpointState = useAppStore((s) => s.checkpointState);
  const allMessages = useAppStore((s) => s.messages);
  const checkpointTurnIndex = useMemo(() => {
    if (!isUser || !checkpointState) return null;
    const myIdx = allMessages.findIndex(m => m.id === message.id);
    if (myIdx < 0) return null;
    // Find the boundary: next user message or end of array
    const nextUserIdx = allMessages.findIndex((m, i) => i > myIdx && m.role === 'user');
    const endIdx = nextUserIdx >= 0 ? nextUserIdx : allMessages.length;
    // Check ALL assistant messages in this turn (there can be multiple:
    // one with tool_use blocks, one with the text response after tool execution)
    for (let i = myIdx + 1; i < endIdx; i++) {
      if (allMessages[i].role === 'assistant') {
        const cp = checkpointState.checkpoints.find(c => c.messageId === allMessages[i].id);
        if (cp) return cp.turnIndex;
      }
    }
    return null;
  }, [isUser, checkpointState, allMessages, message.id]);

  const canRevert = checkpointTurnIndex !== null && !isBusy
    && (checkpointState?.revertedToIndex === null
        || checkpointTurnIndex < checkpointState!.revertedToIndex!);

  const isInRevertedRange = useMemo(() => {
    if (!checkpointState || checkpointState.revertedToIndex === null) return false;
    // For user messages: check if the turn for this user message is in the reverted range
    if (isUser) {
      return checkpointTurnIndex !== null && checkpointTurnIndex >= checkpointState.revertedToIndex;
    }
    // For assistant messages: check if there's a checkpoint with this message's id in reverted range
    const cp = checkpointState.checkpoints.find(c => c.messageId === message.id);
    return cp !== undefined && cp.turnIndex >= checkpointState.revertedToIndex;
  }, [checkpointState, checkpointTurnIndex, isUser, message.id]);

  const canRedo = isUser && isInRevertedRange && !isBusy && checkpointTurnIndex !== null;

  // Translation state from store
  const translations = useAppStore((s) => s.translations);
  const translatingMessageIds = useAppStore((s) => s.translatingMessageIds);
  const showingTranslation = useAppStore((s) => s.showingTranslation);
  const toggleTranslationView = useAppStore((s) => s.toggleTranslationView);
  const translationLanguage = useAppStore((s) => s.translationLanguage);

  const babelFishEnabled = useAppStore((s) => s.babelFishEnabled);
  const userOriginalText = useAppStore((s) => s.userOriginalTexts[message.id]);
  const translationError = useAppStore((s) => s.translationErrors[message.id]);
  const isTranslating = translatingMessageIds.has(message.id);
  const hasTranslation = message.id in translations;
  const isShowingTranslation = showingTranslation.has(message.id);
  const isRtlLanguage = translationLanguage === 'Hebrew' || translationLanguage === 'Arabic';
  const forceLtr = useAppStore((s) => s.messageForcedLtr.has(message.id));
  const toggleMessageForcedLtr = useAppStore((s) => s.toggleMessageForcedLtr);
  const rtlLanguageDir: 'rtl' | 'ltr' | 'auto' = forceLtr ? 'ltr' : (isRtlLanguage ? 'rtl' : 'auto');

  // Summary Mode: hide tool blocks in messages (animation lives in the persistent SummaryModeWidget)
  const summaryModeEnabled = useAppStore((s) => s.summaryModeEnabled);
  const messageToolCount = useMemo(() => contentBlocks.filter(b => b.type === 'tool_use').length, [contentBlocks]);
  const shouldShowSummaryMode = summaryModeEnabled && !isUser && messageToolCount > 0;

  // Chat Search: highlight matching messages
  const isSearchActive = useAppStore((s) => s.chatSearchOpen && s.chatSearchScope === 'session');
  const isSearchMatch = useAppStore((s) => s.chatSearchOpen && s.chatSearchMatchIds.includes(message.id));
  const isCurrentSearchMatch = useAppStore((s) =>
    s.chatSearchOpen && s.chatSearchMatchIds[s.chatSearchCurrentIndex] === message.id
  );

  // Session Vitals: turn intensity border
  const vitalsEnabled = useAppStore((s) => s.vitalsEnabled);
  const turnData = useAppStore((s) => s.turnByMessageId[message.id]);
  const resolvedTurnData = useMemo(
    () => turnData || deriveTurnFromAssistantMessage(message, 0) || undefined,
    [turnData, message]
  );

  // Category colors with alpha variants for intensity: [full, medium, light]
  const INTENSITY_COLORS: Record<TurnCategory, [string, string, string]> = {
    success:      ['#4caf50', '#4caf50b3', '#4caf5066'],
    error:        ['#f44336', '#f44336b3', '#f4433666'],
    discussion:   ['#2196f3', '#2196f3b3', '#2196f366'],
    'code-write': ['#9c27b0', '#9c27b0b3', '#9c27b066'],
    research:     ['#ff9800', '#ff9800b3', '#ff980066'],
    command:      ['#00bcd4', '#00bcd4b3', '#00bcd466'],
    skill:        ['#e040fb', '#e040fbb3', '#e040fb66'],
  };

  const vitalsBorderStyle = useMemo((): React.CSSProperties | undefined => {
    if (!vitalsEnabled || !resolvedTurnData || isUser) return undefined;
    const colors = INTENSITY_COLORS[resolvedTurnData.category];
    const count = resolvedTurnData.toolCount;
    // 0 tools = thin/light, 1-3 = medium, 4+ = thick/full
    const width = count === 0 ? 2 : count <= 3 ? 3 : 4;
    const color = count === 0 ? colors[2] : count <= 3 ? colors[1] : colors[0];
    return { borderLeft: `${width}px solid ${color}` };
  }, [vitalsEnabled, resolvedTurnData, isUser]);

  const intensityTooltip = useMemo((): string | undefined => {
    if (!vitalsBorderStyle || !resolvedTurnData) return undefined;
    const catLabels: Record<TurnCategory, string> = {
      success: 'Success', error: 'Error', discussion: 'Discussion',
      'code-write': 'Code-write', research: 'Research', command: 'Command',
      skill: 'Skill',
    };
    const cat = catLabels[resolvedTurnData.category];
    const n = resolvedTurnData.toolCount;
    const w = n === 0 ? 'thin' : n <= 3 ? 'medium' : 'thick';
    return `Intensity Border: ${cat} turn, ${n} tools (${w})\n\nColors:\nGreen = success\nRed = error\nBlue = discussion (no tools)\nPurple = code-write\nOrange = research\nCyan = command\nMagenta = skill\n\nWidth: thin = 0 tools, medium = 1-3, thick = 4+`;
  }, [vitalsBorderStyle, resolvedTurnData]);

  const handleTranslate = useCallback(() => {
    if (hasTranslation) {
      toggleTranslationView(message.id);
      return;
    }
    // Extract text content, excluding code blocks
    const translatableText = extractTranslatableText(contentBlocks);
    if (!translatableText.trim()) return;

    useAppStore.getState().setTranslating(message.id, true);
    postToExtension({
      type: 'translateMessage',
      messageId: message.id,
      textContent: translatableText,
      language: translationLanguage,
    });
  }, [message.id, hasTranslation, contentBlocks, toggleTranslationView, translationLanguage]);

  // Check if this assistant message has any collapsible blocks
  const hasCollapsibles = useMemo(() => {
    return !isUser && contentBlocks.some(b => b.type === 'tool_use' || b.type === 'tool_result');
  }, [isUser, contentBlocks]);

  const [allExpanded, setAllExpanded] = useState(false);

  // Toggle ALL collapsible blocks across the entire chat interface
  const handleToggleAll = useCallback(() => {
    const chatContainer = document.querySelector('.message-list') || document.body;
    const indicators = Array.from(chatContainer.querySelectorAll('.tool-collapse-indicator'));
    if (indicators.length === 0) return;

    const anyCollapsed = indicators.some(el => !el.classList.contains('expanded'));
    indicators.forEach(el => {
      const isExpanded = el.classList.contains('expanded');
      const header = el.closest('.tool-use-header') as HTMLElement | null;
      if (!header) return;
      if (anyCollapsed && !isExpanded) header.click();
      else if (!anyCollapsed && isExpanded) header.click();
    });
    setAllExpanded(anyCollapsed);
  }, []);

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
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}${isSearchMatch ? ' search-match' : ''}${isCurrentSearchMatch ? ' search-current-match' : ''}${isInRevertedRange ? ' message-reverted' : ''}`} data-message-id={message.id} style={vitalsBorderStyle}>
      {vitalsBorderStyle && (
        <div
          className="intensity-border-zone"
          data-tooltip={intensityTooltip}
        />
      )}
      <div className="message-role">
        {isUser ? 'You' : 'Assistant'}
        {message.timestamp && (
          <span className="message-timestamp">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {message.model && (
          <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>
            {getClaudeModelLabel(message.model)}
          </span>
        )}
        {!isUser && message.thinkingEffort && (
          <span className={`thinking-effort-badge thinking-effort-${message.thinkingEffort}`}>
            {message.thinkingEffort}
          </span>
        )}
        {textContent && (
          <button
            className="copy-message-btn"
            onClick={handleCopy}
            data-tooltip="Copy to clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
        {textContent && (
          <button
            className={`alignment-message-btn${forceLtr ? ' forced-ltr' : ''}`}
            onClick={() => toggleMessageForcedLtr(message.id)}
            data-tooltip={forceLtr ? 'Restore automatic alignment' : 'Force left alignment for this message'}
          >
            {forceLtr ? 'Auto' : 'LTR'}
          </button>
        )}
        {hasCollapsibles && !shouldShowSummaryMode && (
          <button
            className="toggle-all-btn"
            onClick={handleToggleAll}
            data-tooltip={allExpanded ? 'Collapse all blocks' : 'Expand all blocks'}
          >
            <span className={`toggle-all-arrows${allExpanded ? ' expanded' : ''}`} />
          </button>
        )}
        {canEdit && !isEditing && (
          <button
            className="edit-message-btn"
            onClick={handleEditClick}
            data-tooltip="Edit and resend this message"
          >
            Edit
          </button>
        )}
        {canFork && !isEditing && (
          <button
            className="fork-message-btn"
            onClick={() => onFork!(message.id, textContent)}
            data-tooltip="Fork conversation from this message"
          >
            Fork
          </button>
        )}
        {canRevert && !isEditing && (
          <button
            className="checkpoint-revert-btn"
            onClick={() => onCheckpointRevert?.(message.id)}
            data-tooltip="Revert file changes from this prompt onwards"
          >
            Revert
          </button>
        )}
        {canRedo && !isEditing && (
          <button
            className="checkpoint-redo-btn"
            onClick={() => onCheckpointRedo?.(message.id)}
            data-tooltip="Re-apply file changes"
          >
            Redo
          </button>
        )}
        {!isUser && textContent && providerCapabilities.supportsTranslation && !babelFishEnabled && (
          <button
            className={`translate-message-btn${isShowingTranslation ? ' showing-translation' : ''}${isTranslating ? ' translating' : ''}${translationError ? ' translation-error' : ''}`}
            onClick={handleTranslate}
            data-tooltip={translationError ? `Translation failed - click to retry` : isShowingTranslation ? 'Show original' : `Translate to ${translationLanguage}`}
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : translationError ? 'Retry' : isShowingTranslation ? 'Original' : translationLanguage}
          </button>
        )}
        {!isUser && babelFishEnabled && (hasTranslation || isTranslating) && (
          <button
            className={`translate-message-btn${isShowingTranslation ? ' showing-translation' : ''}${isTranslating ? ' translating' : ''}`}
            onClick={() => toggleTranslationView(message.id)}
            data-tooltip={isShowingTranslation ? 'Show original (English)' : `Show ${translationLanguage}`}
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : isShowingTranslation ? 'Original' : translationLanguage}
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
            <button className="edit-message-send" onClick={handleEditSend} disabled={!editText.trim()} data-tooltip="Send edited message">
              Send
            </button>
            <button className="edit-message-cancel" onClick={handleEditCancel} data-tooltip="Cancel editing">
              Cancel
            </button>
          </div>
        </div>
      ) : isUser && userOriginalText ? (
        <div className="babel-fish-user-message">
          <div className="babel-fish-user-line" dir={rtlLanguageDir}>
            <span className="babel-fish-user-label">You wrote:</span>
            <TextBlockRenderer text={userOriginalText} forceLtr={forceLtr} />
          </div>
          <div className="babel-fish-user-line">
            <span className="babel-fish-user-label">Claude Code received:</span>
            <TextBlockRenderer text={textContent} forceLtr={forceLtr} />
          </div>
        </div>
      ) : isShowingTranslation ? (
        <div dir={rtlLanguageDir}>
          <TextBlockRenderer text={translations[message.id]} forceLtr={forceLtr} />
          {contentBlocks
            .filter((block) => block.type !== 'text')
            .map((block, index) => (
              <ContentBlockRenderer key={`orig-${index}`} block={block} forceLtr={forceLtr} />
            ))}
        </div>
      ) : shouldShowSummaryMode ? (
        <div dir={resolveDir(textContent, forceLtr)}>
          {contentBlocks.filter(b => b.type === 'text').map((block, i) => (
            <ContentBlockRenderer key={`text-${i}`} block={block} forceLtr={forceLtr} />
          ))}
        </div>
      ) : (
        <ContentBlockList contentBlocks={contentBlocks} forceLtr={forceLtr} />
      )}
    </div>
  );
};

/**
 * Renders content blocks with agent tool_use -> tool_result pairing.
 * For agent/team tools, the tool_result is inlined into the agent card
 * and suppressed from rendering as a standalone block.
 */
const ContentBlockList: React.FC<{ contentBlocks: ContentBlock[]; forceLtr: boolean }> = ({ contentBlocks, forceLtr }) => {
  // Pre-compute: map agent tool_use ids -> their matching tool_result blocks
  const { pairMap, pairedResultIds } = useMemo(() => {
    const map = new Map<string, ContentBlock>();
    const ids = new Set<string>();
    for (const block of contentBlocks) {
      if (block.type === 'tool_use' && block.id && RESULT_PAIRED_TOOLS.has(block.name || '')) {
        const result = contentBlocks.find(
          (b) => b.type === 'tool_result' && b.tool_use_id === block.id
        );
        if (result) {
          map.set(block.id, result);
          if (result.tool_use_id) ids.add(result.tool_use_id);
        }
      }
    }
    return { pairMap: map, pairedResultIds: ids };
  }, [contentBlocks]);

  const blockText = useMemo(
    () => contentBlocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join(' '),
    [contentBlocks]
  );
  const effectiveDir = resolveDir(blockText, forceLtr);

  return (
    <div dir={effectiveDir}>
      {contentBlocks.map((block, index) => (
        <ContentBlockRenderer
          key={index}
          block={block}
          pairedResult={block.type === 'tool_use' && block.id ? pairMap.get(block.id) : undefined}
          pairedResultIds={pairedResultIds}
          forceLtr={forceLtr}
        />
      ))}
    </div>
  );
};

/** Tools that write/modify files and can show diffs */
const DIFF_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** All special tool sets that need result pairing */
const RESULT_PAIRED_TOOLS = new Set([...AGENT_TOOLS, ...TEAM_TOOLS]);

/**
 * Renders a tool_use block, adding an inline DiffViewer below it when
 * detailed diff mode is enabled for Write/Edit/MultiEdit tools.
 * For Agent/Team tools, pairs with the matching tool_result.
 */
const ToolUseWithDiff: React.FC<{ block: ContentBlock; pairedResult?: ContentBlock }> = ({ block, pairedResult }) => {
  const detailedDiffEnabled = useAppStore((s) => s.detailedDiffEnabled);
  const writeOldContentByToolId = useAppStore((s) => s.writeOldContentByToolId);

  const toolName = block.name || 'unknown';
  const input = block.input as Record<string, unknown> | undefined;

  // For agent/team tools, build a toolResult prop from the paired result block
  const agentToolResult = pairedResult && RESULT_PAIRED_TOOLS.has(toolName)
    ? {
        content: pairedResult.content as string | Array<{ type: string; text?: string }>,
        isError: pairedResult.is_error === true,
      }
    : undefined;

  const toolUseBlock = (
    <ToolUseBlock
      toolName={toolName}
      input={block.input}
      isStreaming={false}
      toolResult={agentToolResult}
    />
  );

  if (!detailedDiffEnabled || !DIFF_TOOLS.has(toolName) || !input) {
    return toolUseBlock;
  }

  // Build diffs depending on tool type
  const diffs: Array<{ filePath: string; oldContent: string; newContent: string }> = [];

  if (toolName === 'Edit') {
    const filePath = (input.file_path as string) || '';
    const oldStr = (input.old_string as string) ?? '';
    const newStr = (input.new_string as string) ?? '';
    if (filePath) {
      diffs.push({ filePath, oldContent: oldStr, newContent: newStr });
    }
  } else if (toolName === 'MultiEdit') {
    const filePath = (input.file_path as string) || '';
    const edits = Array.isArray(input.edits) ? input.edits as Array<{ old_string?: string; new_string?: string }> : [];
    for (const edit of edits) {
      diffs.push({
        filePath,
        oldContent: edit.old_string ?? '',
        newContent: edit.new_string ?? '',
      });
    }
  } else if (toolName === 'Write' || toolName === 'NotebookEdit') {
    const filePath = (input.file_path as string) || (input.notebook_path as string) || '';
    const newContent = (input.content as string) ?? '';
    const toolId = (block as ContentBlock & { id?: string }).id ?? '';
    const captured = toolId ? writeOldContentByToolId[toolId] : undefined;
    const oldContent = captured?.oldContent ?? '';
    if (filePath) {
      diffs.push({ filePath, oldContent, newContent });
    }
  }

  if (diffs.length === 0) {
    return toolUseBlock;
  }

  return (
    <>
      {toolUseBlock}
      {diffs.map((d, i) => (
        <DiffViewer
          key={i}
          filePath={d.filePath}
          oldContent={d.oldContent}
          newContent={d.newContent}
        />
      ))}
    </>
  );
};

/** Renders a single content block based on its type */
const ContentBlockRenderer: React.FC<{
  block: ContentBlock;
  pairedResult?: ContentBlock;
  pairedResultIds?: Set<string>;
  forceLtr?: boolean;
}> = ({ block, pairedResult, pairedResultIds, forceLtr }) => {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer text={block.text || ''} forceLtr={forceLtr} />;

    case 'image':
      return <ImageBlockRenderer block={block} />;

    case 'tool_use':
      return <ToolUseWithDiff block={block} pairedResult={pairedResult} />;

    case 'tool_result':
      // If this result is already paired with an agent tool_use, skip standalone rendering
      if (pairedResultIds && block.tool_use_id && pairedResultIds.has(block.tool_use_id)) return null;
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

  const dataUri = `data:${block.source.media_type};base64,${block.source.data}`;

  return (
    <div className="message-image">
      <img
        src={dataUri}
        alt="Attached image"
        onClick={() => useAppStore.getState().setLightboxImageSrc(dataUri)}
      />
    </div>
  );
};

/** Renders text content, splitting out code blocks */
const TextBlockRenderer: React.FC<{ text: string; forceLtr?: boolean }> = ({ text, forceLtr }) => {
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
          <MarkdownContent key={index} text={segment.content} forceLtr={forceLtr} />
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

/**
 * Extract translatable text from content blocks.
 * Strips fenced code blocks (which should not be translated).
 */
function extractTranslatableText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => {
      const text = b.text || '';
      // Remove fenced code blocks, keep everything else
      return text.replace(/```[\w]*\n[\s\S]*?```/g, '').trim();
    })
    .join('\n\n');
}
