import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';
import { getBudgetCap } from './filterUtils';

const SUPPORTS_PATTERN = /^(npx\s+)?(jest|vitest)\b/;

const SUPPRESS_PATTERNS = [
  /^\s*PASS\s/i,
  /watch\s+usage/i,
  /press\s/i,
  /^\s*✓\s/,
  /^\s*○\s.*skipped/i,
];

const IMPORTANT_PATTERNS = [
  /FAIL/i, /✕|✗|✘|×/, /Expected/i, /Received/i,
  /Test Suites:/i, /Tests:/i, /Snapshots:/i, /Time:/i,
  /●\s/, /error/i, /thrown/i,
  /at\s+.*\(.*:\d+:\d+\)/, // stack frame
  /\d+\s+(passed|failed|skipped|total)/i,
];

export class JestVitestFilter implements OutputFilter {
  name = 'JestVitestFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const cap = getBudgetCap(input.profile, input.exitCode, input.budgetOverrides);

    const filteredStdout = filterJestOutput(input.stdout, cap, input.exitCode !== 0);
    const filteredStderr = filterJestOutput(input.stderr, Math.floor(cap / 4), true);

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

function filterJestOutput(text: string, budget: number, isFailure: boolean): string {
  if (!text) return '';

  const lines = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split('\n');
  const kept: string[] = [];
  let inFailedSuite = false;

  for (const line of lines) {
    // Track failed test suite blocks
    if (/^\s*FAIL\s/i.test(line)) {
      inFailedSuite = true;
      kept.push(line);
      continue;
    }
    if (inFailedSuite && /^\s*(PASS|FAIL)\s/i.test(line) && !/^\s*FAIL\s/i.test(line)) {
      inFailedSuite = false;
    }

    if (inFailedSuite) {
      kept.push(line);
      continue;
    }

    if (SUPPRESS_PATTERNS.some(p => p.test(line)) && !isFailure) continue;
    if (IMPORTANT_PATTERNS.some(p => p.test(line))) {
      kept.push(line);
      continue;
    }
    if (isFailure && line.trim()) {
      kept.push(line);
    }
  }

  let result = kept.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget - 30) + '\n[... truncated to budget ...]';
  }
  return result;
}
