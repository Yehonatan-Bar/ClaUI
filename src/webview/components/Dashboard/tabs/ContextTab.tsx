import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../../state/store';
import type { ChatMessage } from '../../../state/store';
import type { ContentBlock } from '../../../../extension/types/stream-json';
import type { McpServerInfo } from '../../../../extension/types/webview-messages';
import { DASH_COLORS } from '../dashboardUtils';
import { getClaudeModelLabel } from '../../../utils/claudeModelDisplay';

// --- Styles ---
const cardStyle = {
  background: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '8px',
  padding: '14px 16px',
  marginBottom: '12px',
};

const labelStyle = {
  fontSize: '11px',
  color: DASH_COLORS.textMuted,
  marginBottom: '4px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const codeBlockStyle = {
  fontFamily: 'monospace',
  fontSize: '12px',
  lineHeight: '1.5',
  background: '#0d1117',
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '6px',
  padding: '10px 12px',
  overflowX: 'auto' as const,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-all' as const,
  color: DASH_COLORS.text,
  maxHeight: '400px',
  overflowY: 'auto' as const,
};

const pillStyle = (color: string) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 600 as const,
  color: '#fff',
  backgroundColor: color,
  marginRight: '4px',
  marginBottom: '4px',
});

function mcpPillStyle(server: McpServerInfo): React.CSSProperties {
  const color =
    server.effectiveStatus === 'active' ? DASH_COLORS.green :
    server.effectiveStatus === 'pending_restart' ? DASH_COLORS.amber :
    server.effectiveStatus === 'needs_auth' ? '#fb8500' :
    server.effectiveStatus === 'broken' ? DASH_COLORS.red :
    DASH_COLORS.purple;

  return {
    ...pillStyle(color),
    cursor: 'pointer',
  };
}

// --- Helpers ---
function formatBlockContent(block: ContentBlock): string {
  if (block.type === 'text') {
    return block.text || '';
  }
  if (block.type === 'tool_use') {
    const inputStr = block.input ? JSON.stringify(block.input, null, 2) : '{}';
    return `[Tool Call] ${block.name || 'unknown'}\nID: ${block.id || '-'}\nInput:\n${inputStr}`;
  }
  if (block.type === 'tool_result') {
    const resultContent = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map(b => b.text || JSON.stringify(b)).join('\n')
        : String(block.content ?? '');
    return `[Tool Result] tool_use_id: ${block.tool_use_id || '-'}${block.is_error ? ' (ERROR)' : ''}\n${resultContent}`;
  }
  if (block.type === 'image') {
    return '[Image content]';
  }
  return JSON.stringify(block, null, 2);
}

function roleColor(role: string): string {
  return role === 'user' ? DASH_COLORS.blue : DASH_COLORS.green;
}

// --- Components ---

