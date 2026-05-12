import { FilterInput, FilterOutput } from '../../extension/local-boost/LocalBoostTypes';
import { OutputFilter, estimateTokens, buildOutputHeader } from './OutputFilterRegistry';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\([A-Z]|\x1b[=>]/g;
const SPINNER_REGEX = /[⠀-⣿─-╿▀-▟■-◿⏰-⏳⌚⌛]/g;

const IMPORTANT_PATTERNS = [
  /error/i, /failed/i, /failure/i, /exception/i, /traceback/i,
  /panic/i, /segmentation fault/i, /assert/i, /expected/i, /received/i,
  /warning/i, /TS\d+/, /E\d{3,}/, /FATAL/i,
  /Cannot find module/i, /Module not found/i,
];

const SUMMARY_PATTERNS = [
  /\d+\s+(passed|failed|skipped|errors?|warnings?|tests?)/i,
  /total/i, /summary/i, /\d+\s+of\s+\d+/i,
];

const BUDGETS: Record<string, { success: number; failure: number }> = {
  balanced: { success: 8000, failure: 16000 },
  strict: { success: 4000, failure: 8000 },
  verbose: { success: 32000, failure: 32000 },
};

export class GenericFilter implements OutputFilter {
  name = 'GenericFilter';
  version = '1.0.0';

  supports(_input: FilterInput): boolean {
    return true;
  }

  filter(input: FilterInput): FilterOutput {
    const budget = BUDGETS[input.profile] ?? BUDGETS.balanced;
    const cap = input.exitCode === 0 ? budget.success : budget.failure;

    const filteredStdout = filterText(input.stdout, cap);
    const filteredStderr = filterText(input.stderr, Math.floor(cap / 4));

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

function filterText(text: string, budget: number): string {
  if (!text) return '';

  // Step 1: Strip ANSI
  let cleaned = text.replace(ANSI_REGEX, '');

  // Step 2: Normalize \r-based progress lines (keep last state)
  cleaned = normalizeCarriageReturns(cleaned);

  // Step 3: Remove spinner frames
  cleaned = cleaned.replace(SPINNER_REGEX, '');

  // Step 4: Split into lines
  const lines = cleaned.split('\n');

  // Step 5: Collapse adjacent duplicates
  const deduped = collapseDuplicates(lines);

  // Step 6: Classify lines
  const HEAD_COUNT = 20;
  const TAIL_COUNT = 80;
  const important: number[] = [];
  const summary: number[] = [];

  for (let i = 0; i < deduped.length; i++) {
    const line = deduped[i];
    if (IMPORTANT_PATTERNS.some(p => p.test(line))) important.push(i);
    if (SUMMARY_PATTERNS.some(p => p.test(line))) summary.push(i);
  }

  // If output fits in budget, return as-is
  const fullText = deduped.join('\n');
  if (fullText.length <= budget) return fullText;

  // Build kept set: head + tail + important + summary
  const kept = new Set<number>();
  for (let i = 0; i < Math.min(HEAD_COUNT, deduped.length); i++) kept.add(i);
  for (let i = Math.max(0, deduped.length - TAIL_COUNT); i < deduped.length; i++) kept.add(i);
  for (const i of important) kept.add(i);
  for (const i of summary) kept.add(i);

  // Build output from kept lines
  const sorted = Array.from(kept).sort((a, b) => a - b);
  const parts: string[] = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      parts.push(`[... ${idx - lastIdx - 1} lines omitted ...]`);
    }
    parts.push(deduped[idx]);
    lastIdx = idx;
  }

  let result = parts.join('\n');

  // Enforce hard budget cap
  if (result.length > budget) {
    result = result.slice(0, budget - 30) + '\n[... truncated to budget ...]';
  }

  return result;
}

function normalizeCarriageReturns(text: string): string {
  return text.replace(/[^\n]*\r(?!\n)/g, '');
}

function collapseDuplicates(lines: string[]): string[] {
  const result: string[] = [];
  let lastLine = '';
  let dupeCount = 0;

  for (const line of lines) {
    if (line === lastLine && line.trim()) {
      dupeCount++;
    } else {
      if (dupeCount > 0) {
        result.push(`[repeated ${dupeCount} more time${dupeCount > 1 ? 's' : ''}]`);
      }
      result.push(line);
      lastLine = line;
      dupeCount = 0;
    }
  }

  if (dupeCount > 0) {
    result.push(`[repeated ${dupeCount} more time${dupeCount > 1 ? 's' : ''}]`);
  }

  return result;
}
