import React, { useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { JoinDialog } from './JoinDialog';
import { ParticipantList } from './ParticipantList';
import { ApprovalDialog } from './ApprovalDialog';
import { MPChatView } from './MPChatView';
import { MPInputArea } from './MPInputArea';

export const MPSessionView: React.FC = () => {
  const connectionStatus = useAppStore((s) => s.mpConnectionStatus);
  const session = useAppStore((s) => s.mpSession);
  const joinDialogOpen = useAppStore((s) => s.mpJoinDialogOpen);
  const setJoinDialogOpen = useAppStore((s) => s.setMpJoinDialogOpen);

  useEffect(() => {
    if (!session && connectionStatus !== 'connecting') {
      setJoinDialogOpen(true);
    }
  }, [session, connectionStatus, setJoinDialogOpen]);

  const showJoinDialog = joinDialogOpen || (!session && connectionStatus !== 'connecting');

  return (
    <div className="mp-session-view">
      {showJoinDialog && <JoinDialog />}
      <ApprovalDialog />

      {session && (
        <>
          <div className="mp-header">
            <div className="mp-session-name">
              {session.name}
              {session.sessionNumber != null && (
                <span className="mp-session-number" title="Session number">#{session.sessionNumber}</span>
              )}
            </div>
            <div className="mp-header-actions">
              <button
                className="mp-reset-button"
                onClick={() => postToExtension({ type: 'mpResetSession' })}
                title="Start a new session"
              >
                New Session
              </button>
              <div className={`mp-connection-badge mp-connection-badge--${connectionStatus || 'disconnected'}`}>
                {connectionStatus === 'connected' ? 'Connected' :
                 connectionStatus === 'connecting' ? 'Connecting...' :
                 connectionStatus === 'error' ? 'Error' : 'Disconnected'}
              </div>
            </div>
          </div>

          <div className="mp-body">
            <ParticipantList />
            <div className="mp-main-area">
              <MPChatView />
              <MPInputArea />
            </div>
          </div>
        </>
      )}

      {!session && connectionStatus === 'connecting' && (
        <div className="mp-connecting-overlay">
          <div className="mp-connecting-spinner" />
          <div className="mp-connecting-text">Connecting to session...</div>
        </div>
      )}
    </div>
  );
};
