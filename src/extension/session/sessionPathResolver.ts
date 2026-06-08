import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

/**
 * Find the JSONL file for a session ID.
 * Tries the expected project directory first, then scans all projects.
 */
export function findSessionJsonlPath(
  sessionId: string,
  workspacePath?: string,
): string | null {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) {
    return null;
  }

  const fileName = `${sessionId}.jsonl`;

  if (workspacePath) {
    const dirName = workspacePath.replace(/[:\\/]/g, '-');
    const expectedPath = path.join(projectsDir, dirName, fileName);
    if (fs.existsSync(expectedPath)) {
      return expectedPath;
    }

    // Try with toggled drive letter case (Windows inconsistency)
    const ch = dirName.charAt(0);
    const altDirName = (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + dirName.slice(1);
    const altPath = path.join(projectsDir, altDirName, fileName);
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }

  // Fallback: scan all project directories
  try {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      const candidatePath = path.join(projectsDir, dir, fileName);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  } catch {
    // Directory listing failed
  }

  return null;
}

/**
 * Encode an absolute path the way the Claude CLI names its per-project transcript
 * folder under ~/.claude/projects. The CLI replaces the drive colon, both slash
 * kinds, AND dots with '-'. This differs from findSessionJsonlPath's lookup
 * transform (which keeps dots) — so when WRITING a transcript into a target
 * project folder we must use this stricter encoding to match where the CLI will
 * later look for `--resume <id>`.
 */
export function claudeProjectDirName(absPath: string): string {
  return absPath.replace(/[:\\/.]/g, '-');
}

/**
 * Copy a session's JSONL transcript into the CLI project folder for `targetCwd`,
 * so that a subsequent `claude --resume <id>` launched with that cwd can find it.
 * The CLI scopes `--resume` lookup to the current cwd's project folder, so moving
 * a session across directories requires relocating its transcript first.
 *
 * Copies (not moves) so the original survives; overwrites any stale target copy
 * because the live source is the freshest. Returns the destination path on success.
 */
export function relocateSessionTranscript(
  sessionId: string,
  targetCwd: string,
  sourceWorkspacePath?: string,
): { ok: true; targetPath: string } | { ok: false; error: string } {
  const src = findSessionJsonlPath(sessionId, sourceWorkspacePath);
  if (!src) {
    return { ok: false, error: `Session transcript not found for ${sessionId}.` };
  }

  const destDir = path.join(CLAUDE_DIR, 'projects', claudeProjectDirName(targetCwd));
  const destPath = path.join(destDir, `${sessionId}.jsonl`);

  // Already in the right place (e.g. moving to a worktree that encodes identically).
  if (path.resolve(src).toLowerCase() === path.resolve(destPath).toLowerCase()) {
    return { ok: true, targetPath: destPath };
  }

  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, destPath);
    return { ok: true, targetPath: destPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
