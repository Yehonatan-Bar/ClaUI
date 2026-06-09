import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl } from '../../hooks/useRtlDetection';
import { WT_COLORS } from './worktreeColors';
import { MergeAssistantChat } from './MergeAssistantChat';
import type { WorktreeWithSessions, MergeStrategy } from '../../../extension/worktree/worktreeTypes';

/**
 * Staged "merge this worktree into a target branch" modal. Three stages driven
 * by store state: Review (configure + pre-flight), Conflict (resolve/abort/
 * complete the paused merge), and Result (success with undo, or error).
 *
 * The wizard never runs git itself: it posts requests and renders the
 * MergePreview / MergeResult the extension sends back.
 */

const PROTECTED = new Set(['main', 'master']);

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1100,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const panel: React.CSSProperties = {
  background: WT_COLORS.card,
  border: `1px solid ${WT_COLORS.cardBorder}`,
  borderRadius: 10,
  width: 'min(620px, 100%)',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const body: React.CSSProperties = {
  padding: '18px 20px',
  overflowY: 'auto',
};

const footer: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  alignItems: 'center',
  padding: '12px 20px',
  borderTop: `1px solid ${WT_COLORS.cardBorder}`,
};

const ghostBtn = (disabled?: boolean): React.CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${WT_COLORS.cardBorder}`,
  color: disabled ? WT_COLORS.textDim : WT_COLORS.text,
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

const Chip: React.FC<{ color: string; bg: string; mono?: boolean; children: React.ReactNode }> = ({
  color,
  bg,
  mono,
  children,
}) => (
  <span
    style={{
      fontSize: 12,
      color,
      background: bg,
      padding: '4px 10px',
      borderRadius: 6,
      whiteSpace: 'nowrap',
      fontFamily: mono ? 'monospace' : undefined,
    }}
  >
    {children}
  </span>
);

const StatusCard: React.FC<{ tone: 'green' | 'amber' | 'grey'; title: string; children?: React.ReactNode }> = ({
  tone,
  title,
  children,
}) => {
  const color = tone === 'green' ? WT_COLORS.green : tone === 'amber' ? WT_COLORS.amber : WT_COLORS.textDim;
  const bg =
    tone === 'green'
      ? 'rgba(63, 185, 80, 0.08)'
      : tone === 'amber'
        ? 'rgba(210, 153, 34, 0.08)'
        : 'rgba(139, 148, 158, 0.08)';
  return (
    <div style={{ border: `1px solid ${color}55`, background: bg, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>{title}</div>
      {children && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
};

const FileList: React.FC<{ files: string[] }> = ({ files }) => (
  <div dir="ltr" style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
    {files.map((f) => (
      <span key={f} style={{ fontSize: 11, color: WT_COLORS.textDim, fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {f}
      </span>
    ))}
  </div>
);

interface StrategyCardProps {
  active: boolean;
  disabled?: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}
const StrategyCard: React.FC<StrategyCardProps> = ({ active, disabled, title, desc, onClick }) => (
  <button
    onClick={() => !disabled && onClick()}
    disabled={disabled}
    style={{
      flex: '1 1 0',
      textAlign: 'left',
      background: active ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
      border: `1px solid ${active ? WT_COLORS.accent : WT_COLORS.cardBorder}`,
      borderRadius: 8,
      padding: '10px 12px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      color: WT_COLORS.text,
    }}
  >
    <div style={{ fontSize: 13, fontWeight: 600, color: active ? WT_COLORS.accent : WT_COLORS.text }}>{title}</div>
    <div style={{ fontSize: 11, color: WT_COLORS.textDim, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
  </button>
);

export const MergeWizard: React.FC<{
  source: WorktreeWithSessions;
  /** Reopen straight into the conflict stage for a merge already paused in `source`. */
  resume?: boolean;
  onClose: () => void;
}> = ({ source, resume, onClose }) => {
  const preview = useAppStore((s) => s.mergePreview);
  const branches = useAppStore((s) => s.mergeBranches);
  const result = useAppStore((s) => s.mergeResult);
  const defaults = useAppStore((s) => s.mergeDefaults);
  const setMergePreview = useAppStore((s) => s.setMergePreview);
  const setMergeResult = useAppStore((s) => s.setMergeResult);
  const mergeAssistant = useAppStore((s) => s.mergeAssistant);
  const mergeConflictFiles = useAppStore((s) => s.mergeConflictFiles);
  const initMergeAssistant = useAppStore((s) => s.initMergeAssistant);
  const clearMergeAssistant = useAppStore((s) => s.clearMergeAssistant);
  const clearMergeConflicts = useAppStore((s) => s.clearMergeConflicts);

  const [targetBranch, setTargetBranch] = useState<string>('');
  const [strategy, setStrategy] = useState<MergeStrategy>('merge');
  const [squashMessage, setSquashMessage] = useState('');
  const [removeAfter, setRemoveAfter] = useState(false);
  const [pushAfter, setPushAfter] = useState(false);
  const [allowMainSwitch, setAllowMainSwitch] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [showCommit, setShowCommit] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [protectedConfirm, setProtectedConfirm] = useState(false);

  // This preview belongs to us only when it is for our source worktree.
  const ours = preview && preview.sourcePath === source.path ? preview : null;

  // On mount: either reopen into the conflict stage for a paused merge, or
  // clear stale state and request branches + a first preview.
  useEffect(() => {
    if (resume && source.mergeInProgress) {
      setMergePreview(null);
      setMergeResult({
        action: 'merge',
        phase: 'conflict',
        success: false,
        message: 'Merge in progress.',
        targetPath: source.path,
        targetBranch: source.branch ?? '',
        strategy: source.mergeInProgress.kind,
        conflictFiles: source.mergeInProgress.conflictedFiles,
      });
      return;
    }
    setMergeResult(null);
    setMergePreview(null);
    postToExtension({ type: 'listBranches' });
    postToExtension({ type: 'getMergePreview', sourcePath: source.path });
  }, [source.path, resume, setMergePreview, setMergeResult]);

  // Seed editable fields once, from the first preview + settings defaults.
  // Keyed on sourcePath (stable for the wizard's life) so changing the target
  // branch re-fetches the preview without clobbering the user's choices.
  useEffect(() => {
    if (!ours) return;
    setTargetBranch((cur) => cur || ours.targetBranch);
    if (defaults) {
      setStrategy((cur) => (cur === 'merge' && defaults.defaultStrategy ? defaults.defaultStrategy : cur));
      setRemoveAfter((cur) => cur || defaults.removeAfterMerge);
    }
    setSquashMessage(
      (cur) => cur || `Squash merge ${ours.sourceBranch} into ${ours.targetBranch}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ours?.sourcePath]);

  // Any fresh preview (initial or after a target change) clears the spinner.
  useEffect(() => {
    if (ours) setBusy(false);
  }, [ours]);

  // When a result lands, stop the spinner. Abort/undo are terminal and just
  // dismiss the wizard (the worktree list refresh is the visible feedback).
  useEffect(() => {
    if (!result) return;
    setBusy(false);
    if (result.success && (result.action === 'abort' || result.action === 'undo')) {
      onClose();
    }
  }, [result, onClose]);

  // Guarantee the merge-assistant CLI process is killed when the wizard closes,
  // even if the user never finalized through Abort/Complete. Safe no-op when no
  // assistant was started.
  useEffect(() => {
    return () => {
      postToExtension({ type: 'stopMergeAssistant' });
      clearMergeAssistant();
      // Drop the cached unmerged lists so a later wizard for the same target
      // path can't read a stale list and wrongly gate its Complete button.
      clearMergeConflicts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual conflict resolution (editing the files outside the assistant) emits
  // no refresh, so the cached unmerged list can stay non-empty and keep Complete
  // disabled within the same wizard. While parked in the conflict stage with the
  // assistant idle and conflicts still cached, poll the backend so manual edits
  // unblock Complete. VS Code webview iframes don't fire focus/visibility events
  // reliably, so a short self-terminating poll is the robust trigger: it stops
  // once the list empties (cache -> []) or the assistant takes over (busy, which
  // posts its own refresh on the next idle).
  useEffect(() => {
    const targetPath = result?.targetPath;
    const inConflict = result?.phase === 'conflict' && result.action !== 'abort';
    const cached = targetPath ? mergeConflictFiles[targetPath] : undefined;
    const assistantBusy = mergeAssistant?.isBusy ?? false;
    if (!targetPath || !inConflict || assistantBusy || !cached || cached.length === 0) {
      return;
    }
    const id = window.setInterval(() => {
      postToExtension({ type: 'refreshMergeConflicts', targetPath });
    }, 2500);
    return () => window.clearInterval(id);
  }, [result?.targetPath, result?.phase, result?.action, mergeConflictFiles, mergeAssistant?.isBusy]);

  const changeTarget = (next: string) => {
    setTargetBranch(next);
    setAllowMainSwitch(false);
    setBusy(true);
    postToExtension({ type: 'getMergePreview', sourcePath: source.path, targetBranch: next });
  };

  const ffDisabled = !!ours && ours.behind > 0;
  const intoProtected = PROTECTED.has(targetBranch);

  // Effective strategy (never let a disabled ff stay selected).
  const effectiveStrategy: MergeStrategy = strategy === 'ff' && ffDisabled ? 'merge' : strategy;

  const conflictPredicted = ours?.conflict === 'conflict';
  const mergeLabel = useMemo(() => {
    if (conflictPredicted) return 'Merge & resolve conflicts';
    if (effectiveStrategy === 'squash') return 'Squash & merge';
    if (effectiveStrategy === 'ff') return 'Fast-forward';
    return 'Merge';
  }, [conflictPredicted, effectiveStrategy]);

  const blocked = ours?.blockedReason;
  const mergeDisabled =
    busy || !ours || !ours.success || !!blocked || ours.alreadyMerged || ours.ahead === 0;

  const dispatchMerge = () => {
    if (!ours) return;
    setBusy(true);
    setMergeResult(null);
    postToExtension({
      type: 'performMerge',
      sourcePath: source.path,
      targetBranch,
      strategy: effectiveStrategy,
      commitMessage: effectiveStrategy === 'squash' ? squashMessage.trim() || undefined : undefined,
      allowMainSwitch,
      removeAfter,
      pushAfter,
    });
  };

  const runMerge = () => {
    if (mergeDisabled || !ours) return;
    if (intoProtected && defaults?.confirmIntoProtected) {
      setProtectedConfirm(true);
      return;
    }
    dispatchMerge();
  };

  const commitFirst = () => {
    if (!commitMsg.trim()) return;
    setBusy(true);
    postToExtension({
      type: 'commitWorktree',
      worktreePath: source.path,
      message: commitMsg.trim(),
      targetBranch: targetBranch || undefined,
    });
    // The handler re-posts the preview after committing; clear the field.
    setCommitMsg('');
    setShowCommit(false);
  };

  // ---- result-driven stages ----
  const isConflict = result?.phase === 'conflict' && result.action !== 'abort';
  const isClean =
    result?.phase === 'clean' &&
    result.success &&
    (result.action === 'merge' || result.action === 'complete');
  const isError = result?.phase === 'error';

  const squashFlag = (result?.strategy ?? effectiveStrategy) === 'squash';

  // Conflict stage: prefer the freshly re-read unmerged list (posted after the
  // assistant edits + stages files) over the stale list from the merge result.
  const refreshedConflicts = result?.targetPath ? mergeConflictFiles[result.targetPath] : undefined;
  const liveConflicts = refreshedConflicts ?? result?.conflictFiles ?? [];
  // Complete is gated while the assistant is busy and until the refreshed list
  // is empty. Before any refresh it keeps the original behavior (enabled).
  const completeDisabled =
    busy ||
    (mergeAssistant?.isBusy ?? false) ||
    (refreshedConflicts !== undefined && refreshedConflicts.length > 0);

  const openConflicts = () => {
    if (!result?.targetPath || !liveConflicts.length) return;
    postToExtension({ type: 'openConflictFiles', targetPath: result.targetPath, files: liveConflicts });
  };
  const abort = () => {
    if (!result?.targetPath) return;
    setBusy(true);
    postToExtension({ type: 'abortMerge', targetPath: result.targetPath, squash: squashFlag });
  };
  const complete = () => {
    if (!result?.targetPath) return;
    setBusy(true);
    postToExtension({
      type: 'completeMerge',
      targetPath: result.targetPath,
      squash: squashFlag,
      message: squashFlag ? squashMessage.trim() || undefined : undefined,
      preSha: result.preSha,
    });
  };

  // Opt-in: spin up the fresh merge-focused Claude session for this conflict.
  const startAssistant = () => {
    if (!result?.targetPath) return;
    initMergeAssistant();
    postToExtension({
      type: 'startMergeAssistant',
      targetPath: result.targetPath,
      conflictFiles: liveConflicts,
      // On resume `source` IS the target checkout (source.branch is the target
      // branch, not the merge source, which isn't recorded). Send empty and let
      // the assistant read MERGE_HEAD/MERGE_MSG instead of mislabeling it.
      sourceBranch: resume ? '' : (source.branch ?? ''),
      targetBranch: result.targetBranch || targetBranch || '',
    });
  };

  // Kill-before-teardown: stop the assistant first (so no tool call is mid-flight
  // when the index changes), then run the finalize action. A short timeout backs
  // up the deterministic `mergeAssistantSessionEnded` signal.
  const stopAssistantThen = (proceed: () => void) => {
    setBusy(true);
    if (!mergeAssistant) {
      proceed();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      clearMergeAssistant();
      proceed();
    };
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'mergeAssistantSessionEnded') finish();
    };
    window.addEventListener('message', onMsg);
    postToExtension({ type: 'stopMergeAssistant' });
    window.setTimeout(finish, 1500);
  };
  const undo = (mode: 'revert' | 'discard') => {
    if (!result?.targetPath || !result.newSha) return;
    setBusy(true);
    postToExtension({
      type: 'undoMerge',
      targetPath: result.targetPath,
      mode,
      strategy: result.strategy ?? effectiveStrategy,
      newSha: result.newSha,
      preSha: result.preSha,
    });
  };

  const rtlSquash = detectRtl(squashMessage);
  const rtlCommit = detectRtl(commitMsg);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: `1px solid ${WT_COLORS.cardBorder}`,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {isConflict ? 'Resolve merge conflicts' : isClean ? 'Merge complete' : 'Merge worktree'}
          </span>
          <button
            onClick={onClose}
            data-tooltip="Close (ESC)"
            style={{ background: 'transparent', border: 'none', color: WT_COLORS.textDim, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            x
          </button>
        </div>

        {/* ---------- STAGE C: result ---------- */}
        {isClean ? (
          <>
            <div style={body}>
              <StatusCard tone="green" title={result?.message || 'Merged successfully.'}>
                {(result?.removed || result?.pushNote) && (
                  <div style={{ fontSize: 12, color: WT_COLORS.textDim }}>
                    {result?.removed && <div>Worktree removed.</div>}
                    {result?.pushNote && <div>{result.pushNote}</div>}
                  </div>
                )}
              </StatusCard>
              {result?.newSha && (
                <div style={{ fontSize: 12, color: WT_COLORS.textDim }}>
                  New commit <Chip color={WT_COLORS.text} bg="rgba(139,148,158,0.12)" mono>{result.newSha}</Chip>
                </div>
              )}
            </div>
            <div style={footer}>
              {result?.canDiscard ? (
                <button onClick={() => setDiscardConfirm(true)} disabled={busy} style={{ ...ghostBtn(busy), color: WT_COLORS.red, borderColor: 'rgba(248,81,73,0.4)' }}>
                  Discard (rewrite history)
                </button>
              ) : null}
              <button onClick={() => undo('revert')} disabled={busy || !result?.newSha} style={ghostBtn(busy || !result?.newSha)}>
                Undo merge
              </button>
              <button onClick={onClose} style={{ ...ghostBtn(), background: WT_COLORS.accent, color: '#0d1117', border: 'none', fontWeight: 600 }}>
                Done
              </button>
            </div>
          </>
        ) : isError ? (
          <>
            <div style={body}>
              <StatusCard tone="amber" title="The operation could not be completed">
                <div style={{ fontSize: 12, color: WT_COLORS.text, whiteSpace: 'pre-wrap' }}>{result?.message}</div>
              </StatusCard>
            </div>
            <div style={footer}>
              <button onClick={() => setMergeResult(null)} style={ghostBtn()}>Back</button>
              <button onClick={onClose} style={{ ...ghostBtn(), background: WT_COLORS.accent, color: '#0d1117', border: 'none', fontWeight: 600 }}>Close</button>
            </div>
          </>
        ) : isConflict ? (
          /* ---------- STAGE B: conflict ---------- */
          <>
            <div style={body}>
              {liveConflicts.length > 0 ? (
                <StatusCard
                  tone="amber"
                  title={`Merge paused - conflicts in ${liveConflicts.length} file${liveConflicts.length === 1 ? '' : 's'}`}
                >
                  <FileList files={liveConflicts} />
                </StatusCard>
              ) : (
                <StatusCard tone="green" title="All conflicts resolved - ready to complete the merge." />
              )}
              <div style={{ fontSize: 12, color: WT_COLORS.textDim, lineHeight: 1.5 }}>
                Resolve the conflicts in the editor, then Complete the merge. Or Abort to restore the target branch
                exactly as it was before.
              </div>

              {mergeAssistant ? (
                <MergeAssistantChat targetPath={result?.targetPath ?? ''} />
              ) : (
                <button
                  onClick={startAssistant}
                  style={{
                    ...ghostBtn(),
                    marginTop: 12,
                    width: '100%',
                    borderColor: WT_COLORS.accent,
                    color: WT_COLORS.accent,
                    fontWeight: 600,
                  }}
                >
                  Ask Claude to help resolve
                </button>
              )}
            </div>
            <div style={footer}>
              <button onClick={openConflicts} disabled={!liveConflicts.length} style={ghostBtn(!liveConflicts.length)}>
                Open conflicted files
              </button>
              <button
                onClick={() => stopAssistantThen(abort)}
                disabled={busy}
                style={{ ...ghostBtn(busy), color: WT_COLORS.red, borderColor: 'rgba(248,81,73,0.4)' }}
              >
                Abort merge
              </button>
              <button
                onClick={() => stopAssistantThen(complete)}
                disabled={completeDisabled}
                data-tooltip={mergeAssistant?.isBusy ? 'Wait for Claude to finish' : liveConflicts.length ? 'Resolve all conflicts first' : undefined}
                style={{ ...ghostBtn(completeDisabled), background: completeDisabled ? WT_COLORS.cardBorder : WT_COLORS.green, color: completeDisabled ? WT_COLORS.textDim : '#0d1117', border: 'none', fontWeight: 600 }}
              >
                Complete merge
              </button>
            </div>
          </>
        ) : (
          /* ---------- STAGE A: review & configure ---------- */
          <>
            <div style={body}>
              {/* Direction header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Chip color={WT_COLORS.accent} bg="rgba(88,166,255,0.12)">
                    {ours?.sourceBranch || source.branch || 'source'}
                  </Chip>
                  <span style={{ fontSize: 11, color: WT_COLORS.textDim }}>
                    {ours ? `${ours.ahead} ahead / ${ours.behind} behind` : 'analyzing...'}
                  </span>
                </div>
                <span style={{ fontSize: 20, color: WT_COLORS.textDim }}>{'→'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select
                    value={targetBranch}
                    onChange={(e) => changeTarget(e.target.value)}
                    dir="ltr"
                    style={{
                      background: WT_COLORS.inputBg,
                      border: `1px solid ${WT_COLORS.cardBorder}`,
                      borderRadius: 6,
                      color: WT_COLORS.text,
                      padding: '5px 10px',
                      fontSize: 13,
                      minWidth: 160,
                    }}
                  >
                    {(branches.length ? branches : ours ? [ours.targetBranch] : []).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: WT_COLORS.textDim, fontFamily: 'monospace' }}>
                    {ours?.targetSha ? `HEAD ${ours.targetSha}` : ' '}
                  </span>
                </div>
              </div>

              {/* Hard block */}
              {blocked && <StatusCard tone="amber" title="Cannot merge"><div style={{ fontSize: 12, color: WT_COLORS.text }}>{blocked}</div></StatusCard>}

              {/* Conflict prediction */}
              {ours && !blocked && (
                ours.alreadyMerged ? (
                  <StatusCard tone="grey" title={`Nothing to merge - already in ${ours.targetBranch}`} />
                ) : ours.conflict === 'clean' ? (
                  <StatusCard tone="green" title={`Clean merge - ${ours.ahead} commit${ours.ahead === 1 ? '' : 's'} will be applied`} />
                ) : ours.conflict === 'conflict' ? (
                  <StatusCard tone="amber" title={`Conflicts predicted in ${ours.conflictFiles.length} file${ours.conflictFiles.length === 1 ? '' : 's'}`}>
                    <FileList files={ours.conflictFiles} />
                    <div style={{ fontSize: 11, color: WT_COLORS.textDim, marginTop: 6 }}>
                      You can still merge and resolve them in the editor.
                    </div>
                  </StatusCard>
                ) : (
                  <StatusCard tone="grey" title="Conflict prediction unavailable (git &lt; 2.38)">
                    <div style={{ fontSize: 11, color: WT_COLORS.textDim }}>The merge itself will report any conflicts.</div>
                  </StatusCard>
                )
              )}

              {/* Commits to merge */}
              {ours && ours.commits.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <button
                    onClick={() => setShowCommits((v) => !v)}
                    style={{ ...ghostBtn(), width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                  >
                    <span>{ours.commits.length} commit{ours.commits.length === 1 ? '' : 's'} to merge</span>
                    <span style={{ color: WT_COLORS.textDim }}>{showCommits ? '▾' : '▸'}</span>
                  </button>
                  {showCommits && (
                    <div dir="ltr" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left' }}>
                      {ours.commits.map((c) => (
                        <div key={c.sha} style={{ fontSize: 11, fontFamily: 'monospace', color: WT_COLORS.textDim, wordBreak: 'break-word' }}>
                          <span style={{ color: WT_COLORS.accent }}>{c.sha}</span> {c.subject}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Warnings */}
              {ours?.sourceDirty && (
                <StatusCard tone="amber" title="The worktree has uncommitted changes">
                  <div style={{ fontSize: 11, color: WT_COLORS.textDim, marginBottom: 6 }}>They will NOT be included in the merge.</div>
                  {showCommit ? (
                    <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                      <input
                        value={commitMsg}
                        onChange={(e) => setCommitMsg(e.target.value)}
                        placeholder="Commit message"
                        dir={rtlCommit ? 'rtl' : 'ltr'}
                        style={{ background: WT_COLORS.inputBg, border: `1px solid ${WT_COLORS.cardBorder}`, borderRadius: 5, color: WT_COLORS.text, padding: '6px 10px', fontSize: 12 }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={commitFirst} disabled={!commitMsg.trim() || busy} style={{ ...ghostBtn(!commitMsg.trim() || busy), color: WT_COLORS.green, borderColor: 'rgba(63,185,80,0.4)' }}>
                          Commit them
                        </button>
                        <button onClick={() => setShowCommit(false)} style={ghostBtn()}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowCommit(true)} style={ghostBtn()}>Commit them first</button>
                  )}
                </StatusCard>
              )}

              {ours?.needsMainSwitch && (
                <StatusCard tone="amber" title={`The main checkout will be switched to ${targetBranch}`}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: WT_COLORS.text, cursor: 'pointer' }}>
                    <input type="checkbox" checked={allowMainSwitch} onChange={(e) => setAllowMainSwitch(e.target.checked)} />
                    Allow switching the main checkout to run this merge
                  </label>
                </StatusCard>
              )}

              {/* Strategy */}
              <div style={{ fontSize: 12, color: WT_COLORS.textDim, margin: '4px 0 8px' }}>Strategy</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <StrategyCard
                  active={effectiveStrategy === 'merge'}
                  title="Merge commit"
                  desc="Keep all the branch's commits and add one merge point."
                  onClick={() => setStrategy('merge')}
                />
                <StrategyCard
                  active={effectiveStrategy === 'squash'}
                  title="Squash"
                  desc="Combine everything into a single clean commit."
                  onClick={() => setStrategy('squash')}
                />
                <StrategyCard
                  active={effectiveStrategy === 'ff'}
                  disabled={ffDisabled}
                  title="Fast-forward"
                  desc={ffDisabled ? `Unavailable - ${targetBranch} has moved on.` : `Move ${targetBranch} forward with no extra commit.`}
                  onClick={() => setStrategy('ff')}
                />
              </div>

              {effectiveStrategy === 'squash' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: WT_COLORS.textDim }}>Squash commit message</span>
                  <textarea
                    value={squashMessage}
                    onChange={(e) => setSquashMessage(e.target.value)}
                    dir={rtlSquash ? 'rtl' : 'ltr'}
                    rows={2}
                    style={{ background: WT_COLORS.inputBg, border: `1px solid ${WT_COLORS.cardBorder}`, borderRadius: 5, color: WT_COLORS.text, padding: '6px 10px', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </label>
              )}

              {/* After merge */}
              <div style={{ fontSize: 12, color: WT_COLORS.textDim, margin: '4px 0 8px' }}>After merge</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: WT_COLORS.text, cursor: 'pointer', marginBottom: 6 }}>
                <input type="checkbox" checked={removeAfter} onChange={(e) => setRemoveAfter(e.target.checked)} />
                Remove this worktree after a successful merge
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: WT_COLORS.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={pushAfter} onChange={(e) => setPushAfter(e.target.checked)} />
                Push {targetBranch || 'the target'} after merge
              </label>
            </div>

            <div style={footer}>
              {ours && !ours.success && !blocked && (
                <span style={{ fontSize: 12, color: WT_COLORS.red, marginInlineEnd: 'auto' }}>{ours.message}</span>
              )}
              <button onClick={onClose} style={ghostBtn()}>Cancel</button>
              <button
                onClick={runMerge}
                disabled={mergeDisabled}
                style={{
                  ...ghostBtn(mergeDisabled),
                  background: mergeDisabled ? WT_COLORS.cardBorder : conflictPredicted ? WT_COLORS.amber : WT_COLORS.accent,
                  color: mergeDisabled ? WT_COLORS.textDim : '#0d1117',
                  border: 'none',
                  fontWeight: 600,
                }}
              >
                {busy ? 'Working...' : mergeLabel}
              </button>
            </div>
          </>
        )}

        {/* Protected-branch confirm */}
        {protectedConfirm && (
          <div style={overlay} onClick={() => setProtectedConfirm(false)}>
            <div style={{ ...panel, width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Merge into {targetBranch}?</div>
                <div style={{ fontSize: 12, color: WT_COLORS.textDim, marginBottom: 16 }}>
                  {targetBranch} is a protected branch. {mergeLabel} {ours?.sourceBranch || source.branch} into it now?
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setProtectedConfirm(false)} style={ghostBtn()}>Cancel</button>
                  <button
                    onClick={() => { setProtectedConfirm(false); dispatchMerge(); }}
                    style={{ ...ghostBtn(), background: WT_COLORS.accent, color: '#0d1117', border: 'none', fontWeight: 600 }}
                  >
                    {mergeLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Guarded destructive-undo confirm */}
        {discardConfirm && (
          <div style={overlay} onClick={() => setDiscardConfirm(false)}>
            <div style={{ ...panel, width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Rewrite history?</div>
                <div style={{ fontSize: 12, color: WT_COLORS.textDim, marginBottom: 16 }}>
                  This discards the merge commit by resetting {result?.targetBranch || 'the target'} to its previous
                  state. Safe only because the commit was never pushed.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setDiscardConfirm(false)} style={ghostBtn()}>Cancel</button>
                  <button
                    onClick={() => { setDiscardConfirm(false); undo('discard'); }}
                    style={{ ...ghostBtn(), background: WT_COLORS.red, color: '#0d1117', border: 'none', fontWeight: 600 }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
