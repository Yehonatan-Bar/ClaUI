import * as fs from 'fs';
import * as path from 'path';

export type DeduplicationVerdict = 'new' | 'upgrade' | 'skip';

export interface DeduplicationResult {
  /** The skill folder name from skills_out */
  skillName: string;
  /** Whether to install, upgrade, or skip */
  verdict: DeduplicationVerdict;
  /** If upgrading, the path of the existing skill being replaced */
  existingSkillPath?: string;
  /** Human-readable reason for the verdict */
  reason: string;
  /** Which dedup tier made the decision (1=traceability, 2=metadata, 3=AI) */
  tier: 1 | 2 | 3;
}

interface SkillTraceability {
  source_documents?: string[];
  fingerprint?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface SkillMetadata {
  name?: string;
  description?: string;
  keywords?: string[];
  [key: string]: unknown;
}

/**
 * DeduplicationEngine checks whether generated skills already exist
 * in the target installation directory, using a 3-tier approach:
 *
 * Tier 1 (Traceability): Compare traceability.json fingerprints and source doc overlap
 * Tier 2 (Metadata + Content): Compare names, descriptions, keywords without AI
 * Tier 3 (AI): Use Claude for ambiguous cases (optional, configurable)
 */
export class DeduplicationEngine {
  private log: (msg: string) => void = () => {};
  private skipThreshold = 0.85;
  private upgradeThreshold = 0.45;

  /** Configure the upgrade threshold (similarity score above which an existing skill is upgraded instead of creating new) */
  setUpgradeThreshold(threshold: number): void {
    this.upgradeThreshold = threshold;
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Check all skills in the skills_out directory against existing installed skills.
   */
  async checkAll(
    skillsOutDir: string,
    installedSkillsDir: string,
    useAI: boolean
  ): Promise<DeduplicationResult[]> {
    const results: DeduplicationResult[] = [];

    // List generated skills (subdirectories of skills_out)
    const generatedSkills = this.listSkillDirs(skillsOutDir);
    const installedSkills = this.listSkillDirs(installedSkillsDir);

    this.log(`[SkillGen:Dedup][INFO] Dedup started | generated=${generatedSkills.length} installed=${installedSkills.length} aiEnabled=${useAI}`);

    for (const genSkill of generatedSkills) {
      const genPath = path.join(skillsOutDir, genSkill);
      const result = await this.checkSingle(genSkill, genPath, installedSkillsDir, installedSkills, useAI);
      results.push(result);
      this.log(`[SkillGen:Dedup][DEBUG] Verdict | skill=${genSkill} verdict=${result.verdict} tier=${result.tier} reason=${result.reason}`);
    }

    const verdictCounts = {
      new: results.filter(r => r.verdict === 'new').length,
      upgrade: results.filter(r => r.verdict === 'upgrade').length,
      skip: results.filter(r => r.verdict === 'skip').length,
    };
    const tierCounts = {
      tier1: results.filter(r => r.tier === 1).length,
      tier2: results.filter(r => r.tier === 2).length,
      tier3: results.filter(r => r.tier === 3).length,
    };
    this.log(`[SkillGen:Dedup][INFO] Dedup complete | new=${verdictCounts.new} upgrade=${verdictCounts.upgrade} skip=${verdictCounts.skip} tier1=${tierCounts.tier1} tier2=${tierCounts.tier2} tier3=${tierCounts.tier3}`);

    return results;
  }

  private async checkSingle(
    skillName: string,
    genPath: string,
    installedDir: string,
    installedSkills: string[],
    useAI: boolean
  ): Promise<DeduplicationResult> {
    // --- Tier 1: Traceability ---
    const tier1Result = this.checkTraceability(skillName, genPath, installedDir, installedSkills);
    if (tier1Result) return tier1Result;

    // --- Tier 2: Metadata + Content ---
    const tier2Result = this.checkMetadata(skillName, genPath, installedDir, installedSkills);
    if (tier2Result) return tier2Result;

    // --- Tier 3: AI (optional) ---
    if (useAI) {
      const tier3Result = await this.checkWithAI(skillName, genPath, installedDir, installedSkills);
      if (tier3Result) return tier3Result;
    }

    // No match found - this is a genuinely new skill
    return {
      skillName,
      verdict: 'new',
      reason: 'No matching existing skill found across all tiers',
      tier: useAI ? 3 : 2,
    };
  }

  /**
   * Tier 1: Compare traceability.json fingerprints and source document overlap.
   */
  private checkTraceability(
    skillName: string,
    genPath: string,
    installedDir: string,
    installedSkills: string[]
  ): DeduplicationResult | null {
    const genTrace = this.readTraceability(genPath);
    if (!genTrace) return null;

    for (const installed of installedSkills) {
      const installedPath = path.join(installedDir, installed);
      const installedTrace = this.readTraceability(installedPath);
      if (!installedTrace) continue;

      // Exact fingerprint match = identical skill, skip
      if (genTrace.fingerprint && installedTrace.fingerprint &&
          genTrace.fingerprint === installedTrace.fingerprint) {
        return {
          skillName,
          verdict: 'skip',
          existingSkillPath: installedPath,
          reason: `Identical fingerprint match with "${installed}"`,
          tier: 1,
        };
      }

      // Check source document overlap
      const genSources = new Set(genTrace.source_documents || []);
      const installedSources = new Set(installedTrace.source_documents || []);
      if (genSources.size > 0 && installedSources.size > 0) {
        const overlap = [...genSources].filter(s => installedSources.has(s));
        const overlapRatio = overlap.length / Math.max(genSources.size, installedSources.size);

        if (overlapRatio > 0.7) {
          return {
            skillName,
            verdict: 'upgrade',
            existingSkillPath: installedPath,
            reason: `${Math.round(overlapRatio * 100)}% source document overlap with "${installed}" (upgrade candidate)`,
            tier: 1,
          };
        }
      }
    }

    return null;
  }

  /**
   * Tier 2: Compare skill names, descriptions, keywords.
   */
  private checkMetadata(
    skillName: string,
    genPath: string,
    installedDir: string,
    installedSkills: string[]
  ): DeduplicationResult | null {
    const genMeta = this.readSkillMetadata(genPath);
    if (!genMeta) return null;

    let bestMatch: { name: string; score: number; path: string } | null = null;

    for (const installed of installedSkills) {
      const installedPath = path.join(installedDir, installed);
      const installedMeta = this.readSkillMetadata(installedPath);
      if (!installedMeta) continue;

      const score = this.computeMetadataSimilarity(genMeta, installedMeta);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { name: installed, score, path: installedPath };
      }
    }

    if (!bestMatch) return null;

    if (bestMatch.score > this.skipThreshold) {
      return {
        skillName,
        verdict: 'skip',
        existingSkillPath: bestMatch.path,
        reason: `High metadata similarity (${Math.round(bestMatch.score * 100)}%) with "${bestMatch.name}"`,
        tier: 2,
      };
    }

    if (bestMatch.score > this.upgradeThreshold) {
      return {
        skillName,
        verdict: 'upgrade',
        existingSkillPath: bestMatch.path,
        reason: `Moderate metadata similarity (${Math.round(bestMatch.score * 100)}%) with "${bestMatch.name}" (upgrade candidate)`,
        tier: 2,
      };
    }

    return null;
  }

