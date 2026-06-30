import {
  CostConfig, DeveloperRecord, TokenCounts, UsageRecord, UsageWindow,
} from './types';
import { addCounts, computeCost, rawTokens, weightedTokens } from './CostCalculator';

const DAY = 86_400_000;
const ZERO: TokenCounts = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

/** Stable avatar/legend colors (mirrors the Hebrew mockup palette). */
const DEV_COLORS = ['#5a4fd6', '#0ea59a', '#d98a2b', '#1faf6b', '#dc4b5c', '#8b82e8', '#3b32a8', '#6a6f88'];
const CATEGORY_COLORS: Record<string, string> = {
  opus: '#5a4fd6', sonnet: '#8b82e8', haiku: '#0ea59a', fable: '#d98a2b', other: '#6a6f88',
};

export interface ModelMixEntry { category: string; costUsd: number; share: number; color: string; }
export interface SeriesBucket { label: string; start: number; end: number; costUsd: number; weightedTokens: number; }
export interface LeaderboardEntry {
  developerId: string;
  displayName: string;
  weightedTokens: number;
  rawTokens: number;
  costUsd: number;
  costShare: number;
  primaryModel: string;
  primaryModelCategory: string;
  lastReportAt: number | null;
  color: string;
  /** Whether this developer had any usage in the selected window. */
  activeInWindow: boolean;
}
export interface UsageAlert {
  severity: 'danger' | 'warn' | 'good' | 'info';
  kind: 'budget' | 'spike' | 'inactive';
  title: string;
  detail: string;
  developerId?: string;
}
export interface SummaryResponse {
  window: UsageWindow;
  generatedAt: number;
  currency: string;
  exchangeRate: number;
  lastReportAt: number | null;
  registeredCount: number;
  activeCount: number;
  totals: {
    costUsd: number;
    weightedTokens: number;
    rawTokens: number;
    unpricedTokens: number;
    unpricedModels: string[];
  };
  previousTotals: { costUsd: number; weightedTokens: number };
  modelMix: ModelMixEntry[];
  series: SeriesBucket[];
  /** Window-active consumers only (cost desc). Subset of `developers`. */
  leaderboard: LeaderboardEntry[];
  /** EVERY registered developer (active + idle), each with their last-report time. */
  developers: LeaderboardEntry[];
  alerts: UsageAlert[];
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function windowRange(window: UsageWindow, now: number): { start: number; end: number; bucketCount: number } {
  switch (window) {
    case 'today': return { start: startOfUtcDay(now), end: now, bucketCount: 8 };
    case '7d': return { start: now - 7 * DAY, end: now, bucketCount: 7 };
    case 'quarter': return { start: now - 90 * DAY, end: now, bucketCount: 12 };
    case '30d':
    default: return { start: now - 30 * DAY, end: now, bucketCount: 6 };
  }
}

export function modelCategory(modelId: string): string {
  const id = (modelId || '').toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('fable') || id.includes('mythos')) return 'fable';
  return 'other';
}

function colorForDeveloper(developerId: string): string {
  let h = 0;
  for (let i = 0; i < developerId.length; i++) h = (h * 31 + developerId.charCodeAt(i)) >>> 0;
  return DEV_COLORS[h % DEV_COLORS.length];
}

/** Accumulate records into per-developer and team-wide model->counts maps. */
function accumulate(records: UsageRecord[]): {
  perDev: Map<string, Map<string, TokenCounts>>;
  team: Map<string, TokenCounts>;
} {
  const perDev = new Map<string, Map<string, TokenCounts>>();
  const team = new Map<string, TokenCounts>();
  for (const rec of records) {
    let devMap = perDev.get(rec.developerId);
    if (!devMap) { devMap = new Map(); perDev.set(rec.developerId, devMap); }
    for (const u of rec.usage) {
      const counts: TokenCounts = {
        input: Math.max(0, u.input || 0),
        output: Math.max(0, u.output || 0),
        cacheCreation: Math.max(0, u.cacheCreation || 0),
        cacheRead: Math.max(0, u.cacheRead || 0),
      };
      const model = u.model || 'unknown';
      devMap.set(model, addCounts(devMap.get(model) ?? ZERO, counts));
      team.set(model, addCounts(team.get(model) ?? ZERO, counts));
    }
  }
  return { perDev, team };
}

