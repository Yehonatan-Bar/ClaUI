import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCliCaller } from '../ClaudeCliCaller';
import { PhaseResult } from './types';

// Domain vocabulary - hardcoded from Python toolkit phase_c_tag_enrichment.py
const DOMAIN_VOCABULARY = [
  'data-analysis', 'data-processing', 'data-validation', 'data-profiling',
  'pdf-processing', 'pdf-extraction', 'document-processing', 'text-extraction',
  'api-development', 'backend', 'frontend', 'ui', 'dashboard',
  'deployment', 'infrastructure', 'devops', 'ci-cd',
  'ai-integration', 'llm', 'prompt-engineering', 'machine-learning',
  'database', 'sql', 'nosql', 'data-modeling',
  'testing', 'qa', 'automation', 'scripting',
  'logging', 'monitoring', 'observability', 'error-handling',
  'authentication', 'security', 'authorization',
  'file-processing', 'image-processing', 'audio-processing', 'video-processing',
  'web-scraping', 'etl', 'data-pipeline', 'workflow-automation',
  'cli-tools', 'utilities', 'configuration', 'settings',
];

// Pattern vocabulary - hardcoded from Python toolkit phase_c_tag_enrichment.py
const PATTERN_VOCABULARY = [
  'feature-implementation', 'bug-fix', 'refactor', 'optimization',
  'integration', 'migration', 'upgrade', 'configuration',
  'extraction', 'transformation', 'loading', 'etl',
  'api-wrapper', 'client-library', 'sdk-integration',
  'ui-component', 'form-handling', 'data-visualization',
  'error-handling', 'retry-logic', 'fallback',
  'caching', 'performance', 'scaling',
  'validation', 'sanitization', 'normalization',
  'report-generation', 'export', 'import',
  'scheduled-task', 'batch-processing', 'async-processing',
  'template-creation', 'code-generation', 'scaffolding',
];

interface EnrichmentResponse {
  domains: string[];
  patterns: string[];
  confidence: number;
  reasoning: string;
}

/**
 * Phase C.2: AI Tag Enrichment
 *
 * Reads doc cards from {clusters_dir}/doc_cards/ and enriches cards
 * that have missing domain/pattern tags using Claude CLI calls.
 * Writes enriched cards to {clusters_dir}/doc_cards_enriched/
 * and regenerated buckets to {clusters_dir}/buckets_enriched/.
 */
export class PhaseC2TagEnrichment {
  private log: (msg: string) => void = () => {};
  private cancelled = false;

