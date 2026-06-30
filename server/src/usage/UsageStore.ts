import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import {
  CostConfig, DeveloperRecord, DeveloperEvent, ModelUsage, PriceRow, UsageRecord,
} from './types';
import { defaultCostConfig } from './PriceDefaults';
import { hashSecret, randomToken, verifySecret } from '../util/crypto';

/**
 * Persistent store for the usage/cost feature. Mirrors SessionPersistence's
 * append-only JSONL pattern, replayed on startup to rebuild in-memory aggregates.
 * Fully isolated: own files, own in-memory state, never touches session data.
 *
 * Files (under dataDir):
 *   developers.jsonl - registry events (register, lastReport)
 *   usage.jsonl      - one record per accepted report delta
 *   prices.json      - the single cost-config document (overwritten on save)
 */
export class UsageStore {
  private readonly dataDir: string;
  private readonly log: (msg: string) => void;

  private developers = new Map<string, DeveloperRecord>();
  private usageRecords: UsageRecord[] = [];
  private config: CostConfig;

  private devStream: fs.WriteStream | null = null;
  private usageStream: fs.WriteStream | null = null;

  constructor(dataDir: string, log?: (msg: string) => void) {
    this.dataDir = dataDir;
    this.log = log || console.log;
    this.config = defaultCostConfig(new Date().toISOString());
  }

  private get devFile(): string { return path.join(this.dataDir, 'developers.jsonl'); }
  private get usageFile(): string { return path.join(this.dataDir, 'usage.jsonl'); }
  private get pricesFile(): string { return path.join(this.dataDir, 'prices.json'); }

  /** Replay persisted files into memory and open append streams. */
  load(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.loadDevelopers();
    this.loadUsage();
    this.loadConfig();

    this.devStream = fs.createWriteStream(this.devFile, { flags: 'a', encoding: 'utf-8' });
    this.usageStream = fs.createWriteStream(this.usageFile, { flags: 'a', encoding: 'utf-8' });

    this.log(`UsageStore: ${this.developers.size} developers, ${this.usageRecords.length} usage records, ${Object.keys(this.config.prices).length} price rows (dir: ${this.dataDir})`);
  }

