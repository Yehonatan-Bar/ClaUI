import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillGenStore } from './SkillGenStore';
import { PythonPipelineRunner } from './PythonPipelineRunner';
import { DeduplicationEngine } from './DeduplicationEngine';
import { SkillInstaller } from './SkillInstaller';
import type {
  SkillGenRunStatus,
  SkillGenRunHistoryEntry,
  SkillGenStatusMessage,
  SkillGenProgressMessage,
  SkillGenCompleteMessage,
} from '../types/webview-messages';

/** Lock file prevents concurrent runs from multiple VS Code windows */
const LOCK_FILENAME = '.skillgen.lock';

/** Callback for sending messages to the webview */
type WebviewSender = (msg: SkillGenStatusMessage | SkillGenProgressMessage | SkillGenCompleteMessage) => void;

/**
 * SkillGenService is the central orchestrator for automatic skill generation.
 *
 * Responsibilities:
 * - Scan for SR-PTD documents and track them in the ledger
 * - Check preflight conditions (Python, toolkit, API key)
 * - Enforce cross-process locking
 * - Run the Python pipeline
 * - Deduplicate generated skills against existing ones
 * - Install results atomically with backup/rollback
 * - Report progress and results to the webview
 */
export class SkillGenService {
  private log: (msg: string) => void = () => {};
  private runStatus: SkillGenRunStatus = 'idle';
  private progress = 0;
  private progressLabel = '';
  /** Multi-tab broadcast: maps tabId -> webview sender */
  private readonly tabSenders = new Map<string, WebviewSender>();

  readonly store: SkillGenStore;
  private readonly runner: PythonPipelineRunner;
  private readonly dedup: DeduplicationEngine;
  private readonly installer: SkillInstaller;

  constructor(memento: vscode.Memento) {
    this.store = new SkillGenStore(memento);
    this.runner = new PythonPipelineRunner();
    this.dedup = new DeduplicationEngine();
    this.installer = new SkillInstaller();

    // Wire pipeline progress to our progress handler
    this.runner.setProgressHandler((update) => {
      this.runStatus = update.status;
      this.progress = update.progress;
      this.progressLabel = update.progressLabel;
      this.sendProgress();
    });
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
    this.store.setLogger(logger);
    this.runner.setLogger(logger);
    this.dedup.setLogger(logger);
    this.installer.setLogger(logger);
  }

  /** Register a tab's webview sender for broadcasting status/progress messages */
  registerTab(tabId: string, sender: WebviewSender): void {
    this.tabSenders.set(tabId, sender);
    // Send current status to the newly registered tab immediately
    sender(this.getStatus());
  }

  /** Unregister a tab (called when the tab is closed or disposed) */
  unregisterTab(tabId: string): void {
    this.tabSenders.delete(tabId);
  }

  // ─── Configuration ─────────────────────────────────────────

  private getConfig() {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    return {
      enabled: config.get<boolean>('skillGen.enabled', false),
      threshold: config.get<number>('skillGen.threshold', 30),
      docsDirectory: config.get<string>('skillGen.docsDirectory', 'C:/projects/Skills/Dev_doc_for_skills'),
      docsPattern: config.get<string>('skillGen.docsPattern', 'SR-PTD*.md'),
      skillsDirectory: config.get<string>('skillGen.skillsDirectory', '') || this.defaultSkillsDir(),
      pythonPath: config.get<string>('skillGen.pythonPath', 'python'),
      toolkitPath: config.get<string>('skillGen.toolkitPath', ''),
      workspaceDir: config.get<string>('skillGen.workspaceDir', '') || this.defaultWorkspaceDir(),
      pipelineMode: config.get<string>('skillGen.pipelineMode', 'run_pipeline') as 'run_pipeline' | 'python_api' | 'create_skills',
      autoRun: config.get<boolean>('skillGen.autoRun', false),
      timeoutMs: config.get<number>('skillGen.timeoutMs', 600000),
      aiDeduplication: config.get<boolean>('skillGen.aiDeduplication', true),
    };
  }

  private defaultSkillsDir(): string {
    return path.join(os.homedir(), '.claude', 'skills');
  }

  private defaultWorkspaceDir(): string {
    return path.join(os.tmpdir(), 'claui-skillgen-workspace');
  }

  // ─── Public API ────────────────────────────────────────────

  /** Get the current status for the webview */
  getStatus(): SkillGenStatusMessage {
    const config = this.getConfig();
    return {
      type: 'skillGenStatus',
      pendingDocs: this.store.getPendingCount(),
      threshold: config.threshold,
      runStatus: this.runStatus,
      progress: this.progress,
      progressLabel: this.progressLabel,
      lastRun: this.store.getLastRun(),
      history: this.store.getHistory(),
    };
  }

