import type * as vscode from 'vscode';
import type {
  TokenUsageRatioSample,
  TokenRatioBucketSummary,
  UsageStat,
} from '../types/webview-messages';

/**
 * Cost weights relative to base input price.
 * Identical across Opus and Sonnet (same multiplier structure).
 * Input=$1x, Output=$5x, CacheWrite(5-min)=$1.25x, CacheRead=$0.1x
 */
const COST_WEIGHTS = {
  input: 1.0,
  output: 5.0,
  cacheCreation: 1.25, // 5-min TTL (Claude Code default)
  cacheRead: 0.1,
};

/** Persisted data shape for globalState */
interface TokenUsageRatioHistory {
  samples: TokenUsageRatioSample[];
  cumulativeTokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  cumulativeWeightedTokens: number;
  globalTurnCount: number;
  lastSampledAtTurnCount: number;
}

/** Token counts from a single turn */
export interface TurnTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const STORAGE_KEY = 'claudeMirror.tokenUsageRatio';
const SAMPLE_INTERVAL = 5; // every N turns
const MAX_SAMPLES = 500;

/** Compute the cost-weighted token value for a set of token counts */
function weightedSum(input: number, output: number, cacheCreation: number, cacheRead: number): number {
  return input * COST_WEIGHTS.input
    + output * COST_WEIGHTS.output
    + cacheCreation * COST_WEIGHTS.cacheCreation
    + cacheRead * COST_WEIGHTS.cacheRead;
}

/**
 * Correlates token consumption with usage percentage changes over time.
 * Tokens are cost-weighted so the ratio accurately reflects real API spend.
 * Global (shared across all tabs/sessions), persisted in VS Code globalState.
 */
