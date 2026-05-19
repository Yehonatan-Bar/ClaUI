import * as fs from 'fs';
import * as path from 'path';
import {
  ParticleAcceleratorTrace, ParticleAcceleratorTraceSummary, ParticleAcceleratorAggregate,
  ParticleAcceleratorDailyReport, ParticleAcceleratorSettings,
} from './ParticleAcceleratorTypes';

export class ParticleAcceleratorTraceReader {
  constructor(private storeDir: string) {}

  async getRecentTraces(limit: number, workspacePath?: string): Promise<ParticleAcceleratorTraceSummary[]> {
    const tracesDir = path.join(this.storeDir, 'traces');
    const dateDirs = await this.getSortedDateDirs(tracesDir);
    const summaries: ParticleAcceleratorTraceSummary[] = [];

    for (const dateDir of dateDirs) {
      if (summaries.length >= limit) break;
      const dirPath = path.join(tracesDir, dateDir);
      const files = await this.safeReaddir(dirPath);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      for (const file of jsonFiles) {
        if (summaries.length >= limit) break;
        try {
          const raw = await fs.promises.readFile(path.join(dirPath, file), 'utf8');
          const trace: ParticleAcceleratorTrace = JSON.parse(raw);
          if (workspacePath && trace.workspacePath !== workspacePath) continue;
          summaries.push(this.toSummary(trace));
        } catch {
          // Skip corrupted files
        }
      }
    }

    return summaries;
  }

