import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS } from '../dashboardUtils';
import type {
  MemoryProcessCategory,
  MemorySnapshotMessage,
  MemoryVsCodeProcess,
} from '../../../../extension/types/webview-messages';

const SAMPLE_INTERVAL_MS = 2500;

const CATEGORY_LABELS: Record<MemoryProcessCategory, string> = {
  main: 'Main',
  renderer: 'Renderer',
  extensionHost: 'Ext Host',
  gpu: 'GPU',
  utility: 'Utility',
  pty: 'Terminal',
  crashpad: 'Crashpad',
  other: 'Other',
};

const CATEGORY_COLORS: Record<MemoryProcessCategory, string> = {
  main: DASH_COLORS.blue,
  renderer: DASH_COLORS.purple,
  extensionHost: DASH_COLORS.green,
  gpu: DASH_COLORS.orange,
  utility: DASH_COLORS.amber,
  pty: DASH_COLORS.teal,
  crashpad: DASH_COLORS.textMuted,
  other: '#484f58',
};

const tooltipStyle: React.CSSProperties = {
  backgroundColor: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '6px',
  color: DASH_COLORS.text,
  fontSize: '12px',
};

const cardStyle: React.CSSProperties = {
  background: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: 8,
  padding: '14px 16px',
};

const chartCardStyle: React.CSSProperties = {
  ...cardStyle,
  marginBottom: 16,
};

const chartTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: DASH_COLORS.text,
  marginBottom: 10,
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ${units[i]}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sumByCategory(processes: MemoryVsCodeProcess[]): Record<MemoryProcessCategory, number> {
  const out: Record<MemoryProcessCategory, number> = {
    main: 0, renderer: 0, extensionHost: 0, gpu: 0, utility: 0, pty: 0, crashpad: 0, other: 0,
  };
  for (const p of processes) {
    out[p.category] += p.rssBytes;
  }
  return out;
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, hint, accent }) => (
  <div style={{
    ...cardStyle,
    borderLeft: accent ? `4px solid ${accent}` : cardStyle.border,
    flex: 1,
    minWidth: 160,
  }}>
    <div style={{ fontSize: 11, color: DASH_COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: DASH_COLORS.text, lineHeight: 1.2, marginTop: 4 }}>
      {value}
    </div>
    {hint && (
      <div style={{ fontSize: 11, color: DASH_COLORS.textMuted, marginTop: 4 }}>{hint}</div>
    )}
  </div>
);

