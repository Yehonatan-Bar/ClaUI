import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCliCaller } from './ClaudeCliCaller';
import { PythonPhaseRunner } from './phases/PythonPhaseRunner';
import { PhaseC2TagEnrichment } from './phases/PhaseC2TagEnrichment';
import { PhaseC3IncrementalClustering } from './phases/PhaseC3IncrementalClustering';
import { PhaseC4CrossBucketMerge } from './phases/PhaseC4CrossBucketMerge';
import { PhaseDSkillSynthesis } from './phases/PhaseDSkillSynthesis';
import {
  PhaseId,
  PhaseResult,
  PipelineProgress,
  PipelineProgressUpdate,
  PipelineRunResult,
  PHASE_PROGRESS_RANGES,
} from './phases/types';

/** Ordered list of phases to execute */
const PHASE_ORDER: PhaseId[] = [
  PhaseId.B,
  PhaseId.C0_C1,
  PhaseId.C2,
  PhaseId.C3,
  PhaseId.C4,
  PhaseId.C5,
  PhaseId.SANITY,
  PhaseId.D,
];

/** Phase output checks (matches Python's check_output lambdas) */
const PHASE_CHECKS: Record<PhaseId, (workspaceDir: string) => boolean> = {
  [PhaseId.B]: (ws) => {
    const dir = path.join(ws, 'extractions');
    return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.json'));
  },
  [PhaseId.C0_C1]: (ws) => fs.existsSync(path.join(ws, 'clusters', 'doc_cards')),
  [PhaseId.C2]: (ws) => fs.existsSync(path.join(ws, 'clusters', 'buckets_enriched')),
  [PhaseId.C3]: (ws) => fs.existsSync(path.join(ws, 'clusters', 'clusters_incremental')),
  [PhaseId.C4]: (ws) => fs.existsSync(path.join(ws, 'clusters', 'clusters_final')),
  [PhaseId.C5]: (ws) => fs.existsSync(path.join(ws, 'clusters', 'representatives')),
  [PhaseId.SANITY]: () => true,
  [PhaseId.D]: (ws) => fs.existsSync(path.join(ws, 'skills_out')),
};

/** Whether a phase is an AI phase (runs via ClaudeCliCaller) or Python phase */
const AI_PHASES = new Set<PhaseId>([PhaseId.C2, PhaseId.C3, PhaseId.C4, PhaseId.D]);

/**
 * PhaseOrchestrator replaces PythonPipelineRunner.
 *
 * Runs phases individually:
 * - Non-AI phases (B, C.0-C.1, C.5, sanity): Python subprocess per phase
 * - AI phases (C.2, C.3, C.4, D): TypeScript using Claude Code CLI one-shot calls
 *
 * Supports resume via .pipeline_progress.json (same format as Python).
 */
export class PhaseOrchestrator {
  private log: (msg: string) => void = () => {};
  private onProgress: ((update: PipelineProgressUpdate) => void) | null = null;
  private _isRunning = false;
  private _cancelled = false;

  private readonly cliCaller: ClaudeCliCaller;
  private readonly pythonRunner: PythonPhaseRunner;
  private readonly phaseC2: PhaseC2TagEnrichment;
  private readonly phaseC3: PhaseC3IncrementalClustering;
  private readonly phaseC4: PhaseC4CrossBucketMerge;
  private readonly phaseD: PhaseDSkillSynthesis;

  constructor() {
    this.cliCaller = new ClaudeCliCaller();
    this.pythonRunner = new PythonPhaseRunner();
    this.phaseC2 = new PhaseC2TagEnrichment(this.cliCaller);
    this.phaseC3 = new PhaseC3IncrementalClustering(this.cliCaller);
    this.phaseC4 = new PhaseC4CrossBucketMerge(this.cliCaller);
    this.phaseD = new PhaseDSkillSynthesis(this.cliCaller);
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
    this.cliCaller.setLogger(logger);
    this.pythonRunner.setLogger(logger);
    this.phaseC2.setLogger(logger);
    this.phaseC3.setLogger(logger);
    this.phaseC4.setLogger(logger);
    this.phaseD.setLogger(logger);
  }

