import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { t as tAch } from './achievementI18n';
import type { CommunityFriendProfilePayload } from '../../../extension/types/webview-messages';

export const CommunityPanel: React.FC = () => {
  const {
    achievementProfile,
    achievementLanguage,
    githubSyncStatus,
    communityFriends,
    friendActionPending,
    setCommunityPanelOpen,
    setFriendActionPending,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'friends' | 'compare'>('friends');
  const [addInput, setAddInput] = useState('');
  const [selectedFriend, setSelectedFriend] = useState<CommunityFriendProfilePayload | null>(null);
  const [addError, setAddError] = useState('');

  const lang = achievementLanguage;
  const tr = tAch(lang);
  const isRtl = lang === 'he';
  const connected = githubSyncStatus?.connected ?? false;

  // Request community data on mount
  useEffect(() => {
    postToExtension({ type: 'getCommunityData' });
  }, []);

  const handleConnect = () => {
    postToExtension({ type: 'githubSync', action: 'connect' });
  };

  const handleDisconnect = () => {
    postToExtension({ type: 'githubSync', action: 'disconnect' });
  };

  const handlePublish = () => {
    postToExtension({ type: 'githubSync', action: 'publish' });
  };

  const handleAddFriend = () => {
    const username = addInput.trim().replace(/^@/, '');
    if (!username) return;
    setAddError('');
    setFriendActionPending(true);
    postToExtension({ type: 'addFriend', username });
    setAddInput('');
  };

  const handleRemoveFriend = (username: string) => {
    postToExtension({ type: 'removeFriend', username });
  };

  const handleRefresh = () => {
    setFriendActionPending(true);
    postToExtension({ type: 'refreshFriends' });
  };

  const handleCompare = (friend: CommunityFriendProfilePayload) => {
    setSelectedFriend(friend);
    setActiveTab('compare');
  };

  // Listen for friend action results
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'friendActionResult') {
        setFriendActionPending(false);
        if (!msg.success && msg.error) {
          setAddError(msg.error);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setFriendActionPending]);

  const lastSyncedText = githubSyncStatus?.lastSyncedAt
    ? formatTimeAgo(githubSyncStatus.lastSyncedAt)
    : 'Never';

  return (
    <div className="community-panel" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="community-panel-header">
        <strong>{tr.community}</strong>
        <button className="community-panel-close" onClick={() => setCommunityPanelOpen(false)}>x</button>
      </div>

      {!connected ? (
        <div className="community-connect-card">
          <div className="community-connect-title">{tr.connectGitHub}</div>
          <p className="community-connect-desc">{tr.connectGitHubDesc}</p>
          <button className="community-connect-btn" onClick={handleConnect}>
            {tr.connectGitHub}
          </button>
        </div>
      ) : (
        <>
          {/* Sync status bar */}
          <div className="community-sync-bar">
            <span className="community-sync-user">@{githubSyncStatus?.username}</span>
            <span className="community-sync-time">{tr.lastSynced}: {lastSyncedText}</span>
            <button className="community-sync-publish-btn" onClick={handlePublish} title={tr.publishNow}>
              {tr.publishNow}
            </button>
            <button className="community-sync-disconnect-btn" onClick={handleDisconnect} title={tr.disconnect}>
              {tr.disconnect}
            </button>
          </div>

          {/* Tabs */}
          <div className="community-tabs">
            <button
              className={`community-tab ${activeTab === 'friends' ? 'active' : ''}`}
              onClick={() => setActiveTab('friends')}
            >
              {tr.friends}
            </button>
            <button
              className={`community-tab ${activeTab === 'compare' ? 'active' : ''}`}
              onClick={() => setActiveTab('compare')}
            >
              {tr.compare}
            </button>
          </div>

          {activeTab === 'friends' && (
            <div className="community-friends-tab">
              <div className="community-add-friend">
                <input
                  className="community-add-input"
                  placeholder={tr.addFriendPlaceholder}
                  value={addInput}
                  onChange={(e) => { setAddInput(e.target.value); setAddError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
                />
                <button
                  className="community-add-btn"
                  onClick={handleAddFriend}
                  disabled={friendActionPending || !addInput.trim()}
                >
                  {friendActionPending ? '...' : tr.addFriend}
                </button>
                <button
                  className="community-refresh-btn"
                  onClick={handleRefresh}
                  disabled={friendActionPending}
                  title={tr.refreshFriends}
                >
                  {'\u21BB'}
                </button>
              </div>
              {addError && <div className="community-add-error">{addError}</div>}

              {communityFriends.length === 0 ? (
                <div className="community-empty">{tr.noFriendsYet}</div>
              ) : (
                <div className="community-friends-list">
                  {communityFriends.map((friend) => (
                    <div key={friend.username} className="community-friend-card">
                      {friend.avatarUrl && (
                        <img
                          className="community-friend-avatar"
                          src={friend.avatarUrl}
                          alt={friend.displayName}
                        />
                      )}
                      <div className="community-friend-info">
                        <div className="community-friend-name">{friend.displayName}</div>
                        <div className="community-friend-meta">
                          Lv.{friend.level} | {friend.totalXp} XP | {friend.unlockedIds.length} {tr.achievementsLabel}
                        </div>
                      </div>
                      <div className="community-friend-actions">
                        <button
                          className="community-compare-btn"
                          onClick={() => handleCompare(friend)}
                          title={tr.compare}
                        >
                          {tr.compare}
                        </button>
                        <button
                          className="community-remove-btn"
                          onClick={() => handleRemoveFriend(friend.username)}
                          title={tr.removeFriend}
                        >
                          x
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'compare' && (
            <div className="community-compare-tab">
              {!selectedFriend ? (
                <div className="community-empty">{tr.selectFriendToCompare}</div>
              ) : (
                <CompareView
                  myProfile={achievementProfile}
                  friend={selectedFriend}
                  tr={tr}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** Side-by-side comparison view */
const CompareView: React.FC<{
  myProfile: { totalXp: number; level: number; totalAchievements: number; unlockedIds: string[] };
  friend: CommunityFriendProfilePayload;
  tr: ReturnType<typeof tAch>;
}> = ({ myProfile, friend, tr }) => {
  const allIds = Array.from(new Set([
    ...myProfile.unlockedIds,
    ...friend.unlockedIds,
  ])).sort();

  return (
    <div className="community-compare-content">
      <div className="compare-header-row">
        <div className="compare-col compare-col-you"><strong>{tr.you}</strong></div>
        <div className="compare-col compare-col-metric"><strong>{tr.metric}</strong></div>
        <div className="compare-col compare-col-friend"><strong>{friend.displayName}</strong></div>
      </div>

      <CompareRow label={tr.level} myVal={myProfile.level} friendVal={friend.level} />
      <CompareRow label={tr.xp} myVal={myProfile.totalXp} friendVal={friend.totalXp} />
      <CompareRow label={tr.achievementsLabel} myVal={myProfile.totalAchievements} friendVal={friend.unlockedIds.length} />
      <CompareRow label={tr.sessions} myVal={0} friendVal={friend.stats.sessionsCompleted} hideMyVal />
      <CompareRow label={tr.bugFixes} myVal={0} friendVal={friend.stats.bugFixes} hideMyVal />
      <CompareRow label={tr.testsPassed} myVal={0} friendVal={friend.stats.testPasses} hideMyVal />
      <CompareRow label={tr.streak} myVal={0} friendVal={friend.stats.consecutiveDays} hideMyVal />

      <div className="compare-achievements-title">{tr.achievementsLabel} ({allIds.length})</div>
      <div className="compare-achievement-grid">
        {allIds.map((id) => {
          const myHas = myProfile.unlockedIds.includes(id);
          const friendHas = friend.unlockedIds.includes(id);
          return (
            <div key={id} className="compare-achievement-cell" title={id}>
              <span className={myHas ? 'compare-unlocked' : 'compare-locked'}>
                {myHas ? '\u2713' : '\u2717'}
              </span>
              <span className="compare-achievement-id">{id.slice(0, 12)}</span>
              <span className={friendHas ? 'compare-unlocked' : 'compare-locked'}>
                {friendHas ? '\u2713' : '\u2717'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CompareRow: React.FC<{
  label: string;
  myVal: number;
  friendVal: number;
  hideMyVal?: boolean;
}> = ({ label, myVal, friendVal, hideMyVal }) => {
  const myWins = myVal > friendVal;
  const friendWins = friendVal > myVal;
  return (
    <div className="compare-row">
      <div className={`compare-col compare-col-you ${myWins && !hideMyVal ? 'compare-winning' : ''}`}>
        {hideMyVal ? '-' : myVal.toLocaleString()}
      </div>
      <div className="compare-col compare-col-metric">{label}</div>
      <div className={`compare-col compare-col-friend ${friendWins ? 'compare-winning' : ''}`}>
        {friendVal.toLocaleString()}
      </div>
    </div>
  );
};

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
