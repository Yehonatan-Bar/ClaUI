import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { PhaseId, PhaseResult } from './types';
import { killProcessTree } from '../../process/killTree';

/**
 * Script-to-args mapping for each non-AI Python phase.
 */
interface PhaseScript {
  script: string;
  buildArgs: (workspaceDir: string) => string[];
}

const PHASE_SCRIPTS: Record<string, PhaseScript> = {
  [PhaseId.B]: {
    script: 'layer1_extractor.py',
    buildArgs: (ws) => [
      path.join(ws, 'srptd_raw'),
      '-o',
      path.join(ws, 'extractions'),
    ],
  },
  [PhaseId.C0_C1]: {
    script: 'phase_c_clustering.py',
    buildArgs: (ws) => [
      '--input-dir', path.join(ws, 'extractions'),
      '--output-dir', path.join(ws, 'clusters'),
    ],
  },
  [PhaseId.C5]: {
    script: 'phase_c5_representatives.py',
    buildArgs: () => [],
  },
  [PhaseId.SANITY]: {
    script: 'sanity_check.py',
    buildArgs: () => [],
  },
};

/**
 * Runs individual non-AI Python phases as subprocesses.
 * Replaces the monolithic PythonPipelineRunner for non-AI phases.
 */
export class PythonPhaseRunner {
  private log: (msg: string) => void = () => {};
  private activeProcess: cp.ChildProcess | null = null;

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  get isRunning(): boolean {
    return this.activeProcess !== null;
  }

  /**
   * Run a single non-AI Python phase.
   */
  async run(
    phaseId: PhaseId,
    workspaceDir: string,
    pythonPath: string,
    toolkitPath: string,
    timeoutMs: number = 300_000,
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    const phaseConfig = PHASE_SCRIPTS[phaseId];

    if (!phaseConfig) {
      return {
        success: false,
        error: `No Python script mapping for phase ${phaseId}`,
        durationMs: Date.now() - startTime,
      };
    }

    const scriptPath = path.join(toolkitPath, 'scripts', phaseConfig.script);
    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `Script not found: ${scriptPath}`,
        durationMs: Date.now() - startTime,
      };
    }

    const args = [scriptPath, ...phaseConfig.buildArgs(workspaceDir)];

    this.log(`[PythonPhaseRunner] Starting phase ${phaseId} | script=${phaseConfig.script} cwd=${workspaceDir}`);
    this.log(`[PythonPhaseRunner] Command: ${pythonPath} ${args.join(' ')}`);

    return new Promise<PhaseResult>((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = cp.spawn(pythonPath, args, {
        cwd: workspaceDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          SRPTD_PROJECT_ROOT: workspaceDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      this.activeProcess = child;

      // Auto-answer interactive prompts
      child.stdin?.write('y\n');
      child.stdin?.end();

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        for (const line of text.split('\n').filter(Boolean)) {
          this.log(`[PythonPhaseRunner][${phaseId}] stderr: ${line}`);
        }
      });

      const timer = setTimeout(() => {
        this.log(`[PythonPhaseRunner] Phase ${phaseId} timed out after ${timeoutMs}ms`);
        this.killActive();
        resolve({
          success: false,
          error: `Phase ${phaseId} timed out after ${Math.round(timeoutMs / 1000)}s`,
          durationMs: Date.now() - startTime,
        });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcess = null;

        // Write logs
        const logsDir = path.join(workspaceDir, 'logs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        try {
          fs.mkdirSync(logsDir, { recursive: true });
          fs.writeFileSync(path.join(logsDir, `phase-${phaseId}-stdout-${ts}.log`), stdout, 'utf-8');
          fs.writeFileSync(path.join(logsDir, `phase-${phaseId}-stderr-${ts}.log`), stderr, 'utf-8');
        } catch { /* non-critical */ }

        const durationMs = Date.now() - startTime;

        if (code === 0) {
          this.log(`[PythonPhaseRunner] Phase ${phaseId} completed successfully | durationMs=${durationMs}`);
          resolve({ success: true, durationMs });
        } else {
          const stderrTail = stderr.slice(-300).trim();
          this.log(`[PythonPhaseRunner] Phase ${phaseId} failed | code=${code} stderr=${stderrTail}`);
          resolve({
            success: false,
            error: `Phase ${phaseId} exited with code ${code}\n${stderr.slice(-500)}`,
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcess = null;
        this.log(`[PythonPhaseRunner] Phase ${phaseId} spawn error: ${err.message}`);
        resolve({
          success: false,
          error: `Spawn error: ${err.message}`,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /** Cancel the active Python subprocess */
  cancel(): void {
    this.killActive();
  }

  private killActive(): void {
    if (!this.activeProcess) return;
    killProcessTree(this.activeProcess);
    this.activeProcess = null;
  }
}
