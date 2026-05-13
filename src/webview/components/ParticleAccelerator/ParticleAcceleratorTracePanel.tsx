import { useAppStore } from '../../state/store';

export function ParticleAcceleratorTracePanel() {
  const aggregate = useAppStore(s => s.particleAcceleratorAggregate);

  if (!aggregate || aggregate.totalCommands === 0) {
    return (
      <div style={{ padding: '8px', fontSize: '12px', opacity: 0.6 }}>
        No Particle Accelerator traces yet. Run a session with Particle Accelerator enabled.
      </div>
    );
  }

  const ratio = aggregate.avgCompressionRatio;
  const tokensSaved = aggregate.totalEstimatedTokensSaved;
  const tokenLabel = tokensSaved >= 1000
    ? `${(tokensSaved / 1000).toFixed(1)}k`
    : String(tokensSaved);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
        Particle Accelerator Stats
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '12px',
      }}>
        <StatCard label="Commands" value={String(aggregate.totalCommands)} />
        <StatCard label="Tokens Saved" value={`~${tokenLabel}`} />
        <StatCard
          label="Compression"
          value={ratio > 1 ? `${ratio.toFixed(1)}x` : '1x'}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: '4px',
      backgroundColor: 'var(--vscode-editor-background)',
      border: '1px solid var(--vscode-widget-border, transparent)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '16px', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: '10px', opacity: 0.7 }}>{label}</div>
    </div>
  );
}
