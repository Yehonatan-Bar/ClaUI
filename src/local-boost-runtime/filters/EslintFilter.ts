import { FilterInput, FilterOutput } from '../../extension/local-boost/LocalBoostTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';

const SUPPORTS_PATTERN = /^(npx\s+)?eslint\b/;

const BUDGETS: Record<string, { success: number; failure: number }> = {
  balanced: { success: 8000, failure: 16000 },
  strict: { success: 4000, failure: 8000 },
  verbose: { success: 32000, failure: 32000 },
};

export class EslintFilter implements OutputFilter {
  name = 'EslintFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const budget = BUDGETS[input.profile] ?? BUDGETS.balanced;
    const cap = input.exitCode === 0 ? budget.success : budget.failure;

    const filteredStdout = filterEslintOutput(input.stdout, cap);
    const filteredStderr = filterEslintOutput(input.stderr, Math.floor(cap / 4));

    const rawStdoutBytes = Buffer.byteLength(input.stdout, 'utf8');
    const rawStderrBytes = Buffer.byteLength(input.stderr, 'utf8');
    const filteredStdoutBytes = Buffer.byteLength(filteredStdout, 'utf8');
    const filteredStderrBytes = Buffer.byteLength(filteredStderr, 'utf8');
    const totalRaw = rawStdoutBytes + rawStderrBytes;
    const totalFiltered = filteredStdoutBytes + filteredStderrBytes;

    const header = buildOutputHeader(
      input.command, input.exitCode, input.durationMs,
      totalRaw, totalFiltered,
      this.name, this.version,
      input.redactionResult.replacements,
    );

    return {
      filteredStdout, filteredStderr, header,
      filterName: this.name, filterVersion: this.version,
      rawStdoutBytes, rawStderrBytes, filteredStdoutBytes, filteredStderrBytes,
      estimatedTokensSaved: estimateTokens(totalRaw - totalFiltered),
    };
  }
}

function filterEslintOutput(text: string, budget: number): string {
  if (!text) return '';

  const cleaned = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lines = cleaned.split('\n');

  // Group diagnostics by file
  const fileIssues: Map<string, string[]> = new Map();
  const summaryLines: string[] = [];
  let currentFile: string | null = null;

  // ESLint format: filepath\n  line:col  type  message  rule
  const filePathPattern = /^[/\\]|^[A-Za-z]:[/\\]|^\.\//;
  const issuePattern = /^\s+\d+:\d+\s+(error|warning)\s+/;
  const summaryPattern = /\d+\s+(problem|error|warning)/i;

  for (const line of lines) {
    if (summaryPattern.test(line)) {
      summaryLines.push(line);
      continue;
    }

    if (filePathPattern.test(line.trim())) {
      currentFile = line.trim();
      if (!fileIssues.has(currentFile)) fileIssues.set(currentFile, []);
      continue;
    }

    if (issuePattern.test(line) && currentFile) {
      fileIssues.get(currentFile)!.push(line);
      continue;
    }

    if (line.trim()) {
      summaryLines.push(line);
    }
  }

  // Sort files by issue count
  const sorted = Array.from(fileIssues.entries()).sort((a, b) => b[1].length - a[1].length);

  const parts: string[] = [];
  const totalIssues = Array.from(fileIssues.values()).reduce((sum, arr) => sum + arr.length, 0);

  if (totalIssues > 0) {
    parts.push(`ESLint: ${totalIssues} issue${totalIssues === 1 ? '' : 's'} in ${fileIssues.size} file${fileIssues.size === 1 ? '' : 's'}`);
    parts.push('');
  }

  const MAX_ISSUES_PER_FILE = 10;
  for (const [file, issues] of sorted) {
    parts.push(`${file} (${issues.length})`);
    const shown = issues.slice(0, MAX_ISSUES_PER_FILE);
    parts.push(...shown);
    if (issues.length > MAX_ISSUES_PER_FILE) {
      parts.push(`  ... and ${issues.length - MAX_ISSUES_PER_FILE} more issues`);
    }
    parts.push('');
  }

  parts.push(...summaryLines);

  let result = parts.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget - 30) + '\n[... truncated to budget ...]';
  }
  return result;
}
