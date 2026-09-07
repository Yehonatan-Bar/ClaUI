import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodexModelOption, CodexReasoningEffort } from '../types/webview-messages';

/** Reasoning efforts the webview contract recognizes (excludes the '' "default" sentinel). */
const VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set<CodexReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

/** Turns a Codex model slug (`gpt-5.6-sol`) into a display label (`GPT-5.6-Sol`). */
function formatCodexModelLabel(id: string): string {
  return id
    .split('-')
    .map((part) => (part.toLowerCase() === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

/** Coerces a cache field to a positive finite integer, or undefined when invalid. */
function toPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/** Coerces a cache field to a recognized reasoning effort, or undefined when invalid. */
function toReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === 'string' && VALID_REASONING_EFFORTS.has(value)
    ? (value as CodexReasoningEffort)
    : undefined;
}

/**
 * Detects whether a cache entry advertises a Fast speed tier. The Codex CLI marks
 * this via `additional_speed_tiers` (e.g. `["fast"]`) and/or a `service_tiers`
 * entry named/keyed for the priority ("Fast") lane.
 */
function detectSupportsFast(model: Record<string, unknown>): boolean {
  const speedTiers = model.additional_speed_tiers;
  if (Array.isArray(speedTiers) && speedTiers.some((t) => typeof t === 'string' && t.toLowerCase() === 'fast')) {
    return true;
  }
  const serviceTiers = model.service_tiers;
  if (Array.isArray(serviceTiers)) {
    return serviceTiers.some((tier) => {
      if (!tier || typeof tier !== 'object') return false;
      const id = (tier as { id?: unknown }).id;
      const name = (tier as { name?: unknown }).name;
      const idStr = typeof id === 'string' ? id.toLowerCase() : '';
      const nameStr = typeof name === 'string' ? name.toLowerCase() : '';
      return idStr === 'priority' || idStr === 'fast' || nameStr === 'fast';
    });
  }
  return false;
}

/**
 * Pure parser for the shape of `~/.codex/models_cache.json`. Kept separate from
 * the file read so it can be unit-tested against fixture JSON without touching the
 * filesystem. Only validated primitives are copied out of the cache; free-form
 * cache content (descriptions, NUX messages, prompts) is never forwarded.
 */
export function parseCodexModelOptions(rawJson: string): CodexModelOption[] {
  const parsed = JSON.parse(rawJson) as { models?: Array<Record<string, unknown>> };
  const models = Array.isArray(parsed?.models) ? parsed.models : [];
  const seen = new Set<string>();

  return models
    .filter((model) => {
      const slug = typeof model.slug === 'string' ? model.slug : '';
      const displayName = typeof model.display_name === 'string' ? model.display_name : '';
      const haystack = `${slug} ${displayName}`.toLowerCase();
      const isVisible = model.visibility === undefined || model.visibility === 'list';
      return isVisible && (haystack.includes('gpt') || haystack.includes('codex'));
    })
    .sort((a, b) => {
      const priorityA = typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER;
      const priorityB = typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const slugA = typeof a.slug === 'string' ? a.slug : '';
      const slugB = typeof b.slug === 'string' ? b.slug : '';
      return slugA.localeCompare(slugB);
    })
    .map((model) => {
      const slug = typeof model.slug === 'string' ? model.slug.trim() : '';
      if (!slug || seen.has(slug)) return null;
      seen.add(slug);

      const supportedReasoningEfforts = Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null;
              return toReasoningEffort((entry as { effort?: unknown }).effort) ?? null;
            })
            .filter((effort): effort is CodexReasoningEffort => !!effort)
        : undefined;

      return {
        label: formatCodexModelLabel(slug),
        value: slug,
        supportedReasoningEfforts: supportedReasoningEfforts?.length ? supportedReasoningEfforts : undefined,
        contextWindow: toPositiveInt(model.context_window),
        maxContextWindow: toPositiveInt(model.max_context_window),
        supportsFast: detectSupportsFast(model),
        defaultReasoningEffort: toReasoningEffort(model.default_reasoning_level),
      } as CodexModelOption;
    })
    .filter((opt): opt is CodexModelOption => !!opt);
}

/**
 * Reads the model list the Codex CLI maintains in `~/.codex/models_cache.json`.
 *
 * This is the source of truth for which models the current account may use, and
 * which reasoning efforts / speed tiers / context windows each one accepts.
 * Running Codex CLI processes refetch and rewrite the file, so the advertised
 * model set can differ between reads. Returns an empty array when the cache is
 * missing or unreadable, letting the caller fall back to a static list.
 */
export function readCodexModelOptions(log?: (message: string) => void): CodexModelOption[] {
  try {
    const modelsCachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    if (!fs.existsSync(modelsCachePath)) {
      log?.(`Codex models cache not found: ${modelsCachePath}`);
      return [];
    }

    const options = parseCodexModelOptions(fs.readFileSync(modelsCachePath, 'utf8'));
    log?.(`Loaded ${options.length} Codex model options from models_cache.json`);
    return options;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.(`Failed to read Codex model options: ${message}`);
    return [];
  }
}
