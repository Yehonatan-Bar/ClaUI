import { CostConfig, PriceRow } from './types';

/**
 * Seed API price list (USD per 1M tokens), taken from the official price list in
 * Kingdom_of_Claudes_Beloved_MDs/tokens_usage_costs_HE.txt.
 *
 * cacheCreation models the 5-minute cache-write tier (input x 1.25, the Claude
 * Code default). cacheRead is input x 0.1. The 1-hour cache-write tier (input
 * x 2.0) is out of MVP scope. The admin can edit any of these in the dashboard
 * and add new rows for models that ship later.
 */
export const DEFAULT_PRICES: Record<string, PriceRow> = {
  'claude-opus-4-8':   { input: 5.0,  output: 25.0, cacheCreation: 6.25,  cacheRead: 0.5 },
  'claude-opus-4-7':   { input: 5.0,  output: 25.0, cacheCreation: 6.25,  cacheRead: 0.5 },
  'claude-opus-4-6':   { input: 5.0,  output: 25.0, cacheCreation: 6.25,  cacheRead: 0.5 },
  'claude-opus-4-5':   { input: 5.0,  output: 25.0, cacheCreation: 6.25,  cacheRead: 0.5 },
  // Sonnet 5 standard pricing. Note: an introductory promo of $2/$10 input/output
  // runs through 2026-08-31 — an admin can lower this row during the promo window.
  'claude-sonnet-5':   { input: 3.0,  output: 15.0, cacheCreation: 3.75,  cacheRead: 0.3 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0, cacheCreation: 3.75,  cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3.0,  output: 15.0, cacheCreation: 3.75,  cacheRead: 0.3 },
  'claude-haiku-4-5':  { input: 1.0,  output: 5.0,  cacheCreation: 1.25,  cacheRead: 0.1 },
  'claude-fable-5':    { input: 10.0, output: 50.0, cacheCreation: 12.5,  cacheRead: 1.0 },
  // Fallback row for any model id we have no price for. Kept at zero so unknown
  // tokens are never silently mispriced; their volume is surfaced separately as
  // "unpriced tokens" so an admin knows to add a real row.
  'unknown':           { input: 0,    output: 0,    cacheCreation: 0,     cacheRead: 0 },
};

/** A fresh, fully-populated cost config seeded with the defaults above. */
export function defaultCostConfig(nowIso: string): CostConfig {
  return {
    currency: 'USD',
    exchangeRate: 1,
    monthlyBudgetUsd: 500,
    spikePercent: 150,
    inactiveDays: 14,
    // Clone so callers can mutate without touching the module-level defaults.
    prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
    updatedAt: nowIso,
  };
}
