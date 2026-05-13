import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';
import { getBudgetCap } from './filterUtils';

const SUPPORTS_PATTERN = /^(npx\s+)?tsc\b/;

export class TypeScriptFilter implements OutputFilter {
  name = 'TypeScriptFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const cap = getBudgetCap(input.profile, input.exitCode, input.budgetOverrides);

    const filteredStdout = filterTscOutput(input.stdout, cap);
    const filteredStderr = filterTscOutput(input.stderr, Math.floor(cap / 4));

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

function filterTscOutput(text: string, budget: number): string {
  if (!text) return '';

  const cleaned = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lines = cleaned.split('\n');

  // Group diagnostics by file
  const fileErrors: Map<string, string[]> = new Map();
  const otherLines: string[] = [];
  const diagnosticPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

  for (const line of lines) {
    const match = diagnosticPattern.exec(line);
    if (match) {
      const file = match[1];
      if (!fileErrors.has(file)) fileErrors.set(file, []);
      fileErrors.get(file)!.push(line);
    } else if (line.trim()) {
      otherLines.push(line);
    }
  }

  // Sort files by error count (most errors first)
  const sorted = Array.from(fileErrors.entries()).sort((a, b) => b[1].length - a[1].length);

  const parts: string[] = [];

  // Summary line
  const totalErrors = Array.from(fileErrors.values()).reduce((sum, arr) => sum + arr.length, 0);
  if (totalErrors > 0) {
    parts.push(`TypeScript: ${totalErrors} error${totalErrors === 1 ? '' : 's'} in ${fileErrors.size} file${fileErrors.size === 1 ? '' : 's'}`);
    parts.push('');
  }

  // Top files by error count, cap errors per file
  const MAX_ERRORS_PER_FILE = 10;
  for (const [file, errors] of sorted) {
    parts.push(`--- ${file} (${errors.length} error${errors.length === 1 ? '' : 's'}) ---`);
    const shown = errors.slice(0, MAX_ERRORS_PER_FILE);
    parts.push(...shown);
    if (errors.length > MAX_ERRORS_PER_FILE) {
      parts.push(`  ... and ${errors.length - MAX_ERRORS_PER_FILE} more errors`);
    }
    parts.push('');
  }

  // Include other lines (summary, etc.)
  parts.push(...otherLines);

  let result = parts.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget - 30) + '\n[... truncated to budget ...]';
  }
  return result;
}
