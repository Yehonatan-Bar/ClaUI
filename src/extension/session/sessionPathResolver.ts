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