  /** Propagate API key to the ClaudeCliCaller used by all AI phases */
  setApiKey(key: string | undefined): void {
    this.cliCaller.setApiKey(key);
  }

  setProgressHandler(handler: (update: PipelineProgressUpdate) => void): void {
    this.onProgress = handler;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Run the full pipeline.
   * Compatible with PythonPipelineRunner.run() signature for easy swap.
   */
  async run(
    docsDirectory: string,
    pendingDocPaths: string[],
    workspaceDir: string,
    pythonPath: string,
    toolkitPath: string,
    _pipelineMode: string, // ignored - we orchestrate phases directly
    timeoutMs: number,
  ): Promise<PipelineRunResult> {
    const startTime = Date.now();
    this._isRunning = true;
    this._cancelled = false;

    const skillsOutDir = path.join(workspaceDir, 'skills_out');

    // Load resume progress BEFORE cleaning
    const progressFile = path.join(workspaceDir, '.pipeline_progress.json');
    let progress = this.loadProgress(progressFile);
    const startFromIndex = this.findResumeIndex(progress);

    // Clean workspace for fresh runs (startFromIndex === 0 means no valid resume point)
    // This prevents accumulation of old data from previous pipeline runs
    if (startFromIndex === 0) {
      this.log(`[PhaseOrchestrator] Fresh run - cleaning workspace to prevent stale data accumulation`);
      for (const sub of ['srptd_raw', 'extractions', 'clusters', 'skills_out']) {
        const subDir = path.join(workspaceDir, sub);
        if (fs.existsSync(subDir)) {
          fs.rmSync(subDir, { recursive: true, force: true });
        }
      }
      // Also clear progress file for fresh run
      if (fs.existsSync(progressFile)) {
        fs.unlinkSync(progressFile);
      }
      progress = {};
    }

    // Ensure workspace subdirectories exist
    for (const sub of ['srptd_raw', 'extractions', 'clusters', 'skills_out', 'logs']) {
      fs.mkdirSync(path.join(workspaceDir, sub), { recursive: true });
    }

    this.emitProgress('running', 5, 'Preparing pipeline workspace...');
    this.log(`[PhaseOrchestrator] Starting pipeline | docsDir=${docsDirectory} docs=${pendingDocPaths.length} workspace=${workspaceDir}`);

    // Copy pending SR-PTD docs into workspace srptd_raw/
    const srptdRawDir = path.join(workspaceDir, 'srptd_raw');
    for (const docName of pendingDocPaths) {
      const srcPath = path.join(docsDirectory, docName);
      const destPath = path.join(srptdRawDir, docName);
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        this.log(`[PhaseOrchestrator] WARNING: Failed to copy doc | src=${srcPath} error=${err}`);
      }
    }
    this.log(`[PhaseOrchestrator] Copied ${pendingDocPaths.length} docs to srptd_raw/`);

    // Write manifest
    fs.writeFileSync(
      path.join(workspaceDir, 'pending_docs.json'),
      JSON.stringify({ docsDirectory, pendingDocPaths, timestamp: new Date().toISOString() }, null, 2),
      'utf-8'
    );

    if (startFromIndex > 0) {
      this.log(`[PhaseOrchestrator] Resuming from phase ${PHASE_ORDER[startFromIndex]}`);
    }

    // Execute phases in order
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      if (this._cancelled) {
        this.emitProgress('cancelled', 0, 'Pipeline cancelled');
        this._isRunning = false;
        return { success: false, skillsOutputDir: skillsOutDir, durationMs: Date.now() - startTime, error: 'Pipeline cancelled' };
      }

      const phaseId = PHASE_ORDER[i];

      // Skip already completed phases when resuming
      if (i < startFromIndex) {
        this.log(`[PhaseOrchestrator] Skipping ${phaseId} (already completed)`);
        continue;
      }

      const range = PHASE_PROGRESS_RANGES[phaseId];
      this.emitProgress('running', range.start, `Running phase ${phaseId}...`);

      let result: PhaseResult;

      try {
        if (AI_PHASES.has(phaseId)) {
          result = await this.runAiPhase(phaseId, workspaceDir, range);
        } else {
          result = await this.pythonRunner.run(phaseId, workspaceDir, pythonPath, toolkitPath, timeoutMs);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { success: false, error: msg, durationMs: 0 };
      }

      if (result.success) {
        this.saveProgress(progressFile, phaseId, 'SUCCESS');
        this.log(`[PhaseOrchestrator] Phase ${phaseId} SUCCESS | durationMs=${result.durationMs}`);
        this.emitProgress('running', range.end, `Phase ${phaseId} complete`);
      } else {
        this.saveProgress(progressFile, phaseId, 'FAILED');
        this.log(`[PhaseOrchestrator] Phase ${phaseId} FAILED | error=${result.error} durationMs=${result.durationMs}`);
        this.emitProgress('failed', range.start, `Phase ${phaseId} failed`);
        this._isRunning = false;
        return {
          success: false,
          skillsOutputDir: skillsOutDir,
          durationMs: Date.now() - startTime,
          error: result.error || `Phase ${phaseId} failed`,
        };
      }
    }

    const durationMs = Date.now() - startTime;
    this.emitProgress('running', 95, 'Pipeline complete, preparing results...');
    this.log(`[PhaseOrchestrator] All phases complete | durationMs=${durationMs}`);
    this._isRunning = false;

    return { success: true, skillsOutputDir: skillsOutDir, durationMs };
  }