export class TokenUsageRatioTracker {
  private history: TokenUsageRatioHistory;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly globalState: vscode.Memento) {
    this.history = this.load();
  }

  /**
   * Called after every turn (success or error).
   * Increments counters and returns true if a sample is due.
   */
  recordTurn(tokens: TurnTokens): boolean {
    this.history.cumulativeTokens.input += tokens.inputTokens;
    this.history.cumulativeTokens.output += tokens.outputTokens;
    this.history.cumulativeTokens.cacheCreation += tokens.cacheCreationTokens;
    this.history.cumulativeTokens.cacheRead += tokens.cacheReadTokens;

    this.history.cumulativeWeightedTokens += weightedSum(
      tokens.inputTokens, tokens.outputTokens,
      tokens.cacheCreationTokens, tokens.cacheReadTokens
    );

    this.history.globalTurnCount++;
    this.enqueueWrite();

    // Quick-start: trigger first baseline sample after just 2 turns
    if (this.history.samples.length === 0 && this.history.globalTurnCount >= 2) {
      return true;
    }

    // If all existing samples are baselines (no valid ratio yet), use shorter
    // interval (2 turns) to get real data ASAP instead of waiting the full 5.
    if (this.history.samples.length > 0 &&
        this.history.samples.every(s => s.tokensPerPercent === null)) {
      const turnsSince = this.history.globalTurnCount - this.history.lastSampledAtTurnCount;
      return turnsSince >= 2;
    }

    const turnsSinceLastSample = this.history.globalTurnCount - this.history.lastSampledAtTurnCount;
    return turnsSinceLastSample >= SAMPLE_INTERVAL;
  }

  /**
   * Create samples from a fresh usage fetch result.
   * One sample per bucket. Persists to globalState.
   */
  createSamples(usageStats: UsageStat[]): void {
    const now = Date.now();
    const cumRaw = this.totalCumulativeTokens();
    const cumWeighted = this.history.cumulativeWeightedTokens;

    for (const stat of usageStats) {
      // Use bucketKey (original API key like "seven_day_sonnet") when available;
      // fall back to label→key mapping for older data that predates this field.
      const bucket = stat.bucketKey ?? this.labelToBucketKey(stat.label);
      const lastForBucket = this.lastSampleForBucket(bucket);

      let deltaTokens = 0;
      let weightedDeltaTokens = 0;
      let deltaUsagePercent = 0;
      let tokensPerPercent: number | null = null;

      if (lastForBucket) {
        deltaTokens = cumRaw - lastForBucket.cumulativeTotalTokens;
        deltaUsagePercent = stat.percentage - lastForBucket.usagePercent;

        // Only compute weighted delta if previous sample had weighted data
        // (backward compat: old samples before cost-weighting have no weighted field)
        const prevWeighted = lastForBucket.cumulativeWeightedTokens;
        if (prevWeighted !== undefined && prevWeighted > 0) {
          weightedDeltaTokens = cumWeighted - prevWeighted;

          // Usage reset (window rolled over) or no change
          if (deltaUsagePercent > 0 && weightedDeltaTokens > 0) {
            tokensPerPercent = Math.round(weightedDeltaTokens / deltaUsagePercent);
          }
        } else {
          // Old sample without weighted data: use raw delta as fallback
          if (deltaUsagePercent > 0 && deltaTokens > 0) {
            tokensPerPercent = Math.round(deltaTokens / deltaUsagePercent);
          }
          weightedDeltaTokens = deltaTokens; // approximate for display
        }
        // Negative deltaUsagePercent = reset, null is appropriate
      } else {
        // First sample for this bucket: delta is entire cumulative (from zero).
        // We can't compute tokensPerPercent (no baseline usage% to diff),
        // but showing actual token accumulation is more useful than zeros.
        deltaTokens = cumRaw;
        weightedDeltaTokens = cumWeighted;
        // deltaUsagePercent stays 0 (unknown baseline), tokensPerPercent stays null
      }

      // Build a clear bucket label: "7 Days: Sonnet" or just "All Models" if only label available
      const bucketLabel = stat.period
        ? `${stat.period}: ${stat.modelLabel ?? stat.label}`
        : stat.label;

      const sample: TokenUsageRatioSample = {
        id: `${bucket}-${now}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        bucket,
        bucketLabel,
        usagePercent: stat.percentage,
        cumulativeTotalTokens: cumRaw,
        cumulativeWeightedTokens: cumWeighted,
        deltaTokens,
        weightedDeltaTokens,
        deltaUsagePercent,
        tokensPerPercent,
      };

      this.history.samples.push(sample);
    }

    // Trim to max
    if (this.history.samples.length > MAX_SAMPLES) {
      this.history.samples = this.history.samples.slice(-MAX_SAMPLES);
    }

    this.history.lastSampledAtTurnCount = this.history.globalTurnCount;
    this.enqueueWrite();
  }

  /** Get persisted history data */
  getHistory(): TokenUsageRatioHistory {
    return { ...this.history };
  }

  /** Compute per-bucket summary statistics */
  computeSummaries(): TokenRatioBucketSummary[] {
    const bucketMap = new Map<string, TokenUsageRatioSample[]>();

    for (const sample of this.history.samples) {
      const arr = bucketMap.get(sample.bucket) || [];
      arr.push(sample);
      bucketMap.set(sample.bucket, arr);
    }

    const summaries: TokenRatioBucketSummary[] = [];

    for (const [bucket, samples] of bucketMap) {
      const validSamples = samples.filter(s => s.tokensPerPercent !== null);
      const sampleCount = validSamples.length;
      const bucketLabel = samples[samples.length - 1]?.bucketLabel || bucket;

      let avgTokensPerPercent: number | null = null;
      let latestTokensPerPercent: number | null = null;
      let trend: TokenRatioBucketSummary['trend'] = 'insufficient-data';

      if (sampleCount > 0) {
        const sum = validSamples.reduce((acc, s) => acc + (s.tokensPerPercent ?? 0), 0);
        avgTokensPerPercent = Math.round(sum / sampleCount);
        latestTokensPerPercent = validSamples[validSamples.length - 1].tokensPerPercent;

        if (sampleCount >= 3) {
          const half = Math.floor(sampleCount / 2);
          const firstHalf = validSamples.slice(0, half);
          const secondHalf = validSamples.slice(half);
          const avgFirst = firstHalf.reduce((a, s) => a + (s.tokensPerPercent ?? 0), 0) / firstHalf.length;
          const avgSecond = secondHalf.reduce((a, s) => a + (s.tokensPerPercent ?? 0), 0) / secondHalf.length;
          const diff = avgSecond - avgFirst;
          const threshold = avgFirst * 0.1; // 10% change threshold
          if (diff > threshold) {
            trend = 'increasing';
          } else if (diff < -threshold) {
            trend = 'decreasing';
          } else {
            trend = 'stable';
          }
        }
      }

      summaries.push({
        bucket,
        bucketLabel,
        sampleCount,
        avgTokensPerPercent,
        latestTokensPerPercent,
        trend,
      });
    }

    return summaries;
  }

  /** Reset all tracked data */
  clearAll(): void {
    this.history = this.emptyHistory();
    this.enqueueWrite();
  }

  // --- Private helpers ---

  private totalCumulativeTokens(): number {
    const t = this.history.cumulativeTokens;
    return t.input + t.output + t.cacheCreation + t.cacheRead;
  }

  private lastSampleForBucket(bucket: string): TokenUsageRatioSample | undefined {
    for (let i = this.history.samples.length - 1; i >= 0; i--) {
      if (this.history.samples[i].bucket === bucket) {
        return this.history.samples[i];
      }
    }
    return undefined;
  }

  /** Map human-readable label back to a bucket key */
  private labelToBucketKey(label: string): string {
    const map: Record<string, string> = {
      'Current session': 'five_hour',
      'Current week (all models)': 'seven_day',
      'Current week (Opus only)': 'seven_day_opus',
      'Current week (Sonnet only)': 'seven_day_sonnet',
      'Current week (OAuth apps)': 'seven_day_oauth_apps',
      'Current week (CoWork)': 'seven_day_cowork',
    };
    return map[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  private load(): TokenUsageRatioHistory {
    const stored = this.globalState.get<TokenUsageRatioHistory>(STORAGE_KEY);
    if (stored && Array.isArray(stored.samples)) {
      // Backward compat: old history may not have cumulativeWeightedTokens
      if (typeof stored.cumulativeWeightedTokens !== 'number') {
        stored.cumulativeWeightedTokens = 0;
      }
      return stored;
    }
    return this.emptyHistory();
  }

  private emptyHistory(): TokenUsageRatioHistory {
    return {
      samples: [],
      cumulativeTokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      cumulativeWeightedTokens: 0,
      globalTurnCount: 0,
      lastSampledAtTurnCount: 0,
    };
  }

  /** Serialize writes to avoid race conditions from multiple tabs */
  private enqueueWrite(): void {
    this.writeQueue = this.writeQueue.then(() =>
      this.globalState.update(STORAGE_KEY, this.history)
    ).catch(() => {
      // Non-critical: globalState write failed
    });
  }
}
