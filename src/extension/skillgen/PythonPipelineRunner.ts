import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { SkillGenRunStatus } from '../types/webview-messages';

export interface PipelineRunResult {
  success: boolean;
  skillsOutputDir: string;
  durationMs: number;
  error?: string;
}

export interface PipelineProgressUpdate {
  status: SkillGenRunStatus;
  progress: number;       // 0-100
  progressLabel: string;
}

/**
 * PythonPipelineRunner executes the existing Python skill generation toolkit
 * as a subprocess and monitors its progress.
 *
 * Supports three modes:
 * - run_pipeline: Uses run_pipeline.py with resume via .pipeline_progress.json
 * - python_api: Direct Python module invocation (most controlled)
 * - create_skills: Simple create_skills.py (MVP/debug only, no resume)
 */
export class PythonPipelineRunner {
  private log: (msg: string) => void = () => {};
  private childProcess: cp.ChildProcess | null = null;
  private onProgress: ((update: PipelineProgressUpdate) => void) | null = null;

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  setProgressHandler(handler: (update: PipelineProgressUpdate) => void): void {
    this.onProgress = handler;
  }

  get isRunning(): boolean {
    return this.childProcess !== null;
  }

  /**
   * Run the pipeline, writing outputs to the given workspace directory.
   */
  async run(
    docsDirectory: string,
    pendingDocPaths: string[],
    workspaceDir: string,
    pythonPath: string,
    toolkitPath: string,
    pipelineMode: 'run_pipeline' | 'python_api' | 'create_skills',
    timeoutMs: number
  ): Promise<PipelineRunResult> {
    const startTime = Date.now();

    // Ensure workspace subdirectories exist
    const extractionsDir = path.join(workspaceDir, 'extractions');
    const clustersDir = path.join(workspaceDir, 'clusters');
    const skillsOutDir = path.join(workspaceDir, 'skills_out');
    const logsDir = path.join(workspaceDir, 'logs');

    for (const dir of [extractionsDir, clustersDir, skillsOutDir, logsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.emitProgress('running', 5, 'Preparing pipeline workspace...');
    this.log(`[SkillGen:Pipeline][INFO] Preparing workspace | docsDir=${docsDirectory} docCount=${pendingDocPaths.length} mode=${pipelineMode} timeoutMs=${timeoutMs}`);

    // Write the list of pending docs to a manifest file
    const manifestPath = path.join(workspaceDir, 'pending_docs.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      docsDirectory,
      pendingDocPaths,
      timestamp: new Date().toISOString(),
    }, null, 2), 'utf-8');

    try {
      const result = await this.executePipeline(
        docsDirectory,
        workspaceDir,
        skillsOutDir,
        pythonPath,
        toolkitPath,
        pipelineMode,
        timeoutMs
      );

      const durationMs = Date.now() - startTime;
      return {
        ...result,
        skillsOutputDir: skillsOutDir,
        durationMs,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;
      this.log(`[SkillGen:Pipeline][ERROR] Pipeline exception | error=${errorMsg} durationMs=${durationMs}`);
      return {
        success: false,
        skillsOutputDir: skillsOutDir,
        durationMs,
        error: errorMsg,
      };
    }
  }

  /** Cancel a running pipeline */
  cancel(): void {
    if (!this.childProcess) {
      this.log('[SkillGen:Pipeline][DEBUG] Cancel called but no child process');
      return;
    }
    this.log(`[SkillGen:Pipeline][INFO] Cancelling pipeline | pid=${this.childProcess.pid}`);
    try {
      // On Windows, use taskkill to kill the entire process tree
      if (process.platform === 'win32' && this.childProcess.pid) {
        cp.execSync(`taskkill /F /T /PID ${this.childProcess.pid}`, { stdio: 'ignore' });
      } else {
        this.childProcess.kill('SIGTERM');
      }
    } catch {
      // Process may already be gone
    }
    this.childProcess = null;
    this.emitProgress('cancelled', 0, 'Pipeline cancelled');
    this.log('[SkillGen:Pipeline][INFO] Pipeline cancelled successfully');
  }

  private async executePipeline(
    docsDirectory: string,
    workspaceDir: string,
    skillsOutDir: string,
    pythonPath: string,
    toolkitPath: string,
    pipelineMode: string,
    timeoutMs: number
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      let args: string[];
      let cwd = toolkitPath || docsDirectory;

      switch (pipelineMode) {
        case 'run_pipeline':
          args = [
            path.join(toolkitPath, 'run_pipeline.py'),
            '--input-dir', docsDirectory,
            '--output-dir', skillsOutDir,
            '--workspace', workspaceDir,
            '--resume',
          ];
          break;

        case 'python_api':
          // Invoke as a module: python -m skill_generator.pipeline ...
          args = [
            '-m', 'skill_generator.pipeline',
            '--input-dir', docsDirectory,
            '--output-dir', skillsOutDir,
            '--workspace', workspaceDir,
          ];
          cwd = toolkitPath;
          break;

        case 'create_skills':
        default:
          args = [
            path.join(toolkitPath, 'create_skills.py'),
            '--input-dir', docsDirectory,
            '--output-dir', skillsOutDir,
          ];
          break;
      }

      this.log(`[SkillGen:Pipeline][INFO] Spawning subprocess | cmd=${pythonPath} mode=${pipelineMode} cwd=${cwd}`);
      this.log(`[SkillGen:Pipeline][DEBUG] Full command | ${pythonPath} ${args.join(' ')}`);
      this.emitProgress('running', 10, 'Starting Python pipeline...');

      const child = cp.spawn(pythonPath, args, {
        cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          SKILLGEN_WORKSPACE: workspaceDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      this.childProcess = child;
      this.log(`[SkillGen:Pipeline][INFO] Subprocess started | pid=${child.pid}`);

      let stdout = '';
      let stderr = '';
      let lastProgressLabel = '';

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.parsePipelineOutput(text, lastProgressLabel, (label) => { lastProgressLabel = label; });
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        // Log stderr lines for diagnostics (keep at DEBUG to avoid noise)
        for (const line of text.split('\n').filter(Boolean)) {
          this.log(`[SkillGen:Pipeline][DEBUG] stderr: ${line}`);
        }
      });

      // Timeout handler
      const timer = setTimeout(() => {
        this.log(`[SkillGen:Pipeline][ERROR] Pipeline timed out | timeoutMs=${timeoutMs} pid=${child.pid}`);
        this.cancel();
        reject(new Error(`Pipeline timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.childProcess = null;

        // Write stdout/stderr to log files for debugging
        const logDir = path.join(workspaceDir, 'logs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        let stdoutLogPath = '';
        let stderrLogPath = '';
        try {
          stdoutLogPath = path.join(logDir, `pipeline-stdout-${ts}.log`);
          stderrLogPath = path.join(logDir, `pipeline-stderr-${ts}.log`);
          fs.writeFileSync(stdoutLogPath, stdout, 'utf-8');
          fs.writeFileSync(stderrLogPath, stderr, 'utf-8');
        } catch { /* non-critical */ }

        if (code === 0) {
          this.log(`[SkillGen:Pipeline][INFO] Subprocess exited successfully | code=0 stdoutLog=${stdoutLogPath}`);
          this.emitProgress('running', 90, 'Pipeline complete, preparing results...');
          resolve({ success: true });
        } else {
          const stderrTail = stderr.slice(-300).trim();
          this.log(`[SkillGen:Pipeline][ERROR] Subprocess exited with error | code=${code} signal=${signal || 'none'} stderrLog=${stderrLogPath} stderrTail=${stderrTail}`);
          resolve({ success: false, error: `Pipeline exited with code ${code}\n${stderr.slice(-500)}` });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.childProcess = null;
        this.log(`[SkillGen:Pipeline][ERROR] Subprocess spawn error | error=${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Parse pipeline stdout for progress indicators.
   * The Python pipeline is expected to output lines like:
   *   [PROGRESS] 30 Extracting patterns...
   *   [PROGRESS] 60 Clustering documents...
   *   [PROGRESS] 85 Generating skills...
   */
  private parsePipelineOutput(
    text: string,
    lastLabel: string,
    setLastLabel: (label: string) => void
  ): void {
    for (const line of text.split('\n')) {
      const match = line.match(/\[PROGRESS\]\s*(\d+)\s*(.*)/);
      if (match) {
        const progress = Math.min(90, Math.max(10, parseInt(match[1], 10)));
        const label = match[2].trim() || 'Processing...';
        // Only log when stage label changes to reduce noise
        if (label !== lastLabel) {
          this.log(`[SkillGen:Pipeline][INFO] Pipeline stage | progress=${progress}% label=${label}`);
          setLastLabel(label);
        }
        this.emitProgress('running', progress, label);
      }
    }
  }

  private emitProgress(status: SkillGenRunStatus, progress: number, label: string): void {
    this.onProgress?.({ status, progress, progressLabel: label });
  }
}