  /** Cancel a running pipeline */
  cancel(): void {
    this._cancelled = true;
    this.pythonRunner.cancel();
    this.phaseC2.cancel();
    this.phaseC3.cancel();
    this.phaseC4.cancel();
    this.phaseD.cancel();
    this.emitProgress('cancelled', 0, 'Pipeline cancelled');
    this.log('[PhaseOrchestrator] Cancel requested');
  }

  private async runAiPhase(phaseId: PhaseId, workspaceDir: string, range: { start: number; end: number }): Promise<PhaseResult> {
    const onProgress = (pct: number, label: string) => {
      const mappedProgress = range.start + Math.round((pct / 100) * (range.end - range.start));
      this.emitProgress('running', mappedProgress, label);
    };

    switch (phaseId) {
      case PhaseId.C2:
        return this.phaseC2.run(workspaceDir, 'claude-sonnet-4-6', onProgress);
      case PhaseId.C3:
        return this.phaseC3.run(workspaceDir, 'claude-sonnet-4-6', onProgress);
      case PhaseId.C4:
        return this.phaseC4.run(workspaceDir, 'claude-sonnet-4-6', onProgress);
      case PhaseId.D:
        return this.phaseD.run(workspaceDir, 'claude-opus-4-6', 3, onProgress);
      default:
        return { success: false, error: `Unknown AI phase: ${phaseId}`, durationMs: 0 };
    }
  }

  private loadProgress(filePath: string): PipelineProgress {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  private saveProgress(filePath: string, phaseId: PhaseId, status: 'SUCCESS' | 'FAILED'): void {
    let progress = this.loadProgress(filePath);
    progress[phaseId] = { status, timestamp: new Date().toISOString() };
    progress.last_phase = phaseId;
    progress.last_status = status;
    try {
      fs.writeFileSync(filePath, JSON.stringify(progress, null, 2), 'utf-8');
    } catch { /* non-critical */ }
  }

  private findResumeIndex(progress: PipelineProgress): number {
    if (progress.last_status !== 'SUCCESS') return 0;

    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phaseId = PHASE_ORDER[i];
      const phaseProgress = progress[phaseId] as any;
      if (!phaseProgress || phaseProgress.status !== 'SUCCESS') {
        return i;
      }
    }
    return 0; // All phases completed, re-run from start
  }

  private emitProgress(status: PipelineProgressUpdate['status'], progress: number, label: string): void {
    this.onProgress?.({ status, progress, progressLabel: label });
  }
}
