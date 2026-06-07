import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl } from '../../hooks/useRtlDetection';
import { WT_COLORS, providerBadgeColor, providerLabel } from './worktreeColors';
import { MergeWizard } from './MergeWizard';
import type { WorktreeWithSessions, WorktreeSessionRef } from '../../../extension/worktree/worktreeTypes';

/** Small pill used for branch names and provider badges. */
const Pill: React.FC<{ color: string; bg: string; children: React.ReactNode }> = ({ color, bg, children }) => (
  <span style={{ fontSize: 11, color, background: bg, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
    {children}
  </span>
);

const SessionRow: React.FC<{ session: WorktreeSessionRef }> = ({ session }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        marginInline: -8,
        borderRadius: 6,
        fontSize: 12,
        background: hovered ? 'rgba(128, 128, 128, 0.14)' : 'transparent',
        transition: 'background 0.12s ease',
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: session.slotColor,
          flexShrink: 0,
        }}
      />
      <span style={{ color: WT_COLORS.textDim }}>tab {session.tabNumber}</span>
      <span style={{ color: WT_COLORS.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
        {session.displayName}
      </span>
      <Pill color="#0d1117" bg={providerBadgeColor(session.provider)}>
        {providerLabel(session.provider)}
      </Pill>
      <span style={{ color: session.isBusy ? WT_COLORS.green : WT_COLORS.textDim }}>
        {session.isBusy ? 'busy' : 'idle'}
      </span>
      <button
        onClick={() => postToExtension({ type: 'focusWorktreeSession', tabId: session.tabId })}
        style={{
          background: 'transparent',
          border: `1px solid ${WT_COLORS.cardBorder}`,
          color: WT_COLORS.accent,
          borderRadius: 4,
          padding: '2px 10px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Open
      </button>
    </div>
  );
};

const cardBtn = (disabled?: boolean): React.CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${WT_COLORS.cardBorder}`,
  color: disabled ? WT_COLORS.textDim : WT_COLORS.text,
  borderRadius: 5,
  padding: '5px 12px',
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

const WorktreeCard: React.FC<{
  wt: WorktreeWithSessions;
  onRemove: (path: string) => void;
  onMerge: (wt: WorktreeWithSessions) => void;
  onResume: (wt: WorktreeWithSessions) => void;
}> = ({ wt, onRemove, onMerge, onResume }) => {
  const hasLiveSession = wt.sessions.length > 0;
  const removeDisabled = wt.isMain || hasLiveSession;
  const removeTooltip = wt.isMain
    ? 'The main worktree cannot be removed'
    : hasLiveSession
      ? 'Close the running session before removing'
      : 'Remove this worktree';
  const canMerge = !wt.isMain && !wt.isDetached && !!wt.branch && !wt.mergeInProgress;
  const inProgress = wt.mergeInProgress;

  return (
    <div
      style={{
        background: WT_COLORS.card,
        border: `1px solid ${wt.isMain ? WT_COLORS.accent : WT_COLORS.cardBorder}`,
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Pill color={WT_COLORS.accent} bg="rgba(88, 166, 255, 0.12)">
          {wt.isDetached || !wt.branch ? 'detached' : wt.branch}
        </Pill>
        {wt.isMain && (
          <Pill color={WT_COLORS.green} bg="rgba(63, 185, 80, 0.12)">main</Pill>
        )}
        {wt.isLocked && (
          <Pill color="#d29922" bg="rgba(210, 153, 34, 0.12)">locked</Pill>
        )}
        {wt.isPrunable && (
          <Pill color={WT_COLORS.red} bg="rgba(248, 81, 73, 0.12)">missing</Pill>
        )}
        {wt.headSha && (
          <span style={{ marginInlineStart: 'auto', fontSize: 11, color: WT_COLORS.textDim, fontFamily: 'monospace' }}>
            HEAD {wt.headSha.slice(0, 7)}
          </span>
        )}
      </div>

      {/* Path */}
      <div
        dir="ltr"
        style={{ fontSize: 11, color: WT_COLORS.textDim, marginTop: 6, fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'left' }}
      >
        {wt.path}
      </div>

      {/* Sessions */}
      <div style={{ marginTop: 10, borderTop: `1px solid ${WT_COLORS.cardBorder}`, paddingTop: 8 }}>
        <div style={{ fontSize: 11, color: WT_COLORS.textDim, marginBottom: 2 }}>Sessions here</div>
        {hasLiveSession ? (
          wt.sessions.map((s) => <SessionRow key={s.tabId} session={s} />)
        ) : (
          <div style={{ fontSize: 12, color: WT_COLORS.textDim, padding: '6px 0' }}>No active sessions</div>
        )}
      </div>

      {/* Persistent merge-in-progress bar (target checkout holding a paused merge) */}
      {inProgress && (
        <div
          style={{
            marginTop: 10,
            border: `1px solid ${WT_COLORS.amber}55`,
            background: 'rgba(210, 153, 34, 0.1)',
            borderRadius: 6,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, color: WT_COLORS.amber, fontWeight: 600 }}>
            Merge paused - {inProgress.conflictedFiles.length} conflicted file{inProgress.conflictedFiles.length === 1 ? '' : 's'}
          </span>
          <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
            <button onClick={() => onResume(wt)} style={{ ...cardBtn(), color: WT_COLORS.amber, borderColor: `${WT_COLORS.amber}66` }}>
              Resolve
            </button>
            <button
              onClick={() => postToExtension({ type: 'abortMerge', targetPath: wt.path, squash: inProgress.kind === 'squash' })}
              style={{ ...cardBtn(), color: WT_COLORS.red, borderColor: 'rgba(248, 81, 73, 0.4)' }}
            >
              Abort
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => postToExtension({ type: 'createWorktreeSession', worktreePath: wt.path })}
          style={cardBtn()}
        >
          + New session here
        </button>
        <button
          onClick={() => postToExtension({ type: 'openWorktreeFolder', worktreePath: wt.path })}
          style={cardBtn()}
        >
          Open folder
        </button>
        {canMerge && (
          <button
            onClick={() => onMerge(wt)}
            data-tooltip={`Merge ${wt.branch} into another branch`}
            style={{ ...cardBtn(), color: WT_COLORS.green, borderColor: 'rgba(63, 185, 80, 0.4)' }}
          >
            Merge
          </button>
        )}
        <button
          onClick={() => !removeDisabled && onRemove(wt.path)}
          disabled={removeDisabled}
          data-tooltip={removeTooltip}
          style={{ ...cardBtn(removeDisabled), color: removeDisabled ? WT_COLORS.textDim : WT_COLORS.red, borderColor: removeDisabled ? WT_COLORS.cardBorder : 'rgba(248, 81, 73, 0.4)' }}
        >
          Remove
        </button>
      </div>
    </div>
  );
};

export const WorktreePanel: React.FC = () => {
  const worktreeList = useAppStore((s) => s.worktreeList);
  const isGitRepo = useAppStore((s) => s.worktreeIsGitRepo);
  const actionResult = useAppStore((s) => s.worktreeActionResult);
  const setWorktreePanelOpen = useAppStore((s) => s.setWorktreePanelOpen);
  const setWorktreeActionResult = useAppStore((s) => s.setWorktreeActionResult);

  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [startSession, setStartSession] = useState(true);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);
  const [forcePath, setForcePath] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{ wt: WorktreeWithSessions; resume: boolean } | null>(null);

  // Fetch the list whenever the panel mounts.
  useEffect(() => {
    postToExtension({ type: 'getWorktreeList' });
  }, []);

  // Close on ESC — the merge wizard takes priority over closing the panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mergeTarget) {
        setMergeTarget(null);
      } else {
        setWorktreePanelOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setWorktreePanelOpen, mergeTarget]);

  // React to a create/remove result: dirty-remove asks for force, others toast.
  useEffect(() => {
    if (!actionResult) return;
    if (actionResult.action === 'remove' && actionResult.requiresForce && actionResult.worktreePath) {
      setForcePath(actionResult.worktreePath);
    } else {
      setBanner({ text: actionResult.message, ok: actionResult.success });
      if (actionResult.action === 'create' && actionResult.success) {
        setName('');
      }
    }
    setCreating(false);
    setWorktreeActionResult(null);
  }, [actionResult, setWorktreeActionResult]);

  const sorted = [...worktreeList].sort((a, b) => (a.isMain === b.isMain ? 0 : a.isMain ? -1 : 1));
  const activeSessions = worktreeList.reduce((sum, w) => sum + w.sessions.length, 0);
  const mergeInProgressWt = worktreeList.find((w) => w.mergeInProgress);

  const submitCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setBanner(null);
    postToExtension({
      type: 'createWorktree',
      name: trimmed,
      baseBranch: baseBranch.trim() || undefined,
      startSession,
    });
  };

  const confirmForceRemove = () => {
    if (!forcePath) return;
    postToExtension({ type: 'removeWorktree', worktreePath: forcePath, force: true });
    setForcePath(null);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: WT_COLORS.bg,
        color: WT_COLORS.text,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: `1px solid ${WT_COLORS.cardBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Worktrees</span>
          <span style={{ fontSize: 11, color: WT_COLORS.textDim }}>
            {worktreeList.length} worktree{worktreeList.length === 1 ? '' : 's'} / {activeSessions} active session{activeSessions === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => postToExtension({ type: 'getWorktreeList' })}
            style={{
              background: 'transparent',
              border: `1px solid ${WT_COLORS.cardBorder}`,
              color: WT_COLORS.text,
              borderRadius: 5,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <button
            onClick={() => setWorktreePanelOpen(false)}
            data-tooltip="Close (ESC)"
            style={{ background: 'transparent', border: 'none', color: WT_COLORS.textDim, fontSize: 20, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
          >
            x
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {mergeInProgressWt && mergeInProgressWt.mergeInProgress && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12,
              color: WT_COLORS.amber,
              background: 'rgba(210, 153, 34, 0.1)',
              border: `1px solid ${WT_COLORS.amber}55`,
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>
              Merge in progress in {mergeInProgressWt.branch || mergeInProgressWt.path}
            </span>
            <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
              <button
                onClick={() => setMergeTarget({ wt: mergeInProgressWt, resume: true })}
                style={{ ...cardBtn(), color: WT_COLORS.amber, borderColor: `${WT_COLORS.amber}66` }}
              >
                Resolve
              </button>
              <button
                onClick={() =>
                  postToExtension({
                    type: 'abortMerge',
                    targetPath: mergeInProgressWt.path,
                    squash: mergeInProgressWt.mergeInProgress!.kind === 'squash',
                  })
                }
                style={{ ...cardBtn(), color: WT_COLORS.red, borderColor: 'rgba(248, 81, 73, 0.4)' }}
              >
                Abort
              </button>
            </div>
          </div>
        )}

        {banner && (
          <div
            style={{
              fontSize: 12,
              color: banner.ok ? WT_COLORS.green : WT_COLORS.red,
              background: banner.ok ? 'rgba(63, 185, 80, 0.1)' : 'rgba(248, 81, 73, 0.1)',
              border: `1px solid ${banner.ok ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'}`,
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 12,
            }}
          >
            {banner.text}
          </div>
        )}

        {!isGitRepo ? (
          <div style={{ fontSize: 13, color: WT_COLORS.textDim, padding: '24px 0', textAlign: 'center' }}>
            This workspace is not a git repository, so worktrees are unavailable.
          </div>
        ) : (
          <>
            {sorted.map((wt) => (
              <WorktreeCard
                key={wt.path}
                wt={wt}
                onRemove={(p) => postToExtension({ type: 'removeWorktree', worktreePath: p, force: false })}
                onMerge={(w) => setMergeTarget({ wt: w, resume: false })}
                onResume={(w) => setMergeTarget({ wt: w, resume: true })}
              />
            ))}

            {/* Create form */}
            <div
              style={{
                background: WT_COLORS.card,
                border: `1px solid ${WT_COLORS.cardBorder}`,
                borderRadius: 8,
                padding: '14px 16px',
                marginTop: 4,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Create a worktree</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                  <span style={{ fontSize: 11, color: WT_COLORS.textDim }}>Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
                    placeholder="feature-auth"
                    dir={detectRtl(name) ? 'rtl' : 'ltr'}
                    style={{
                      background: WT_COLORS.inputBg,
                      border: `1px solid ${WT_COLORS.cardBorder}`,
                      borderRadius: 5,
                      color: WT_COLORS.text,
                      padding: '6px 10px',
                      fontSize: 13,
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
                  <span style={{ fontSize: 11, color: WT_COLORS.textDim }}>Base branch</span>
                  <input
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
                    placeholder="origin/HEAD"
                    dir="ltr"
                    style={{
                      background: WT_COLORS.inputBg,
                      border: `1px solid ${WT_COLORS.cardBorder}`,
                      borderRadius: 5,
                      color: WT_COLORS.text,
                      padding: '6px 10px',
                      fontSize: 13,
                    }}
                  />
                </label>
                <button
                  onClick={submitCreate}
                  disabled={!name.trim() || creating}
                  style={{
                    background: !name.trim() || creating ? WT_COLORS.cardBorder : WT_COLORS.accent,
                    border: 'none',
                    borderRadius: 5,
                    color: !name.trim() || creating ? WT_COLORS.textDim : '#0d1117',
                    padding: '7px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: !name.trim() || creating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: WT_COLORS.textDim, cursor: 'pointer' }}>
                <input type="checkbox" checked={startSession} onChange={(e) => setStartSession(e.target.checked)} />
                Start a session here after creating
              </label>
            </div>
          </>
        )}
      </div>

      {/* Force-remove confirm */}
      {forcePath && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ background: WT_COLORS.card, border: `1px solid ${WT_COLORS.cardBorder}`, borderRadius: 8, padding: 20, maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Discard uncommitted changes?</div>
            <div style={{ fontSize: 12, color: WT_COLORS.textDim, marginBottom: 16, wordBreak: 'break-all' }}>
              {forcePath} has uncommitted or untracked changes. Removing it will permanently discard them.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setForcePath(null)} style={cardBtn()}>Cancel</button>
              <button
                onClick={confirmForceRemove}
                style={{ ...cardBtn(), color: '#0d1117', background: WT_COLORS.red, border: 'none', fontWeight: 600 }}
              >
                Discard and remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge wizard */}
      {mergeTarget && (
        <MergeWizard source={mergeTarget.wt} resume={mergeTarget.resume} onClose={() => setMergeTarget(null)} />
      )}
    </div>
  );
};
