import * as fs from 'fs';
import * as path from 'path';
import { ParticleAcceleratorDailyReport } from './ParticleAcceleratorTypes';
import { ParticleAcceleratorTraceReader } from './ParticleAcceleratorTraceReader';

export class ParticleAcceleratorDailyReportGenerator {
  constructor(
    private storeDir: string,
    private traceReader: ParticleAcceleratorTraceReader,
  ) {}

  async generateDailyReport(date: string): Promise<ParticleAcceleratorDailyReport> {
    const summaries = await this.traceReader.getRecentTraces(100000);
    const dayTraces = summaries.filter(s => s.timestamp.startsWith(date));

    const familyMap = new Map<string, { count: number; tokensSaved: number }>();
    const filterMap = new Map<string, number>();
    const providerMap = new Map<string, { count: number; tokensSaved: number }>();

    let totalRaw = 0, totalFiltered = 0, totalTokens = 0;
    let totalDuration = 0, totalRedactions = 0, failedCount = 0;

    for (const t of dayTraces) {
      totalRaw += t.rawBytes;
      totalFiltered += t.filteredBytes;
      totalTokens += t.estimatedTokensSaved;
      totalDuration += t.durationMs;
      totalRedactions += t.redactions;
      if (t.exitCode !== 0) failedCount++;

      const fc = familyMap.get(t.commandFamily) ?? { count: 0, tokensSaved: 0 };
      fc.count++;
      fc.tokensSaved += t.estimatedTokensSaved;
      familyMap.set(t.commandFamily, fc);

      filterMap.set(t.filterName, (filterMap.get(t.filterName) ?? 0) + 1);

      const pc = providerMap.get(t.provider) ?? { count: 0, tokensSaved: 0 };
      pc.count++;
      pc.tokensSaved += t.estimatedTokensSaved;
      providerMap.set(t.provider, pc);
    }

    const n = dayTraces.length || 1;

    return {
      schemaVersion: 1,
      date,
      generatedAt: new Date().toISOString(),
      commandCount: dayTraces.length,
      failedCommandCount: failedCount,
      totalRawBytes: totalRaw,
      totalFilteredBytes: totalFiltered,
      estimatedTokensSaved: totalTokens,
      topCommandFamilies: Array.from(familyMap.entries())
        .map(([family, data]) => ({ family, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topFilters: Array.from(filterMap.entries())
        .map(([filter, count]) => ({ filter, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      avgCompressionRatio: totalRaw > 0 ? totalRaw / (totalFiltered || 1) : 1,
      avgDurationMs: totalDuration / n,
      totalRedactions,
      providerBreakdown: Object.fromEntries(providerMap),
    };
  }

  async generateIfMissing(date: string): Promise<void> {
    const reportPath = path.join(this.storeDir, 'reports', `daily-${date}.json`);
    try {
      await fs.promises.access(reportPath);
      return; // Already exists
    } catch {
      // Generate it
    }

    const report = await this.generateDailyReport(date);
    if (report.commandCount === 0) return; // No data for this day

    const reportsDir = path.join(this.storeDir, 'reports');
    try {
      await fs.promises.mkdir(reportsDir, { recursive: true });
    } catch {
      // exists
    }

    const tmpPath = reportPath + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(report, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, reportPath);
  }
}
