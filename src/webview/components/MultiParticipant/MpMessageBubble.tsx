import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import type { MPMessage } from './mpTypes';
import { getParticipantColor, DELIVERY_STATUS_COLORS, KIND_BADGE_COLORS } from './mpColors';
import { detectRtl } from '../../hooks/useRtlDetection';

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

  const isMe = message.authorParticipantId === myHumanId;
  const isMyAgent = message.authorParticipantId === myAgentId;
  const authorColor = getParticipantColor(message.authorParticipantId);

  // Current participant info for rename detection (F5)
  const currentParticipant = useMemo(
    () => participants.find((p) => p.participantId === message.authorParticipantId),
    [participants, message.authorParticipantId]
  );

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

  // Streaming overlay text for this message's delivery
  const streamingText = message.deliveryId ? streamingTexts[message.deliveryId] : undefined;

  // RTL detection on content
  const isRtl = detectRtl(message.parsedBody);

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
            : {truncateText(triggerMessage.parsedBody, 50)}
          </span>
        </button>
      )}

      {/* Message content */}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--vscode-editor-foreground, #e6edf3)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          direction: isRtl ? 'rtl' : 'ltr',
          textAlign: isRtl ? 'right' : 'left',
        }}
      >
        {message.parsedBody}
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
            borderTop: '1px dashed rgba(48, 54, 61, 0.5)',
            paddingTop: 4,
            fontStyle: 'italic',
          }}
        >
          {streamingText}
          <span style={pulsingCursorStyle}>|</span>
        </div>
      )}
    </div>
  );
};

// --- Helpers ---

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