  async getTrace(traceId: string): Promise<ParticleAcceleratorTrace | null> {
    const tracesDir = path.join(this.storeDir, 'traces');
    const dateDirs = await this.getSortedDateDirs(tracesDir);

    for (const dateDir of dateDirs) {
      const filePath = path.join(tracesDir, dateDir, `${traceId}.json`);
      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
      } catch {
        continue;
      }
    }
    return null;
  }

  async getAggregate(workspacePath?: string): Promise<ParticleAcceleratorAggregate> {
    const traces = await this.getRecentTraces(10000, workspacePath);
    return this.computeAggregate(traces);
  }

  async getRawLog(traceId: string, stream: 'stdout' | 'stderr'): Promise<string | null> {
    const rawDir = path.join(this.storeDir, 'raw');
    const dateDirs = await this.getSortedDateDirs(rawDir);

    for (const dateDir of dateDirs) {
      const filePath = path.join(rawDir, dateDir, `${traceId}.${stream}.log`);
      try {
        return await fs.promises.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
    }
    return null;
  }

  async getDailyReport(date: string): Promise<ParticleAcceleratorDailyReport | null> {
    const filePath = path.join(this.storeDir, 'reports', `daily-${date}.json`);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async cleanExpired(settings: ParticleAcceleratorSettings): Promise<{
    deletedTraces: number;
    deletedRawLogs: number;
    deletedReports: number;
    freedBytes: number;
  }> {
    let deletedTraces = 0;
    let deletedRawLogs = 0;
    let deletedReports = 0;
    let freedBytes = 0;

    const now = Date.now();

    // Tier 1: Raw logs — time + size
    const rawRetentionMs = Math.min(settings.rawLogRetentionDays, 90) * 86400000;
    const maxRawBytes = Math.min(settings.maxRawLogMb, 5000) * 1024 * 1024;
    const rawResult = await this.cleanDirectory(
      path.join(this.storeDir, 'raw'), rawRetentionMs, now, undefined, maxRawBytes,
    );
    deletedRawLogs = rawResult.deleted;
    freedBytes += rawResult.freedBytes;

    // Tier 2: Traces — time + count
    const traceRetentionMs = Math.min(settings.traceRetentionDays, 365) * 86400000;
    const maxTraces = Math.min(settings.maxTraceCount, 100000);
    const traceResult = await this.cleanDirectory(
      path.join(this.storeDir, 'traces'), traceRetentionMs, now, maxTraces,
    );
    deletedTraces = traceResult.deleted;
    freedBytes += traceResult.freedBytes;

    // Tier 3: Reports — time only
    const reportRetentionMs = Math.min(settings.dailyReportRetentionDays, 365) * 86400000;
    const reportResult = await this.cleanReports(
      path.join(this.storeDir, 'reports'), reportRetentionMs, now,
    );
    deletedReports = reportResult.deleted;
    freedBytes += reportResult.freedBytes;

    return { deletedTraces, deletedRawLogs, deletedReports, freedBytes };
  }

  private toSummary(trace: ParticleAcceleratorTrace): ParticleAcceleratorTraceSummary {
    return {
      traceId: trace.traceId,
      timestamp: trace.timestamp,
      provider: trace.provider,
      commandFamily: trace.command.family,
      exitCode: trace.execution.exitCode,
      durationMs: trace.execution.durationMs,
      rawBytes: trace.output.rawStdoutBytes + trace.output.rawStderrBytes,
      filteredBytes: trace.output.filteredStdoutBytes + trace.output.filteredStderrBytes,
      estimatedTokensSaved: trace.output.estimatedTokensSaved,
      filterName: trace.filter.name,
      redactions: trace.redaction.replacements,
      rulesTriggered: trace.redaction.rulesTriggered ?? [],
      rawLines: trace.output.rawLines ?? 0,
      filteredLines: trace.output.filteredLines ?? 0,
      dlpFindingCount: trace.dlp?.findingCount,
      dlpSeverityMax: trace.dlp?.severityMax,
    };
  }

  private computeAggregate(summaries: ParticleAcceleratorTraceSummary[]): ParticleAcceleratorAggregate {
    const familyCounts = new Map<string, { count: number; tokensSaved: number }>();
    const filterCounts = new Map<string, number>();
    const providerCounts = new Map<string, { count: number; tokensSaved: number }>();
    const secretTypeCounts = new Map<string, number>();

    let totalRaw = 0, totalFiltered = 0, totalTokensSaved = 0;
    let totalDurationMs = 0, totalRedactions = 0, failedCount = 0;
    let totalRawLines = 0, totalFilteredLines = 0;
    let totalRawWords = 0, totalFilteredWords = 0;

    for (const s of summaries) {
      totalRaw += s.rawBytes;
      totalFiltered += s.filteredBytes;
      totalTokensSaved += s.estimatedTokensSaved;
      totalDurationMs += s.durationMs;
      totalRedactions += s.redactions;
      totalRawLines += s.rawLines ?? 0;
      totalFilteredLines += s.filteredLines ?? 0;
      if (s.exitCode !== 0) failedCount++;

      const fc = familyCounts.get(s.commandFamily) ?? { count: 0, tokensSaved: 0 };
      fc.count++;
      fc.tokensSaved += s.estimatedTokensSaved;
      familyCounts.set(s.commandFamily, fc);

      filterCounts.set(s.filterName, (filterCounts.get(s.filterName) ?? 0) + 1);

      const pc = providerCounts.get(s.provider) ?? { count: 0, tokensSaved: 0 };
      pc.count++;
      pc.tokensSaved += s.estimatedTokensSaved;
      providerCounts.set(s.provider, pc);

      for (const rule of (s.rulesTriggered ?? [])) {
        secretTypeCounts.set(rule, (secretTypeCounts.get(rule) ?? 0) + 1);
      }
    }

    // Estimate words from bytes (~5 bytes per word for mixed content)
    totalRawWords = Math.round(totalRaw / 5);
    totalFilteredWords = Math.round(totalFiltered / 5);

    const n = summaries.length || 1;

    return {
      totalCommands: summaries.length,
      failedCommands: failedCount,
      totalRawBytes: totalRaw,
      totalFilteredBytes: totalFiltered,
      totalEstimatedTokensSaved: totalTokensSaved,
      avgCompressionRatio: totalRaw > 0 ? totalRaw / (totalFiltered || 1) : 1,
      avgDurationMs: totalDurationMs / n,
      totalRedactions,
      totalRawLines,
      totalFilteredLines,
      totalRawWords,
      totalFilteredWords,
      secretTypeBreakdown: Array.from(secretTypeCounts.entries())
        .map(([secretType, count]) => ({ secretType, count }))
        .sort((a, b) => b.count - a.count),
      topCommandFamilies: Array.from(familyCounts.entries())
        .map(([family, data]) => ({ family, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topFilters: Array.from(filterCounts.entries())
        .map(([filter, count]) => ({ filter, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      providerBreakdown: Object.fromEntries(providerCounts),
    };
  }

  private async getSortedDateDirs(baseDir: string): Promise<string[]> {
    const dirs = await this.safeReaddir(baseDir);
    return dirs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  }

  private async safeReaddir(dirPath: string): Promise<string[]> {
    try {
      return await fs.promises.readdir(dirPath);
    } catch {
      return [];
    }
  }

  private async cleanDirectory(
    baseDir: string,
    retentionMs: number,
    now: number,
    maxCount?: number,
    maxBytes?: number,
  ): Promise<{ deleted: number; freedBytes: number }> {
    let deleted = 0;
    let freedBytes = 0;
    const cutoff = now - retentionMs;

    const dateDirs = await this.getSortedDateDirs(baseDir);
    let totalCount = 0;
    let totalBytes = 0;

    // First pass: count and measure
    const allFiles: Array<{ path: string; dateDir: string; size: number; dateMs: number }> = [];
    for (const dateDir of dateDirs) {
      const dateMs = new Date(dateDir).getTime();
      const dirPath = path.join(baseDir, dateDir);
      const files = await this.safeReaddir(dirPath);
      for (const f of files) {
        const fp = path.join(dirPath, f);
        try {
          const stat = await fs.promises.stat(fp);
          allFiles.push({ path: fp, dateDir, size: stat.size, dateMs });
          totalCount++;
          totalBytes += stat.size;
        } catch {
          // skip
        }
      }
    }

    // Sort oldest first for deletion
    allFiles.sort((a, b) => a.dateMs - b.dateMs);

    for (const f of allFiles) {
      const shouldDeleteByTime = f.dateMs < cutoff;
      const shouldDeleteByCount = maxCount !== undefined && totalCount > maxCount;
      const shouldDeleteBySize = maxBytes !== undefined && totalBytes > maxBytes;

      if (shouldDeleteByTime || shouldDeleteByCount || shouldDeleteBySize) {
        try {
          await fs.promises.unlink(f.path);
          deleted++;
          freedBytes += f.size;
          totalCount--;
          totalBytes -= f.size;
        } catch {
          // skip
        }
      }
    }

    // Clean up empty date directories
    for (const dateDir of dateDirs) {
      const dirPath = path.join(baseDir, dateDir);
      const remaining = await this.safeReaddir(dirPath);
      if (remaining.length === 0) {
        try { await fs.promises.rmdir(dirPath); } catch { /* skip */ }
      }
    }

    return { deleted, freedBytes };
  }

  private async cleanReports(
    reportsDir: string,
    retentionMs: number,
    now: number,
  ): Promise<{ deleted: number; freedBytes: number }> {
    let deleted = 0;
    let freedBytes = 0;
    const cutoff = now - retentionMs;

    const files = await this.safeReaddir(reportsDir);
    for (const f of files) {
      const match = /^daily-(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
      if (!match) continue;
      const dateMs = new Date(match[1]).getTime();
      if (dateMs < cutoff) {
        const fp = path.join(reportsDir, f);
        try {
          const stat = await fs.promises.stat(fp);
          await fs.promises.unlink(fp);
          deleted++;
          freedBytes += stat.size;
        } catch {
          // skip
        }
      }
    }

    return { deleted, freedBytes };
  }
}
