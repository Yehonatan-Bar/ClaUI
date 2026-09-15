import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** OpenAI-compatible endpoint profile (Ollama / LM Studio / llama.cpp / vLLM / any). */
export interface OpenAiCompatProvider {
  id: string;
  label?: string;
  baseUrl: string;
  /** Direct API key (discouraged — prefer apiKeyEnv/apiKeyFile). */
  apiKey?: string;
  /** Name of an environment variable holding the API key. */
  apiKeyEnv?: string;
  /** Path to a file whose trimmed contents are the API key. */
  apiKeyFile?: string;
  models?: string[];
}

/** Model-council settings (see backends/council.ts). */
export interface CouncilConfig {
  /** Member tokens (e.g. `codex`, `grok`, `openai/<providerId>/<model>`). Empty
   *  = runtime defaults (codex, grok). */
  members?: string[];
  /** Preferred chair token; overridden by an explicit `bridge:council/<chair>`. */
  chair?: string;
  /** Per-member (and per-chair) timeout in ms. */
  timeoutMs?: number;
}

export interface BridgeConfig {
  version: number;
  /** Claude subscription CLI path (council availability detection only in v1). */
  claude?: { cliPath?: string };
  /** Codex CLI path (used by the council backend). */
  codex?: { cliPath?: string };
  grok?: { cliPath?: string };
  antigravity?: { cliPath?: string };
  openai?: OpenAiCompatProvider[];
  /** Model-council configuration. */
  council?: CouncilConfig;
  /** Directory for bridge session state (defaults to ~/.claui/bridge-sessions). */
  storageDir?: string;
  /** ClaUi permission mode at spawn time ('full-access' | 'supervised'). */
  permissionMode?: string;
  /** Bridge command-tools (see src/bridge-runtime/commands/): lets
   *  /code-review, /security-review, /simplify actually run inside bridge
   *  tabs instead of being forwarded to the backend as inert text. */
  commandTools?: {
    /** Master switch. Default true. */
    enabled?: boolean;
    /** 'auto' prefers a tool-capable backend's MCP tool, else falls back to
     *  a macro rewrite. 'macro'/'tool'/'offload' force that strategy. */
    strategy?: 'auto' | 'macro' | 'tool' | 'offload';
    /** Allow Layer C (running the real claude/codex CLI as a co-processor).
     *  Default false. */
    offload?: boolean;
    /** Base ref for branch-scoped commands. Default 'main'. */
    diffBase?: string;
  };
}

export const CLAUI_HOME = path.join(os.homedir(), '.claui');
export const CONFIG_PATH =
  process.env.CLAUI_BRIDGE_CONFIG || path.join(CLAUI_HOME, 'bridge.json');

export function loadBridgeConfig(): BridgeConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as BridgeConfig;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    /* missing/corrupt config falls through to defaults */
  }
  return { version: 1 };
}

export function storageDir(cfg: BridgeConfig): string {
  return cfg.storageDir || path.join(CLAUI_HOME, 'bridge-sessions');
}

export function resolveOpenAiApiKey(p: OpenAiCompatProvider): string {
  if (p.apiKey) return p.apiKey.trim();
  if (p.apiKeyEnv && process.env[p.apiKeyEnv]) {
    return String(process.env[p.apiKeyEnv]).trim();
  }
  if (p.apiKeyFile) {
    try {
      return fs.readFileSync(p.apiKeyFile, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Parsed form of a ClaUi bridge model value (`bridge:<backend>/<rest>`).
 * A discriminated union: the `council` backend carries no model, only an
 * optional chair; the others carry a model (and, for openai, a provider id).
 */
export type BridgeModelRef =
  | { backend: 'grok'; model: string }
  | { backend: 'antigravity'; model: string }
  | { backend: 'openai'; providerId: string; model: string }
  | { backend: 'council'; chair?: string };

export const BRIDGE_MODEL_PREFIX = 'bridge:';

export function parseBridgeModel(value: string | null | undefined): BridgeModelRef | null {
  const v = String(value || '').trim();
  if (!v.startsWith(BRIDGE_MODEL_PREFIX)) return null;
  const rest = v.slice(BRIDGE_MODEL_PREFIX.length);

  // Council has no backend model segment; the (optional) chair may itself
  // contain '/', so keep the whole suffix. Handled BEFORE the slash guard so a
  // bare `bridge:council` (no slash) is recognized.
  if (rest === 'council') return { backend: 'council' };
  if (rest.startsWith('council/')) {
    const chair = rest.slice('council/'.length).trim();
    return chair ? { backend: 'council', chair } : { backend: 'council' };
  }

  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const backend = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (backend === 'grok') return { backend, model: tail };
  if (backend === 'antigravity') return { backend, model: tail };
  if (backend === 'openai') {
    const slash2 = tail.indexOf('/');
    if (slash2 < 0) return null;
    return {
      backend,
      providerId: tail.slice(0, slash2),
      model: tail.slice(slash2 + 1),
    };
  }
  return null;
}