  constructor(private readonly cliCaller: ClaudeCliCaller) {}

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(
    workspaceDir: string,
    model: string = 'claude-sonnet-4-6',
    onProgress?: (pct: number, label: string) => void,
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    this.cancelled = false;

    const clustersDir = path.join(workspaceDir, 'clusters');
    const docCardsDir = path.join(clustersDir, 'doc_cards');
    const enrichedCardsDir = path.join(clustersDir, 'doc_cards_enriched');
    const enrichedBucketsDir = path.join(clustersDir, 'buckets_enriched');

    fs.mkdirSync(enrichedCardsDir, { recursive: true });
    fs.mkdirSync(enrichedBucketsDir, { recursive: true });

    if (!fs.existsSync(docCardsDir)) {
      return { success: false, error: `doc_cards directory not found: ${docCardsDir}`, durationMs: Date.now() - startTime };
    }

    // Load all doc cards
    const cardFiles = fs.readdirSync(docCardsDir).filter(f => f.endsWith('.json'));
    const allCards: Record<string, any> = {};
    const cardsNeedingEnrichment: any[] = [];

    // Build index of existing enriched cards for incremental processing
    const existingEnriched: Record<string, any> = {};
    if (fs.existsSync(enrichedCardsDir)) {
      for (const file of fs.readdirSync(enrichedCardsDir).filter(f => f.endsWith('.json'))) {
        try {
          const enrichedCard = JSON.parse(fs.readFileSync(path.join(enrichedCardsDir, file), 'utf-8'));
          if (enrichedCard.doc_id) {
            existingEnriched[enrichedCard.doc_id] = enrichedCard;
          }
        } catch { /* skip corrupt files */ }
      }
    }

    let alreadyEnrichedCount = 0;

    for (const file of cardFiles) {
      const card = JSON.parse(fs.readFileSync(path.join(docCardsDir, file), 'utf-8'));
      allCards[card.doc_id] = card;
      if (this.needsEnrichment(card)) {
        // Check if already enriched in a previous run
        const prev = existingEnriched[card.doc_id];
        if (prev?._enrichment?.enriched) {
          // Reuse previous enrichment - don't re-call AI
          allCards[card.doc_id] = prev;
          alreadyEnrichedCount++;
        } else {
          cardsNeedingEnrichment.push(card);
        }
      }
    }

    this.log(`[PhaseC2] Found ${cardFiles.length} cards, ${alreadyEnrichedCount} already enriched (cached), ${cardsNeedingEnrichment.length} need enrichment now`);

    const results = { total: cardFiles.length, alreadyEnriched: alreadyEnrichedCount, enriched: 0, failed: 0, bucketChanges: 0 };
    const enrichedCards: Record<string, any> = {};

    // Process cards sequentially
    for (let i = 0; i < cardsNeedingEnrichment.length; i++) {
      if (this.cancelled) {
        return { success: false, error: 'Phase C.2 cancelled', durationMs: Date.now() - startTime };
      }

      const card = cardsNeedingEnrichment[i];
      const pct = Math.round((i / cardsNeedingEnrichment.length) * 100);
      onProgress?.(pct, `Enriching card ${i + 1}/${cardsNeedingEnrichment.length}`);

      this.log(`[PhaseC2] [${i + 1}/${cardsNeedingEnrichment.length}] Enriching ${(card.doc_id as string).slice(0, 40)}...`);

      try {
        const prompt = this.buildPrompt(card);
        const response = await this.cliCaller.callJson<EnrichmentResponse>({
          prompt,
          model,
          timeoutMs: 30_000,
        });

        // Validate against vocabulary
        const newDomains = response.domains?.filter((d: string) => DOMAIN_VOCABULARY.includes(d)) ?? [];
        const newPatterns = response.patterns?.filter((p: string) => PATTERN_VOCABULARY.includes(p)) ?? [];

        const enrichedCard = { ...card };
        enrichedCard.tags = { ...card.tags };
        enrichedCard.tags.domains = newDomains.length > 0 ? newDomains : (card.tags?.domains ?? []);
        enrichedCard.tags.patterns = newPatterns.length > 0 ? newPatterns : (card.tags?.patterns ?? []);

        // Recompute bucket key
        const primaryDomain = enrichedCard.tags.domains[0] || 'unknown';
        const primaryPattern = enrichedCard.tags.patterns[0] || 'unknown';
        const oldBucketKey = card.bucket_key || 'unknown__unknown';
        enrichedCard.bucket_key = `${primaryDomain}__${primaryPattern}`;

        enrichedCard._enrichment = {
          enriched: true,
          confidence: response.confidence ?? 0,
          reasoning: response.reasoning ?? '',
          original_bucket_key: oldBucketKey,
        };

        enrichedCards[card.doc_id] = enrichedCard;
        results.enriched++;

        if (oldBucketKey !== enrichedCard.bucket_key) {
          results.bucketChanges++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[PhaseC2] Error enriching ${card.doc_id}: ${msg}`);

        enrichedCards[card.doc_id] = {
          ...card,
          _enrichment: { enriched: false, error: msg },
        };
        results.failed++;
      }
    }

    // Save all cards (enriched where available, original otherwise)
    for (const [docId, card] of Object.entries(allCards)) {
      const saveCard = enrichedCards[docId] || card;
      fs.writeFileSync(
        path.join(enrichedCardsDir, `${docId}.json`),
        JSON.stringify(saveCard, null, 2),
        'utf-8'
      );
    }

    // Regenerate buckets
    this.regenerateBuckets(enrichedCardsDir, enrichedBucketsDir);

    // Save summary
    fs.writeFileSync(
      path.join(clustersDir, '_enrichment_summary.json'),
      JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2),
      'utf-8'
    );

    const durationMs = Date.now() - startTime;
    this.log(`[PhaseC2] Complete | enriched=${results.enriched} failed=${results.failed} bucketChanges=${results.bucketChanges} durationMs=${durationMs}`);

    return { success: true, durationMs };
  }

  private needsEnrichment(card: any): boolean {
    const tags = card.tags ?? {};
    const domains = tags.domains ?? [];
    const patterns = tags.patterns ?? [];

    const hasValidDomain = domains.some((d: string) => d && d !== 'unknown');
    const hasValidPattern = patterns.some((p: string) => p && p !== 'unknown');

    return !hasValidDomain || !hasValidPattern;
  }

  private buildPrompt(card: any): string {
    return `Analyze this document card and suggest appropriate domain and pattern tags.

DOCUMENT CARD:
${JSON.stringify(card, null, 2)}

ALLOWED DOMAIN VOCABULARY (use ONLY these terms):
${DOMAIN_VOCABULARY.join(', ')}

ALLOWED PATTERN VOCABULARY (use ONLY these terms):
${PATTERN_VOCABULARY.join(', ')}

TASK: Infer 1-3 domains and 1-3 patterns based on:
- The trigger/what_triggered text
- The workflow steps
- The artifacts produced
- Any issues encountered
- The existing tags (frameworks, languages, tools)

RESPOND WITH ONLY THIS JSON FORMAT:
{
    "domains": ["domain1", "domain2"],
    "patterns": ["pattern1", "pattern2"],
    "confidence": 0.8,
    "reasoning": "Brief explanation of why these tags were chosen"
}

Use ONLY terms from the allowed vocabularies. If nothing matches well, pick the closest term.
Do not invent new terms. Respond with ONLY the JSON, no markdown formatting.`;
  }

  private regenerateBuckets(enrichedCardsDir: string, enrichedBucketsDir: string): void {
    const buckets: Record<string, { doc_ids: string[]; primary_domain: string; primary_pattern: string; doc_count: number }> = {};

    for (const file of fs.readdirSync(enrichedCardsDir).filter(f => f.endsWith('.json'))) {
      const card = JSON.parse(fs.readFileSync(path.join(enrichedCardsDir, file), 'utf-8'));
      const bucketKey = card.bucket_key || 'unknown__unknown';
      const parts = bucketKey.split('__');

      if (!buckets[bucketKey]) {
        buckets[bucketKey] = {
          doc_ids: [],
          primary_domain: parts[0] || 'unknown',
          primary_pattern: parts[1] || 'unknown',
          doc_count: 0,
        };
      }

      buckets[bucketKey].doc_ids.push(card.doc_id);
      buckets[bucketKey].doc_count = buckets[bucketKey].doc_ids.length;
    }

    for (const [bucketKey, data] of Object.entries(buckets)) {
      const safeKey = bucketKey.replace(/[/\\]/g, '-');
      fs.writeFileSync(
        path.join(enrichedBucketsDir, `${safeKey}.json`),
        JSON.stringify({ bucket_key: bucketKey, ...data }, null, 2),
        'utf-8'
      );
    }
  }
}