function teamCost(records: UsageRecord[], prices: CostConfig['prices']): { costUsd: number; weightedTokens: number } {
  const { team } = accumulate(records);
  const cb = computeCost(Object.fromEntries(team), prices);
  return { costUsd: cb.costUsd, weightedTokens: cb.weightedTokens };
}

function formatBucketLabel(ts: number, bucketMs: number): string {
  const d = new Date(ts);
  if (bucketMs < DAY) {
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  }
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function buildSeries(records: UsageRecord[], start: number, end: number, bucketCount: number, prices: CostConfig['prices']): SeriesBucket[] {
  const span = Math.max(1, end - start);
  const bucketMs = span / bucketCount;
  const buckets: SeriesBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bStart = start + i * bucketMs;
    const bEnd = i === bucketCount - 1 ? end : bStart + bucketMs;
    const inBucket = records.filter(r => r.serverReceivedAt >= bStart && r.serverReceivedAt < bEnd);
    const { costUsd, weightedTokens: wt } = teamCost(inBucket, prices);
    buckets.push({ label: formatBucketLabel(bStart, bucketMs), start: Math.round(bStart), end: Math.round(bEnd), costUsd, weightedTokens: wt });
  }
  return buckets;
}

/** Pick a developer's primary (most expensive) model id within their model map. */
function primaryModelOf(devMap: Map<string, TokenCounts>, prices: CostConfig['prices']): string {
  let best = '';
  let bestCost = -1;
  let bestRaw = -1;
  const cb = computeCost(Object.fromEntries(devMap), prices);
  for (const [model, info] of Object.entries(cb.byModel)) {
    if (info.costUsd > bestCost || (info.costUsd === bestCost && info.rawTokens > bestRaw)) {
      bestCost = info.costUsd;
      bestRaw = info.rawTokens;
      best = model;
    }
  }
  return best || 'unknown';
}

