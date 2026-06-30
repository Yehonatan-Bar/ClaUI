import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { StreamingText } from '../ChatView/StreamingText';
import { detectRtl } from '../../hooks/useRtlDetection';
import { WT_COLORS } from './worktreeColors';
import type { ContentBlock } from '../../../extension/types/stream-json';

/**
 * Embedded chat pane for the Merge Wizard's conflict stage. Talks to a fresh,
 * merge-focused Claude session (MergeAssistantSession) whose working directory
 * is the target checkout where the conflicts live. Reads the `mergeAssistant`
 * store slice, renders the conversation plus a live tool-activity line, and
 * after every turn asks the extension to re-read the unmerged file list so the
 * wizard's Complete gate stays in sync.
 *
 * Sits ALONGSIDE the native editor: "Open conflicted files" still works for
 * hands-on hunk editing. This component never finalizes the merge -- the
 * wizard's Complete / Abort buttons own that.
 */

const SUGGESTIONS = [
  'Which change is newer?',
  'Explain the differences',
  'Resolve all conflicts',
  'Keep both sides',
];

const container: React.CSSProperties = {
  marginTop: 12,
  border: `1px solid ${WT_COLORS.cardBorder}`,
  borderRadius: 8,
  background: WT_COLORS.inputBg,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: `1px solid ${WT_COLORS.cardBorder}`,
  fontSize: 12,
  fontWeight: 600,
  color: WT_COLORS.text,
};

const messagesArea: React.CSSProperties = {
  maxHeight: 260,
  minHeight: 96,
  overflowY: 'auto',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const roleLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: WT_COLORS.textDim,
  marginBottom: 3,
};

const msgText: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  color: WT_COLORS.text,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const activityLine: React.CSSProperties = {
  fontSize: 11.5,
  fontStyle: 'italic',
  color: WT_COLORS.accent,
  fontFamily: 'monospace',
};

const chipsRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: '8px 12px 0',
};

const inputArea: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'flex-end',
  padding: 12,
};

export const MergeAssistantChat: React.FC<{ targetPath: string }> = ({ targetPath }) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevBusyRef = useRef(false);

  const session = useAppStore((s) => s.mergeAssistant);
  const addUserMessage = useAppStore((s) => s.addMergeAssistantUserMessage);

  const isBusy = session?.isBusy ?? false;
  const sessionMessages = session?.messages ?? [];
  const streamingBlocks = session?.streamingBlocks ?? [];
  const isStreaming = !!session?.streamingMessageId && streamingBlocks.length > 0;

  // Auto-scroll to the newest content as it arrives.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionMessages, streamingBlocks]);

  // After every turn (busy -> idle), re-read the unmerged file list so the
  // wizard's conflict card and Complete gate reflect what Claude just did.
  useEffect(() => {
    if (prevBusyRef.current && !isBusy) {
      postToExtension({ type: 'refreshMergeConflicts', targetPath });
    }
    prevBusyRef.current = isBusy;
  }, [isBusy, targetPath]);

  const send = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || isBusy) {
        return;
      }
      // Optimistic echo so the user message shows before the CLI round-trips it.
      addUserMessage([{ type: 'text', text: trimmed }]);
      postToExtension({ type: 'sendMergeAssistantMessage', text: trimmed });
      setText('');
    },
    [isBusy, addUserMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(text);
      }
    },
    [text, send],
  );

  const getText = (content: ContentBlock[]): string =>
    content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');

  const inputRtl = detectRtl(text);

  return (
    <div style={container}>
      <div style={header}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isBusy ? WT_COLORS.amber : WT_COLORS.green,
            flexShrink: 0,
          }}
        />
        <span>Claude - merge helper</span>
      </div>

      <div style={messagesArea} ref={scrollRef}>
        {sessionMessages.length === 0 && !isStreaming && (
          <div style={{ fontSize: 12, color: WT_COLORS.textDim, fontStyle: 'italic' }}>
            {isBusy ? 'Claude is reviewing the conflicts...' : 'Ask about the conflicts, or have Claude resolve them.'}
          </div>
        )}

        {sessionMessages.map((m) => {
          const body = getText(m.content);
          if (!body) {
            return null;
          }
          return (
            <div key={m.id}>
              <div style={roleLabel}>{m.role === 'user' ? 'You' : 'Claude'}</div>
              <div style={msgText} dir={detectRtl(body) ? 'rtl' : 'auto'}>
                {body}
              </div>
            </div>
          );
        })}

        {isStreaming && (
          <div>
            <div style={roleLabel}>Claude</div>
            {streamingBlocks.map((b) =>
              b.type === 'tool_use' ? (
                <div key={b.blockIndex} style={activityLine}>
                  {b.text}...
                </div>
              ) : (
                <div key={b.blockIndex} style={msgText}>
                  <StreamingText text={b.text} />
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div style={chipsRow}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            disabled={isBusy}
            data-tooltip={`Ask Claude: ${s}`}
            style={{
              background: 'transparent',
              border: `1px solid ${WT_COLORS.cardBorder}`,
              color: isBusy ? WT_COLORS.textDim : WT_COLORS.accent,
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 11,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.5 : 1,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={inputArea}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isBusy ? 'Claude is working...' : 'Ask Claude about the conflicts...'}
          dir={inputRtl ? 'rtl' : 'auto'}
          rows={1}
          style={{
            flex: 1,
            background: WT_COLORS.card,
            border: `1px solid ${WT_COLORS.cardBorder}`,
            borderRadius: 6,
            color: WT_COLORS.text,
            padding: '7px 10px',
            fontSize: 12.5,
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 34,
          }}
        />
        <button
          onClick={() => send(text)}
          disabled={!text.trim() || isBusy}
          data-tooltip="Send message to Claude"
          style={{
            background: !text.trim() || isBusy ? WT_COLORS.cardBorder : WT_COLORS.accent,
            color: !text.trim() || isBusy ? WT_COLORS.textDim : '#0d1117',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: !text.trim() || isBusy ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