  /**
   * Scan the documents directory for new/changed SR-PTD files.
   * Updates the ledger and returns the number of pending docs.
   */
  async scanDocuments(): Promise<number> {
    const config = this.getConfig();
    if (!config.enabled) return 0;

    const docsDir = config.docsDirectory;
    if (!docsDir || !fs.existsSync(docsDir)) {
      this.log(`[SkillGen] Documents directory not found: ${docsDir}`);
      return 0;
    }

    this.runStatus = 'scanning';
    this.sendProgress();

    try {
      const files = fs.readdirSync(docsDir, { withFileTypes: true });
      const pattern = this.globToRegex(config.docsPattern);

      const scanned = files
        .filter(f => f.isFile() && pattern.test(f.name))
        .map(f => {
          const fullPath = path.join(docsDir, f.name);
          const stat = fs.statSync(fullPath);
          return {
            relativePath: f.name,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          };
        });

      const newPending = await this.store.updateFromScan(scanned);
      const totalPending = this.store.getPendingCount();

      this.log(`[SkillGen] Scan: ${scanned.length} total files, ${newPending} newly pending, ${totalPending} total pending`);
      this.runStatus = 'idle';
      this.sendStatus();

      // Check if threshold reached
      if (config.autoRun && totalPending >= config.threshold && !this.runner.isRunning) {
        this.log(`[SkillGen] Threshold reached (${totalPending}/${config.threshold}), auto-triggering pipeline`);
        // Run async, don't await
        void this.triggerPipeline();
      } else if (totalPending >= config.threshold) {
        // Show notification
        const action = await vscode.window.showInformationMessage(
          `Skill Generation: ${totalPending} documents ready (threshold: ${config.threshold}). Generate skills now?`,
          'Generate Now',
          'Later'
        );
        if (action === 'Generate Now') {
          void this.triggerPipeline();
        }
      }

      return totalPending;
    } catch (err) {
      this.log(`[SkillGen] Scan error: ${err}`);
      this.runStatus = 'idle';
      return 0;
    }
  }

  /**
   * Trigger the full pipeline: preflight -> lock -> run -> dedup -> install.
   */
  async triggerPipeline(): Promise<void> {
    const config = this.getConfig();

    if (!config.enabled) {
      this.log('[SkillGen] Feature is disabled');
      return;
    }

    if (this.runner.isRunning) {
      this.log('[SkillGen] Pipeline already running');
      return;
    }

    // ─── Preflight checks ─────────────────────────────────
    this.runStatus = 'preflight';
    this.progress = 0;
    this.progressLabel = 'Running preflight checks...';
    this.sendProgress();

    const preflightResult = await this.preflightChecks(config);
    if (!preflightResult.ok) {
      this.log(`[SkillGen] Preflight failed: ${preflightResult.error}`);
      this.runStatus = 'failed';
      this.progressLabel = preflightResult.error;
      this.sendProgress();
      this.sendComplete(false, 0, 0, 0, 0, preflightResult.error);
      this.runStatus = 'idle';
      return;
    }

    // ─── Lock ─────────────────────────────────────────────
    const lockFile = path.join(config.workspaceDir, LOCK_FILENAME);
    if (!this.acquireLock(lockFile)) {
      const msg = 'Another instance is running the pipeline';
      this.log(`[SkillGen] ${msg}`);
      this.runStatus = 'idle';
      this.sendComplete(false, 0, 0, 0, 0, msg);
      return;
    }

    const startTime = Date.now();

    try {
      // ─── Run pipeline ─────────────────────────────────
      this.runStatus = 'running';
      this.progress = 5;
      this.progressLabel = 'Starting pipeline...';
      this.sendProgress();

      const pendingPaths = this.store.getPendingDocPaths();
      this.log(`[SkillGen] Running pipeline with ${pendingPaths.length} pending documents`);

      const pipelineResult = await this.runner.run(
        config.docsDirectory,
        pendingPaths,
        config.workspaceDir,
        config.pythonPath,
        config.toolkitPath,
        config.pipelineMode,
        config.timeoutMs
      );

      if (!pipelineResult.success) {
        const duration = Date.now() - startTime;
        await this.recordRun('failed', pendingPaths.length, 0, 0, 0, duration);
        this.sendComplete(false, 0, 0, 0, duration, pipelineResult.error);
        return;
      }

      // ─── Deduplication ────────────────────────────────
      this.runStatus = 'installing';
      this.progress = 92;
      this.progressLabel = 'Checking for duplicate skills...';
      this.sendProgress();

      const dedupResults = await this.dedup.checkAll(
        pipelineResult.skillsOutputDir,
        config.skillsDirectory,
        config.aiDeduplication
      );

      // ─── Installation ─────────────────────────────────
      this.progress = 95;
      this.progressLabel = 'Installing skills...';
      this.sendProgress();

      const installResult = await this.installer.install(
        pipelineResult.skillsOutputDir,
        config.skillsDirectory,
        dedupResults,
        config.workspaceDir
      );

      // If there were critical failures, decide if rollback is needed
      if (installResult.failed.length > 0 &&
          installResult.installed.length === 0 &&
          installResult.upgraded.length === 0) {
        // Total failure - rollback
        await this.installer.rollback(installResult, config.skillsDirectory);
        const duration = Date.now() - startTime;
        const errors = installResult.failed.map(f => `${f.skillName}: ${f.error}`).join('; ');
        await this.recordRun('failed', pendingPaths.length, 0, 0, 0, duration);
        this.sendComplete(false, 0, 0, 0, duration, `Installation failed: ${errors}`);
        return;
      }

      // Success (possibly partial)
      await this.store.markAllProcessed();
      const duration = Date.now() - startTime;
      const newCount = installResult.installed.length;
      const upgradedCount = installResult.upgraded.length;
      const skippedCount = installResult.skipped.length;

      await this.recordRun('succeeded', pendingPaths.length, newCount, upgradedCount, skippedCount, duration);
      this.runStatus = 'succeeded';
      this.progress = 100;
      this.progressLabel = 'Complete!';
      this.sendProgress();
      this.sendComplete(true, newCount, upgradedCount, skippedCount, duration);

      this.log(`[SkillGen] Pipeline complete: ${newCount} new, ${upgradedCount} upgraded, ${skippedCount} skipped (${Math.round(duration / 1000)}s)`);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log(`[SkillGen] Pipeline error: ${errorMsg}`);
      const duration = Date.now() - startTime;
      await this.recordRun('failed', 0, 0, 0, 0, duration);
      this.sendComplete(false, 0, 0, 0, duration, errorMsg);
    } finally {
      this.releaseLock(lockFile);
      this.runStatus = 'idle';
      this.progress = 0;
      this.progressLabel = '';
    }
  }

