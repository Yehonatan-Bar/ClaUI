const SECRET_TYPE_SHORT: Record<string, string> = {
  'env-value': 'Env',
  'github-classic-pat': 'GitHub PAT',
  'github-fine-grained': 'GitHub PAT',
  'aws-access-key': 'AWS Key',
  'aws-secret-key': 'AWS Secret',
  'jwt': 'JWT',
  'openai-key': 'OpenAI',
  'anthropic-key': 'Anthropic',
  'slack-token': 'Slack',
  'stripe-key': 'Stripe',
  'google-api-key': 'Google',
  'private-key-block': 'PEM Key',
  'basic-auth-url': 'Auth URL',
  'db-url-creds': 'DB Creds',
  'bearer-token': 'Bearer',
};

export function ParticleAcceleratorTraceDetail({ trace }: { trace: {
  traceId: string;
  timestamp: string;
  provider?: string;
  commandFamily: string;
  exitCode: number | null;
  durationMs: number;
  rawBytes: number;
  filteredBytes: number;
  estimatedTokensSaved: number;
  filterName: string;
  redactions: number;
  rulesTriggered?: string[];
  rawLines?: number;
  filteredLines?: number;
} }) {
  const ratio = trace.rawBytes > 0 ? (trace.rawBytes / (trace.filteredBytes || 1)).toFixed(1) : '1.0';
  const durationSec = (trace.durationMs / 1000).toFixed(1);
  const failed = trace.exitCode !== null && trace.exitCode !== 0;
  const rules = trace.rulesTriggered ?? [];
  const linesSaved = (trace.rawLines ?? 0) - (trace.filteredLines ?? 0);

  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: '4px',
      backgroundColor: 'var(--vscode-editor-background)',
      border: `1px solid ${failed ? 'rgba(248, 81, 73, 0.3)' : 'var(--vscode-widget-border, transparent)'}`,
      fontSize: '11px',
      marginBottom: '3px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 600, fontSize: '12px' }}>{trace.commandFamily}</span>
          {trace.provider && (
            <span style={{
              fontSize: '9px',
              padding: '1px 4px',
              borderRadius: '3px',
              backgroundColor: trace.provider === 'claude' ? 'rgba(188, 140, 255, 0.15)' : 'rgba(88, 166, 255, 0.15)',
              color: trace.provider === 'claude' ? '#bc8cff' : '#58a6ff',
              textTransform: 'capitalize',
            }}>
              {trace.provider}
            </span>
          )}
        </div>
        <span style={{ opacity: 0.5, fontSize: '10px' }}>
          {new Date(trace.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '10px', opacity: 0.8, flexWrap: 'wrap' }}>
        <span style={{ color: failed ? '#f85149' : undefined }}>
          Exit: {trace.exitCode ?? '?'}
        </span>
        <span>{durationSec}s</span>
        <span>{ratio}x</span>
        <span>~{trace.estimatedTokensSaved} tokens</span>
        {linesSaved > 0 && <span>{linesSaved} lines</span>}
        {trace.redactions > 0 && (
          <span style={{ color: '#e3b341' }}>
            {trace.redactions} redacted
            {rules.length > 0 && (
              <span style={{ opacity: 0.7 }}>
                {' '}({rules.map(r => SECRET_TYPE_SHORT[r] ?? r).join(', ')})
              </span>
            )}
          </span>
        )}
        <span style={{ opacity: 0.4 }}>{trace.filterName}</span>
      </div>
    </div>
  );
}