  private loadDevelopers(): void {
    if (!fs.existsSync(this.devFile)) return;
    const lines = fs.readFileSync(this.devFile, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as DeveloperEvent;
        if (ev.ev === 'register') {
          const existing = this.developers.get(ev.developerId);
          if (existing) {
            // Re-registration of the same id (e.g. token rotation): update fields.
            existing.displayName = ev.displayName;
            existing.tokenHash = ev.tokenHash;
            if (ev.deviceId && !existing.deviceIds.includes(ev.deviceId)) {
              existing.deviceIds.push(ev.deviceId);
            }
          } else {
            this.developers.set(ev.developerId, {
              developerId: ev.developerId,
              displayName: ev.displayName,
              deviceIds: ev.deviceId ? [ev.deviceId] : [],
              tokenHash: ev.tokenHash,
              createdAt: ev.createdAt,
              lastReportAt: null,
            });
          }
        } else if (ev.ev === 'lastReport') {
          const dev = this.developers.get(ev.developerId);
          if (dev) {
            dev.lastReportAt = ev.at;
            if (ev.deviceId && !dev.deviceIds.includes(ev.deviceId)) {
              dev.deviceIds.push(ev.deviceId);
            }
          }
        }
      } catch (err) {
        this.log(`UsageStore: bad developers line: ${err}`);
      }
    }
  }

  private loadUsage(): void {
    if (!fs.existsSync(this.usageFile)) return;
    const lines = fs.readFileSync(this.usageFile, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as UsageRecord;
        if (rec && typeof rec.serverReceivedAt === 'number' && Array.isArray(rec.usage)) {
          this.usageRecords.push(rec);
        }
      } catch (err) {
        this.log(`UsageStore: bad usage line: ${err}`);
      }
    }
  }

  private loadConfig(): void {
    if (!fs.existsSync(this.pricesFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.pricesFile, 'utf-8')) as Partial<CostConfig>;
      // Merge over defaults so a partial/old file still yields a complete config.
      const base = defaultCostConfig(this.config.updatedAt);
      this.config = {
        currency: parsed.currency ?? base.currency,
        exchangeRate: typeof parsed.exchangeRate === 'number' ? parsed.exchangeRate : base.exchangeRate,
        monthlyBudgetUsd: typeof parsed.monthlyBudgetUsd === 'number' ? parsed.monthlyBudgetUsd : base.monthlyBudgetUsd,
        spikePercent: typeof parsed.spikePercent === 'number' ? parsed.spikePercent : base.spikePercent,
        inactiveDays: typeof parsed.inactiveDays === 'number' ? parsed.inactiveDays : base.inactiveDays,
        prices: (parsed.prices && typeof parsed.prices === 'object') ? parsed.prices as Record<string, PriceRow> : base.prices,
        updatedAt: parsed.updatedAt ?? base.updatedAt,
      };
      // Always guarantee an "unknown" fallback row exists.
      if (!this.config.prices['unknown']) {
        this.config.prices['unknown'] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      }
    } catch (err) {
      this.log(`UsageStore: failed to read prices.json, using defaults: ${err}`);
    }
  }

  // --- Developer registry ---

  /** Register a new developer. Returns the id + a one-time bearer token (never persisted in plaintext). */
  registerDeveloper(displayName: string, deviceId: string): { developerId: string; developerToken: string } {
    const developerId = uuid();
    const developerToken = randomToken(32);
    const tokenHash = hashSecret(developerToken);
    const createdAt = Date.now();

    this.developers.set(developerId, {
      developerId,
      displayName,
      deviceIds: deviceId ? [deviceId] : [],
      tokenHash,
      createdAt,
      lastReportAt: null,
    });

    const ev: DeveloperEvent = { ev: 'register', developerId, displayName, deviceId, tokenHash, createdAt };
    this.devStream?.write(JSON.stringify(ev) + '\n');
    this.log(`UsageStore: registered developer ${developerId} "${displayName}"`);
    return { developerId, developerToken };
  }

  getDeveloper(developerId: string): DeveloperRecord | undefined {
    return this.developers.get(developerId);
  }

  /** Constant-time validation of a developer's bearer token. */
  verifyDeveloperToken(developerId: string, token: string): boolean {
    const dev = this.developers.get(developerId);
    if (!dev) return false;
    return verifySecret(token, dev.tokenHash);
  }

  /**
   * Record an accepted report and refresh the developer's lastReportAt.
   *
   * An empty `usage` array is a valid hourly heartbeat (online-but-idle
   * developer): it still advances lastReportAt (persisted via the `lastReport`
   * event so it survives a restart) but is NOT appended to usage.jsonl and never
   * enters the in-memory aggregate, so heartbeats neither bloat storage nor
   * affect cost/leaderboard figures.
   */
  recordReport(developerId: string, deviceId: string, usage: ModelUsage[], serverReceivedAt: number): void {
    if (usage.length > 0) {
      const rec: UsageRecord = { developerId, deviceId, serverReceivedAt, usage };
      this.usageRecords.push(rec);
      this.usageStream?.write(JSON.stringify(rec) + '\n');
    }

    const dev = this.developers.get(developerId);
    if (dev) {
      dev.lastReportAt = serverReceivedAt;
      if (deviceId && !dev.deviceIds.includes(deviceId)) dev.deviceIds.push(deviceId);
    }
    const ev: DeveloperEvent = { ev: 'lastReport', developerId, at: serverReceivedAt, deviceId };
    this.devStream?.write(JSON.stringify(ev) + '\n');
  }

  // --- Accessors for the aggregator ---

  getAllDevelopers(): DeveloperRecord[] {
    return [...this.developers.values()];
  }

  getAllRecords(): UsageRecord[] {
    return this.usageRecords;
  }

  /** Records whose serverReceivedAt falls in [start, end). */
  getRecordsInRange(start: number, end: number): UsageRecord[] {
    return this.usageRecords.filter(r => r.serverReceivedAt >= start && r.serverReceivedAt < end);
  }

  getConfig(): CostConfig {
    return this.config;
  }

  /** Overwrite the cost config (prices + thresholds) and persist prices.json. */
  saveConfig(patch: Partial<CostConfig>): CostConfig {
    const next: CostConfig = {
      ...this.config,
      ...patch,
      prices: patch.prices ?? this.config.prices,
      updatedAt: new Date().toISOString(),
    };
    if (!next.prices['unknown']) {
      next.prices['unknown'] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    }
    this.config = next;
    fs.writeFileSync(this.pricesFile, JSON.stringify(next, null, 2), 'utf-8');
    this.log('UsageStore: prices.json saved');
    return next;
  }

  close(): void {
    this.devStream?.end();
    this.usageStream?.end();
    this.devStream = null;
    this.usageStream = null;
  }
}