  /**
   * Tier 3: Use AI for ambiguous cases.
   * Placeholder - will use Claude Sonnet API when enabled.
   */
  private async checkWithAI(
    _skillName: string,
    _genPath: string,
    _installedDir: string,
    _installedSkills: string[]
  ): Promise<DeduplicationResult | null> {
    this.log('[SkillGen:Dedup][DEBUG] AI deduplication not yet implemented, falling through');
    return null;
  }

  // --- Helpers ---

  private listSkillDirs(dir: string): string[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return [];
    }
  }

  private readTraceability(skillDir: string): SkillTraceability | null {
    try {
      const filePath = path.join(skillDir, 'traceability.json');
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private readSkillMetadata(skillDir: string): SkillMetadata | null {
    try {
      // Try SKILL.md frontmatter first
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        const content = fs.readFileSync(skillMd, 'utf-8');
        return this.parseFrontmatter(content);
      }
      // Try metadata.json
      const metaJson = path.join(skillDir, 'metadata.json');
      if (fs.existsSync(metaJson)) {
        return JSON.parse(fs.readFileSync(metaJson, 'utf-8'));
      }
      // Fallback: use folder name
      return { name: path.basename(skillDir) };
    } catch {
      return null;
    }
  }

  /** Extract name/description/keywords from SKILL.md frontmatter */
  private parseFrontmatter(content: string): SkillMetadata {
    const meta: SkillMetadata = {};
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const lines = fmMatch[1].split('\n');
      for (const line of lines) {
        const kv = line.match(/^(\w+):\s*(.+)/);
        if (kv) {
          const [, key, value] = kv;
          if (key === 'keywords') {
            meta.keywords = value.split(',').map(k => k.trim().toLowerCase());
          } else {
            meta[key.toLowerCase()] = value.trim();
          }
        }
      }
    }
    // Also extract the first heading as name fallback
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch && !meta.name) {
      meta.name = headingMatch[1].trim();
    }
    return meta;
  }

  /**
   * Compute similarity between two skill metadata sets.
   * Returns a score between 0 and 1.
   */
  private computeMetadataSimilarity(a: SkillMetadata, b: SkillMetadata): number {
    let score = 0;
    let weights = 0;

    // Name similarity (weight: 3)
    if (a.name && b.name) {
      score += this.stringSimilarity(a.name.toLowerCase(), b.name.toLowerCase()) * 3;
      weights += 3;
    }

    // Description similarity (weight: 2)
    if (a.description && b.description) {
      score += this.stringSimilarity(a.description.toLowerCase(), b.description.toLowerCase()) * 2;
      weights += 2;
    }

    // Keyword overlap (weight: 2)
    if (a.keywords?.length && b.keywords?.length) {
      const aSet = new Set(a.keywords);
      const bSet = new Set(b.keywords);
      const intersection = [...aSet].filter(k => bSet.has(k));
      const union = new Set([...aSet, ...bSet]);
      score += (intersection.length / union.size) * 2;
      weights += 2;
    }

    return weights > 0 ? score / weights : 0;
  }

  /** Simple Jaccard-like string similarity based on trigrams */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const trigramsA = this.trigrams(a);
    const trigramsB = this.trigrams(b);
    if (trigramsA.size === 0 && trigramsB.size === 0) return 1;

    const intersection = [...trigramsA].filter(t => trigramsB.has(t));
    const union = new Set([...trigramsA, ...trigramsB]);
    return intersection.length / union.size;
  }

  private trigrams(s: string): Set<string> {
    const result = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) {
      result.add(s.slice(i, i + 3));
    }
    return result;
  }
}
