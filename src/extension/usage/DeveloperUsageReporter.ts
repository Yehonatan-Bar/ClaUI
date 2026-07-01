import type * as vscode from 'vscode';
import type { TurnTokens } from '../session/TokenUsageRatioTracker';
import { UsageReportClient, deriveHttpBaseFromWs } from './UsageReportClient';

const STATE_KEY = 'claudeMirror.developerUsage';
const SECRET_KEY = 'claudeMirror.developerToken';
const HOUR_MS = 60 * 60 * 1000;

/** Per-token-type counts for one model. */
interface TokenTypeCounts {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** Persisted state (VS Code globalState). Only numeric counts — never code/prompts. */
interface DeveloperUsageState {
  developerId: string | null;
  consentGranted: boolean;
  cumulative: Record<string, TokenTypeCounts>;
  lastReportedCumulative: Record<string, TokenTypeCounts>;
  lastSuccessfulReportAt: number | null;
  deviceId: string;
  displayName: string;
}

/**
 * Local default API prices (USD per 1M tokens), mirroring the server seed list.
 * Used ONLY for the developer's own "estimated cost" personal card; the
 * authoritative, admin-editable prices live on the server.
 */
const LOCAL_PRICES: Record<string, TokenTypeCounts> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 },
  'claude-fable-5': { input: 10, output: 50, cacheCreation: 12.5, cacheRead: 1.0 },
};
const WEIGHTS: TokenTypeCounts = { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 };

/** Result of a flush attempt (used by the manual "Report Usage Now" command). */
export interface FlushResult {
  ok: boolean;
  /** Number of model deltas sent (0 = heartbeat with no new usage). */
  sent?: number;
  /** Short machine reason when not ok. */
  reason?: string;
}

export interface MyUsageSnapshot {
  enabled: boolean;
  consentGranted: boolean;
  registered: boolean;
  developerName: string;
  totalRawTokens: number;
  totalWeightedTokens: number;
  estimatedCostUsd: number;
  primaryModel: string;
  lastSuccessfulReportAt: number | null;
  serverUrl: string;
}

/**
 * Owns the developer's local usage accumulation and the hourly report to the
 * coordination server. Privacy by construction: this class only ever holds
 * numeric token counts per model/type. No report is ever sent without
 * `consentGranted`. The developer token lives in SecretStorage, never settings.
 */
