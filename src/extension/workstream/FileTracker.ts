import { execSync } from 'child_process';

export interface FileTrackingResult {
  filesModified: string[];
  filesRead: string[];
  gitBranch?: string;
  gitCommit?: string;
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

export class FileTracker {
  private modified = new Set<string>();
  private read = new Set<string>();

  trackToolUse(toolName: string, input: Record<string, unknown>): void {
    const filePath = this.extractFilePath(toolName, input);
    if (!filePath) { return; }

    if (WRITE_TOOLS.has(toolName)) {
      this.modified.add(filePath);
    } else if (READ_TOOLS.has(toolName)) {
      this.read.add(filePath);
    }

    if (toolName === 'Bash') {
      this.extractBashFilePaths(input, this.modified, this.read);
    }
  }

  getResult(workspacePath?: string): FileTrackingResult {
    const result: FileTrackingResult = {
      filesModified: [...this.modified],
      filesRead: [...this.read],
    };

    if (workspacePath) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: workspacePath,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        result.gitBranch = branch;
      } catch {
        // not a git repo or git not available
      }

      try {
        const commit = execSync('git rev-parse --short HEAD', {
          cwd: workspacePath,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        result.gitCommit = commit;
      } catch {
        // ignore
      }
    }

    return result;
  }

  reset(): void {
    this.modified.clear();
    this.read.clear();
  }

  private extractFilePath(toolName: string, input: Record<string, unknown>): string | undefined {
    if (typeof input.file_path === 'string') {
      return this.normalizePath(input.file_path);
    }
    if (typeof input.path === 'string') {
      return this.normalizePath(input.path);
    }
    return undefined;
  }

  private extractBashFilePaths(
    input: Record<string, unknown>,
    modified: Set<string>,
    read: Set<string>,
  ): void {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) { return; }

    // Extract obvious file references from safe commands
    const writePatterns = [
      />\s*["']?([^\s"'|&;]+\.\w+)/g,
      /tee\s+["']?([^\s"'|&;]+)/g,
    ];
    const readPatterns = [
      /cat\s+["']?([^\s"'|&;]+\.\w+)/g,
      /less\s+["']?([^\s"'|&;]+\.\w+)/g,
    ];

    for (const pattern of writePatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        if (match[1] && !match[1].startsWith('-')) {
          modified.add(this.normalizePath(match[1]));
        }
      }
    }
    for (const pattern of readPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        if (match[1] && !match[1].startsWith('-')) {
          read.add(this.normalizePath(match[1]));
        }
      }
    }
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
  }
}
