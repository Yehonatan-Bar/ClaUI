import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AntigravityBackend } from './backends/antigravity';
import { CouncilBackend } from './backends/council';
import { GrokAcpBackend } from './backends/grokAcp';
import { OpenAiCompatBackend } from './backends/openaiCompat';
import { dispatchCommand, isToolPathActive, normalizeDiffBase } from './commands/dispatcher';
import {
  BridgeModelRef,
  CLAUI_HOME,
  loadBridgeConfig,
  parseBridgeModel,
  storageDir,
} from './config';
import { attachStdin, BridgePrompt, StreamEmitter } from './protocol';
import { SessionStore } from './sessionStore';

/**
 * ClaUi bridge runtime — a drop-in stand-in for the claude CLI that routes
 * conversations to non-Claude backends (xAI Grok, Google Antigravity, or any
 * OpenAI-compatible server) while speaking the exact stream-json protocol the
 * extension already understands.
 *
 * ClaUi spawns this instead of the claude CLI for bridge-provider tabs (the
 * same mechanism as the Happy/remote provider): all standard claude flags are
 * accepted; the backend is selected by the namespaced --model value
 * (`bridge:grok/<model>`, `bridge:antigravity/<model>`,
 * `bridge:openai/<providerId>/<model>`), with a sticky per-session fallback so
 * resumed tabs keep their backend even if the flag is missing.
 */

const args = process.argv.slice(2);

