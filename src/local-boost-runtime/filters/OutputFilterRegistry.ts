import { FilterInput, FilterOutput, FilterConfig } from '../../extension/local-boost/LocalBoostTypes';

export interface OutputFilter {
  name: string;
  version: string;
  supports(input: FilterInput): boolean;
  filter(input: FilterInput): FilterOutput;
}

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export function buildOutputHeader(
  command: string,
  exitCode: number | null,
  durationMs: number,
  rawBytes: number,
  filteredBytes: number,
  filterName: string,
  filterVersion: string,
  redactions: number,
): string {
  const status = exitCode === 0 ? 'passed' : 'failed';
  const durationSec = (durationMs / 1000).toFixed(1);
  const tokensSaved = estimateTokens(rawBytes - filteredBytes);
  return [
    `[claui-local-boost] ${command} ${status} with exit code ${exitCode ?? 'null'} in ${durationSec}s.`,
    `Raw output: ${rawBytes} bytes. Filtered output: ${filteredBytes} bytes. Estimated tokens saved: ${tokensSaved}.`,
    `Filter: ${filterName}@${filterVersion}. Redacted secrets: ${redactions}.`,
  ].join('\n');
}

export class OutputFilterRegistry {
  private filters: OutputFilter[] = [];
  private config: FilterConfig = {};

  register(filter: OutputFilter): void {
    this.filters.push(filter);
  }

  setConfig(config: FilterConfig): void {
    this.config = config;
  }

  findFilter(input: FilterInput): OutputFilter {
    if (this.config.disabledFilters) {
      const disabled = new Set(this.config.disabledFilters);
      for (const f of this.filters) {
        if (!disabled.has(f.name) && f.supports(input)) {
          return f;
        }
      }
    } else {
      for (const f of this.filters) {
        if (f.supports(input)) {
          return f;
        }
      }
    }
    // Fallback: last filter should be GenericFilter
    return this.filters[this.filters.length - 1];
  }

  applyFilter(input: FilterInput): FilterOutput {
    const filter = this.findFilter(input);

    // Apply budget overrides from config
    const budgetOverride = this.config.budgetOverrides?.[filter.name];
    if (budgetOverride) {
      // Budget overrides are applied inside each filter via the profile,
      // but we can't easily inject them. For now, config overrides are
      // handled at the filter level if filters read them.
    }

    return filter.filter(input);
  }
}
