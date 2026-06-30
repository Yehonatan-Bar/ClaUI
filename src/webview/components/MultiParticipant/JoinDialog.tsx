import React, { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { MPAgentProvider } from '../../../extension/multiparticipant/MultiParticipantProtocol';

export const JoinDialog: React.FC = () => {
  const isOpen = useAppStore((s) => s.mpJoinDialogOpen);
  const joinError = useAppStore((s) => s.mpJoinError);
  const connectionStatus = useAppStore((s) => s.mpConnectionStatus);
  const connectionMessage = useAppStore((s) => s.mpConnectionMessage);
  const setOpen = useAppStore((s) => s.setMpJoinDialogOpen);
  const defaults = useAppStore((s) => s.mpDialogDefaults);

  const [mode, setMode] = useState<'create' | 'join'>('join');
  const [humanName, setHumanName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentProvider, setAgentProvider] = useState<MPAgentProvider>('claude');
  const [serverUrl, setServerUrl] = useState('');
  const [sessionNumber, setSessionNumber] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  useEffect(() => {
    if (defaults && !defaultsApplied) {
      setMode(defaults.mode);
      if (defaults.humanName) setHumanName(defaults.humanName);
      if (defaults.agentName) setAgentName(defaults.agentName);
      if (defaults.serverUrl) setServerUrl(defaults.serverUrl);
      setDefaultsApplied(true);
    }
  }, [defaults, defaultsApplied]);

  const isConnecting = connectionStatus === 'connecting';

  const handleSubmit = useCallback(() => {
    const trimmedHuman = humanName.trim();
    const trimmedAgent = agentName.trim();
    const trimmedSessionNum = sessionNumber.trim();

    if (!trimmedHuman) {
      setLocalError('Name is required');
      return;
    }
    if (trimmedHuman.length > 32) {
      setLocalError('Name too long (max 32 characters)');
      return;
    }
    if (!trimmedAgent) {
      setLocalError('Agent name is required');
      return;
    }
    if (trimmedAgent.length > 32) {
      setLocalError('Agent name too long (max 32 characters)');
      return;
    }
    if (!trimmedSessionNum) {
      setLocalError('Session number is required');
      return;
    }
    const num = parseInt(trimmedSessionNum, 10);
    if (isNaN(num) || num < 0) {
      setLocalError('Session number must be a non-negative integer');
      return;
    }
    if (mode === 'create' && !sessionName.trim()) {
      setLocalError('Session name is required when creating');
      return;
    }

    setLocalError(null);
    postToExtension({
      type: 'mpJoinSession',
      humanName: trimmedHuman,
      agentName: trimmedAgent,
      agentProvider,
      serverUrl: serverUrl.trim() || undefined,
      sessionNumber: num,
      sessionName: mode === 'create' ? sessionName.trim() : undefined,
      mode,
      password: password || undefined,
    });
  }, [humanName, agentName, agentProvider, serverUrl, sessionNumber, sessionName, mode, password]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isConnecting) handleSubmit();
    if (e.key === 'Escape') setOpen(false);
  }, [handleSubmit, isConnecting, setOpen]);

  if (!isOpen) return null;

  // Surface connection failures (e.g. server unreachable or auth rejected) in the
  // dialog too -- previously only join errors showed, so a failed connection just
  // silently reopened a blank dialog and looked "stuck".
  const error = joinError
    ?? (connectionStatus === 'error' ? connectionMessage : null)
    ?? localError;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }} onClick={() => setOpen(false)}>
      <div style={{
        background: 'var(--vscode-editor-background, #1e1e1e)',
        border: '1px solid var(--vscode-panel-border, #30363d)',
        borderRadius: 8,
        padding: 24,
        minWidth: 340,
        maxWidth: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--vscode-foreground, #e6edf3)',
          marginBottom: 16,
        }}>
          Multi-Participant Session
        </div>

        <label style={labelStyle}>Mode</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['join', 'create'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-tooltip={m === 'create' ? 'Create a new session' : 'Join an existing session'}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: 4,
                border: `1px solid ${mode === m ? '#58a6ff' : 'var(--vscode-panel-border, #30363d)'}`,
                background: mode === m ? '#58a6ff22' : 'transparent',
                color: mode === m ? '#58a6ff' : 'var(--vscode-foreground, #e6edf3)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'create' ? 'Create' : 'Join'}
            </button>
          ))}
        </div>

        <label style={labelStyle}>Session Number</label>
        <input
          type="text"
          placeholder="e.g. 1, 42, 100"
          value={sessionNumber}
          onChange={(e) => setSessionNumber(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={handleKeyDown}
          style={inputStyle}
        />

        {mode === 'create' && (
          <>
            <label style={labelStyle}>Session Name</label>
            <input
              type="text"
              placeholder="e.g. Code Review, Planning"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              onKeyDown={handleKeyDown}
              style={inputStyle}
              maxLength={64}
            />
          </>
        )}

        <label style={labelStyle}>Password (optional)</label>
        <input
          type="password"
          placeholder="Leave empty for no password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          style={inputStyle}
        />

        <label style={labelStyle}>Server URL (optional)</label>
        <input
          type="text"
          placeholder="ws://localhost:9120"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          style={inputStyle}
        />

        <label style={labelStyle}>Your Name</label>
        <input
          type="text"
          placeholder="Alice"
          value={humanName}
          onChange={(e) => setHumanName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={inputStyle}
          maxLength={32}
        />

        <label style={labelStyle}>Agent Name</label>
        <input
          type="text"
          placeholder="Claude"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          onKeyDown={handleKeyDown}
          style={inputStyle}
          maxLength={32}
        />

        <label style={labelStyle}>Agent Provider</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['claude', 'codex'] as MPAgentProvider[]).map((prov) => (
            <button
              key={prov}
              onClick={() => setAgentProvider(prov)}
              data-tooltip={`Use ${prov === 'claude' ? 'Claude' : 'Codex'} provider`}
              style={{
                flex: 1,
                padding: '6px 12px',
                borderRadius: 4,
                border: `1px solid ${agentProvider === prov ? '#58a6ff' : 'var(--vscode-panel-border, #30363d)'}`,
                background: agentProvider === prov ? '#58a6ff22' : 'transparent',
                color: agentProvider === prov ? '#58a6ff' : 'var(--vscode-foreground, #e6edf3)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: agentProvider === prov ? 600 : 400,
              }}
            >
              {prov === 'claude' ? 'Claude' : 'Codex'}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            color: '#f85149',
            fontSize: 12,
            marginBottom: 12,
            padding: '6px 8px',
            background: '#f8514915',
            borderRadius: 4,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => setOpen(false)}
            data-tooltip="Close dialog"
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid var(--vscode-panel-border, #30363d)',
              background: 'transparent',
              color: 'var(--vscode-foreground, #e6edf3)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isConnecting}
            data-tooltip={mode === 'create' ? 'Create session' : 'Join session'}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid #58a6ff',
              background: '#58a6ff',
              color: '#fff',
              cursor: isConnecting ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              opacity: isConnecting ? 0.6 : 1,
            }}
          >
            {isConnecting ? 'Connecting...' : mode === 'create' ? 'Create' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--vscode-descriptionForeground, #8b949e)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 4,
  border: '1px solid var(--vscode-panel-border, #30363d)',
  background: 'var(--vscode-input-background, #0d1117)',
  color: 'var(--vscode-input-foreground, #e6edf3)',
  fontSize: 13,
  marginBottom: 12,
  outline: 'none',
  boxSizing: 'border-box',
};
