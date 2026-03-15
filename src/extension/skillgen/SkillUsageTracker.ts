import * as fs from 'fs';
import * as path from 'path';

export interface SkillUsageRecord {
  skill_name: string;
  use_count: number;
  last_used: string;
  first_used: string;
}

export interface UsageData {
  skills: Record<string, SkillUsageRecord>;
  updated_at: string;
}

const USAGE_FILENAME = '_usage.json';

/**
 * Tracks skill invocations by maintaining a _usage.json file
 * in the skills directory. Used by the archiving system to
 * identify least-used skills.
 */
export class SkillUsageTracker {
  private log: (msg: string) => void = () => {};
  private readonly usageFilePath: string;

  constructor(private readonly skillsDir: string) {
    this.usageFilePath = path.join(skillsDir, USAGE_FILENAME);
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Record a skill invocation. Increments count, updates timestamps. */
  recordUsage(skillName: string): void {
    try {
      const data = this.readUsageData();
      const now = new Date().toISOString();
      const existing = data.skills[skillName];

      if (existing) {
        existing.use_count++;
        existing.last_used = now;
      } else {
        data.skills[skillName] = {
          skill_name: skillName,
          use_count: 1,
          first_used: now,
          last_used: now,
        };
      }

      data.updated_at = now;
      this.writeUsageData(data);
      this.log(`[SkillUsage][INFO] Recorded usage | skill=${skillName} count=${data.skills[skillName].use_count}`);
    } catch (err) {
      this.log(`[SkillUsage][WARNING] Failed to record usage | skill=${skillName} error=${err}`);
    }
  }

  /** Get all usage data */
  getUsage(): UsageData {
    return this.readUsageData();
  }

  /**
   * Get the N least-used skill names.
   * Sorts by use_count ascending, then by last_used ascending (oldest first).
   * Excludes protected skills (starting with _ or explicitly protected).
   */
  getLeastUsed(count: number, protectedSkills: string[] = ['sr-ptd-skill']): string[] {
    const data = this.readUsageData();
    const installedSkills = this.listInstalledSkills();

    // Build records for all installed skills (including those with 0 usage)
    const records: SkillUsageRecord[] = installedSkills
      .filter(name => !name.startsWith('_') && !protectedSkills.includes(name))
      .map(name => data.skills[name] || {
        skill_name: name,
        use_count: 0,
        first_used: '',
        last_used: '',
      });

    // Sort: lowest usage first, then oldest last_used first
    records.sort((a, b) => {
      if (a.use_count !== b.use_count) return a.use_count - b.use_count;
      return (a.last_used || '').localeCompare(b.last_used || '');
    });

    return records.slice(0, count).map(r => r.skill_name);
  }

  /** Get all usage records sorted by usage (ascending) */
  getAllUsageSorted(): SkillUsageRecord[] {
    const data = this.readUsageData();
    return Object.values(data.skills).sort((a, b) => a.use_count - b.use_count);
  }

  private readUsageData(): UsageData {
    try {
      if (fs.existsSync(this.usageFilePath)) {
        return JSON.parse(fs.readFileSync(this.usageFilePath, 'utf-8'));
      }
    } catch {
      // Corrupted file, start fresh
    }
    return { skills: {}, updated_at: '' };
  }

  private writeUsageData(data: UsageData): void {
    fs.writeFileSync(this.usageFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private listInstalledSkills(): string[] {
    try {
      return fs.readdirSync(this.skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'))
        .map(d => d.name);
    } catch {
      return [];
    }
  }
}
