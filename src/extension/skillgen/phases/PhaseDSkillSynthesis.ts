import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCliCaller } from '../ClaudeCliCaller';
import { PhaseResult } from './types';

/**
 * Phase D: Skill Synthesis
 *
 * Reads cluster manifests, representatives, and extractions.
 * Uses Opus for heavy synthesis (32K token output).
 * Parallelized with concurrency limiter (max 3 concurrent CLI processes).
 */
export class PhaseDSkillSynthesis {
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
    model: string = 'claude-opus-4-6',
    concurrency: number = 3,
    onProgress?: (pct: number, label: string) => void,
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    this.cancelled = false;

    const clustersDir = path.join(workspaceDir, 'clusters');
    const finalDir = path.join(clustersDir, 'clusters_final');
    const representativesDir = path.join(clustersDir, 'representatives');
    const extractionsDir = path.join(workspaceDir, 'extractions');
    const outputDir = path.join(workspaceDir, 'skills_out');

    fs.mkdirSync(outputDir, { recursive: true });

    if (!fs.existsSync(finalDir)) {
      return { success: false, error: `clusters_final directory not found: ${finalDir}`, durationMs: Date.now() - startTime };
    }

    // Get all cluster IDs
    const clusterIds = fs.readdirSync(finalDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json'))
      .sort();

    this.log(`[PhaseD] Found ${clusterIds.length} clusters to synthesize`);

    const results = { processed: [] as any[], failed: [] as any[], skipped: [] as any[] };
    let completed = 0;

    // Build tasks
    const tasks = clusterIds.map(clusterId => async () => {
      if (this.cancelled) return;

      try {
        const clusterData = this.loadClusterData(clusterId, finalDir, representativesDir, extractionsDir);

        if (!clusterData.extractions.length) {
          this.log(`[PhaseD] Skipping ${clusterId}: no extractions`);
          results.skipped.push({ cluster_id: clusterId, reason: 'No extractions' });
          return;
        }

        this.log(`[PhaseD] Synthesizing ${clusterId} (${clusterData.extractions.length} extractions)...`);

        const prompt = this.buildSynthesisPrompt(clusterData);
        const skillResult = await this.cliCaller.callJson<any>({
          prompt,
          model,
          timeoutMs: 300_000, // 5 minutes for heavy synthesis
        });

        this.writeSkillFolder(skillResult, outputDir);

        results.processed.push({
          cluster_id: clusterId,
          skill_name: skillResult.skill_name,
          description: (skillResult.description || '').slice(0, 100),
        });

        this.log(`[PhaseD] Success: ${skillResult.skill_name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[PhaseD] Failed ${clusterId}: ${msg}`);
        results.failed.push({ cluster_id: clusterId, error: msg });
      } finally {
        completed++;
        const pct = Math.round((completed / clusterIds.length) * 100);
        onProgress?.(pct, `Synthesized ${completed}/${clusterIds.length} skills`);
      }
    });

    // Run with concurrency limiter
    await this.runWithConcurrency(tasks, concurrency);

    // Save summary
    const summaryPath = path.join(clustersDir, '_phase_d_synthesis_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      output_dir: outputDir,
      results,
    }, null, 2), 'utf-8');

    const durationMs = Date.now() - startTime;
    this.log(`[PhaseD] Complete | processed=${results.processed.length} failed=${results.failed.length} skipped=${results.skipped.length} durationMs=${durationMs}`);

    return { success: true, durationMs };
  }

  private loadClusterData(
    clusterId: string,
    finalDir: string,
    representativesDir: string,
    extractionsDir: string,
  ): { clusterId: string; manifest: any; representatives: any; extractions: any[] } {
    const manifestPath = path.join(finalDir, `${clusterId}.json`);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Cluster manifest not found: ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Load representatives
    const repsPath = path.join(representativesDir, `${clusterId}.json`);
    let repsData: any = { representative_doc_ids: manifest.member_doc_ids || [] };
    if (fs.existsSync(repsPath)) {
      repsData = JSON.parse(fs.readFileSync(repsPath, 'utf-8'));
    }

    // Load extractions
    const extractions: any[] = [];
    for (const docId of repsData.representative_doc_ids || []) {
      const extPath = path.join(extractionsDir, `${docId}.json`);
      if (fs.existsSync(extPath)) {
        try {
          extractions.push(JSON.parse(fs.readFileSync(extPath, 'utf-8')));
        } catch { /* skip malformed */ }
      }
    }

    return { clusterId, manifest, representatives: repsData, extractions };
  }

  private buildSynthesisPrompt(clusterData: {
    clusterId: string;
    manifest: any;
    extractions: any[];
  }): string {
    const manifest = clusterData.manifest;

    const summaries = clusterData.extractions.map(ext => ({
      doc_id: ext.doc_id || 'unknown',
      trigger: ext.trigger || {},
      workflow: ext.workflow || {},
      code_written: ext.code_written || {},
      issues_and_fixes: ext.issues_and_fixes || {},
      skill_assessment: ext.skill_assessment || {},
      tags: ext.tags || {},
      raw_context: ext.raw_sections?.context || '',
      raw_workflow: ext.raw_sections?.workflow || '',
    }));

    // Truncate to stay within reasonable prompt size
    const summariesJson = JSON.stringify(summaries, null, 2).slice(0, 50000);

    const triggerLines = (manifest.trigger_phrases || []).slice(0, 15).map((p: string) => `- ${p}`).join('\n');
    const outputLines = (manifest.typical_outputs || []).slice(0, 10).map((o: string) => `- ${o}`).join('\n');

    return `You are a skill synthesis expert. Generate a complete Claude Code skill from the following cluster.

## CLUSTER INFORMATION

**Cluster ID**: ${manifest.cluster_name || 'unknown'}
**Description**: ${manifest.cluster_description || 'No description'}
**Member Count**: ${manifest.member_count || 0} documents

**Top Shared Tags**:
- Domains: ${(manifest.top_tags?.domains || []).slice(0, 10).join(', ')}
- Patterns: ${(manifest.top_tags?.patterns || []).slice(0, 10).join(', ')}
- Frameworks: ${(manifest.top_tags?.frameworks || []).slice(0, 10).join(', ')}

**Common Trigger Phrases**:
${triggerLines}

**Typical Outputs**:
${outputLines}

## REPRESENTATIVE DOCUMENTS

${summariesJson}

## OUTPUT CONTRACT

Return a single JSON object:

{
  "skill_name": "kebab-case-name",
  "description": "One-line description for skill activation",
  "skill_md": "Full markdown content for SKILL.md",
  "references_files": [
    {"path": "references/filename.md", "contents": "file contents"}
  ],
  "scripts_files": [
    {"path": "scripts/filename.py", "contents": "file contents"}
  ],
  "assets_files": [
    {"path": "assets/filename.ext", "contents": "file contents"}
  ],
  "traceability": {
    "source_doc_ids": ["list of doc_ids used"],
    "section_sources": {
      "workflow": ["doc_id_1"],
      "issues": ["doc_id_2"],
      "scripts": ["doc_id_1"]
    }
  }
}

## SKILL.MD FORMAT

---
name: skill-name
description: Brief description for matching
version: 1.0.0
---

# Skill Title

## Purpose
What this skill does and why.

## Triggers
- "trigger phrase 1"
- "trigger phrase 2"

## Prerequisites
### Required Libraries

## Workflow Overview

### High-Level Steps
1. Step one
2. Step two

## Core Implementation

### Pattern 1
Code and explanation.

## Common Issues & Solutions

### Issue 1
**Symptoms**: What you see
**Cause**: Root cause
**Solution**: How to fix

## Verification
- [ ] Checklist item 1

## References
- Scripts: [script.py](scripts/script.py)

## SYNTHESIS RULES

1. Include what Claude can't know (your specifics)
2. Exclude generic knowledge
3. Match specificity to risk
4. Keep SKILL.md lean - push deep content to references/scripts/assets
5. No emojis

Return ONLY the JSON object, no markdown code fences around it.`;
  }

  private writeSkillFolder(skillResult: any, outputDir: string): void {
    const skillName = skillResult.skill_name || 'unknown-skill';
    const skillDir = path.join(outputDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    // Write SKILL.md
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillResult.skill_md || '', 'utf-8');

    // Write references
    for (const ref of skillResult.references_files || []) {
      const refPath = path.join(skillDir, ref.path || 'references/unknown.md');
      fs.mkdirSync(path.dirname(refPath), { recursive: true });
      fs.writeFileSync(refPath, ref.contents || '', 'utf-8');
    }

    // Write scripts
    for (const script of skillResult.scripts_files || []) {
      const scriptPath = path.join(skillDir, script.path || 'scripts/unknown.py');
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
      fs.writeFileSync(scriptPath, script.contents || '', 'utf-8');
    }

    // Write assets
    for (const asset of skillResult.assets_files || []) {
      const assetPath = path.join(skillDir, asset.path || 'assets/unknown.txt');
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, asset.contents || '', 'utf-8');
    }

    // Write traceability
    fs.writeFileSync(
      path.join(skillDir, 'traceability.json'),
      JSON.stringify(skillResult.traceability || {}, null, 2),
      'utf-8'
    );
  }

  /**
   * Run async tasks with a concurrency limit.
   */
  private async runWithConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
    const executing = new Set<Promise<void>>();

    for (const task of tasks) {
      if (this.cancelled) break;

      const p = task().then(() => {
        executing.delete(p);
      });
      executing.add(p);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }
}