  /** Cancel a running pipeline */
  cancelPipeline(): void {
    if (this.runner.isRunning) {
      this.runner.cancel();
      this.runStatus = 'cancelled';
      this.sendProgress();
    }
  }

  // ─── Preflight ─────────────────────────────────────────────

  private async preflightChecks(config: ReturnType<typeof this.getConfig>): Promise<{ ok: boolean; error: string }> {
    // Check Python
    try {
      const { execSync } = require('child_process');
      execSync(`${config.pythonPath} --version`, { stdio: 'pipe', timeout: 10000 });
    } catch {
      return { ok: false, error: `Python not found at: ${config.pythonPath}` };
    }

    // Check toolkit path
    if (config.toolkitPath && !fs.existsSync(config.toolkitPath)) {
      return { ok: false, error: `Toolkit path not found: ${config.toolkitPath}` };
    }

    // Check docs directory
    if (!fs.existsSync(config.docsDirectory)) {
      return { ok: false, error: `Documents directory not found: ${config.docsDirectory}` };
    }

    // Ensure workspace directory exists
    fs.mkdirSync(config.workspaceDir, { recursive: true });

    return { ok: true, error: '' };
  }

  // ─── Locking ───────────────────────────────────────────────

  private acquireLock(lockFile: string): boolean {
    try {
      // Check if lock exists and is stale (older than 2 hours)
      if (fs.existsSync(lockFile)) {
        const stat = fs.statSync(lockFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 2 * 60 * 60 * 1000) {
          // Lock is fresh, someone else has it
          this.log(`[SkillGen] Lock file exists and is fresh (${Math.round(ageMs / 1000)}s old)`);
          return false;
        }
        // Stale lock, remove it
        this.log(`[SkillGen] Removing stale lock (${Math.round(ageMs / 60000)}min old)`);
        fs.unlinkSync(lockFile);
      }
      // Create lock with our PID
      fs.mkdirSync(path.dirname(lockFile), { recursive: true });
      fs.writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
      }), { flag: 'wx' }); // wx = exclusive create, fails if exists
      return true;
    } catch {
      return false;
    }
  }

  private releaseLock(lockFile: string): void {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Non-critical
    }
  }

  // ─── Run history ───────────────────────────────────────────

  private async recordRun(
    status: 'succeeded' | 'failed' | 'cancelled',
    docsProcessed: number,
    newSkills: number,
    upgradedSkills: number,
    skippedSkills: number,
    durationMs: number
  ): Promise<void> {
    const entry: SkillGenRunHistoryEntry = {
      date: new Date().toISOString(),
      docsProcessed,
      newSkills,
      upgradedSkills,
      skippedSkills,
      status,
      durationMs,
    };
    await this.store.addRunHistory(entry);
  }

  // ─── Webview messaging ─────────────────────────────────────

  private broadcast(msg: SkillGenStatusMessage | SkillGenProgressMessage | SkillGenCompleteMessage): void {
    for (const sender of this.tabSenders.values()) {
      sender(msg);
    }
  }

  private sendStatus(): void {
    this.broadcast(this.getStatus());
  }

  private sendProgress(): void {
    this.broadcast({
      type: 'skillGenProgress',
      runStatus: this.runStatus,
      progress: this.progress,
      progressLabel: this.progressLabel,
    });
  }

  private sendComplete(
    success: boolean,
    newSkills: number,
    upgradedSkills: number,
    skippedSkills: number,
    durationMs: number,
    error?: string
  ): void {
    this.broadcast({
      type: 'skillGenComplete',
      success,
      newSkills,
      upgradedSkills,
      skippedSkills,
      durationMs,
      error,
    });
    // Also send updated status (with new history)
    this.sendStatus();
  }

  // ─── Helpers ───────────────────────────────────────────────

  /** Convert a simple glob pattern to a RegExp */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }
}
