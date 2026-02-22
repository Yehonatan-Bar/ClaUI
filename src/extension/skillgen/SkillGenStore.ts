import * as vscode from 'vscode';
import type { SkillGenRunHistoryEntry } from '../types/webview-messages';

/**
 * Fingerprint for a single SR-PTD document.
 * Used to detect new/changed documents without re-processing.
 */
export interface DocumentFingerprint {
  /** Relative path from the docs directory */
  relativePath: string;
  /** File size in bytes */
  size: number;
  /** Last modified time (ms since epoch) */
  mtimeMs: number;
  /** Processing status */
  status: 'pending' | 'processed';
  /** When first discovered (ISO date) */
  discoveredAt: string;
}

/**
 * Persisted state for the skill generation feature.
 * Uses globalState (survives across workspaces and restarts).
 */
export interface SkillGenLedger {
  /** Document fingerprints keyed by relative path */
  documents: Record<string, DocumentFingerprint>;
  /** Run history (most recent first) */
  history: SkillGenRunHistoryEntry[];
  /** Last successful scan timestamp (ISO) */
  lastScanAt: string | null;
  /** Last successful run timestamp (ISO) */
  lastRunAt: string | null;
}

const STORE_KEY = 'skillGen.ledger';
const MAX_HISTORY = 20;

/**
 * SkillGenStore manages persistent state for the skill generation feature:
 * - Document fingerprint ledger (tracks which docs are new/processed)
 * - Run history (past pipeline executions and their results)
 *
 * Persisted via vscode.Memento (globalState) for cross-session durability.
 */
export class SkillGenStore {
  private log: (msg: string) => void = () => {};

  constructor(private readonly memento: vscode.Memento) {}

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Get the full ledger (or empty defaults) */
  getLedger(): SkillGenLedger {
    return this.memento.get<SkillGenLedger>(STORE_KEY, {
      documents: {},
      history: [],
      lastScanAt: null,
      lastRunAt: null,
    });
  }

  /** Replace the full ledger */
  private async saveLedger(ledger: SkillGenLedger): Promise<void> {
    await this.memento.update(STORE_KEY, ledger);
  }

  /** Get count of documents with 'pending' status */
  getPendingCount(): number {
    const ledger = this.getLedger();
    return Object.values(ledger.documents).filter(d => d.status === 'pending').length;
  }

  /** Get all pending document paths */
  getPendingDocPaths(): string[] {
    const ledger = this.getLedger();
    return Object.values(ledger.documents)
      .filter(d => d.status === 'pending')
      .map(d => d.relativePath);
  }

  /** Get total tracked document count */
  getTotalCount(): number {
    const ledger = this.getLedger();
    return Object.keys(ledger.documents).length;
  }

  /**
   * Update the ledger with a fresh scan of documents.
   * - New documents get status 'pending'
   * - Changed documents (mtime/size differ) get status 'pending'
   * - Unchanged documents keep their current status
   * - Documents no longer on disk are removed
   *
   * @returns Number of newly pending documents
   */
  async updateFromScan(scannedDocs: Array<{ relativePath: string; size: number; mtimeMs: number }>): Promise<number> {
    const ledger = this.getLedger();
    const now = new Date().toISOString();
    const scannedPaths = new Set(scannedDocs.map(d => d.relativePath));
    let newPendingCount = 0;

    // Add/update scanned documents
    for (const doc of scannedDocs) {
      const existing = ledger.documents[doc.relativePath];
      if (!existing) {
        // New document
        ledger.documents[doc.relativePath] = {
          relativePath: doc.relativePath,
          size: doc.size,
          mtimeMs: doc.mtimeMs,
          status: 'pending',
          discoveredAt: now,
        };
        newPendingCount++;
      } else if (existing.mtimeMs !== doc.mtimeMs || existing.size !== doc.size) {
        // Changed document - mark as pending again
        existing.mtimeMs = doc.mtimeMs;
        existing.size = doc.size;
        existing.status = 'pending';
        newPendingCount++;
      }
      // Unchanged documents keep their current status
    }

    // Remove documents that are no longer on disk
    for (const path of Object.keys(ledger.documents)) {
      if (!scannedPaths.has(path)) {
        delete ledger.documents[path];
      }
    }

    ledger.lastScanAt = now;
    await this.saveLedger(ledger);
    this.log(`[SkillGen] Scan complete: ${scannedDocs.length} total, ${newPendingCount} newly pending, ${this.getPendingCount()} total pending`);
    return newPendingCount;
  }

  /**
   * Mark all pending documents as processed.
   * Called after a successful pipeline run + installation.
   */
  async markAllProcessed(): Promise<void> {
    const ledger = this.getLedger();
    for (const doc of Object.values(ledger.documents)) {
      if (doc.status === 'pending') {
        doc.status = 'processed';
      }
    }
    await this.saveLedger(ledger);
    this.log('[SkillGen] All pending documents marked as processed');
  }

  /** Add a run to the history */
  async addRunHistory(entry: SkillGenRunHistoryEntry): Promise<void> {
    const ledger = this.getLedger();
    ledger.history.unshift(entry);
    // Keep only the most recent entries
    if (ledger.history.length > MAX_HISTORY) {
      ledger.history = ledger.history.slice(0, MAX_HISTORY);
    }
    if (entry.status === 'succeeded') {
      ledger.lastRunAt = entry.date;
    }
    await this.saveLedger(ledger);
  }

  /** Get run history */
  getHistory(): SkillGenRunHistoryEntry[] {
    return this.getLedger().history;
  }

  /** Get the last run entry (or null) */
  getLastRun(): SkillGenRunHistoryEntry | null {
    const history = this.getHistory();
    return history.length > 0 ? history[0] : null;
  }

  /** Clear all data (for testing/reset) */
  async clear(): Promise<void> {
    await this.memento.update(STORE_KEY, undefined);
    this.log('[SkillGen] Store cleared');
  }
}