export const MemoryTab: React.FC = () => {
  const memorySnapshots = useAppStore((s) => s.memorySnapshots);
  const memoryStreamError = useAppStore((s) => s.memoryStreamError);
  const clearMemoryHistory = useAppStore((s) => s.clearMemoryHistory);

  // Start streaming on mount, stop on unmount.
  React.useEffect(() => {
    postToExtension({ type: 'requestMemoryStream', enabled: true, intervalMs: SAMPLE_INTERVAL_MS });
    return () => {
      postToExtension({ type: 'requestMemoryStream', enabled: false });
    };
  }, []);

  const latest = memorySnapshots[memorySnapshots.length - 1] as MemorySnapshotMessage | undefined;

  // Build line-chart data: for each snapshot, total VS Code RSS, ext host RSS, our CLI RSS sum.
  const lineData = React.useMemo(() => {
    return memorySnapshots.map((snap) => {
      const totalVsCode = snap.vscodeProcesses.reduce((acc, p) => acc + p.rssBytes, 0);
      const cliTotal = snap.cliProcesses.reduce((acc, p) => acc + p.treeRssBytes, 0);
      const usedSystem = snap.systemTotalBytes - snap.systemFreeBytes;
      return {
        ts: snap.timestamp,
        time: formatTime(snap.timestamp),
        vscode: totalVsCode / (1024 * 1024),
        extHost: snap.extensionHost.rssBytes / (1024 * 1024),
        cli: cliTotal / (1024 * 1024),
        systemUsed: usedSystem / (1024 * 1024 * 1024),
      };
    });
  }, [memorySnapshots]);

  const categoryBars = React.useMemo(() => {
    if (!latest) return [];
    const sums = sumByCategory(latest.vscodeProcesses);
    return (Object.keys(sums) as MemoryProcessCategory[])
      .filter((cat) => sums[cat] > 0)
      .map((cat) => ({
        category: CATEGORY_LABELS[cat],
        rssMB: sums[cat] / (1024 * 1024),
        color: CATEGORY_COLORS[cat],
      }))
      .sort((a, b) => b.rssMB - a.rssMB);
  }, [latest]);

  const totalVsCodeBytes = latest
    ? latest.vscodeProcesses.reduce((acc, p) => acc + p.rssBytes, 0)
    : 0;
  const totalCliBytes = latest
    ? latest.cliProcesses.reduce((acc, p) => acc + p.treeRssBytes, 0)
    : 0;
  const systemUsedBytes = latest ? latest.systemTotalBytes - latest.systemFreeBytes : 0;
  const systemUsedPct = latest && latest.systemTotalBytes > 0
    ? (systemUsedBytes / latest.systemTotalBytes) * 100
    : 0;

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 14,
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: DASH_COLORS.text }}>
            Memory Monitor
          </div>
          <div style={{ fontSize: 12, color: DASH_COLORS.textMuted, marginTop: 2 }}>
            Live RSS (working set) for VS Code processes and ClaUi-spawned CLI trees. Sampled every {(SAMPLE_INTERVAL_MS / 1000).toFixed(1)}s.
          </div>
        </div>
        <button
          onClick={clearMemoryHistory}
          data-tooltip="Clear chart history"
          style={{
            background: DASH_COLORS.cardBg,
            color: DASH_COLORS.textMuted,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Clear history
        </button>
      </div>

      {memoryStreamError && (
        <div style={{
          ...cardStyle,
          borderLeft: `4px solid ${DASH_COLORS.red}`,
          marginBottom: 14,
          color: DASH_COLORS.red,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Memory sampling error</div>
          <div style={{ color: DASH_COLORS.textMuted }}>{memoryStreamError}</div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard
          label="VS Code Total"
          value={latest ? formatBytes(totalVsCodeBytes) : '—'}
          hint={latest ? `${latest.vscodeProcesses.length} processes` : 'sampling…'}
          accent={DASH_COLORS.blue}
        />
        <StatCard
          label="Extension Host"
          value={latest ? formatBytes(latest.extensionHost.rssBytes) : '—'}
          hint={latest
            ? `heap ${formatBytes(latest.extensionHost.heapUsedBytes)} / ${formatBytes(latest.extensionHost.heapTotalBytes)}`
            : 'sampling…'}
          accent={DASH_COLORS.green}
        />
        <StatCard
          label="ClaUi CLI Trees"
          value={latest ? formatBytes(totalCliBytes) : '—'}
          hint={latest
            ? `${latest.cliProcesses.length} active tab${latest.cliProcesses.length === 1 ? '' : 's'}`
            : 'sampling…'}
          accent={DASH_COLORS.amber}
        />
        <StatCard
          label="System Memory"
          value={latest ? `${systemUsedPct.toFixed(0)}%` : '—'}
          hint={latest
            ? `${formatBytes(systemUsedBytes)} of ${formatBytes(latest.systemTotalBytes)} used`
            : 'sampling…'}
          accent={DASH_COLORS.purple}
        />
      </div>

      {/* Line chart over time */}
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>RSS over time (MB)</div>
        {lineData.length === 0 ? (
          <div style={{ color: DASH_COLORS.textMuted, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
            Waiting for first sample…
          </div>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={lineData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="memVsCode" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={DASH_COLORS.blue} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={DASH_COLORS.blue} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="memExtHost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={DASH_COLORS.green} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={DASH_COLORS.green} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="memCli" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={DASH_COLORS.amber} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={DASH_COLORS.amber} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={DASH_COLORS.border} strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke={DASH_COLORS.textMuted} fontSize={11} minTickGap={32} />
                <YAxis
                  stroke={DASH_COLORS.textMuted}
                  fontSize={11}
                  tickFormatter={(v) => `${Number(v).toFixed(0)} MB`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: DASH_COLORS.text }}
                  formatter={(value: number | undefined, name: string | undefined) => [
                    `${(value ?? 0).toFixed(1)} MB`,
                    name ?? '',
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: DASH_COLORS.textMuted }} />
                <Area
                  type="monotone"
                  dataKey="vscode"
                  name="VS Code total"
                  stroke={DASH_COLORS.blue}
                  fill="url(#memVsCode)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="extHost"
                  name="Extension Host"
                  stroke={DASH_COLORS.green}
                  fill="url(#memExtHost)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="cli"
                  name="ClaUi CLI trees"
                  stroke={DASH_COLORS.amber}
                  fill="url(#memCli)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Process category breakdown */}
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>VS Code processes by group (current)</div>
        {categoryBars.length === 0 ? (
          <div style={{ color: DASH_COLORS.textMuted, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
            Waiting for first sample…
          </div>
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryBars} layout="vertical" margin={{ top: 4, right: 12, left: 24, bottom: 0 }}>
                <CartesianGrid stroke={DASH_COLORS.border} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  stroke={DASH_COLORS.textMuted}
                  fontSize={11}
                  tickFormatter={(v) => `${Number(v).toFixed(0)} MB`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  stroke={DASH_COLORS.textMuted}
                  fontSize={11}
                  width={70}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number | undefined) => [
                    `${(value ?? 0).toFixed(1)} MB`,
                    'RSS',
                  ]}
                  cursor={{ fill: 'rgba(88, 166, 255, 0.08)' }}
                />
                <Bar dataKey="rssMB" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {categoryBars.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-tab CLI tree table */}
      <div style={cardStyle}>
        <div style={chartTitleStyle}>Per-tab CLI process trees</div>
        {!latest || latest.cliProcesses.length === 0 ? (
          <div style={{ color: DASH_COLORS.textMuted, fontSize: 12, padding: '12px 0' }}>
            No active CLI processes. Open a Claude or Codex session to see per-tab memory.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: DASH_COLORS.textMuted, borderBottom: `1px solid ${DASH_COLORS.border}` }}>
                <th style={{ padding: '6px 8px' }}>Tab</th>
                <th style={{ padding: '6px 8px' }}>Provider</th>
                <th style={{ padding: '6px 8px' }}>Root PID</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Processes</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Tree RSS</th>
              </tr>
            </thead>
            <tbody>
              {latest.cliProcesses.map((p) => (
                <tr key={p.tabId} style={{ color: DASH_COLORS.text, borderBottom: `1px solid ${DASH_COLORS.border}` }}>
                  <td style={{ padding: '6px 8px' }}>{p.tabName}</td>
                  <td style={{ padding: '6px 8px', color: DASH_COLORS.textMuted }}>{p.provider}</td>
                  <td style={{ padding: '6px 8px', color: DASH_COLORS.textMuted, fontFamily: 'monospace' }}>{p.rootPid}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: DASH_COLORS.textMuted }}>{p.processCount}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{formatBytes(p.treeRssBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 11, color: DASH_COLORS.textMuted, marginTop: 12, lineHeight: 1.5 }}>
        Note: VS Code runs all extensions in a single shared Extension Host process, so &quot;Extension Host&quot; reflects
        ClaUi plus every other active extension — there is no per-extension breakdown available from VS Code.
        The CLI tree column is precise: it shows the cmd.exe / node.exe spawned for each ClaUi tab and all descendants.
      </div>
    </div>
  );
};
