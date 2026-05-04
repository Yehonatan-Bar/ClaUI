import type { SessionSummary } from '../types/webview-messages';
import type { EnrichedSessionData } from '../types/workstreamTypes';
import type { SessionMetadata } from '../session/SessionStore';

export class SessionBackfiller {
  enrichFromSummary(summary: SessionSummary, metadata?: SessionMetadata): EnrichedSessionData {
    const enriched: EnrichedSessionData = {
      sessionId: summary.sessionId,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      totalTurns: summary.totalTurns,
      totalCostUsd: summary.totalCostUsd,
    };

    if (summary.filesModified?.length) {
      enriched.filesModified = summary.filesModified;
    }
    if (summary.filesRead?.length) {
      enriched.filesRead = summary.filesRead;
    }
    if (summary.gitBranch) {
      enriched.gitBranch = summary.gitBranch;
    }
    if (summary.gitCommit) {
      enriched.gitCommit = summary.gitCommit;
    }
    if (summary.firstPrompt) {
      enriched.firstPrompt = summary.firstPrompt;
    }
    if (summary.summary) {
      enriched.summary = summary.summary;
    }
    if (summary.outcome) {
      enriched.outcome = summary.outcome;
    }

    // Derive task type from distribution if not already set
    if (!summary.taskType && summary.taskTypeDistribution) {
      const dominant = this.getDominantKey(summary.taskTypeDistribution);
      if (dominant) {
        enriched.taskType = dominant;
      }
    } else if (summary.taskType) {
      enriched.taskType = summary.taskType;
    }

    // Derive outcome from error rate if not set
    if (!enriched.outcome) {
      enriched.outcome = this.deriveOutcome(summary);
    }

    // Pull first prompt and summary from metadata if available
    if (!enriched.firstPrompt && metadata?.firstPrompt) {
      enriched.firstPrompt = metadata.firstPrompt;
    }
    if (!enriched.summary && metadata?.summary) {
      enriched.summary = metadata.summary;
    }

    return enriched;
  }

  enrichMultiple(
    summaries: SessionSummary[],
    metadataMap: Map<string, SessionMetadata>,
  ): EnrichedSessionData[] {
    return summaries.map(s =>
      this.enrichFromSummary(s, metadataMap.get(s.sessionId))
    );
  }

  isAdequatelyEnriched(data: EnrichedSessionData): boolean {
    return !!(data.firstPrompt || data.summary) && !!(data.startedAt);
  }

  private getDominantKey(distribution: Record<string, number>): string | undefined {
    let maxKey: string | undefined;
    let maxVal = 0;
    for (const [key, val] of Object.entries(distribution)) {
      if (val > maxVal) {
        maxVal = val;
        maxKey = key;
      }
    }
    return maxKey;
  }

  private deriveOutcome(summary: SessionSummary): 'completed' | 'failed' | 'partial' | 'unknown' {
    if (summary.errorRate > 0.5) { return 'failed'; }
    if (summary.totalTurns < 2) { return 'unknown'; }
    if (summary.errorRate > 0.2) { return 'partial'; }
    if (summary.totalTurns >= 2 && summary.errorRate <= 0.1) { return 'completed'; }
    return 'unknown';
  }
}