const SessionMetadataSection: React.FC = () => {
  const meta = useAppStore((s) => s.sessionMetadata);
  const sessionId = useAppStore((s) => s.sessionId);
  const setMcpPanelOpen = useAppStore((s) => s.setMcpPanelOpen);
  const setMcpSelectedTab = useAppStore((s) => s.setMcpSelectedTab);

  if (!meta) {
    return (
      <div style={cardStyle}>
        <div style={labelStyle}>Session Metadata</div>
        <div style={{ color: DASH_COLORS.textMuted, fontSize: '13px', fontStyle: 'italic' }}>
          No session metadata yet - will appear after session starts
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ ...labelStyle, marginBottom: '10px' }}>Session Metadata</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: '13px' }}>
        <span style={{ color: DASH_COLORS.textMuted }}>Session ID</span>
        <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{sessionId || '-'}</span>

        <span style={{ color: DASH_COLORS.textMuted }}>Model</span>
        <span style={{ color: DASH_COLORS.green }}>{meta.model ? getClaudeModelLabel(meta.model) : '-'}</span>

        <span style={{ color: DASH_COLORS.textMuted }}>Working Dir</span>
        <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{meta.cwd || '-'}</span>

        <span style={{ color: DASH_COLORS.textMuted }}>MCP Servers</span>
        <span>
          {meta.mcpServers.length > 0
            ? meta.mcpServers.map((server) => (
                <button
                  key={`${server.name}-${server.scope}`}
                  style={{
                    ...mcpPillStyle(server),
                    border: 'none',
                  }}
                  onClick={() => {
                    setMcpSelectedTab('session');
                    setMcpPanelOpen(true);
                  }}
                  title={`${server.name} | ${server.effectiveStatus} | ${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`}
                >
                  {server.name}
                  {server.tools.length > 0 ? ` (${server.tools.length})` : ''}
                </button>
              ))
            : <span style={{ color: DASH_COLORS.textMuted }}>none</span>}
        </span>
      </div>
      <div style={{ marginTop: '10px' }}>
        <div style={labelStyle}>Available Tools ({meta.tools.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
          {meta.tools.length > 0
            ? meta.tools.map((t, i) => <span key={i} style={pillStyle('#30363d')}>{t}</span>)
            : <span style={{ color: DASH_COLORS.textMuted, fontSize: '13px' }}>none</span>}
        </div>
      </div>
    </div>
  );
};

interface MessageBlockProps {
  message: ChatMessage;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}