function flagValue(name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const LOG_FILE = path.join(CLAUI_HOME, 'bridge.log');
function log(...parts: unknown[]): void {
  try {
    fs.mkdirSync(CLAUI_HOME, { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] ${parts.map((p) => String(p)).join(' ')}\n`,
    );
  } catch {
    /* logging must never break the bridge */
  }
}

interface Backend {
  runTurn(prompt: BridgePrompt, emitter: StreamEmitter): Promise<string>;
  interrupt(): void;
  dispose?(): void;
  /** Open/close a per-turn write window (Section 6 — --fix on a mutating
   *  command tool). Optional: only Grok implements it today; other backends
   *  simply ignore the call. */
  setWriteWindow?(open: boolean): void;
}

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const store = new SessionStore(storageDir(config));

  const resumeId = flagValue('--resume');
  const sessionId = resumeId || flagValue('--session-id') || randomUUID();
  const requestedModel = flagValue('--model') || '';
  const permissionMode =
    flagValue('--permission-mode') === 'bypassPermissions' ? 'full-access' : 'supervised';
  const systemPrompt = flagValue('--append-system-prompt') || '';

  // Backend selection: explicit namespaced --model wins; otherwise a resumed
  // session sticks to its stored backend+model.
  let ref: BridgeModelRef | null = parseBridgeModel(requestedModel);
  if (!ref && resumeId) {
    const stored = store.read(sessionId);
    // Council resumes on backend alone (it has no stored model).
    if (stored?.backend === 'council') {
      ref = { backend: 'council', chair: stored.councilChair };
    } else if (stored?.backend && stored.model) {
      if (stored.backend === 'openai') {
        if (stored.openaiProviderId) {
          ref = { backend: 'openai', providerId: stored.openaiProviderId, model: stored.model };
        }
      } else if (stored.backend === 'grok' || stored.backend === 'antigravity') {
        ref = { backend: stored.backend, model: stored.model };
      }
    }
  }

  log('bridge start', JSON.stringify({ sessionId, requestedModel, resume: !!resumeId }));

  const displayModel = ref
    ? ref.backend === 'openai'
      ? `${ref.providerId}/${ref.model}`
      : ref.backend === 'council'
        ? ref.chair
          ? `council/${ref.chair}`
          : 'council'
        : `${ref.backend}/${ref.model}`
    : requestedModel || 'bridge';
  const emitter = new StreamEmitter(sessionId, displayModel);
  emitter.init(process.cwd(), flagValue('--permission-mode') || 'default');

  if (!ref) {
    const startedAt = Date.now();
    emitter.error(
      'ClaUi bridge: no backend selected. Pick a bridge model from the model ' +
        'picker (values look like bridge:grok/…, bridge:antigravity/…, ' +
        'bridge:openai/<provider>/…), or check ~/.claui/bridge.json.',
      startedAt,
    );
    process.exit(1);
  }

  let backend: Backend;
  if (ref.backend === 'grok') {
    backend = new GrokAcpBackend(
      config.grok?.cliPath || 'grok',
      ref.model,
      sessionId,
      store,
      systemPrompt,
      permissionMode,
      log,
      {
        // Registering the MCP server (and teaching Grok about it) only when
        // the tool path is actually active honors `strategy: 'macro'` as a
        // real escape hatch — see isToolPathActive's doc comment.
        enabled: isToolPathActive(config),
        // Sibling bundle emitted by the 'mcp/command-server' webpack entry —
        // both live under dist/bridge-runtime/.
        serverScriptPath: path.join(__dirname, 'mcp', 'command-server.js'),
        cwd: process.cwd(),
        diffBase: normalizeDiffBase(config.commandTools?.diffBase),
      },
    );
  } else if (ref.backend === 'antigravity') {
    backend = new AntigravityBackend(
      config.antigravity?.cliPath || 'agy',
      ref.model,
      sessionId,
      store,
      systemPrompt,
      permissionMode,
      log,
    );
  } else if (ref.backend === 'council') {
    backend = new CouncilBackend(config, ref.chair, sessionId, store, systemPrompt, log);
  } else {
    const provider = (config.openai || []).find((p) => p.id === ref!.providerId);
    if (!provider) {
      const startedAt = Date.now();
      emitter.error(
        `ClaUi bridge: unknown OpenAI-compatible provider "${ref.providerId}". ` +
          'Check the claudeMirror.bridge.openaiProviders setting.',
        startedAt,
      );
      process.exit(1);
      return;
    }
    backend = new OpenAiCompatBackend(provider, ref.model, sessionId, store, systemPrompt);
    store.write(sessionId, {
      backend: 'openai',
      model: ref.model,
      openaiProviderId: ref.providerId,
    });
  }

  // --- Turn loop -----------------------------------------------------------
  const queue: BridgePrompt[] = [];
  let running = false;
  let stdinClosed = false;
  // Aborts an in-flight offloaded CLI invocation (Layer C) on interrupt.
  // Offload runs INSIDE dispatchCommand, before backend.runTurn is ever
  // called, so backend.interrupt() alone has no way to reach it — this is a
  // separate cancellation path, not a claim that offload skips the backend
  // (its result IS injected into a normal backend.runTurn call afterwards).
  // Only ever set while a turn is running.
  let activeTurnAbort: AbortController | null = null;

  async function pump(): Promise<void> {
    if (running) return;
    if (queue.length === 0) {
      if (stdinClosed) {
        backend.dispose?.();
        process.exit(0);
      }
      return;
    }
    running = true;
    const prompt = queue.shift()!;
    const startedAt = Date.now();
    const turnAbort = new AbortController();
    activeTurnAbort = turnAbort;
    try {
      const outcome = await dispatchCommand(prompt, {
        backendKind: ref!.backend,
        // True only when Grok's MCP command server is actually registered
        // this run (see isToolPathActive) — otherwise this would claim Grok
        // has tools it doesn't, in a build where resolveStrategy's own logic
        // ever starts trusting toolCapable more directly than it does today.
        toolCapable: ref!.backend === 'grok' && isToolPathActive(config),
        permissionMode,
        config,
        cwd: process.cwd(),
        log,
        signal: turnAbort.signal,
      });
      const effectivePrompt = outcome.kind === 'rewrite' ? outcome.prompt : prompt;
      const openedWriteWindow = outcome.kind === 'passthrough' && outcome.writeWindow;
      if (openedWriteWindow) backend.setWriteWindow?.(true);
      try {
        const text = await backend.runTurn(effectivePrompt, emitter);
        emitter.result({ text, startedAt });
      } finally {
        // Scoped to exactly this turn — always close it, success or failure.
        if (openedWriteWindow) backend.setWriteWindow?.(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log('turn error:', message);
      emitter.error(`Bridge (${ref!.backend}) error: ${message}`, startedAt);
    }
    activeTurnAbort = null;
    running = false;
    void pump();
  }

  attachStdin({
    onPrompt: (prompt) => {
      queue.push(prompt);
      void pump();
    },
    onInterrupt: () => {
      // Abort first: AbortController.abort() cannot throw, so ordering it
      // before backend.interrupt() guarantees an in-flight offload is always
      // cancelled even if a backend's own interrupt() implementation throws.
      activeTurnAbort?.abort();
      backend.interrupt();
    },
    onClose: () => {
      stdinClosed = true;
      void pump();
    },
  });

  process.on('exit', () => backend.dispose?.());
}

void main().catch((e) => {
  log('fatal:', e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
