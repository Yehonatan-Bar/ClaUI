import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';
import { getBudgetCap } from './filterUtils';

const SUPPORTS_PATTERN = /^(npm|pnpm|yarn|bun)\s+(test|t|build|compile|install|ci|i|lint|audit|run\s+(test|build|lint))\b/;

const SUPPRESS_PATTERNS = [
  /^npm\s+notice\b/i,
  /^npm\s+WARN\s+deprecated\b/i,
  /funding/i,
  /^\s*[█░▒▓■●]+/,  // progress bars
  /^\s*added\s+\d+\s+packages?\s+in/i,
  /^\s*up to date/i,
];

const IMPORTANT_PATTERNS = [
  /npm ERR!/i, /ERR!/i, /FAIL/i, /FAILED/i, /error/i,
  /\d+\s+failing/i, /\d+\s+passed/i, /\d+\s+failed/i,
  /Test Suites:/i, /Tests:/i, /Snapshots:/i, /Time:/i,
  /audit\s+report/i, /vulnerabilit/i,
  /PASS/i, /warning/i, /✓|✗|✘|×/,
];

export class JavaScriptPackageFilter implements OutputFilter {
  name = 'JavaScriptPackageFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const cap = getBudgetCap(input.profile, input.exitCode, input.budgetOverrides);

    const filteredStdout = filterJsOutput(input.stdout, cap, input.exitCode !== 0);
    const filteredStderr = filterJsOutput(input.stderr, Math.floor(cap / 4), true);

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

function filterJsOutput(text: string, budget: number, isFailure: boolean): string {
  if (!text) return '';

  const lines = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    if (SUPPRESS_PATTERNS.some(p => p.test(line)) && !isFailure) continue;
    if (IMPORTANT_PATTERNS.some(p => p.test(line))) {
      kept.push(line);
      continue;
    }
    if (isFailure) {
      kept.push(line);
      continue;
    }
    // For success, only keep non-empty, non-trivially-passing lines
    if (line.trim() && !/^\s*✓\s/.test(line)) {
      kept.push(line);
    }
  }

  let result = kept.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget - 30) + '\n[... truncated to budget ...]';
  }
  return result;
}
