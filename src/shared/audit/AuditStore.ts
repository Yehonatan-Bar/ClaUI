import * as fs from 'fs';
import * as path from 'path';
import type { AuditEvent, FindingSeverity } from '../secret-protection/types';

export interface AuditEventFilter {
  boundary?: string;
  action?: string;
  severityMin?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditStoreStats {
  totalEvents: number;
  byAction: Record<string, number>;
  byBoundary: Record<string, number>;
  bySeverity: Record<string, number>;
  redactionCount: number;
  redactedBytes: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function auditDirFor(storeDir: string): string {
  return path.join(storeDir, 'audit');
}

function dateFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
  return match ? match[1] : null;
}

function eventMatchesFilter(event: AuditEvent, filter: AuditEventFilter): boolean {
  if (filter.boundary && event.boundary !== filter.boundary) {
    return false;
  }
  if (filter.action && event.action !== filter.action) {
    return false;
  }
  if (filter.severityMin) {
    if (!event.severityMax) {
      return false;
    }
    const minRank = SEVERITY_RANK[filter.severityMin as FindingSeverity] ?? 0;
    const eventRank = SEVERITY_RANK[event.severityMax] ?? 0;
    if (eventRank < minRank) {
      return false;
    }
  }
  if (filter.startDate && event.timestamp < filter.startDate) {
    return false;
  }
  if (filter.endDate && event.timestamp > filter.endDate) {
    return false;
  }
  return true;
}

export class AuditStore {
  constructor(private readonly storeDir: string) {}

  async append(event: AuditEvent): Promise<void> {
    const auditDir = auditDirFor(this.storeDir);
    await fs.promises.mkdir(auditDir, { recursive: true });

    const filePath = path.join(auditDir, `${event.timestamp.slice(0, 10)}.jsonl`);
    await fs.promises.appendFile(filePath, JSON.stringify(event) + '\n', 'utf-8');
  }

  async read(filter?: AuditEventFilter, limit?: number): Promise<AuditEvent[]> {
    const auditDir = auditDirFor(this.storeDir);
    let files: string[];
    try {
      files = await fs.promises.readdir(auditDir);
    } catch {
      return [];
    }

    const jsonlFiles = files
      .filter((file) => file.endsWith('.jsonl'))
      .sort((a, b) => b.localeCompare(a))
      .filter((file) => {
        const fileDate = dateFromFilename(file);
        if (!fileDate) return false;
        if (filter?.startDate && fileDate < filter.startDate.slice(0, 10)) return false;
        if (filter?.endDate && fileDate > filter.endDate.slice(0, 10)) return false;
        return true;
      });

    const events: AuditEvent[] = [];
    for (const file of jsonlFiles) {
      if (limit && events.length >= limit) break;

      let content: string;
      try {
        content = await fs.promises.readFile(path.join(auditDir, file), 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      for (let i = lines.length - 1; i >= 0; i--) {
        if (limit && events.length >= limit) break;
        try {
          const event = JSON.parse(lines[i]) as AuditEvent;
          if (!filter || eventMatchesFilter(event, filter)) {
            events.push(event);
          }
        } catch {
          // Ignore malformed audit lines; the store remains append-only.
        }
      }
    }

    return events;
  }

  async prune(retentionDays: number): Promise<number> {
    const auditDir = auditDirFor(this.storeDir);
    let files: string[];
    try {
      files = await fs.promises.readdir(auditDir);
    } catch {
      return 0;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    let deleted = 0;

    for (const file of files) {
      const fileDate = dateFromFilename(file);
      if (!fileDate || fileDate >= cutoffDate) continue;
      try {
        await fs.promises.unlink(path.join(auditDir, file));
        deleted++;
      } catch {
        // Best-effort retention cleanup.
      }
    }

    return deleted;
  }

  async getStats(filter?: AuditEventFilter): Promise<AuditStoreStats> {
    const events = await this.read(filter);
    const stats: AuditStoreStats = {
      totalEvents: events.length,
      byAction: {},
      byBoundary: {},
      bySeverity: {},
      redactionCount: 0,
      redactedBytes: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    };

    for (const event of events) {
      stats.byAction[event.action] = (stats.byAction[event.action] ?? 0) + 1;
      stats.byBoundary[event.boundary] = (stats.byBoundary[event.boundary] ?? 0) + 1;
      if (event.severityMax) {
        stats.bySeverity[event.severityMax] = (stats.bySeverity[event.severityMax] ?? 0) + 1;
      }
      stats.redactionCount += event.redactionCount ?? 0;
      stats.redactedBytes += event.redactedBytes ?? 0;
      if (!stats.firstTimestamp || event.timestamp < stats.firstTimestamp) {
        stats.firstTimestamp = event.timestamp;
      }
      if (!stats.lastTimestamp || event.timestamp > stats.lastTimestamp) {
        stats.lastTimestamp = event.timestamp;
      }
    }

    return stats;
  }
}
