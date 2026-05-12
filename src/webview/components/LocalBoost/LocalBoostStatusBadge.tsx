import { useAppStore } from '../../state/store';

export function LocalBoostStatusBadge() {
  const status = useAppStore(s => s.localBoostStatus);
  const aggregate = useAppStore(s => s.localBoostAggregate);

  if (!status || !status.enabled) return null;

  const tokensSaved = aggregate?.totalEstimatedTokensSaved ?? 0;
  const cmds = aggregate?.totalCommands ?? 0;
  const tokenLabel = tokensSaved >= 1000
    ? `${(tokensSaved / 1000).toFixed(1)}k`
    : String(tokensSaved);

  const statusText = status.error
    ? 'Error'
    : !status.installed
      ? 'Not installed'
      : cmds > 0
        ? `${cmds} cmds / ~${tokenLabel} tokens saved`
        : 'Active';

  const color = status.error ? '#f48771' : '#89d185';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 6px',
        borderRadius: '3px',
        fontSize: '11px',
        color: 'var(--vscode-foreground)',
        opacity: 0.8,
      }}
      title={status.error ?? `Local Boost: ${statusText}`}
    >
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: color,
        display: 'inline-block',
      }} />
      <span>Local Boost: {statusText}</span>
    </span>
  );
}
