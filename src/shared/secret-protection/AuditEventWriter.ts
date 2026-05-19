import * as fs from 'fs';
import * as path from 'path';
import { AuditEvent, FindingSeverity } from './types';

export interface AuditEventFilter {
  boundary?: string;
  action?: string;
  severityMin?: string;
  startDate?: string;
  endDate?: string;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

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
  if (filter.severityMin && event.severityMax) {
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

export class AuditEventWriter {
  async writeEvent(event: AuditEvent, storeDir: string): Promise<void> {
    const auditDir = path.join(storeDir, 'audit');
    await fs.promises.mkdir(auditDir, { recursive: true });

    const date = event.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(auditDir, `${date}.jsonl`);
    const line = JSON.stringify(event) + '\n';

    await fs.promises.appendFile(filePath, line, 'utf-8');
  }

  async readEvents(
    storeDir: string,
    filter?: AuditEventFilter,
    limit?: number
  ): Promise<AuditEvent[]> {
    const auditDir = path.join(storeDir, 'audit');

    let files: string[];
    try {
      files = await fs.promises.readdir(auditDir);
    } catch {
      return [];
    }

    // Filter to only .jsonl files and sort newest-first by date.
    const jsonlFiles = files
      .filter((f) => f.endsWith('.jsonl'))
      .sort((a, b) => b.localeCompare(a));

    // Pre-filter files by date range if provided.
    const filteredFiles = jsonlFiles.filter((f) => {
      const fileDate = dateFromFilename(f);
      if (!fileDate) return false;
      if (filter?.startDate && fileDate < filter.startDate.slice(0, 10)) return false;
      if (filter?.endDate && fileDate > filter.endDate.slice(0, 10)) return false;
      return true;
    });

    const events: AuditEvent[] = [];

    for (const file of filteredFiles) {
      if (limit && events.length >= limit) break;

      const filePath = path.join(auditDir, file);
      let content: string;
      try {
        content = await fs.promises.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n').filter((l) => l.trim().length > 0);

      // Reverse lines within each file so newest events come first
      // (assuming events are appended chronologically).
      for (let i = lines.length - 1; i >= 0; i--) {
        if (limit && events.length >= limit) break;

        try {
          const event: AuditEvent = JSON.parse(lines[i]);
          if (!filter || eventMatchesFilter(event, filter)) {
            events.push(event);
          }
        } catch {
          // Skip malformed lines.
        }
      }
    }

    return events;
  }

  async pruneOldEvents(storeDir: string, retentionDays: number): Promise<number> {
    const auditDir = path.join(storeDir, 'audit');

    let files: string[];
    try {
      files = await fs.promises.readdir(auditDir);
    } catch {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    let deletedCount = 0;

    for (const file of files) {
      const fileDate = dateFromFilename(file);
      if (!fileDate) continue;

      if (fileDate < cutoffStr) {
        try {
          await fs.promises.unlink(path.join(auditDir, file));
          deletedCount++;
        } catch {
          // Skip files that can't be deleted.
        }
      }
    }

    return deletedCount;
  }
}
