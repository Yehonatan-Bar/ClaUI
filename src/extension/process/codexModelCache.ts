import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodexModelOption, CodexReasoningEffort } from '../types/webview-messages';

/** Turns a Codex model slug (`gpt-5.6-sol`) into a display label (`GPT-5.6-Sol`). */
function formatCodexModelLabel(id: string): string {
  return id
    .split('-')
    .map((part) => (part.toLowerCase() === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

/**
 * Reads the model list the Codex CLI maintains in `~/.codex/models_cache.json`.
 *
 * This is the source of truth for which models the current account may use, and
 * which reasoning efforts each one accepts. Running Codex CLI processes refetch
 * and rewrite the file, so the advertised model set can differ between reads.
 * Returns an empty array when the cache is missing or unreadable, letting the
 * caller fall back to a static list.
 */
export function readCodexModelOptions(log?: (message: string) => void): CodexModelOption[] {
  try {
    const modelsCachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    if (!fs.existsSync(modelsCachePath)) {
      log?.(`Codex models cache not found: ${modelsCachePath}`);
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(modelsCachePath, 'utf8')) as {
      models?: Array<Record<string, unknown>>;
    };
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    const seen = new Set<string>();

    const options = models
      .filter((model) => {
        const slug = typeof model.slug === 'string' ? model.slug : '';
        const displayName = typeof model.display_name === 'string' ? model.display_name : '';
        const haystack = `${slug} ${displayName}`.toLowerCase();
        const isVisible = model.visibility === undefined || model.visibility === 'list';
        return isVisible && (haystack.includes('gpt') || haystack.includes('codex'));
      })
      .sort((a, b) => {
        const pa = typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER;
        const pb = typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        const sa = typeof a.slug === 'string' ? a.slug : '';
        const sb = typeof b.slug === 'string' ? b.slug : '';
        return sa.localeCompare(sb);
      })
      .map((model) => {
        const slug = typeof model.slug === 'string' ? model.slug.trim() : '';
        if (!slug || seen.has(slug)) return null;
        seen.add(slug);
        const supportedReasoningEfforts = Array.isArray(model.supported_reasoning_levels)
          ? model.supported_reasoning_levels
              .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const effort = (entry as { effort?: unknown }).effort;
                return typeof effort === 'string' ? (effort as CodexReasoningEffort) : null;
              })
              .filter((effort): effort is CodexReasoningEffort => !!effort)
          : undefined;
        return {
          label: formatCodexModelLabel(slug),
          value: slug,
          supportedReasoningEfforts: supportedReasoningEfforts?.length ? supportedReasoningEfforts : undefined,
        } as CodexModelOption;
      })
      .filter((opt): opt is CodexModelOption => !!opt);

    log?.(`Loaded ${options.length} Codex model options from models_cache.json`);
    return options;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.(`Failed to read Codex model options: ${message}`);
    return [];
  }
}
