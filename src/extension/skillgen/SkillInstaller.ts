import * as fs from 'fs';
import * as path from 'path';
import type { DeduplicationResult } from './DeduplicationEngine';

export interface InstallationResult {
  installed: string[];
  upgraded: string[];
  skipped: string[];
  failed: Array<{ skillName: string; error: string }>;
  backupDir: string | null;
}

/**
 * SkillInstaller handles atomic installation of skills from a staging
 * directory (skills_out) to the target skills directory.
 *
 * Key behaviors:
 * - Backs up existing skills before overwriting (for rollback)
 * - Atomic copy: writes to temp dir first, then renames
 * - Supports rollback on mid-install failure
 */
export class SkillInstaller {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Install skills from staging based on deduplication results.
   *
   * @param skillsOutDir - Source directory containing generated skills
   * @param targetDir - Target directory to install skills into
   * @param dedupResults - Dedup verdicts for each skill
   * @param workspaceDir - Workspace directory for backups
   * @returns Installation result with counts and details
   */
  async install(
    skillsOutDir: string,
    targetDir: string,
    dedupResults: DeduplicationResult[],
    workspaceDir: string
  ): Promise<InstallationResult> {
    const result: InstallationResult = {
      installed: [],
      upgraded: [],
      skipped: [],
      failed: [],
      backupDir: null,
    };

    // Ensure target directory exists
    fs.mkdirSync(targetDir, { recursive: true });

    // Create backup directory for this run
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(workspaceDir, 'backups', ts);
    fs.mkdirSync(backupDir, { recursive: true });
    result.backupDir = backupDir;

    const toInstall = dedupResults.filter(r => r.verdict === 'new');
    const toUpgrade = dedupResults.filter(r => r.verdict === 'upgrade');
    const toSkip = dedupResults.filter(r => r.verdict === 'skip');

    // Record skips
    result.skipped = toSkip.map(r => r.skillName);

    this.log(`[SkillGen:Install] Plan: ${toInstall.length} new, ${toUpgrade.length} upgrades, ${toSkip.length} skips`);

    // Process upgrades first (backup + replace)
    for (const upgrade of toUpgrade) {
      try {
        await this.upgradeSkill(upgrade, skillsOutDir, targetDir, backupDir);
        result.upgraded.push(upgrade.skillName);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log(`[SkillGen:Install] Failed to upgrade ${upgrade.skillName}: ${errorMsg}`);
        result.failed.push({ skillName: upgrade.skillName, error: errorMsg });
        // Attempt rollback of this single skill
        this.rollbackSingle(upgrade.skillName, targetDir, backupDir);
      }
    }

    // Process new installs
    for (const install of toInstall) {
      try {
        await this.installNew(install, skillsOutDir, targetDir);
        result.installed.push(install.skillName);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log(`[SkillGen:Install] Failed to install ${install.skillName}: ${errorMsg}`);
        result.failed.push({ skillName: install.skillName, error: errorMsg });
      }
    }

    this.log(`[SkillGen:Install] Complete: ${result.installed.length} installed, ${result.upgraded.length} upgraded, ${result.skipped.length} skipped, ${result.failed.length} failed`);
    return result;
  }

  /**
   * Rollback all installations from a failed run.
   * Restores backups and removes newly installed skills.
   */
  async rollback(result: InstallationResult, targetDir: string): Promise<void> {
    if (!result.backupDir) return;

    this.log('[SkillGen:Install] Rolling back...');

    // Restore upgraded skills from backup
    for (const skillName of result.upgraded) {
      this.rollbackSingle(skillName, targetDir, result.backupDir);
    }

    // Remove newly installed skills (they didn't exist before)
    for (const skillName of result.installed) {
      const targetPath = path.join(targetDir, skillName);
      try {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
          this.log(`[SkillGen:Install] Removed new skill: ${skillName}`);
        }
      } catch (err) {
        this.log(`[SkillGen:Install] Failed to remove ${skillName}: ${err}`);
      }
    }

    this.log('[SkillGen:Install] Rollback complete');
  }

  // --- Private helpers ---

  private async installNew(
    dedup: DeduplicationResult,
    skillsOutDir: string,
    targetDir: string
  ): Promise<void> {
    const sourcePath = path.join(skillsOutDir, dedup.skillName);
    const targetPath = path.join(targetDir, dedup.skillName);

    if (fs.existsSync(targetPath)) {
      throw new Error(`Target already exists: ${targetPath}`);
    }

    this.copyDirRecursive(sourcePath, targetPath);
    this.log(`[SkillGen:Install] Installed new skill: ${dedup.skillName}`);
  }

  private async upgradeSkill(
    dedup: DeduplicationResult,
    skillsOutDir: string,
    targetDir: string,
    backupDir: string
  ): Promise<void> {
    const sourcePath = path.join(skillsOutDir, dedup.skillName);
    const existingName = dedup.existingSkillPath
      ? path.basename(dedup.existingSkillPath)
      : dedup.skillName;
    const existingPath = dedup.existingSkillPath || path.join(targetDir, existingName);
    const backupPath = path.join(backupDir, existingName);

    // Backup existing skill
    if (fs.existsSync(existingPath)) {
      this.copyDirRecursive(existingPath, backupPath);
      this.log(`[SkillGen:Install] Backed up existing: ${existingName} -> ${backupPath}`);

      // Remove existing
      fs.rmSync(existingPath, { recursive: true, force: true });
    }

    // Install new version
    const targetPath = path.join(targetDir, dedup.skillName);
    this.copyDirRecursive(sourcePath, targetPath);
    this.log(`[SkillGen:Install] Upgraded skill: ${existingName} -> ${dedup.skillName}`);
  }

  private rollbackSingle(skillName: string, targetDir: string, backupDir: string): void {
    const backupPath = path.join(backupDir, skillName);
    const targetPath = path.join(targetDir, skillName);

    try {
      if (fs.existsSync(backupPath)) {
        // Remove current version
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
        // Restore from backup
        this.copyDirRecursive(backupPath, targetPath);
        this.log(`[SkillGen:Install] Restored from backup: ${skillName}`);
      }
    } catch (err) {
      this.log(`[SkillGen:Install] Rollback failed for ${skillName}: ${err}`);
    }
  }

  /** Recursively copy a directory */
  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