const MessageBlock: React.FC<MessageBlockProps> = ({ message, index, expanded, onToggle }) => {
  const isUser = message.role === 'user';
  const blocks = Array.isArray(message.content) ? message.content : [];
  const textPreview = blocks
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join(' ')
    .slice(0, 120);

  const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
  const toolResultBlocks = blocks.filter(b => b.type === 'tool_result');

  return (
    <div style={{
      ...cardStyle,
      borderLeft: `3px solid ${roleColor(message.role)}`,
    }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={pillStyle(roleColor(message.role))}>
            {isUser ? 'USER' : 'ASSISTANT'}
          </span>
          <span style={{ color: DASH_COLORS.textMuted, fontSize: '11px' }}>
            #{index + 1}
          </span>
          {message.model && (
            <span style={{ color: DASH_COLORS.textMuted, fontSize: '11px' }}>
              {getClaudeModelLabel(message.model)}
            </span>
          )}
          {toolUseBlocks.length > 0 && (
            <span style={{ color: DASH_COLORS.amber, fontSize: '11px' }}>
              {toolUseBlocks.length} tool call{toolUseBlocks.length !== 1 ? 's' : ''}
            </span>
          )}
          {toolResultBlocks.length > 0 && (
            <span style={{ color: DASH_COLORS.teal, fontSize: '11px' }}>
              {toolResultBlocks.length} result{toolResultBlocks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ color: DASH_COLORS.textMuted, fontSize: '14px' }}>
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
      </div>

      {!expanded && textPreview && (
        <div style={{
          color: DASH_COLORS.textMuted,
          fontSize: '12px',
          marginTop: '6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {textPreview}{textPreview.length >= 120 ? '...' : ''}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '10px' }}>
          {blocks.map((block, bIdx) => (
            <div key={bIdx} style={{ marginBottom: '8px' }}>
              <div style={{
                fontSize: '10px',
                color: block.type === 'tool_use' ? DASH_COLORS.amber
                  : block.type === 'tool_result' ? DASH_COLORS.teal
                  : DASH_COLORS.textMuted,
                marginBottom: '2px',
                textTransform: 'uppercase',
              }}>
                {block.type}
                {block.type === 'tool_use' && block.name ? ` - ${block.name}` : ''}
                {block.type === 'tool_result' && block.is_error ? ' (error)' : ''}
              </div>
              <div style={codeBlockStyle}>
                {formatBlockContent(block)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Main Tab ---

export const ContextTab: React.FC = () => {
  const messages = useAppStore((s) => s.messages);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'assistant'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMessages = useMemo(() => {
    let filtered = messages;
    if (filterRole !== 'all') {
      filtered = filtered.filter(m => m.role === filterRole);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m => {
        const blocks = Array.isArray(m.content) ? m.content : [];
        return blocks.some(b => {
          if (b.type === 'text' && b.text?.toLowerCase().includes(q)) return true;
          if (b.type === 'tool_use' && (b.name?.toLowerCase().includes(q) || JSON.stringify(b.input ?? {}).toLowerCase().includes(q))) return true;
          if (b.type === 'tool_result') {
            const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
            if (content.toLowerCase().includes(q)) return true;
          }
          return false;
        });
      });
    }
    return filtered;
  }, [messages, filterRole, searchQuery]);

  const toggleMessage = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(filteredMessages.map(m => m.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Stats
  const totalBlocks = messages.reduce((s, m) => s + (Array.isArray(m.content) ? m.content.length : 0), 0);
  const totalToolCalls = messages.reduce((s, m) => {
    const blocks = Array.isArray(m.content) ? m.content : [];
    return s + blocks.filter(b => b.type === 'tool_use').length;
  }, 0);

  return (
    <div>
      {/* Session Metadata */}
      <SessionMetadataSection />

      {/* Stats bar */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '12px',
        fontSize: '12px',
        color: DASH_COLORS.textMuted,
      }}>
        <span>{messages.length} messages</span>
        <span>{totalBlocks} content blocks</span>
        <span>{totalToolCalls} tool calls</span>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        marginBottom: '12px',
        flexWrap: 'wrap',
      }}>
        {(['all', 'user', 'assistant'] as const).map(role => (
          <button
            key={role}
            onClick={() => setFilterRole(role)}
            style={{
              padding: '4px 12px',
              borderRadius: '14px',
              border: `1px solid ${filterRole === role ? DASH_COLORS.blue : DASH_COLORS.border}`,
              background: filterRole === role ? DASH_COLORS.blue + '22' : 'transparent',
              color: filterRole === role ? DASH_COLORS.blue : DASH_COLORS.textMuted,
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {role === 'all' ? 'All' : role.charAt(0).toUpperCase() + role.slice(1)}
          </button>
        ))}

        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '5px 10px',
            borderRadius: '6px',
            border: `1px solid ${DASH_COLORS.border}`,
            background: '#0d1117',
            color: DASH_COLORS.text,
            fontSize: '12px',
            outline: 'none',
          }}
        />

        <button
          onClick={expandAll}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: `1px solid ${DASH_COLORS.border}`,
            background: 'transparent',
            color: DASH_COLORS.textMuted,
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: `1px solid ${DASH_COLORS.border}`,
            background: 'transparent',
            color: DASH_COLORS.textMuted,
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Collapse All
        </button>
      </div>

      {/* Message list */}
      {filteredMessages.length === 0 ? (
        <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '48px', fontSize: '14px', fontStyle: 'italic' }}>
          {messages.length === 0
            ? 'No messages yet - start a session to see the conversation context'
            : 'No messages match your filter'}
        </div>
      ) : (
        filteredMessages.map((msg, idx) => (
          <MessageBlock
            key={msg.id}
            message={msg}
            index={messages.indexOf(msg)}
            expanded={expandedIds.has(msg.id)}
            onToggle={() => toggleMessage(msg.id)}
          />
        ))
      )}

      {/* System prompt note */}
      <div style={{
        ...cardStyle,
        borderLeft: `3px solid ${DASH_COLORS.amber}`,
        marginTop: '16px',
      }}>
        <div style={{ fontSize: '12px', color: DASH_COLORS.amber, fontWeight: 600, marginBottom: '4px' }}>
          Note: System Prompt
        </div>
        <div style={{ fontSize: '12px', color: DASH_COLORS.textMuted }}>
          The system prompt is not exposed by the Claude CLI stream-json protocol.
          The metadata above (tools, model, cwd, MCP servers) is everything available from the init event.
          The conversation messages shown include all user and assistant content blocks, tool calls, and tool results.
        </div>
      </div>
    </div>
  );
};
