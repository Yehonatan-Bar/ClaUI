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
   *
   * @param docsDirectory - Directory containing SR-PTD docs
   * @param pendingDocPaths - Relative paths of pending documents
   * @param workspaceDir - Isolated workspace for pipeline artifacts
   * @param pythonPath - Path to python executable
   * @param toolkitPath - Path to the Python toolkit directory
   * @param pipelineMode - Which entry point to use
   * @param timeoutMs - Maximum run time
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

      return {
        ...result,
        skillsOutputDir: skillsOutDir,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log(`[SkillGen] Pipeline failed: ${errorMsg}`);
      return {
        success: false,
        skillsOutputDir: skillsOutDir,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }

  /** Cancel a running pipeline */
  cancel(): void {
    if (!this.childProcess) return;
    this.log('[SkillGen] Cancelling pipeline...');
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

      this.log(`[SkillGen] Running: ${pythonPath} ${args.join(' ')}`);
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

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.parsePipelineOutput(text);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        // Log stderr lines for diagnostics
        for (const line of text.split('\n').filter(Boolean)) {
          this.log(`[SkillGen:stderr] ${line}`);
        }
      });

      // Timeout handler
      const timer = setTimeout(() => {
        this.log(`[SkillGen] Pipeline timed out after ${timeoutMs}ms`);
        this.cancel();
        reject(new Error(`Pipeline timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        this.childProcess = null;

        // Write stdout/stderr to log files for debugging
        const logDir = path.join(workspaceDir, 'logs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        try {
          fs.writeFileSync(path.join(logDir, `pipeline-stdout-${ts}.log`), stdout, 'utf-8');
          fs.writeFileSync(path.join(logDir, `pipeline-stderr-${ts}.log`), stderr, 'utf-8');
        } catch { /* non-critical */ }

        if (code === 0) {
          this.log('[SkillGen] Pipeline completed successfully');
          this.emitProgress('running', 90, 'Pipeline complete, preparing results...');
          resolve({ success: true });
        } else {
          const errMsg = `Pipeline exited with code ${code}`;
          this.log(`[SkillGen] ${errMsg}`);
          resolve({ success: false, error: `${errMsg}\n${stderr.slice(-500)}` });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.childProcess = null;
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
  private parsePipelineOutput(text: string): void {
    for (const line of text.split('\n')) {
      const match = line.match(/\[PROGRESS\]\s*(\d+)\s*(.*)/);
      if (match) {
        const progress = Math.min(90, Math.max(10, parseInt(match[1], 10)));
        const label = match[2].trim() || 'Processing...';
        this.emitProgress('running', progress, label);
      }
    }
  }

  private emitProgress(status: SkillGenRunStatus, progress: number, label: string): void {
    this.onProgress?.({ status, progress, progressLabel: label });
  }
}
