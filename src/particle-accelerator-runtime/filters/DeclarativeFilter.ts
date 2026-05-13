import { FilterInput, FilterOutput, DeclarativeFilterDefinition } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter } from './OutputFilterRegistry';
import { stripAnsi, getBudgetCap, applyBudgetCap, buildFilterOutput } from './filterUtils';

interface CompiledDefinition {
  raw: DeclarativeFilterDefinition;
  commandPatterns: RegExp[];
  suppressPatterns: RegExp[];
  importantPatterns: RegExp[];
  diagnosticPattern: RegExp | null;
}

function compileDefinitions(defs: DeclarativeFilterDefinition[]): CompiledDefinition[] {
  const compiled: CompiledDefinition[] = [];
  for (const def of defs) {
    if (!def.id || !def.commandPatterns?.length) continue;
    try {
      compiled.push({
        raw: def,
        commandPatterns: def.commandPatterns.map(p => new RegExp(p)),
        suppressPatterns: (def.suppressPatterns ?? []).map(p => new RegExp(p, 'i')),
        importantPatterns: (def.importantPatterns ?? []).map(p => new RegExp(p, 'i')),
        diagnosticPattern: def.diagnosticPattern ? new RegExp(def.diagnosticPattern) : null,
      });
    } catch {
      // Invalid regex in definition — skip it
    }
  }
  return compiled;
}

export class DeclarativeFilter implements OutputFilter {
  name = 'DeclarativeFilter';
  version = '1.0.0';

  private definitions: CompiledDefinition[];
  private matched: CompiledDefinition | null = null;

  constructor(definitions: DeclarativeFilterDefinition[]) {
    this.definitions = compileDefinitions(definitions);
  }

  supports(input: FilterInput): boolean {
    const cmd = input.command.trim();
    for (const def of this.definitions) {
      if (def.commandPatterns.some(p => p.test(cmd))) {
        this.matched = def;
        this.name = `DeclarativeFilter:${def.raw.id}`;
        this.version = def.raw.version;
        return true;
      }
    }
    this.matched = null;
    return false;
  }

  filter(input: FilterInput): FilterOutput {
    const def = this.matched!;
    const cap = getBudgetCap(input.profile, input.exitCode, input.budgetOverrides);
    const stderrCap = Math.floor(cap / 4);

    const filteredStdout = def.raw.groupByFile && def.diagnosticPattern
      ? filterGroupedOutput(input.stdout, cap, input.exitCode !== 0, def)
      : filterLineOutput(input.stdout, cap, input.exitCode !== 0, def);
    const filteredStderr = filterLineOutput(input.stderr, stderrCap, true, def);

    return buildFilterOutput(input, filteredStdout, filteredStderr, this.name, this.version);
  }
}

function filterLineOutput(
  text: string,
  budget: number,
  isFailure: boolean,
  def: CompiledDefinition,
): string {
  if (!text) return '';
  const lines = stripAnsi(text).split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    if (def.importantPatterns.some(p => p.test(line))) {
      kept.push(line);
      continue;
    }
    if (!isFailure && def.suppressPatterns.some(p => p.test(line))) continue;
    if (line.trim()) {
      kept.push(line);
    }
  }

  return applyBudgetCap(kept.join('\n'), budget);
}

function filterGroupedOutput(
  text: string,
  budget: number,
  isFailure: boolean,
  def: CompiledDefinition,
): string {
  if (!text) return '';
  const cleaned = stripAnsi(text);
  const lines = cleaned.split('\n');
  const pattern = def.diagnosticPattern!;
  const maxPerFile = def.raw.maxDiagnosticsPerFile ?? 10;

  const fileIssues: Map<string, string[]> = new Map();
  const otherLines: string[] = [];

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.groups?.file) {
      const file = match.groups.file;
      if (!fileIssues.has(file)) fileIssues.set(file, []);
      fileIssues.get(file)!.push(line);
    } else if (def.importantPatterns.some(p => p.test(line))) {
      otherLines.push(line);
    } else if (!isFailure && def.suppressPatterns.some(p => p.test(line))) {
      // skip
    } else if (line.trim()) {
      otherLines.push(line);
    }
  }

  const sorted = Array.from(fileIssues.entries()).sort((a, b) => b[1].length - a[1].length);
  const parts: string[] = [];

  const totalIssues = Array.from(fileIssues.values()).reduce((s, a) => s + a.length, 0);
  if (totalIssues > 0) {
    parts.push(`${def.raw.displayName}: ${totalIssues} issue${totalIssues === 1 ? '' : 's'} in ${fileIssues.size} file${fileIssues.size === 1 ? '' : 's'}`);
    parts.push('');
  }

  for (const [file, issues] of sorted) {
    parts.push(`--- ${file} (${issues.length}) ---`);
    parts.push(...issues.slice(0, maxPerFile));
    if (issues.length > maxPerFile) {
      parts.push(`  ... and ${issues.length - maxPerFile} more`);
    }
    parts.push('');
  }

  parts.push(...otherLines);
  return applyBudgetCap(parts.join('\n'), budget);
}
