import { spawn, ChildProcess } from 'child_process';

export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  interrupted: boolean;
  durationMs: number;
}

export function executeShellCommand(
  command: string,
  options: { cwd: string; shell: string; maxOutputBytes: number; timeoutMs?: number },
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let interrupted = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const isWindows = process.platform === 'win32';
    const shellArgs = isWindows
      ? ['/c', command]
      : ['-c', command];

    const child: ChildProcess = spawn(options.shell, shellArgs, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Forward signals to child
    const signalHandler = (sig: NodeJS.Signals) => {
      interrupted = true;
      killProcessTree(child.pid, isWindows);
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        interrupted = true;
        killProcessTree(child.pid, isWindows);
      }, options.timeoutMs);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes < options.maxOutputBytes) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < options.maxOutputBytes) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8').slice(0, options.maxOutputBytes),
        stderr: Buffer.concat(stderrChunks).toString('utf8').slice(0, options.maxOutputBytes),
        exitCode: code,
        signal: signal,
        interrupted,
        durationMs: Date.now() - startTime,
      });
    });

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: err.message,
        exitCode: 127,
        signal: null,
        interrupted,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

function killProcessTree(pid: number | undefined, isWindows: boolean): void {
  if (!pid) return;
  try {
    if (isWindows) {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }
}