export class DeveloperUsageReporter {
  private state: DeveloperUsageState;
  private writeQueue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Re-entrancy guard so overlapping flushes never race on the reported baseline. */
  private flushing = false;
  private readonly client: UsageReportClient;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
    private readonly getConfig: () => vscode.WorkspaceConfiguration,
    private readonly machineId: string,
    private readonly log: (msg: string) => void,
  ) {
    this.client = new UsageReportClient(log);
    this.state = this.load();
    if (!this.state.deviceId) {
      this.state.deviceId = machineId || 'unknown-device';
      this.enqueueWrite();
    }
  }

  // --- accumulation ---

  /** Accumulate one turn's tokens into the per-model/per-type cumulative counts. */
  recordTurn(tokens: TurnTokens): void {
    const key = this.modelKey(tokens.model);
    const bucket = this.state.cumulative[key] ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    bucket.input += tokens.inputTokens || 0;
    bucket.output += tokens.outputTokens || 0;
    bucket.cacheCreation += tokens.cacheCreationTokens || 0;
    bucket.cacheRead += tokens.cacheReadTokens || 0;
    this.state.cumulative[key] = bucket;
    this.enqueueWrite();
  }

  private modelKey(model?: string): string {
    const m = (model || '').trim().toLowerCase();
    return m || 'unknown';
  }

  // --- timer ---

  /** Start the hourly report timer and flush opportunistically if overdue. */
  startHourlyTimer(): void {
    if (this.timer) return;
    // Opportunistic flush shortly after activation if it has been > 1h.
    const overdue = !this.state.lastSuccessfulReportAt || Date.now() - this.state.lastSuccessfulReportAt > HOUR_MS;
    if (overdue) {
      setTimeout(() => { void this.flushReport(); }, 30_000);
    }
    this.timer = setInterval(() => { void this.flushReport(); }, HOUR_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Best-effort final flush on shutdown (fire-and-forget).
    void this.flushReport();
  }

  // --- reporting ---

  /**
   * Compute the delta since the last successful report and POST it. All network
   * errors are swallowed (silent-failure requirement); the returned result lets a
   * MANUAL trigger ("Report Usage Now") surface feedback. The hourly timer ignores it.
   */
  async flushReport(): Promise<FlushResult> {
    // Cheap gates first; do not enter the try (and its `finally` that clears the
    // guard) unless this call actually owns the in-flight slot.
    if (this.flushing) return { ok: false, reason: 'busy' };
    if (!this.state.developerId) return { ok: false, reason: 'not-registered' };
    if (!this.isEnabled() || !this.state.consentGranted) return { ok: false, reason: 'reporting-off' };
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return { ok: false, reason: 'no-server-url' };

    this.flushing = true;
    try {
      const credential = await this.secrets.get(SECRET_KEY);
      if (!credential) return { ok: false, reason: 'no-credential' };

      // Snapshot the cumulative counts at the moment the delta is computed. Turns
      // recorded while the POST is in flight keep accumulating into `cumulative`
      // but are NOT part of this report, so on success we advance the reported
      // baseline to exactly this SNAPSHOT (not the live, possibly-larger state).
      // That guarantees no double-count and, critically, no lost usage: anything
      // accumulated during the request is still un-reported and goes out next cycle.
      const snapshot = this.deepCopy(this.state.cumulative);
      const usage = this.computeDeltaFrom(snapshot);

      // Always send every cycle, even with an empty delta. The hourly report is
      // also a heartbeat: an online-but-idle developer must still refresh their
      // last-report time so the dashboard and inactive-developer alert stay correct.
      const payload = {
        developerId: this.state.developerId,
        deviceId: this.state.deviceId,
        reportedAt: Date.now(),
        usage,
      };
      const res = await this.client.report(baseUrl, credential, payload);
      if (res.status >= 200 && res.status < 300) {
        // Advance to the snapshot that was actually reported, NOT the live state.
        this.state.lastReportedCumulative = snapshot;
        this.state.lastSuccessfulReportAt = Date.now();
        this.enqueueWrite();
        this.log(`[Usage] Reported ${usage.length} model deltas (heartbeat) to ${baseUrl}`);
        return { ok: true, sent: usage.length };
      }
      this.log(`[Usage] Report rejected (HTTP ${res.status}); will retry next cycle`);
      return { ok: false, reason: `http-${res.status}` };
    } catch (err) {
      // Silent failure by design (offline, server down, etc.). Next cycle retries;
      // lastReportedCumulative is untouched so no usage is lost.
      const reason = err instanceof Error ? err.message : String(err);
      this.log(`[Usage] Report failed silently: ${reason}`);
      return { ok: false, reason };
    } finally {
      this.flushing = false;
    }
  }

  /** delta = snapshot - lastReportedCumulative, clamped to >= 0, only non-zero models. */
  private computeDeltaFrom(snapshot: Record<string, TokenTypeCounts>): Array<TokenTypeCounts & { model: string }> {
    const out: Array<TokenTypeCounts & { model: string }> = [];
    for (const [model, cum] of Object.entries(snapshot)) {
      const prev = this.state.lastReportedCumulative[model] ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      const d = {
        input: Math.max(0, cum.input - prev.input),
        output: Math.max(0, cum.output - prev.output),
        cacheCreation: Math.max(0, cum.cacheCreation - prev.cacheCreation),
        cacheRead: Math.max(0, cum.cacheRead - prev.cacheRead),
      };
      if (d.input + d.output + d.cacheCreation + d.cacheRead > 0) {
        out.push({ model, ...d });
      }
    }
    return out;
  }

  // --- registration & consent ---

  /**
   * Register the developer with the server. On success stores the developerId
   * (globalState) and the bearer credential (SecretStorage), grants consent, and
   * baselines accumulation so only post-consent usage is ever reported.
   */
  async register(displayName: string): Promise<{ ok: boolean; error?: string }> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return { ok: false, error: 'No usage server URL configured (claudeMirror.usageReporting.serverUrl).' };
    const registerSecret = this.getRegisterSecret();
    try {
      const res = await this.client.register(baseUrl, registerSecret, {
        displayName,
        deviceId: this.state.deviceId,
      });
      if (res.status >= 200 && res.status < 300 && res.body && res.body.developerId && res.body.developerToken) {
        this.state.developerId = String(res.body.developerId);
        this.state.displayName = displayName;
        this.state.consentGranted = true;
        // Baseline: only usage from now on is reported.
        this.state.lastReportedCumulative = this.deepCopy(this.state.cumulative);
        await this.secrets.store(SECRET_KEY, String(res.body.developerToken));
        this.enqueueWrite();
        this.log(`[Usage] Registered as "${displayName}" (developerId=${this.state.developerId})`);
        return { ok: true };
      }
      const detail = res.body && res.body.error ? res.body.error : `HTTP ${res.status}`;
      return { ok: false, error: `Registration failed: ${detail}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Turn reporting off: clears consent and removes the stored credential. Keeps local counts. */
  async disable(): Promise<void> {
    this.state.consentGranted = false;
    this.enqueueWrite();
    await this.secrets.delete(SECRET_KEY);
    this.log('[Usage] Reporting disabled by user');
  }

  isRegistered(): boolean {
    return !!this.state.developerId;
  }

  isEnabled(): boolean {
    return this.getConfig().get<boolean>('usageReporting.enabled', false) === true;
  }

  // --- personal snapshot (My Usage card) ---

  getMyUsageSnapshot(): MyUsageSnapshot {
    let totalRaw = 0;
    let totalWeighted = 0;
    let estimatedCost = 0;
    let primaryModel = 'unknown';
    let primaryWeighted = -1;

    for (const [model, c] of Object.entries(this.state.cumulative)) {
      const raw = c.input + c.output + c.cacheCreation + c.cacheRead;
      const weighted = c.input * WEIGHTS.input + c.output * WEIGHTS.output + c.cacheCreation * WEIGHTS.cacheCreation + c.cacheRead * WEIGHTS.cacheRead;
      totalRaw += raw;
      totalWeighted += weighted;
      const price = this.resolveLocalPrice(model);
      estimatedCost += (c.input / 1e6) * price.input + (c.output / 1e6) * price.output
        + (c.cacheCreation / 1e6) * price.cacheCreation + (c.cacheRead / 1e6) * price.cacheRead;
      if (weighted > primaryWeighted) {
        primaryWeighted = weighted;
        primaryModel = model;
      }
    }

    return {
      enabled: this.isEnabled(),
      consentGranted: this.state.consentGranted,
      registered: this.isRegistered(),
      developerName: this.state.displayName || '',
      totalRawTokens: totalRaw,
      totalWeightedTokens: totalWeighted,
      estimatedCostUsd: estimatedCost,
      primaryModel,
      lastSuccessfulReportAt: this.state.lastSuccessfulReportAt,
      serverUrl: this.getBaseUrl(),
    };
  }

  private resolveLocalPrice(model: string): TokenTypeCounts {
    const id = model.toLowerCase();
    if (LOCAL_PRICES[id]) return LOCAL_PRICES[id];
    for (const key of Object.keys(LOCAL_PRICES)) {
      if (id.startsWith(key)) return LOCAL_PRICES[key];
    }
    return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  }

  // --- config resolution ---

  /** HTTP base URL: explicit setting, else derived from the multi-participant WS URL. */
  getBaseUrl(): string {
    const cfg = this.getConfig();
    const explicit = (cfg.get<string>('usageReporting.serverUrl', '') || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const wsUrl = (cfg.get<string>('multiParticipant.serverUrl', '') || '').trim();
    return deriveHttpBaseFromWs(wsUrl);
  }

  private getRegisterSecret(): string {
    return (this.getConfig().get<string>('multiParticipant.authToken', '') || '').trim();
  }

  /** Display name preference: explicit reporter name setting, else the multi-participant human name. */
  getConfiguredDisplayName(): string {
    const cfg = this.getConfig();
    return (cfg.get<string>('usageReporting.developerName', '')
      || cfg.get<string>('multiParticipant.defaultHumanName', '')
      || this.state.displayName
      || '').trim();
  }

  // --- persistence ---

  private deepCopy(obj: Record<string, TokenTypeCounts>): Record<string, TokenTypeCounts> {
    const out: Record<string, TokenTypeCounts> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = { ...v };
    return out;
  }

  private load(): DeveloperUsageState {
    const stored = this.globalState.get<DeveloperUsageState>(STATE_KEY);
    if (stored && typeof stored === 'object') {
      return {
        developerId: stored.developerId ?? null,
        consentGranted: stored.consentGranted === true,
        cumulative: stored.cumulative ?? {},
        lastReportedCumulative: stored.lastReportedCumulative ?? {},
        lastSuccessfulReportAt: stored.lastSuccessfulReportAt ?? null,
        deviceId: stored.deviceId ?? (this.machineId || 'unknown-device'),
        displayName: stored.displayName ?? '',
      };
    }
    return {
      developerId: null,
      consentGranted: false,
      cumulative: {},
      lastReportedCumulative: {},
      lastSuccessfulReportAt: null,
      deviceId: this.machineId || 'unknown-device',
      displayName: '',
    };
  }

  private enqueueWrite(): void {
    this.writeQueue = this.writeQueue
      .then(() => this.globalState.update(STATE_KEY, this.state))
      .catch(() => { /* non-critical */ });
  }
}
