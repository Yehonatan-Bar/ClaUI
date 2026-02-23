import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCliCaller } from '../ClaudeCliCaller';
import { PhaseResult } from './types';

// Domain rollups - hardcoded from Python toolkit phase_c4_merge_clusters.py
const DEFAULT_DOMAIN_ROLLUPS: Record<string, string[]> = {
  'pdf-processing': ['pdf-processing', 'pdf-extraction', 'document-processing', 'text-extraction'],
  'data-analysis': ['data-analysis', 'data-processing', 'data-validation', 'data-profiling', 'excel'],
  'frontend': ['frontend', 'ui', 'dashboard', 'html-generation', 'forms'],
  'api-development': ['api-development', 'backend', 'api', 'fastapi'],
  'deployment': ['deployment', 'infrastructure', 'devops', 'ci-cd'],
  'ai-integration': ['ai-integration', 'llm', 'prompt-engineering', 'machine-learning'],
  'monitoring': ['monitoring', 'logging', 'observability', 'error-handling'],
};

interface RollupMergeResponse {
  recommendation: 'merge_all' | 'split';
  skills: Array<{
    skill_name: string;
    skill_description: string;
    activation_triggers: string[];
    cluster_names: string[];
    estimated_doc_count: number;
  }>;
  rationale: string;
}

interface ClusterSignature {
  cluster_name: string;
  cluster_description: string;
  member_doc_ids: string[];
  member_count: number;
  is_singleton: boolean;
  source_bucket: string;
  domains: string[];
  patterns: string[];
  frameworks: string[];
  trigger_phrases: string[];
  typical_outputs: string[];
  domain_rollup: string;
}

interface RollupGroup {
  rollup: string;
  cluster_names: string[];
  member_count: number;
  total_docs: number;
  domains: string[];
  patterns: string[];
  trigger_phrases: string[];
  typical_outputs: string[];
}

/**
 * Phase C.4: Cross-Bucket Cluster Merging
 *
 * Groups clusters by domain rollup, then for each group the AI decides
 * whether to keep as one skill or split into sub-skills.
 * Far fewer CLI calls than C.2/C.3 (one per rollup group).
 */
export class PhaseC4CrossBucketMerge {
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
    const incrementalDir = path.join(clustersDir, 'clusters_incremental');
    const finalDir = path.join(clustersDir, 'clusters_final');
    const enrichedCardsDir = fs.existsSync(path.join(clustersDir, 'doc_cards_enriched'))
      ? path.join(clustersDir, 'doc_cards_enriched')
      : path.join(clustersDir, 'doc_cards');

    fs.mkdirSync(finalDir, { recursive: true });

    if (!fs.existsSync(incrementalDir)) {
      return { success: false, error: `clusters_incremental directory not found: ${incrementalDir}`, durationMs: Date.now() - startTime };
    }

    // Load all incremental clusters
    const allClusters = this.loadAllIncrementalClusters(incrementalDir);
    this.log(`[PhaseC4] Loaded ${allClusters.length} incremental clusters`);

    // Compute signatures
    const signatures = allClusters.map(c => this.computeSignature(c));
    const sigMap: Record<string, ClusterSignature> = {};
    for (const sig of signatures) {
      sigMap[sig.cluster_name] = sig;
    }

    // Build rollup groups
    const rollupGroups = this.buildRollupGroups(signatures);
    this.log(`[PhaseC4] Created ${rollupGroups.length} rollup groups`);
    for (const g of rollupGroups) {
      this.log(`[PhaseC4]   ${g.rollup}: ${g.member_count} clusters, ${g.total_docs} docs`);
    }

    // Process each rollup group with AI
    const finalClusters: any[] = [];
    const mergeDecisions: any[] = [];

