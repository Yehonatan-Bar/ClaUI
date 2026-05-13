export function ParticleAcceleratorTraceDetail({ trace }: { trace: {
  traceId: string;
  timestamp: string;
  commandFamily: string;
  exitCode: number | null;
  durationMs: number;
  rawBytes: number;
  filteredBytes: number;
  estimatedTokensSaved: number;
  filterName: string;
  redactions: number;
} }) {
  const ratio = trace.rawBytes > 0 ? (trace.rawBytes / (trace.filteredBytes || 1)).toFixed(1) : '1.0';
  const durationSec = (trace.durationMs / 1000).toFixed(1);

  return (
    <div style={{
      padding: '8px',
      borderRadius: '4px',
      backgroundColor: 'var(--vscode-editor-background)',
      border: '1px solid var(--vscode-widget-border, transparent)',
      fontSize: '12px',
      marginBottom: '4px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontWeight: 600 }}>{trace.commandFamily}</span>
        <span style={{ opacity: 0.6 }}>
          {new Date(trace.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '12px', opacity: 0.8 }}>
        <span>Exit: {trace.exitCode ?? '?'}</span>
        <span>{durationSec}s</span>
        <span>{ratio}x compression</span>
        <span>~{trace.estimatedTokensSaved} tokens saved</span>
        {trace.redactions > 0 && <span>{trace.redactions} redacted</span>}
        <span style={{ opacity: 0.5 }}>{trace.filterName}</span>
      </div>
    </div>
  );
}
