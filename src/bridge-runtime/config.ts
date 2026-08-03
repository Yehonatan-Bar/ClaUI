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

export interface BridgeConfig {
  version: number;
  grok?: { cliPath?: string };
  antigravity?: { cliPath?: string };
  openai?: OpenAiCompatProvider[];
  /** Directory for bridge session state (defaults to ~/.claui/bridge-sessions). */
  storageDir?: string;
  /** ClaUi permission mode at spawn time ('full-access' | 'supervised'). */
  permissionMode?: string;
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

/** Parsed form of a ClaUi bridge model value (`bridge:<backend>/<rest>`). */
export interface BridgeModelRef {
  backend: 'grok' | 'antigravity' | 'openai';
  /** Backend model id (for openai this is the part after the provider id). */
  model: string;
  /** Only for openai backend: the provider profile id. */
  providerId?: string;
}

export const BRIDGE_MODEL_PREFIX = 'bridge:';

export function parseBridgeModel(value: string | null | undefined): BridgeModelRef | null {
  const v = String(value || '').trim();
  if (!v.startsWith(BRIDGE_MODEL_PREFIX)) return null;
  const rest = v.slice(BRIDGE_MODEL_PREFIX.length);
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
