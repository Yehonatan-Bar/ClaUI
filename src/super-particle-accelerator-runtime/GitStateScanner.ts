import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SpaSecretScanner } from './SecretScanner';
import { SecretFinding, GitInfo, DiffFileEntry, ScanSource } from '../shared/super-particle-accelerator/types';

export class GitStateScanner {
  private scanner: SpaSecretScanner;
  private cwd: string;
  private maxScanBytes: number;
  private provider: 'claude' | 'codex';

  constructor(
    scanner: SpaSecretScanner,
    cwd: string,
    provider: 'claude' | 'codex',
    maxScanBytes = 20 * 1024 * 1024,
  ) {
    this.scanner = scanner;
    this.cwd = cwd;
    this.provider = provider;
    this.maxScanBytes = maxScanBytes;
  }

  scanStagedDiff(): SecretFinding[] {
    const diff = this.git('diff', '--cached', '--unified=0');
    return this.scanParsedDiff(diff, 'staged-diff');
  }

  scanUnstagedDiff(): SecretFinding[] {
    const diff = this.git('diff', '--unified=0');
    return this.scanParsedDiff(diff, 'diff');
  }

  scanUntrackedFiles(): SecretFinding[] {
    const listing = this.git('ls-files', '--others', '--exclude-standard');
    const files = listing.split('\n').filter(Boolean);

    const findings: SecretFinding[] = [];
    let totalBytes = 0;

    for (const relFile of files) {
      const absPath = path.resolve(this.cwd, relFile);
      let stat: fs.Stats;
      try { stat = fs.statSync(absPath); } catch { continue; }
      if (totalBytes + stat.size > this.maxScanBytes) break;

      // Skip binary files
      const buf = Buffer.alloc(8192);
      let fd: number;
      try { fd = fs.openSync(absPath, 'r'); } catch { continue; }
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      fs.closeSync(fd);
      if (buf.slice(0, bytesRead).includes(0)) continue;

      const content = fs.readFileSync(absPath, 'utf-8');
      totalBytes += Buffer.byteLength(content);

      const fileFindings = this.scanner.scan({
        text: content,
        source: 'file',
        provider: this.provider,
        filePath: relFile,
        cwd: this.cwd,
      });

      findings.push(...fileFindings.map(f => ({ ...f, filePath: relFile })));
    }

    return findings;
  }

  getGitInfo(): GitInfo {
    const status = this.git('status', '--porcelain');
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of status.split('\n').filter(Boolean)) {
      const x = line[0], y = line[1];
      const file = line.slice(3);
      if (x === '?') untracked.push(file);
      else if (x !== ' ') staged.push(file);
      if (y !== ' ' && y !== '?') modified.push(file);
    }

    return {
      stagedFiles: staged,
      modifiedFiles: modified,
      untrackedFiles: untracked,
      hasStagedFindings: false,
      hasUnstagedFindings: false,
    };
  }

  isGitIgnored(filePath: string): boolean {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', filePath], {
        cwd: this.cwd,
        timeout: 3000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  private parseDiff(rawDiff: string): DiffFileEntry[] {
    const entries: DiffFileEntry[] = [];
    const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

    for (const section of fileSections) {
      const pathMatch = section.match(/^\+\+\+ b\/(.+)$/m);
      if (!pathMatch) continue;
      const filePath = pathMatch[1];

      const addedLines: DiffFileEntry['addedLines'] = [];
      const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm;
      let hunkMatch: RegExpExecArray | null;

      while ((hunkMatch = hunkRegex.exec(section)) !== null) {
        let currentLine = parseInt(hunkMatch[1], 10);
        const hunkStart = hunkMatch.index + hunkMatch[0].length;
        const nextHunk = section.indexOf('\n@@ ', hunkStart);
        const nextDiff = section.indexOf('\ndiff --git ', hunkStart);
        const hunkEnd = Math.min(
          nextHunk === -1 ? section.length : nextHunk,
          nextDiff === -1 ? section.length : nextDiff,
        );
        const hunkBody = section.slice(hunkStart, hunkEnd);

        for (const line of hunkBody.split('\n')) {
          if (line.startsWith('+')) {
            addedLines.push({ lineNumber: currentLine, text: line.slice(1) });
            currentLine++;
          } else if (line.startsWith('-')) {
            // deleted line — don't increment newLine counter
          } else if (line.startsWith(' ') || line === '') {
            currentLine++;
          }
        }
      }

      if (addedLines.length > 0) {
        entries.push({ filePath, addedLines });
      }
    }

    return entries;
  }

  private scanParsedDiff(rawDiff: string, source: ScanSource): SecretFinding[] {
    const entries = this.parseDiff(rawDiff);
    const allFindings: SecretFinding[] = [];

    for (const entry of entries) {
      const text = entry.addedLines.map(l => l.text).join('\n');
      if (!text.trim()) continue;

      const findings = this.scanner.scan({
        text,
        source,
        provider: this.provider,
        filePath: entry.filePath,
        cwd: this.cwd,
      });

      for (const finding of findings) {
        if (finding.line !== undefined && finding.line < entry.addedLines.length) {
          finding.line = entry.addedLines[finding.line].lineNumber;
        }
        finding.filePath = entry.filePath;
      }

      allFindings.push(...findings);
    }

    return allFindings;
  }

  private git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
  }
}
