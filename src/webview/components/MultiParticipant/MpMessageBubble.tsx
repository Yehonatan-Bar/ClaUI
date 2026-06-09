import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { MPMessage } from './mpTypes';
import { getParticipantColor, DELIVERY_STATUS_COLORS, KIND_BADGE_COLORS } from './mpColors';
import { detectRtl } from '../../hooks/useRtlDetection';
import { MarkdownContent } from '../ChatView/MarkdownContent';

interface MpMessageBubbleProps {
  message: MPMessage;
}

/**
 * Renders a single message in a multi-participant session.
 *
 * Features:
 * - Deterministic author colors from participantId hash
 * - Kind badge (human/agent)
 * - isMe / isMyAgent labels
 * - Delivery status pill (F2)
 * - Trigger-message link with scroll-to (F3)
 * - Rename display when snapshot differs from current name (F5)
 * - RTL support for Hebrew text
 * - Streaming text overlay
 */
export const MpMessageBubble: React.FC<MpMessageBubbleProps> = ({ message }) => {
  const myHumanId = useAppStore((s) => s.mpMyHumanId);
  const myAgentId = useAppStore((s) => s.mpMyAgentId);
  const participants = useAppStore((s) => s.mpParticipants);
  const deliveryStatuses = useAppStore((s) => s.mpDeliveryStatuses);
  const allMessages = useAppStore((s) => s.mpMessages);
  const streamingTexts = useAppStore((s) => s.mpStreamingTexts);
  const reactions = useAppStore((s) => s.mpReactions[message.messageId]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  const isMe = message.authorParticipantId === myHumanId;
  const isMyAgent = message.authorParticipantId === myAgentId;
  const authorColor = getParticipantColor(message.authorParticipantId);

  // Current participant info for rename detection (F5)
  const currentParticipant = useMemo(
    () => participants.find((p) => p.participantId === message.authorParticipantId),
    [participants, message.authorParticipantId]
  );

  // Recipient lookup for "→ Name" indicator
  const recipientParticipant = useMemo(
    () => message.recipientParticipantId
      ? participants.find((p) => p.participantId === message.recipientParticipantId)
      : undefined,
    [participants, message.recipientParticipantId]
  );
  const recipientColor = recipientParticipant
    ? getParticipantColor(recipientParticipant.participantId)
    : undefined;

  const currentDisplayName = currentParticipant?.displayName;
  const wasRenamed =
    currentDisplayName &&
    message.displayNameSnapshot !== currentDisplayName;

  // Kind badge
  const kind = currentParticipant?.kind;
  const kindBadgeColor = kind ? KIND_BADGE_COLORS[kind] ?? '#8b949e' : undefined;

  // Delivery status (F2)
  const deliveryEntry = message.deliveryId
    ? deliveryStatuses[message.deliveryId]
    : undefined;
  const deliveryColor = deliveryEntry
    ? DELIVERY_STATUS_COLORS[deliveryEntry.status] ?? '#8b949e'
    : undefined;

  // Trigger message link (F3)
  const triggerMessage = useMemo(() => {
    if (!message.triggerMessageId) return undefined;
    return allMessages.find((m) => m.messageId === message.triggerMessageId);
  }, [allMessages, message.triggerMessageId]);

  const handleTriggerClick = useCallback(() => {
    if (!message.triggerMessageId) return;
    const el = document.getElementById(`mp-msg-${message.triggerMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect
      el.style.transition = 'background-color 0.3s';
      el.style.backgroundColor = 'rgba(88, 166, 255, 0.15)';
      setTimeout(() => {
        el.style.backgroundColor = 'transparent';
      }, 1500);
    }
  }, [message.triggerMessageId]);

  const handleReactionToggle = useCallback((emoji: string) => {
    const existing = reactions?.find((r) => r.emoji === emoji);
    const alreadyReacted = existing?.participantIds.includes(myHumanId ?? '');
    if (alreadyReacted) {
      postToExtension({ type: 'mpRemoveReaction', messageId: message.messageId, emoji });
    } else {
      postToExtension({ type: 'mpAddReaction', messageId: message.messageId, emoji });
    }
    setPickerOpen(false);
  }, [reactions, myHumanId, message.messageId]);

  // Streaming overlay text for this message's delivery
  const streamingText = message.deliveryId ? streamingTexts[message.deliveryId] : undefined;

  // RTL detection on content and streaming text
  const displayBody = message.routePrefix ? `${message.routePrefix}, ${message.parsedBody}` : message.parsedBody;
  const isRtl = detectRtl(displayBody);
  const isStreamingRtl = streamingText ? detectRtl(streamingText) : isRtl;

  // When the runner split narration from the answer, show the clean answer as the
  // main body and the narration ("thoughts") in a separate, collapsed section.
  const hasThinking = !!message.thinkingBody && message.thinkingBody.trim().length > 0;
  const answerBody = message.answerBody?.trim() ? message.answerBody : undefined;
  const mainText = answerBody ?? displayBody;

  return (
    <div
      id={`mp-msg-${message.messageId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        borderRadius: 6,
        borderLeft: `3px solid ${authorColor}`,
        backgroundColor: isMe
          ? 'rgba(88, 166, 255, 0.06)'
          : 'var(--vscode-editor-background, #1e1e1e)',
        marginBottom: 6,
        transition: 'background-color 0.3s',
      }}
    >
      {/* Header row: author name + badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {/* Author name */}
        <span style={{ fontWeight: 600, color: authorColor, fontSize: 13 }}>
          {message.displayNameSnapshot}
        </span>

        {/* Recipient indicator */}
        {recipientParticipant && (
          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#6e7681' }}>{'→'}</span>
            <span style={{ fontWeight: 600, color: recipientColor }}>{recipientParticipant.displayName}</span>
          </span>
        )}

        {/* "You" / "Your Agent" badge */}
        {isMe && (
          <span style={selfBadgeStyle}>You</span>
        )}
        {isMyAgent && !isMe && (
          <span style={selfBadgeStyle}>Your Agent</span>
        )}

        {/* Kind badge */}
        {kind && kindBadgeColor && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 3,
              backgroundColor: `${kindBadgeColor}22`,
              color: kindBadgeColor,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {kind}
          </span>
        )}

        {/* Model badge for agents */}
        {kind === 'agent' && (currentParticipant?.model || currentParticipant?.provider) && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 3,
              backgroundColor: 'rgba(139, 148, 158, 0.13)',
              color: '#8b949e',
              fontWeight: 500,
            }}
          >
            {formatModelLabel(currentParticipant.model, currentParticipant.provider)}
          </span>
        )}

        {/* Rename display (F5) */}
        {wasRenamed && (
          <span style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic' }}>
            (now known as {currentDisplayName})
          </span>
        )}

        {/* Delivery status pill (F2) */}
        {deliveryEntry && deliveryColor && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 8,
              backgroundColor: `${deliveryColor}22`,
              color: deliveryColor,
              fontWeight: 500,
              marginInlineStart: 'auto',
            }}
          >
            {deliveryEntry.status}
          </span>
        )}

        {/* Timestamp */}
        <span
          style={{
            fontSize: 10,
            color: '#6e7681',
            marginInlineStart: deliveryEntry ? 0 : 'auto',
          }}
        >
          {formatTime(message.createdAt)}
        </span>
      </div>

      {/* Trigger-message link (F3) */}
      {triggerMessage && (
        <button
          onClick={handleTriggerClick}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontSize: 11,
            color: '#58a6ff',
            textAlign: isRtl ? 'right' : 'left',
            direction: isRtl ? 'rtl' : 'ltr',
            textDecoration: 'none',
          }}
          title="Click to scroll to the referenced message"
        >
          <span style={{ color: '#8b949e' }}>in reply to </span>
          <span style={{ fontWeight: 500 }}>
            {triggerMessage.displayNameSnapshot}
          </span>
          <span style={{ color: '#8b949e' }}>
            : {truncateText(triggerMessage.routePrefix ? `${triggerMessage.routePrefix}, ${triggerMessage.parsedBody}` : triggerMessage.parsedBody, 50)}
          </span>
        </button>
      )}

      {/* Agent "thoughts" (interleaved narration) - distinct from the answer, collapsed by default */}
      {hasThinking && (
        <div style={{ marginTop: 2 }}>
          <button
            onClick={() => setThoughtsOpen((o) => !o)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontSize: 11,
              fontStyle: 'italic',
              color: '#8b949e',
            }}
            title={thoughtsOpen ? 'Hide thoughts' : 'Show thoughts'}
          >
            <span>{thoughtsOpen ? '▾' : '▸'}</span>
            <span>Thoughts</span>
          </button>
          {thoughtsOpen && (
            <div
              style={{
                marginTop: 4,
                paddingInlineStart: 8,
                borderInlineStart: '2px solid rgba(139, 148, 158, 0.3)',
                opacity: 0.7,
                fontSize: 12,
              }}
            >
              <MarkdownContent text={message.thinkingBody!.trim()} />
            </div>
          )}
        </div>
      )}

      {/* Message content (final answer) rendered as markdown */}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--vscode-editor-foreground, #e6edf3)',
          wordBreak: 'break-word',
        }}
      >
        <MarkdownContent text={mainText} />
      </div>

      {/* Streaming text overlay */}
      {streamingText && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'rgba(230, 237, 243, 0.6)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            direction: isStreamingRtl ? 'rtl' : 'ltr',
            textAlign: isStreamingRtl ? 'right' : 'left',
            borderTop: '1px dashed rgba(48, 54, 61, 0.5)',
            paddingTop: 4,
            fontStyle: 'italic',
          }}
        >
          {streamingText}
          <span style={pulsingCursorStyle}>|</span>
        </div>
      )}

      {/* Emoji reactions row */}
      <div ref={pickerRef} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2, position: 'relative' }}>
        {reactions?.map((r) => {
          const iReacted = r.participantIds.includes(myHumanId ?? '');
          return (
            <button
              key={r.emoji}
              onClick={() => handleReactionToggle(r.emoji)}
              title={r.participantIds.map((pid) => participants.find((p) => p.participantId === pid)?.displayName ?? pid).join(', ')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                borderRadius: 10,
                border: `1px solid ${iReacted ? '#58a6ff' : 'rgba(48, 54, 61, 0.6)'}`,
                background: iReacted ? 'rgba(88, 166, 255, 0.12)' : 'rgba(48, 54, 61, 0.3)',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1.4,
                color: 'var(--vscode-editor-foreground, #e6edf3)',
              }}
            >
              <span>{r.emoji}</span>
              <span style={{ fontSize: 10, fontWeight: 500, color: iReacted ? '#58a6ff' : '#8b949e' }}>{r.count}</span>
            </button>
          );
        })}
        <button
          onClick={() => setPickerOpen((o) => !o)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 10,
            border: '1px solid rgba(48, 54, 61, 0.4)',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            color: '#8b949e',
            opacity: 0.6,
          }}
          title="Add reaction"
        >
          +
        </button>

        {/* Emoji picker popover */}
        {pickerOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              padding: 6,
              borderRadius: 8,
              background: 'var(--vscode-editor-background, #1e1e1e)',
              border: '1px solid var(--vscode-panel-border, #30363d)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              display: 'flex',
              gap: 2,
              flexWrap: 'wrap',
              maxWidth: 220,
              zIndex: 100,
            }}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReactionToggle(emoji)}
                style={{
                  width: 30,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 16,
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(88, 166, 255, 0.15)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Helpers ---

const REACTION_EMOJIS = [
  '\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F602}',
  '\u{1F389}', '\u{1F914}', '\u{1F440}', '\u{1F64F}',
  '\u{2705}', '\u{274C}', '\u{1F525}', '\u{1F4A1}',
];

const selfBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 5px',
  borderRadius: 3,
  backgroundColor: 'rgba(88, 166, 255, 0.15)',
  color: '#58a6ff',
  fontWeight: 500,
};

const pulsingCursorStyle: React.CSSProperties = {
  display: 'inline-block',
  animation: 'mp-cursor-blink 1s step-end infinite',
  color: '#58a6ff',
};

function formatTime(ts: string | number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function formatModelLabel(model: string | null | undefined, provider: string | null | undefined): string {
  if (model) {
    // "claude-sonnet-4-6" -> "Sonnet 4.6", "claude-opus-4-6" -> "Opus 4.6"
    const match = model.match(/(?:claude-)?(\w+)-(\d+)-(\d+)/i);
    if (match) {
      const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      return `${family} ${match[2]}.${match[3]}`;
    }
    return model;
  }
  return provider || 'agent';
}
