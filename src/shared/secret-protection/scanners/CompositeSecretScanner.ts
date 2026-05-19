import { DlpFinding, SecretProtectionSettings } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';
import { EnvValueScanner } from './EnvValueScanner';
import { RegexRuleScanner } from './RegexRuleScanner';
import { EntropyScanner } from './EntropyScanner';
import { PathSensitivityClassifier } from './PathSensitivityClassifier';
import { StructuredPayloadScanner } from './StructuredPayloadScanner';
import { PiiAndInternalTopologyScanner } from './PiiAndInternalTopologyScanner';
import { RulePackDefinition } from '../rules/types';
import { getEnabledRulePacks } from '../rules';

const PERF_BUDGET_MS = 100;
const PERF_BUDGET_MAX_BYTES = 128 * 1024;

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function deduplicateFindings(findings: DlpFinding[]): DlpFinding[] {
  const sorted = [...findings].sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    const aStart = a.location.byteStart ?? 0;
    const bStart = b.location.byteStart ?? 0;
    return aStart - bStart;
  });

  const kept: DlpFinding[] = [];
  const keptRanges: Array<[number, number]> = [];

  for (const finding of sorted) {
    const fStart = finding.location.byteStart ?? 0;
    const fEnd = finding.location.byteEnd ?? 0;

    const overlaps = keptRanges.some(
      ([eStart, eEnd]) => fStart < eEnd && fEnd > eStart
    );

    if (!overlaps) {
      kept.push(finding);
      keptRanges.push([fStart, fEnd]);
    }
  }

  return kept;
}

export class CompositeSecretScanner implements ISecretScanner {
  readonly name = 'composite';
  private readonly scanners: ISecretScanner[];

  constructor(settings: SecretProtectionSettings, rulePacks?: RulePackDefinition[]) {
    this.scanners = [];

    if (!settings.enabled) return;

    const packs = rulePacks ?? getEnabledRulePacks();

    this.scanners.push(new EnvValueScanner());
    this.scanners.push(new RegexRuleScanner(packs));
    this.scanners.push(new EntropyScanner({ enabled: settings.enableEntropyScanner }));

    if (settings.blockProtectedPaths) {
      this.scanners.push(new PathSensitivityClassifier());
    }

    this.scanners.push(new StructuredPayloadScanner());
    this.scanners.push(new PiiAndInternalTopologyScanner());
  }

  scan(input: string, context?: ScanContext): ScanResult {
    const start = performance.now();
    const allFindings: DlpFinding[] = [];
    const scannedBytes = Buffer.byteLength(input, 'utf-8');

    for (const scanner of this.scanners) {
      const result = scanner.scan(input, context);
      allFindings.push(...result.findings);
    }

    const deduplicated = deduplicateFindings(allFindings);
    const totalLatency = performance.now() - start;

    if (totalLatency > PERF_BUDGET_MS && scannedBytes <= PERF_BUDGET_MAX_BYTES) {
      console.warn(
        `[secret-protection] Composite scan exceeded performance budget: ${totalLatency.toFixed(1)}ms for ${scannedBytes} bytes`,
      );
    }

    return {
      findings: deduplicated,
      scannedBytes,
      latencyMs: totalLatency,
    };
  }
}