export function buildSummary(
  records: UsageRecord[],
  developers: DeveloperRecord[],
  config: CostConfig,
  window: UsageWindow,
  now: number,
): SummaryResponse {
  const { start, end, bucketCount } = windowRange(window, now);
  const prevEnd = start;
  const prevStart = start - (end - start);

  const inWindow = records.filter(r => r.serverReceivedAt >= start && r.serverReceivedAt < end);
  const inPrev = records.filter(r => r.serverReceivedAt >= prevStart && r.serverReceivedAt < prevEnd);

  const { perDev, team } = accumulate(inWindow);
  const teamCb = computeCost(Object.fromEntries(team), config.prices);
  const prevTeam = teamCost(inPrev, config.prices);

  // Model mix by category (share of cost).
  const byCategory = new Map<string, number>();
  for (const [model, info] of Object.entries(teamCb.byModel)) {
    const cat = modelCategory(model);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + info.costUsd);
  }
  const totalCatCost = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const modelMix: ModelMixEntry[] = [...byCategory.entries()]
    .filter(([, c]) => c > 0)
    .map(([category, costUsd]) => ({
      category,
      costUsd,
      share: totalCatCost > 0 ? costUsd / totalCatCost : 0,
      color: CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // Per-developer roster over EVERY registered developer (not just window-active
  // ones), so the dashboard can always show each developer's last-report time -
  // including online-but-idle developers whose heartbeats updated lastReportAt
  // but who produced no usage in the selected window.
  const roster: LeaderboardEntry[] = [];
  for (const dev of developers) {
    const devMap = perDev.get(dev.developerId);
    const cb = devMap
      ? computeCost(Object.fromEntries(devMap), config.prices)
      : { costUsd: 0, rawTokens: 0, weightedTokens: 0, byModel: {}, unpricedTokens: 0, unpricedModels: [] as string[] };
    const primary = devMap ? primaryModelOf(devMap, config.prices) : 'unknown';
    roster.push({
      developerId: dev.developerId,
      displayName: dev.displayName,
      weightedTokens: cb.weightedTokens,
      rawTokens: cb.rawTokens,
      costUsd: cb.costUsd,
      costShare: teamCb.costUsd > 0 ? cb.costUsd / teamCb.costUsd : 0,
      primaryModel: primary,
      primaryModelCategory: modelCategory(primary),
      lastReportAt: dev.lastReportAt ?? null,
      color: colorForDeveloper(dev.developerId),
      activeInWindow: cb.rawTokens > 0,
    });
  }
  // Active first (by cost), then idle developers by most-recent report.
  roster.sort((a, b) => {
    if (a.activeInWindow !== b.activeInWindow) return a.activeInWindow ? -1 : 1;
    if (a.activeInWindow) return b.costUsd - a.costUsd || b.weightedTokens - a.weightedTokens;
    return (b.lastReportAt ?? 0) - (a.lastReportAt ?? 0);
  });
  // The consumption leaderboard is the window-active subset.
  const leaderboard = roster.filter(e => e.activeInWindow);

  const series = buildSeries(inWindow, start, end, bucketCount, config.prices);

  const lastReportAt = developers.reduce<number | null>(
    (acc, d) => (d.lastReportAt != null && (acc == null || d.lastReportAt > acc) ? d.lastReportAt : acc),
    null,
  );

  const alerts = buildAlerts(records, developers, config, window, now, leaderboard, inPrev);

  return {
    window,
    generatedAt: now,
    currency: config.currency,
    exchangeRate: config.exchangeRate,
    lastReportAt,
    registeredCount: developers.length,
    activeCount: leaderboard.length,
    totals: {
      costUsd: teamCb.costUsd,
      weightedTokens: teamCb.weightedTokens,
      rawTokens: teamCb.rawTokens,
      unpricedTokens: teamCb.unpricedTokens,
      unpricedModels: teamCb.unpricedModels,
    },
    previousTotals: { costUsd: prevTeam.costUsd, weightedTokens: prevTeam.weightedTokens },
    developers: roster,
    modelMix,
    series,
    leaderboard,
    alerts,
  };
}

function buildAlerts(
  records: UsageRecord[],
  developers: DeveloperRecord[],
  config: CostConfig,
  window: UsageWindow,
  now: number,
  windowLeaderboard: LeaderboardEntry[],
  prevWindowRecords: UsageRecord[],
): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  const fmt = (n: number) => `$${n.toFixed(0)}`;

  // Budget breach: per-developer 30d cost over the configured monthly budget.
  if (config.monthlyBudgetUsd > 0) {
    const monthAgo = now - 30 * DAY;
    const month = records.filter(r => r.serverReceivedAt >= monthAgo && r.serverReceivedAt < now);
    const { perDev } = accumulate(month);
    const devById = new Map(developers.map(d => [d.developerId, d]));
    for (const [developerId, devMap] of perDev) {
      const cb = computeCost(Object.fromEntries(devMap), config.prices);
      if (cb.costUsd > config.monthlyBudgetUsd) {
        const name = devById.get(developerId)?.displayName ?? developerId.slice(0, 8);
        alerts.push({
          severity: 'danger',
          kind: 'budget',
          developerId,
          title: `${name} exceeded the monthly API budget`,
          detail: `30-day API cost (${fmt(cb.costUsd)}) is over the configured budget (${fmt(config.monthlyBudgetUsd)}).`,
        });
      }
    }
  }

  // Usage spike: per-developer current window vs prior equal window.
  const prevByDev = accumulate(prevWindowRecords).perDev;
  const devById = new Map(developers.map(d => [d.developerId, d]));
  for (const entry of windowLeaderboard) {
    const prevMap = prevByDev.get(entry.developerId);
    if (!prevMap) continue;
    const prevCost = computeCost(Object.fromEntries(prevMap), config.prices).costUsd;
    if (prevCost <= 0) continue;
    const increasePct = ((entry.costUsd - prevCost) / prevCost) * 100;
    if (increasePct >= config.spikePercent) {
      const name = devById.get(entry.developerId)?.displayName ?? entry.developerId.slice(0, 8);
      alerts.push({
        severity: 'warn',
        kind: 'spike',
        developerId: entry.developerId,
        title: `Unusual usage increase - ${name}`,
        detail: `Consumption is ${Math.round(increasePct)}% higher than the previous ${window} window. Worth checking for an unusual task or inefficient usage.`,
      });
    }
  }

  // Inactive registered developers.
  const cutoff = now - config.inactiveDays * DAY;
  const inactive = developers.filter(d => d.lastReportAt == null || d.lastReportAt < cutoff);
  if (inactive.length > 0) {
    alerts.push({
      severity: 'good',
      kind: 'inactive',
      title: `${inactive.length} registered developer(s) without recent reports`,
      detail: `No successful automatic report in the last ${config.inactiveDays} days. They may be inactive.`,
    });
  }

  return alerts;
}

// --- Per-developer drill-down ---

export interface DeveloperDetail {
  developerId: string;
  displayName: string;
  window: UsageWindow;
  generatedAt: number;
  currency: string;
  exchangeRate: number;
  lastReportAt: number | null;
  deviceCount: number;
  totals: { costUsd: number; weightedTokens: number; rawTokens: number; unpricedTokens: number };
  byModel: Array<{ model: string; category: string; costUsd: number; rawTokens: number; weightedTokens: number }>;
  modelMix: ModelMixEntry[];
  series: SeriesBucket[];
}

export function buildDeveloperDetail(
  records: UsageRecord[],
  developer: DeveloperRecord,
  config: CostConfig,
  window: UsageWindow,
  now: number,
): DeveloperDetail {
  const { start, end, bucketCount } = windowRange(window, now);
  const devRecords = records.filter(
    r => r.developerId === developer.developerId && r.serverReceivedAt >= start && r.serverReceivedAt < end,
  );
  const { team } = accumulate(devRecords); // for a single developer, team == that developer
  const cb = computeCost(Object.fromEntries(team), config.prices);

  const byModel = Object.entries(cb.byModel)
    .map(([model, info]) => ({
      model,
      category: modelCategory(model),
      costUsd: info.costUsd,
      rawTokens: info.rawTokens,
      weightedTokens: info.weightedTokens,
    }))
    .filter(m => m.rawTokens > 0)
    .sort((a, b) => b.costUsd - a.costUsd);

  const byCategory = new Map<string, number>();
  for (const m of byModel) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + m.costUsd);
  const totalCat = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const modelMix: ModelMixEntry[] = [...byCategory.entries()]
    .filter(([, c]) => c > 0)
    .map(([category, costUsd]) => ({
      category, costUsd, share: totalCat > 0 ? costUsd / totalCat : 0, color: CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    developerId: developer.developerId,
    displayName: developer.displayName,
    window,
    generatedAt: now,
    currency: config.currency,
    exchangeRate: config.exchangeRate,
    lastReportAt: developer.lastReportAt,
    deviceCount: developer.deviceIds.length,
    totals: { costUsd: cb.costUsd, weightedTokens: cb.weightedTokens, rawTokens: cb.rawTokens, unpricedTokens: cb.unpricedTokens },
    byModel,
    modelMix,
    series: buildSeries(devRecords, start, end, bucketCount, config.prices),
  };
}
