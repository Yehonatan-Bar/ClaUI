import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCliCaller } from '../ClaudeCliCaller';
import { PhaseResult } from './types';

interface ClusterAssignmentResponse {
  decision: 'new_cluster' | 'assign';
  cluster_name: string;
  cluster_description?: string;
  confidence: number;
  reason: string;
  updated_signature?: {
    trigger_phrases?: string[];
    typical_outputs?: string[];
  };
}

interface IncrementalCluster {
  cluster_name: string;
  cluster_description: string;
  member_doc_ids: string[];
  member_count: number;
  top_tags: any;
  trigger_phrases: string[];
  typical_outputs: string[];
  singleton: boolean;
}

/**
 * Phase C.3: Incremental Clustering
 *
 * For each bucket, processes docs sequentially. For each doc, AI decides
 * whether to assign it to an existing cluster or create a new one.
 * Order matters - clusters build incrementally within each bucket.
 */
export class PhaseC3IncrementalClustering {
  private log: (msg: string) => void = () => {};
  private cancelled = false;
  private maxClustersPerPrompt = 10;

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
    minDocsPerBucket: number = 3,
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    this.cancelled = false;

    const clustersDir = path.join(workspaceDir, 'clusters');
    const enrichedCardsDir = fs.existsSync(path.join(clustersDir, 'doc_cards_enriched'))
      ? path.join(clustersDir, 'doc_cards_enriched')
      : path.join(clustersDir, 'doc_cards');
    const enrichedBucketsDir = fs.existsSync(path.join(clustersDir, 'buckets_enriched'))
      ? path.join(clustersDir, 'buckets_enriched')
      : path.join(clustersDir, 'buckets');
    const outputDir = path.join(clustersDir, 'clusters_incremental');

    fs.mkdirSync(outputDir, { recursive: true });

    if (!fs.existsSync(enrichedBucketsDir)) {
      return { success: false, error: `Buckets directory not found: ${enrichedBucketsDir}`, durationMs: Date.now() - startTime };
    }

    // Load all buckets
    const bucketFiles = fs.readdirSync(enrichedBucketsDir).filter(f => f.endsWith('.json'));
    const bucketsToProcess: { file: string; bucket: any }[] = [];

    for (const file of bucketFiles) {
      const bucket = JSON.parse(fs.readFileSync(path.join(enrichedBucketsDir, file), 'utf-8'));
      if ((bucket.doc_ids?.length ?? 0) >= minDocsPerBucket) {
        bucketsToProcess.push({ file, bucket });
      }
    }

    const skippedBuckets = bucketFiles.length - bucketsToProcess.length;
    if (skippedBuckets > 0) {
      this.log(`[PhaseC3] Skipped ${skippedBuckets} buckets below minDocsPerBucket=${minDocsPerBucket}`);
    }
    this.log(`[PhaseC3] Processing ${bucketsToProcess.length} buckets (minDocsPerBucket=${minDocsPerBucket})`);

    const results = { totalBuckets: bucketFiles.length, processed: 0, totalClusters: 0, totalDocs: 0 };

    for (let i = 0; i < bucketsToProcess.length; i++) {
      if (this.cancelled) {
        return { success: false, error: 'Phase C.3 cancelled', durationMs: Date.now() - startTime };
      }

      const { bucket } = bucketsToProcess[i];
      const bucketKey = bucket.bucket_key || 'unknown';
      const docIds: string[] = bucket.doc_ids || [];

      const pct = Math.round((i / bucketsToProcess.length) * 100);
      onProgress?.(pct, `Clustering bucket ${i + 1}/${bucketsToProcess.length}: ${bucketKey}`);

      this.log(`[PhaseC3] [${i + 1}/${bucketsToProcess.length}] ${bucketKey} (${docIds.length} docs)`);

      const bucketResult = await this.processBucket(bucketKey, docIds, enrichedCardsDir, model);

      // Save result
      const safeKey = bucketKey.replace(/[/\\]/g, '-');
      fs.writeFileSync(
        path.join(outputDir, `${safeKey}.json`),
        JSON.stringify(bucketResult, null, 2),
        'utf-8'
      );

      results.processed++;
      results.totalClusters += bucketResult.clusters.length;
      results.totalDocs += bucketResult.total_docs;

      this.log(`[PhaseC3]   -> Created ${bucketResult.clusters.length} clusters`);
    }

