import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';

const SUPPORTS_PATTERN = /^(python\s+-m\s+)?pytest\b/;

const SUPPRESS_PATTERNS = [
  /^collecting\s/i,
  /^collected\s+\d+\s+items?$/i,
  /^\.+$/,  // dots-only progress lines
  /^platform\s/i,
  /^cachedir:/i,
  /^rootdir:/i,
  /^plugins:/i,
];

const IMPORTANT_PATTERNS = [
  /FAILED/i, /ERROR/i, /ERRORS/i,
  /^E\s+/,  // pytest assertion detail lines
  /^>\s+/,  // pytest source context
  /AssertionError/i, /assert\b/i,
  /short test summary/i,
  /=+ FAILURES =+/i, /=+ ERRORS =+/i,
  /\d+\s+(passed|failed|error|warning|skipped)/i,
  /traceback/i,
];

const BUDGETS: Record<string, { success: number; failure: number }> = {
  balanced: { success: 8000, failure: 16000 },
  strict: { success: 4000, failure: 8000 },
  verbose: { success: 32000, failure: 32000 },
};

export class PytestFilter implements OutputFilter {
  name = 'PytestFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const budget = BUDGETS[input.profile] ?? BUDGETS.balanced;
    const cap = input.exitCode === 0 ? budget.success : budget.failure;

    const filteredStdout = filterPytestOutput(input.stdout, cap, input.exitCode !== 0);
    const filteredStderr = filterPytestOutput(input.stderr, Math.floor(cap / 4), true);

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

function filterPytestOutput(text: string, budget: number, isFailure: boolean): string {
  if (!text) return '';

  const lines = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split('\n');
  const kept: string[] = [];
  let inFailureBlock = false;

  for (const line of lines) {
    // Track failure/error sections
    if (/=+ FAILURES =+|=+ ERRORS =+/i.test(line)) {
      inFailureBlock = true;
      kept.push(line);
      continue;
    }
    if (inFailureBlock && /^=+/.test(line) && !/FAILURES|ERRORS/i.test(line)) {
      inFailureBlock = false;
      kept.push(line);
      continue;
    }

    if (inFailureBlock) {
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
