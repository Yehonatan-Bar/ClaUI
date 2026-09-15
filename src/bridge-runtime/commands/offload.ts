import { ChildProcess } from 'child_process';
import { claudeKnownLocations, codexKnownLocations, invokeClaudeCouncil } from '../backends/council';
import { killTreeAsync, resolveExecutable, spawnCli } from '../procUtils';
import { BridgeCommandSpec } from './commandCatalog';
import { DispatchCtx } from './dispatcher';

/**
 * Layer C (offload / co-processor) — runs the REAL `claude -p "/command"` (or
 * `codex exec`) in the actual project cwd, for higher fidelity than the
 * macro/tool packet layers, and returns its result so the caller can inject
 * it back into the bridge conversation (the bridge model stays the voice —
 * see dispatcher.ts's offload branch, which wraps this as a 'rewrite' that
 * asks the backend to relay the result, not a direct bypass).
 *
 * SAFETY: deliberately as restricted as the council's own members, NOT "the
 * true unrestricted command" — an earlier version of this file used
 * `--permission-prompts none` alone for claude, which is NOT a sandbox: it
 * only denies actions that would otherwise prompt, so any pre-approved tool,
 * hook, or MCP server in the user's own settings could still run/mutate
 * unattended. That was a real gap, caught in review, and fixed by directly
 * reusing `invokeClaudeCouncil` (which already applies `--restricted
 * --permission-prompts none --strict-mcp-config --mcp-config
 * '{"mcpServers":{}}'`) with the REAL project cwd instead of a throwaway
 * temp dir — the only difference from the council's own usage. Offload does
 * NOT add a second write-capable path on top of the Grok write window
 * (Section 6); it is always advisory/read-only, regardless of ClaUi's own
 * tab permission mode (even full-access).
 */

/** Bound on a single offloaded command so a hung/stuck CLI can't wedge the
 *  tab forever. Validated: a non-finite or non-positive override falls back
 *  to the default instead of producing an effectively-zero or NaN timeout. */
function offloadTimeoutMs(): number {
  const raw = Number(process.env.CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

/** Same rationale as CLAUDE_MAX_STDOUT_BYTES: stop unbounded memory growth,
 *  never silently return truncated/partial JSONL as if it were complete. */
const CODEX_MAX_STDOUT_BYTES = 4 * 1024 * 1024;

/** `codex --ask-for-approval never exec --json --sandbox read-only --ephemeral
 *  --ignore-user-config -C <cwd>` in the real project cwd. `--ask-for-approval`
 *  is a GLOBAL flag and MUST precede `exec` (confirmed: codex rejects it when
 *  placed after `exec`) — combined with `--sandbox read-only`, this avoids
 *  both mutation (sandbox, OS-enforced) AND a hang on an interactive approval
 *  prompt (never, since there is no TTY to answer one). `--ephemeral` skips
 *  writing session rollout files to disk. `--ignore-user-config` is required
 *  despite a confirmed Windows regression in some installed Codex CLI
 *  versions (`--ignore-user-config` can reject EVERY command as "blocked by
 *  policy" even under `--sandbox read-only`) — `--sandbox read-only` alone
 *  only constrains codex's own model-generated shell/file operations, NOT
 *  configured apps/MCP servers/hooks, which have independent approval
 *  settings; omitting this flag would leave that surface open. An affected
 *  Codex CLI version therefore fails closed here (offload errors clearly)
 *  rather than silently running with a narrower guarantee than advertised. */
export function invokeCodexCommand(
  cliPath: string,
  slash: string,
  cwd: string,
  signal: AbortSignal,
  log: (msg: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const { command } = resolveExecutable(cliPath, 'codex', codexKnownLocations());
    const args = [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '-C',
      cwd,
      '-',
    ];

    let child: ChildProcess;
    try {
      child = spawnCli(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      reject(new Error(`Failed to start Codex CLI: ${(e as Error).message}`));
      return;
    }

    let settled = false;
    let stdoutBuffer = '';
    let captured = '';
    let stdoutBytes = 0;
    let oversized = false;

    const onAbort = (): void => killTreeAsync(child);
    if (signal.aborted) killTreeAsync(child);
    signal.addEventListener('abort', onAbort, { once: true });

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const flush = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          item?: { type?: string; text?: unknown; content?: unknown };
        };
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          if (typeof event.item.text === 'string' && event.item.text.trim()) {
            captured = event.item.text;
          } else if (Array.isArray(event.item.content)) {
            const joined = event.item.content
              .map((p) =>
                p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
                  ? (p as { text: string }).text
                  : '',
              )
              .join('')
              .trim();
            if (joined) captured = joined;
          }
        }
      } catch {
        /* ignore non-JSON noise */
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (oversized) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > CODEX_MAX_STDOUT_BYTES) {
        oversized = true;
        killTreeAsync(child);
        done(() => reject(new Error(`Codex CLI output exceeded ${CODEX_MAX_STDOUT_BYTES} bytes`)));
        return;
      }
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) flush(line);
    });
    child.stderr?.on('data', (d: Buffer) => log(`offload codex stderr: ${d.toString('utf-8').slice(0, 300)}`));
    child.stdin?.on('error', () => {});
    child.on('error', (e) => done(() => reject(new Error(`Failed to start Codex CLI: ${e.message}`))));
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        flush(stdoutBuffer);
        stdoutBuffer = '';
      }
      done(() => {
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`Codex CLI exited ${code}`));
          return;
        }
        resolve(captured);
      });
    });

    try {
      child.stdin?.write(slash);
      if (!slash.endsWith('\n')) child.stdin?.write('\n');
      child.stdin?.end();
    } catch (e) {
      done(() => reject(new Error(`Codex stdin write failed: ${(e as Error).message}`)));
    }
  });
}

/** Runs `spec.offload` (Layer C) with a bounded timeout composed with the
 *  turn's own interrupt signal, and returns the raw result text. Throws on
 *  any failure (CLI missing, non-zero exit, malformed/empty output, timeout,
 *  interrupt) — the caller's existing turn-error handling surfaces it as a
 *  clear error rather than silently falling back to a different strategy. */
export async function runOffload(spec: BridgeCommandSpec, arg: string, ctx: DispatchCtx): Promise<string> {
  const off = spec.offload;
  if (!off) throw new Error(`/${spec.name} has no offload configuration`);
  const slash = arg ? `${off.slash} ${arg}` : off.slash;

  // Compose the turn's own interrupt signal with a hard timeout into one
  // signal — invokeClaudeCouncil / invokeCodexCommand only accept a single
  // AbortSignal each.
  const composed = new AbortController();
  const onExternalAbort = (): void => composed.abort();
  if (ctx.signal.aborted) composed.abort();
  ctx.signal.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => composed.abort(), offloadTimeoutMs());
  timer.unref?.();

  try {
    let text: string;
    if (off.cli === 'claude') {
      const cliPath = ctx.config.claude?.cliPath || 'claude';
      const { command } = resolveExecutable(cliPath, 'claude', claudeKnownLocations());
      text = await invokeClaudeCouncil(command, '', slash, ctx.cwd, composed.signal, () => {}, ctx.log);
    } else {
      const cliPath = ctx.config.codex?.cliPath || 'codex';
      text = await invokeCodexCommand(cliPath, slash, ctx.cwd, composed.signal, ctx.log);
    }
    if (!text || !text.trim()) {
      const engine = off.cli === 'claude' ? 'Claude' : 'Codex';
      throw new Error(`${engine} CLI returned an empty or malformed result for /${spec.name}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onExternalAbort);
  }
}