    for (let i = 0; i < rollupGroups.length; i++) {
      if (this.cancelled) {
        return { success: false, error: 'Phase C.4 cancelled', durationMs: Date.now() - startTime };
      }

      const group = rollupGroups[i];
      const pct = Math.round((i / rollupGroups.length) * 100);
      onProgress?.(pct, `Merging group ${i + 1}/${rollupGroups.length}: ${group.rollup}`);

      this.log(`[PhaseC4] [${i + 1}/${rollupGroups.length}] ${group.rollup} (${group.total_docs} docs)`);

      try {
        const prompt = this.buildRollupPrompt(group, sigMap);
        const aiResult = await this.cliCaller.callJson<RollupMergeResponse>({
          prompt,
          model,
          timeoutMs: 60_000,
        });

        const recommendation = aiResult.recommendation || 'merge_all';
        const skills = aiResult.skills || [];

        this.log(`[PhaseC4]   AI recommends: ${recommendation}`);

        // If merge_all with 1 skill, use all cluster names
        if (recommendation === 'merge_all' && skills.length === 1) {
          skills[0].cluster_names = group.cluster_names;
        }

        for (const skillDef of skills) {
          if (!skillDef.cluster_names?.length) {
            skillDef.cluster_names = group.cluster_names;
          }

          const cluster = this.createSkillCluster(skillDef, group, sigMap);
          finalClusters.push(cluster);
          this.log(`[PhaseC4]   -> ${cluster.cluster_name} (${cluster.member_count} docs)`);
        }

        mergeDecisions.push({
          rollup: group.rollup,
          source_clusters: group.cluster_names,
          recommendation,
          skills_created: skills.map(s => s.skill_name),
          rationale: aiResult.rationale,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[PhaseC4]   ERROR: ${msg}`);

        // Fallback: create one cluster per rollup
        const fallbackSkill = {
          skill_name: `${group.rollup}-skill`,
          skill_description: `Skills related to ${group.rollup}.`,
          activation_triggers: group.trigger_phrases.slice(0, 5),
          cluster_names: group.cluster_names,
          estimated_doc_count: group.total_docs,
        };
        finalClusters.push(this.createSkillCluster(fallbackSkill, group, sigMap));
      }
    }

    // Save final clusters
    for (const cluster of finalClusters) {
      const safeName = cluster.cluster_name.replace(/[/\\]/g, '-');
      fs.writeFileSync(
        path.join(finalDir, `${safeName}.json`),
        JSON.stringify(cluster, null, 2),
        'utf-8'
      );
    }

    // Create doc-to-cluster map
    const docToCluster: Record<string, string> = {};
    for (const cluster of finalClusters) {
      for (const docId of cluster.member_doc_ids || []) {
        docToCluster[docId] = cluster.cluster_name;
      }
    }
    fs.writeFileSync(
      path.join(clustersDir, 'doc_to_cluster_map_final.json'),
      JSON.stringify(docToCluster, null, 2),
      'utf-8'
    );

    // Save summary
    const summary = {
      generated_at: new Date().toISOString(),
      statistics: {
        input_clusters: allClusters.length,
        output_clusters: finalClusters.length,
        reduction_percent: (1 - finalClusters.length / Math.max(allClusters.length, 1)) * 100,
      },
      merge_decisions: mergeDecisions,
    };
    fs.writeFileSync(
      path.join(clustersDir, '_merge_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    const durationMs = Date.now() - startTime;
    this.log(`[PhaseC4] Complete | input=${allClusters.length} output=${finalClusters.length} durationMs=${durationMs}`);

    return { success: true, durationMs };
  }

  private loadAllIncrementalClusters(dir: string): any[] {
    const clusters: any[] = [];
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const bucketKey = data.bucket_key || path.basename(file, '.json');
        for (const cluster of data.clusters || []) {
          cluster.source_bucket = bucketKey;
          cluster.source_file = file;
          clusters.push(cluster);
        }
      } catch (err) {
        this.log(`[PhaseC4] WARNING: Failed to load ${file}: ${err}`);
      }
    }
    return clusters;
  }

  private computeSignature(cluster: any): ClusterSignature {
    const tags = cluster.top_tags || {};
    const domains = tags.domains || [];
    return {
      cluster_name: cluster.cluster_name || 'unknown',
      cluster_description: (cluster.cluster_description || '').slice(0, 200),
      member_doc_ids: cluster.member_doc_ids || [],
      member_count: (cluster.member_doc_ids || []).length,
      is_singleton: cluster.singleton || false,
      source_bucket: cluster.source_bucket || '',
      domains,
      patterns: tags.patterns || [],
      frameworks: tags.frameworks || [],
      trigger_phrases: (cluster.trigger_phrases || []).slice(0, 10),
      typical_outputs: (cluster.typical_outputs || []).slice(0, 10),
      domain_rollup: this.getDomainRollup(domains),
    };
  }

  private getDomainRollup(domains: string[]): string {
    if (!domains.length) return 'misc';
    for (const [rollup, members] of Object.entries(DEFAULT_DOMAIN_ROLLUPS)) {
      for (const domain of domains) {
        const lower = domain.toLowerCase();
        if (members.includes(lower) || members.some(m => lower.includes(m))) {
          return rollup;
        }
      }
    }
    return 'misc';
  }

  private buildRollupGroups(signatures: ClusterSignature[]): RollupGroup[] {
    const groups: Record<string, ClusterSignature[]> = {};
    for (const sig of signatures) {
      const rollup = sig.domain_rollup;
      if (!groups[rollup]) groups[rollup] = [];
      groups[rollup].push(sig);
    }

    const result: RollupGroup[] = [];
    for (const [rollup, sigs] of Object.entries(groups)) {
      const allDomains = new Set<string>();
      const allPatterns = new Set<string>();
      const allTriggers = new Set<string>();
      const allOutputs = new Set<string>();

      for (const s of sigs) {
        s.domains.forEach(d => allDomains.add(d));
        s.patterns.forEach(p => allPatterns.add(p));
        s.trigger_phrases.forEach(t => allTriggers.add(t));
        s.typical_outputs.forEach(o => allOutputs.add(o));
      }

      result.push({
        rollup,
        cluster_names: sigs.map(s => s.cluster_name),
        member_count: sigs.length,
        total_docs: sigs.reduce((sum, s) => sum + s.member_count, 0),
        domains: [...allDomains].sort(),
        patterns: [...allPatterns].sort(),
        trigger_phrases: [...allTriggers].sort().slice(0, 20),
        typical_outputs: [...allOutputs].sort().slice(0, 20),
      });
    }

    return result.sort((a, b) => b.total_docs - a.total_docs);
  }

  private buildRollupPrompt(group: RollupGroup, sigMap: Record<string, ClusterSignature>): string {
    const clusterDetails = group.cluster_names.slice(0, 15).map(name => {
      const sig = sigMap[name];
      return sig ? {
        name,
        docs: sig.member_count,
        description: sig.cluster_description.slice(0, 100),
        triggers: sig.trigger_phrases.slice(0, 3),
      } : null;
    }).filter(Boolean);

    return `You are consolidating development task clusters into Skills.

ROLLUP DOMAIN: ${group.rollup}
TOTAL CLUSTERS: ${group.member_count}
TOTAL DOCUMENTS: ${group.total_docs}

SAMPLE CLUSTERS:
${JSON.stringify(clusterDetails, null, 2)}

AGGREGATE INFO:
- Domains: ${JSON.stringify(group.domains.slice(0, 10))}
- Patterns: ${JSON.stringify(group.patterns.slice(0, 10))}
- Trigger phrases: ${JSON.stringify(group.trigger_phrases.slice(0, 10))}
- Output types: ${JSON.stringify(group.typical_outputs.slice(0, 10))}

TASK: Create a unified Skill definition for this domain.

Consider:
1. Should this be ONE skill or split into 2-3 sub-skills?
2. Only split if there are CLEARLY distinct use cases
3. When in doubt, keep as ONE skill (fewer = better)

RESPOND WITH ONLY JSON:
{
  "recommendation": "merge_all" or "split",
  "skills": [
    {
      "skill_name": "kebab-case-name",
      "skill_description": "2-3 sentences: what this skill does and when to activate",
      "activation_triggers": ["trigger1", "trigger2", "trigger3"],
      "cluster_names": ["list of cluster names for this skill"],
      "estimated_doc_count": 10
    }
  ],
  "rationale": "Brief explanation"
}

If "merge_all", skills array has 1 item with ALL cluster_names.
If "split", skills array has 2-3 items with subsets.`;
  }

  private createSkillCluster(skillDef: any, group: RollupGroup, sigMap: Record<string, ClusterSignature>): any {
    const allDocIds = new Set<string>();
    const allDomains = new Set<string>();
    const allPatterns = new Set<string>();
    const allFrameworks = new Set<string>();
    const allTriggers = new Set<string>();
    const allOutputs = new Set<string>();
    const sourceBuckets = new Set<string>();

    for (const name of skillDef.cluster_names || []) {
      const sig = sigMap[name];
      if (sig) {
        sig.member_doc_ids.forEach((id: string) => allDocIds.add(id));
        sig.domains.forEach((d: string) => allDomains.add(d));
        sig.patterns.forEach((p: string) => allPatterns.add(p));
        sig.frameworks.forEach((f: string) => allFrameworks.add(f));
        sig.trigger_phrases.forEach((t: string) => allTriggers.add(t));
        sig.typical_outputs.forEach((o: string) => allOutputs.add(o));
        sourceBuckets.add(sig.source_bucket);
      }
    }

    return {
      cluster_name: skillDef.skill_name || `${group.rollup}-skill`,
      cluster_description: skillDef.skill_description || '',
      member_doc_ids: [...allDocIds].sort(),
      member_count: allDocIds.size,
      top_tags: {
        domains: [...allDomains].sort(),
        patterns: [...allPatterns].sort(),
        frameworks: [...allFrameworks].sort(),
      },
      trigger_phrases: [...(skillDef.activation_triggers || []), ...[...allTriggers].slice(0, 10)],
      typical_outputs: [...allOutputs].sort().slice(0, 15),
      source_clusters: skillDef.cluster_names || [],
      source_buckets: [...sourceBuckets].sort(),
      domain_rollup: group.rollup,
      created_at: new Date().toISOString(),
      is_merged: true,
    };
  }
}
