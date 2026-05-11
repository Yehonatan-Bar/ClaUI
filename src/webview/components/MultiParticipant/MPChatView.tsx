import React, { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { MpMessageBubble } from './MpMessageBubble';
import { ConflictWarning } from './ConflictWarning';
import { GuardStopNotification } from './GuardStopNotification';

export const MPChatView: React.FC = () => {
  const messages = useAppStore((s) => s.mpMessages);
  const streamingTexts = useAppStore((s) => s.mpStreamingTexts);
  const participants = useAppStore((s) => s.mpParticipants);
  const deliveryStatuses = useAppStore((s) => s.mpDeliveryStatuses);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, streamingTexts, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 80;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const activeStreamingDeliveries = Object.entries(streamingTexts).filter(
    ([deliveryId]) => {
      const ds = deliveryStatuses[deliveryId];
      return ds && (ds.status === 'streaming' || ds.status === 'running');
    }
  );

  return (
    <div
      ref={containerRef}
      className="mp-chat-view"
      onScroll={handleScroll}
    >
      <ConflictWarning />
      <GuardStopNotification />

      <div className="mp-messages-list">
        {messages.map((msg) => (
          <MpMessageBubble key={msg.messageId} message={msg} />
        ))}
      </div>

      {activeStreamingDeliveries.length > 0 && (
        <div className="mp-streaming-area">
          {activeStreamingDeliveries.map(([deliveryId, text]) => {
            const ds = deliveryStatuses[deliveryId];
            const agent = ds
              ? participants.find((p) => p.participantId === ds.agentParticipantId)
              : null;
            return (
              <div key={deliveryId} className="mp-streaming-bubble">
                <div className="mp-streaming-author">
                  {agent?.displayName || ds?.agentDisplayName || 'Agent'}
                </div>
                <div className="mp-streaming-text">
                  {text}
                  <span className="mp-streaming-cursor" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