    // Save summary
    fs.writeFileSync(
      path.join(clustersDir, '_incremental_clustering_summary.json'),
      JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2),
      'utf-8'
    );

    const durationMs = Date.now() - startTime;
    this.log(`[PhaseC3] Complete | buckets=${results.processed} clusters=${results.totalClusters} docs=${results.totalDocs} durationMs=${durationMs}`);

    return { success: true, durationMs };
  }

  private async processBucket(
    bucketKey: string,
    docIds: string[],
    cardsDir: string,
    model: string,
  ): Promise<{ bucket_key: string; total_docs: number; clusters: IncrementalCluster[]; assignments: any[] }> {
    const result = { bucket_key: bucketKey, total_docs: docIds.length, clusters: [] as IncrementalCluster[], assignments: [] as any[] };

    if (!docIds.length) return result;

    const clusters: IncrementalCluster[] = [];

    for (const docId of docIds) {
      if (this.cancelled) break;

      const cardPath = path.join(cardsDir, `${docId}.json`);
      if (!fs.existsSync(cardPath)) {
        this.log(`[PhaseC3]   WARNING: Card not found for ${docId}`);
        continue;
      }
      const card = JSON.parse(fs.readFileSync(cardPath, 'utf-8'));

      try {
        const prompt = this.buildAssignmentPrompt(card, clusters);
        const decision = await this.cliCaller.callJson<ClusterAssignmentResponse>({
          prompt,
          model,
          timeoutMs: 30_000,
        });

        if (decision.decision === 'new_cluster') {
          const newCluster: IncrementalCluster = {
            cluster_name: decision.cluster_name || `cluster-${clusters.length + 1}`,
            cluster_description: decision.cluster_description || '',
            member_doc_ids: [docId],
            member_count: 1,
            top_tags: card.tags || {},
            trigger_phrases: card.trigger?.keywords || [],
            typical_outputs: card.artifacts || [],
            singleton: docIds.length === 1,
          };
          clusters.push(newCluster);
          result.assignments.push({ doc_id: docId, decision: 'new_cluster', cluster_name: newCluster.cluster_name, confidence: decision.confidence ?? 0 });
        } else {
          // Assign to existing cluster
          const targetName = decision.cluster_name || '';
          const targetCluster = clusters.find(c => c.cluster_name === targetName);

          if (targetCluster) {
            targetCluster.member_doc_ids.push(docId);
            targetCluster.member_count++;
            targetCluster.singleton = false;

            // Update signature
            const updatedSig = decision.updated_signature;
            if (updatedSig?.trigger_phrases) {
              const existing = new Set(targetCluster.trigger_phrases);
              for (const phrase of updatedSig.trigger_phrases) {
                if (phrase && !existing.has(phrase)) {
                  targetCluster.trigger_phrases.push(phrase);
                }
              }
            }
            if (updatedSig?.typical_outputs) {
              const existing = new Set(targetCluster.typical_outputs);
              for (const output of updatedSig.typical_outputs) {
                if (output && !existing.has(output)) {
                  targetCluster.typical_outputs.push(output);
                }
              }
            }

            result.assignments.push({ doc_id: docId, decision: 'assign', cluster_name: targetName, confidence: decision.confidence ?? 0 });
          } else {
            // Fallback: create new cluster if target not found
            this.log(`[PhaseC3]   WARNING: Target cluster '${targetName}' not found, creating new`);
            const newCluster: IncrementalCluster = {
              cluster_name: decision.cluster_name || `cluster-${clusters.length + 1}`,
              cluster_description: decision.cluster_description || '',
              member_doc_ids: [docId],
              member_count: 1,
              top_tags: card.tags || {},
              trigger_phrases: card.trigger?.keywords || [],
              typical_outputs: card.artifacts || [],
              singleton: false,
            };
            clusters.push(newCluster);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[PhaseC3]   ERROR processing ${docId}: ${msg} - skipping (no singleton fallback)`);
      }
    }

    result.clusters = clusters;
    return result;
  }

  private buildAssignmentPrompt(card: any, clusters: IncrementalCluster[]): string {
    const cardSummary = this.buildDocCardSummary(card);

    if (!clusters.length) {
      return `This is the first document in a new bucket. Create an initial cluster for it.

DOCUMENT:
${cardSummary}

Create a cluster that could potentially group similar documents.

RESPOND WITH ONLY THIS JSON:
{
    "decision": "new_cluster",
    "cluster_name": "kebab-case-name",
    "cluster_description": "2-3 sentences describing what this cluster captures",
    "confidence": 0.8,
    "reason": "Brief explanation"
}

Use kebab-case for cluster_name. Make the description specific enough to distinguish from other potential clusters.`;
    }

    const clusterSummaries = clusters.slice(0, this.maxClustersPerPrompt).map((c, i) => {
      return `CLUSTER ${i + 1}: ${c.cluster_name}
Name: ${c.cluster_name}
Description: ${(c.cluster_description || '').slice(0, 200)}
Domains: ${(c.top_tags?.domains || []).slice(0, 5).join(', ')}
Patterns: ${(c.top_tags?.patterns || []).slice(0, 5).join(', ')}
Triggers: ${c.trigger_phrases.slice(0, 5).join(', ')}
Outputs: ${c.typical_outputs.slice(0, 5).join(', ')}
Member count: ${c.member_count}`;
    }).join('\n\n---\n\n');

    return `Decide whether this document belongs to an existing cluster or needs a new cluster.

DOCUMENT:
${cardSummary}

EXISTING CLUSTERS:
${clusterSummaries}

DECISION CRITERIA:
- ASSIGN if the document clearly fits an existing cluster (same trigger type, similar workflow, similar outputs)
- NEW_CLUSTER if the document represents a distinctly different task type

RESPOND WITH ONLY THIS JSON:
{
    "decision": "assign" or "new_cluster",
    "cluster_name": "name of existing cluster to assign to, or new kebab-case name if creating",
    "cluster_description": "only needed if decision is new_cluster",
    "confidence": 0.0-1.0,
    "reason": "Brief explanation of decision",
    "updated_signature": {
        "trigger_phrases": ["if decision is assign, list any new trigger phrases to add"],
        "typical_outputs": ["if decision is assign, list any new outputs to add"]
    }
}

Be conservative - prefer assigning to existing clusters unless the document is truly different.`;
  }

  private buildDocCardSummary(card: any): string {
    const parts: string[] = [];
    parts.push(`Doc ID: ${card.doc_id || 'unknown'}`);

    if (card.trigger?.what_triggered) {
      parts.push(`Trigger: ${(card.trigger.what_triggered as string).slice(0, 200)}`);
    }
    if (card.trigger?.keywords?.length) {
      parts.push(`Keywords: ${card.trigger.keywords.slice(0, 5).join(', ')}`);
    }
    if (card.tags?.domains?.length) {
      parts.push(`Domains: ${card.tags.domains.slice(0, 3).join(', ')}`);
    }
    if (card.tags?.patterns?.length) {
      parts.push(`Patterns: ${card.tags.patterns.slice(0, 3).join(', ')}`);
    }
    if (card.workflow_steps?.length) {
      parts.push(`Workflow: ${card.workflow_steps.slice(0, 3).join(' -> ')}`);
    }
    if (card.artifacts?.length) {
      parts.push(`Artifacts: ${card.artifacts.slice(0, 3).join(', ')}`);
    }

    return parts.join('\n');
  }
}
