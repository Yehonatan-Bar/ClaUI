import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AntigravityBackend } from './backends/antigravity';
import { GrokAcpBackend } from './backends/grokAcp';
import { OpenAiCompatBackend } from './backends/openaiCompat';
import {
  BridgeModelRef,
  CLAUI_HOME,
  loadBridgeConfig,
  parseBridgeModel,
  storageDir,
} from './config';
import { attachStdin, StreamEmitter } from './protocol';
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
  runTurn(prompt: string, emitter: StreamEmitter): Promise<string>;
  interrupt(): void;
  dispose?(): void;
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
    if (stored?.backend && stored.model) {
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
      log,
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
  const queue: string[] = [];
  let running = false;
  let stdinClosed = false;

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
    try {
      const text = await backend.runTurn(prompt, emitter);
      emitter.result({ text, startedAt });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log('turn error:', message);
      emitter.error(`Bridge (${ref!.backend}) error: ${message}`, startedAt);
    }
    running = false;
    void pump();
  }

  attachStdin({
    onPrompt: (text) => {
      queue.push(text);
      void pump();
    },
    onInterrupt: () => backend.interrupt(),
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
