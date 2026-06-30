import { TokenCounts, PriceRow } from './types';

/**
 * Cost-weight multipliers (relative to base input price) used for the "weighted
 * tokens" metric shown in the dashboard. These mirror the client-side
 * TokenUsageRatioTracker weights so the figure is consistent across the product.
 * They are NOT used for the dollar cost — that comes from the editable price list.
 */
const WEIGHTS: TokenCounts = {
  input: 1.0,
  output: 5.0,
  cacheCreation: 1.25,
  cacheRead: 0.1,
};

const ZERO: TokenCounts = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

/** Sum two token-count objects. */
export function addCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/** Raw (unweighted) token total. */
export function rawTokens(c: TokenCounts): number {
  return c.input + c.output + c.cacheCreation + c.cacheRead;
}

/** Cost-weighted token total (input=1x, output=5x, cacheWrite=1.25x, cacheRead=0.1x). */
export function weightedTokens(c: TokenCounts): number {
  return c.input * WEIGHTS.input
    + c.output * WEIGHTS.output
    + c.cacheCreation * WEIGHTS.cacheCreation
    + c.cacheRead * WEIGHTS.cacheRead;
}

/**
 * Map a reported full model id to a price-list key.
 * 1. exact (case-insensitive) match
 * 2. longest price key that is a prefix of the model id (handles dated suffixes
 *    like "claude-opus-4-8-20250101")
 * 3. "unknown" fallback
 */
export function resolvePriceKey(modelId: string, prices: Record<string, PriceRow>): string {
  const id = (modelId || '').trim().toLowerCase();
  if (!id) return 'unknown';
  if (prices[id]) return id;

  let best: string | null = null;
  for (const key of Object.keys(prices)) {
    if (key === 'unknown') continue;
    if (id.startsWith(key) && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best ?? 'unknown';
}

/** Dollar cost of a single model's token counts against one price row. */
export function costForModel(counts: TokenCounts, price: PriceRow): number {
  return (counts.input / 1_000_000) * price.input
    + (counts.output / 1_000_000) * price.output
    + (counts.cacheCreation / 1_000_000) * price.cacheCreation
    + (counts.cacheRead / 1_000_000) * price.cacheRead;
}

export interface CostBreakdown {
  costUsd: number;
  rawTokens: number;
  weightedTokens: number;
  /** Per-model breakdown keyed by the original reported model id. */
  byModel: Record<string, { costUsd: number; rawTokens: number; weightedTokens: number; priceKey: string }>;
  /** Raw token count whose model resolved to the zero-priced "unknown" row. */
  unpricedTokens: number;
  /** Distinct model ids that had no real price row (resolved to "unknown"). */
  unpricedModels: string[];
}

/**
 * Aggregate cost + token metrics for a map of (reported model id -> token counts).
 * cost = Σ_model Σ_type (tokens / 1M) × price[type]. Models without a real price
 * row contribute zero cost but their token volume is surfaced as `unpricedTokens`.
 */
export function computeCost(
  usageByModel: Record<string, TokenCounts>,
  prices: Record<string, PriceRow>,
): CostBreakdown {
  const out: CostBreakdown = {
    costUsd: 0,
    rawTokens: 0,
    weightedTokens: 0,
    byModel: {},
    unpricedTokens: 0,
    unpricedModels: [],
  };
  const unpriced = new Set<string>();

  for (const [model, counts] of Object.entries(usageByModel)) {
    const c = counts ?? ZERO;
    const priceKey = resolvePriceKey(model, prices);
    const price = prices[priceKey] ?? prices['unknown'] ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    const cost = costForModel(c, price);
    const raw = rawTokens(c);
    const weighted = weightedTokens(c);

    out.costUsd += cost;
    out.rawTokens += raw;
    out.weightedTokens += weighted;
    out.byModel[model] = { costUsd: cost, rawTokens: raw, weightedTokens: weighted, priceKey };

    if (priceKey === 'unknown' && raw > 0) {
      out.unpricedTokens += raw;
      unpriced.add(model || 'unknown');
    }
  }

  out.unpricedModels = [...unpriced];
  return out;
}
