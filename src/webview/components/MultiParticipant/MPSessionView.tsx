import React from 'react';
import { useAppStore } from '../../state/store';
import { JoinDialog } from './JoinDialog';
import { ParticipantList } from './ParticipantList';
import { ApprovalDialog } from './ApprovalDialog';
import { MPChatView } from './MPChatView';
import { MPInputArea } from './MPInputArea';

export const MPSessionView: React.FC = () => {
  const connectionStatus = useAppStore((s) => s.mpConnectionStatus);
  const session = useAppStore((s) => s.mpSession);
  const joinDialogOpen = useAppStore((s) => s.mpJoinDialogOpen);

  const showJoinDialog = joinDialogOpen || (!session && connectionStatus !== 'connecting');

  return (
    <div className="mp-session-view">
      {showJoinDialog && <JoinDialog />}
      <ApprovalDialog />

      {session && (
        <>
          <div className="mp-header">
            <div className="mp-session-name">{session.name}</div>
            <div className={`mp-connection-badge mp-connection-badge--${connectionStatus || 'disconnected'}`}>
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' :
               connectionStatus === 'error' ? 'Error' : 'Disconnected'}
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
