import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { estimateTokens, buildOutputHeader } from './OutputFilterRegistry';

export const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\([A-Z]|\x1b[=>]/g;
export const SPINNER_REGEX = /[⠀-⣿─-╿▀-▟■-◿⏰-⏳⌚⌛]/g;

export const DEFAULT_BUDGETS: Record<string, { success: number; failure: number }> = {
  balanced: { success: 8000, failure: 16000 },
  strict: { success: 4000, failure: 8000 },
  verbose: { success: 32000, failure: 32000 },
};

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function getBudgetCap(
  profile: string,
  exitCode: number | null,
  overrides?: { success?: number; failure?: number },
): number {
  const budget = DEFAULT_BUDGETS[profile] ?? DEFAULT_BUDGETS.balanced;
  const base = exitCode === 0 ? budget.success : budget.failure;
  if (!overrides) return base;
  return exitCode === 0
    ? (overrides.success ?? base)
    : (overrides.failure ?? base);
}

export function applyBudgetCap(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget - 30) + '\n[... truncated to budget ...]';
}

export function buildFilterOutput(
  input: FilterInput,
  filteredStdout: string,
  filteredStderr: string,
  filterName: string,
  filterVersion: string,
): FilterOutput {
  const rawStdoutBytes = Buffer.byteLength(input.stdout, 'utf8');
  const rawStderrBytes = Buffer.byteLength(input.stderr, 'utf8');
  const filteredStdoutBytes = Buffer.byteLength(filteredStdout, 'utf8');
  const filteredStderrBytes = Buffer.byteLength(filteredStderr, 'utf8');
  const totalRaw = rawStdoutBytes + rawStderrBytes;
  const totalFiltered = filteredStdoutBytes + filteredStderrBytes;

  const header = buildOutputHeader(
    input.command, input.exitCode, input.durationMs,
    totalRaw, totalFiltered,
    filterName, filterVersion,
    input.redactionResult.replacements,
  );

  return {
    filteredStdout, filteredStderr, header,
    filterName, filterVersion,
    rawStdoutBytes, rawStderrBytes, filteredStdoutBytes, filteredStderrBytes,
    estimatedTokensSaved: estimateTokens(totalRaw - totalFiltered),
  };
}
