import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { ParticleAcceleratorTraceDetail } from './ParticleAcceleratorTraceDetail';

const REFRESH_INTERVAL_MS = 15_000;
const INITIAL_TRACES_SHOWN = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ParticleAcceleratorTracePanel() {
  const aggregate = useAppStore(s => s.particleAcceleratorAggregate);
  const recentTraces = useAppStore(s => s.particleAcceleratorRecentTraces);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tracesExpanded, setTracesExpanded] = useState(false);

  useEffect(() => {
    postToExtension({ type: 'particleAcceleratorGetStatus' } as any);
    intervalRef.current = setInterval(() => {
      postToExtension({ type: 'particleAcceleratorGetStatus' } as any);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!aggregate || aggregate.totalCommands === 0) {
    return (
      <div style={{ padding: '8px', fontSize: '12px', opacity: 0.6 }}>
        No Particle Accelerator traces yet. Run a session with Particle Accelerator enabled.
      </div>
    );
  }

  const failRate = aggregate.totalCommands > 0
    ? ((aggregate.failedCommands / aggregate.totalCommands) * 100).toFixed(0)
    : '0';

  const tracesToShow = tracesExpanded
    ? recentTraces
    : recentTraces.slice(0, INITIAL_TRACES_SHOWN);

  const providers = Object.entries(aggregate.providerBreakdown ?? {});
  const maxFamilyCount = Math.max(...(aggregate.topCommandFamilies ?? []).map(f => f.count), 1);
  const maxFilterCount = Math.max(...(aggregate.topFilters ?? []).map(f => f.count), 1);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>
        Particle Accelerator Stats
      </div>

      {/* ── Overview Stats ──────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '16px',
      }}>
        <StatCard
          label="Commands"
          value={String(aggregate.totalCommands)}
          subtitle={aggregate.failedCommands > 0 ? `${aggregate.failedCommands} failed (${failRate}%)` : undefined}
          subtitleColor={aggregate.failedCommands > 0 ? '#f85149' : undefined}
        />
        <StatCard
          label="Tokens Saved"
          value={`~${formatTokens(aggregate.totalEstimatedTokensSaved)}`}
        />
        <StatCard
          label="Compression"
          value={aggregate.avgCompressionRatio > 1 ? `${aggregate.avgCompressionRatio.toFixed(1)}x` : '1x'}
        />
        <StatCard
          label="Data Volume"
          value={formatBytes(aggregate.totalRawBytes)}
          subtitle={`${formatBytes(aggregate.totalFilteredBytes)} after filtering`}
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(aggregate.avgDurationMs)}
        />
        <StatCard
          label="Secrets Redacted"
          value={String(aggregate.totalRedactions)}
          subtitleColor={aggregate.totalRedactions > 0 ? '#e3b341' : undefined}
        />
      </div>

      {/* ── Provider Breakdown ──────────────────────────────── */}
      {providers.length > 0 && (
        <Section title="Provider Breakdown">
          <div style={{ display: 'flex', gap: '8px' }}>
            {providers.map(([provider, data]) => (
              <div key={provider} style={{
                flex: 1,
                padding: '8px',
                borderRadius: '4px',
                backgroundColor: 'var(--vscode-editor-background)',
                border: '1px solid var(--vscode-widget-border, transparent)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize', marginBottom: '4px' }}>
                  {provider}
                </div>
                <div style={{ fontSize: '11px', opacity: 0.8 }}>
                  {data.count} commands
                </div>
                <div style={{ fontSize: '11px', opacity: 0.8 }}>
                  ~{formatTokens(data.tokensSaved)} tokens saved
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Top Command Families ────────────────────────────── */}
      {(aggregate.topCommandFamilies?.length ?? 0) > 0 && (
        <Section title="Top Command Families">
          {aggregate.topCommandFamilies.map(fam => (
            <BarRow
              key={fam.family}
              label={fam.family}
              value={fam.count}
              maxValue={maxFamilyCount}
              suffix={`${fam.count} cmds / ~${formatTokens(fam.tokensSaved)} tokens`}
              color="#58a6ff"
            />
          ))}
        </Section>
      )}

      {/* ── Top Filters ────────────────────────────────────── */}
      {(aggregate.topFilters?.length ?? 0) > 0 && (
        <Section title="Top Filters">
          {aggregate.topFilters.map(f => (
            <BarRow
              key={f.filter}
              label={f.filter}
              value={f.count}
              maxValue={maxFilterCount}
              suffix={`${f.count} uses`}
              color="#bc8cff"
            />
          ))}
        </Section>
      )}

      {/* ── Recent Traces ──────────────────────────────────── */}
      {recentTraces.length > 0 && (
        <Section title={`Recent Traces (${recentTraces.length})`}>
          {tracesToShow.map(trace => (
            <ParticleAcceleratorTraceDetail key={trace.traceId} trace={trace} />
          ))}
          {recentTraces.length > INITIAL_TRACES_SHOWN && (
            <button
              onClick={() => setTracesExpanded(!tracesExpanded)}
              style={{
                marginTop: '4px',
                padding: '4px 8px',
                borderRadius: '3px',
                border: '1px solid var(--vscode-button-border, transparent)',
                backgroundColor: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                cursor: 'pointer',
                fontSize: '11px',
                width: '100%',
              }}
            >
              {tracesExpanded
                ? 'Show less'
                : `Show all ${recentTraces.length} traces`}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value, subtitle, subtitleColor }: {
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
}) {
  return (
    <div style={{
      padding: '8px',
      borderRadius: '4px',
      backgroundColor: 'var(--vscode-editor-background)',
      border: '1px solid var(--vscode-widget-border, transparent)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '16px', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: '10px', opacity: 0.7 }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: '9px', opacity: 0.6, marginTop: '2px', color: subtitleColor }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, opacity: 0.8, marginBottom: '6px' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function BarRow({ label, value, maxValue, suffix, color }: {
  label: string;
  value: number;
  maxValue: number;
  suffix: string;
  color: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ opacity: 0.7 }}>{suffix}</span>
      </div>
      <div style={{
        height: '4px',
        borderRadius: '2px',
        backgroundColor: 'var(--vscode-editor-background)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          backgroundColor: color,
          borderRadius: '2px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}
