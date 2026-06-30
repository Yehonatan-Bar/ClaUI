/**
 * Shared types for the admin usage / cost dashboard feature.
 *
 * This feature is fully isolated from the WebSocket session protocol: it has its
 * own storage files and in-memory store and never reads or mutates session state.
 * Only numeric token counts cross the wire — never code, prompts, or file paths.
 */

/** Per-token-type raw counts for a single model. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** A single model's usage inside a report (raw token counts). */
export interface ModelUsage extends TokenCounts {
  /** Full model id as captured on the client, e.g. "claude-opus-4-8" or "unknown". */
  model: string;
}

/** USD price per 1M tokens for each token type of one model. */
export interface PriceRow {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/**
 * The single, team-wide cost configuration document (prices.json).
 * Costs are API costs only (not subscription/plan costs).
 */
export interface CostConfig {
  /** Display currency code. Default "USD". */
  currency: string;
  /** Multiplier applied to USD figures for display (1 = USD). Never hardcode a non-1 default. */
  exchangeRate: number;
  /** Per-developer monthly (30d) API cost (USD) above which a budget-breach alert fires. 0 disables. */
  monthlyBudgetUsd: number;
  /** Percent increase (current window vs prior equal window) that triggers a spike alert. */
  spikePercent: number;
  /** Days with no successful report after which a registered developer is flagged inactive. */
  inactiveDays: number;
  /** Price rows keyed by full model id (lowercased). Includes an "unknown" fallback row. */
  prices: Record<string, PriceRow>;
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

/** A registered developer (in-memory aggregate, replayed from developers.jsonl). */
export interface DeveloperRecord {
  developerId: string;
  displayName: string;
  /** Distinct device ids seen for this developer (multi-device disambiguation). */
  deviceIds: string[];
  /** scrypt hash of the bearer developerToken, used to authenticate reports. */
  tokenHash: string;
  /** ms epoch the developer registered. */
  createdAt: number;
  /** ms epoch (serverReceivedAt) of the last accepted report, or null. */
  lastReportAt: number | null;
}

/** One accepted usage report delta (one line in usage.jsonl). */
export interface UsageRecord {
  developerId: string;
  deviceId: string;
  /** Authoritative server clock — always bucket by this, never client timestamps. */
  serverReceivedAt: number;
  usage: ModelUsage[];
}

/** Registry events persisted to developers.jsonl. */
export type DeveloperEvent =
  | { ev: 'register'; developerId: string; displayName: string; deviceId: string; tokenHash: string; createdAt: number }
  | { ev: 'lastReport'; developerId: string; at: number; deviceId?: string };

/** Supported aggregation windows for the admin summary. */
export type UsageWindow = 'today' | '7d' | '30d' | 'quarter';
