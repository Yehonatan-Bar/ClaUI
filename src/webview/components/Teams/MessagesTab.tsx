import React, { useState } from 'react';
import { useAppStore } from '../../state/store';
import { getAgentColor } from './teamColors';
import { postToExtension } from '../../hooks/useClaudeStream';

export const MessagesTab: React.FC = () => {
  const { teamRecentMessages, teamConfig } = useAppStore();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [messageText, setMessageText] = useState('');
  const members = teamConfig?.members || [];

  const handleSend = () => {
    if (!selectedAgent || !messageText.trim()) return;
    postToExtension({
      type: 'teamSendMessage',
      agentName: selectedAgent,
      content: messageText.trim(),
    });
    setMessageText('');
  };

  const getAgentIdx = (name: string) => members.findIndex(m => m.name === name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      {/* Message feed */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
        {teamRecentMessages.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
            No messages yet.
          </div>
        ) : (
          teamRecentMessages.map((msg, i) => {
            const senderIdx = getAgentIdx(msg.from);
            const senderColor = senderIdx >= 0 ? getAgentColor(senderIdx) : '#8b949e';
            const isStructured = msg.type && msg.type !== 'message';
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            return (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 10,
                opacity: msg.read === false ? 1 : 0.8,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: senderColor,
                  marginTop: 5,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: senderColor, fontSize: 12 }}>
                      {msg.from}
                    </span>
                    {msg.to && (
                      <>
                        <span style={{ color: '#484f58', fontSize: 11 }}>-&gt;</span>
                        <span style={{ color: '#8b949e', fontSize: 12 }}>{msg.to}</span>
                      </>
                    )}
                    {!msg.to && msg.type === 'broadcast' && (
                      <span style={{
                        fontSize: 10,
                        background: 'rgba(188, 140, 255, 0.15)',
                        color: '#bc8cff',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}>broadcast</span>
                    )}
                    <span style={{ color: '#484f58', fontSize: 10, marginLeft: 'auto' }}>{time}</span>
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: '#e6edf3',
                    wordBreak: 'break-word',
                    ...(isStructured ? {
                      background: '#21262d',
                      padding: '6px 8px',
                      borderRadius: 4,
                      fontStyle: 'italic' as const,
                    } : {}),
                  }}>
                    {isStructured && (
                      <span style={{
                        fontSize: 10,
                        color: '#d29922',
                        marginRight: 6,
                        textTransform: 'uppercase' as const,
                      }}>
                        [{msg.type}]
                      </span>
                    )}
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Send message form */}
      <div style={{
        display: 'flex',
        gap: 8,
        borderTop: '1px solid #30363d',
        paddingTop: 12,
      }}>
        <select
          value={selectedAgent}
          onChange={e => setSelectedAgent(e.target.value)}
          style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            color: '#e6edf3',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 12,
            minWidth: 120,
          }}
        >
          <option value="">Select agent...</option>
          {members.map(m => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={messageText}
          onChange={e => setMessageText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          style={{
            flex: 1,
            background: '#0d1117',
            border: '1px solid #30363d',
            color: '#e6edf3',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!selectedAgent || !messageText.trim()}
          style={{
            background: !selectedAgent || !messageText.trim() ? '#21262d' : '#238636',
            color: !selectedAgent || !messageText.trim() ? '#484f58' : '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            cursor: !selectedAgent || !messageText.trim() ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
