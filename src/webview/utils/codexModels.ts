import type { CodexModelOption } from '../../extension/types/webview-messages';

/**
 * Static fallback capabilities for Codex models, used ONLY when the Codex CLI
 * model cache (`codexModelOptions`, sourced from `~/.codex/models_cache.json`)
 * is unavailable — e.g. before the first CLI run has written the cache. The
 * cache remains the source of truth; whenever it is present, its values win.
 *
 * Capability metadata mirrors what the cache advertises today so the reasoning,
 * Fast, and context-window controls stay correct even in fallback mode. A static
 * entry here is a UI convenience, NOT a grant of access: real availability still
 * depends on the account, workspace, CLI, and policy.
 */
export const CODEX_MODEL_FALLBACK: CodexModelOption[] = [
  {
    label: 'GPT-6 Astra',
    value: 'gpt-6-astra',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    contextWindow: 272_000,
    maxContextWindow: 872_000,
    supportsFast: true,
    defaultReasoningEffort: 'medium',
  },
  {
    label: 'GPT-5.6 Sol',
    value: 'gpt-5.6-sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    contextWindow: 272_000,
    maxContextWindow: 872_000,
    supportsFast: true,
    defaultReasoningEffort: 'low',
  },
  {
    label: 'GPT-5.6 Terra',
    value: 'gpt-5.6-terra',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    contextWindow: 272_000,
    maxContextWindow: 872_000,
    supportsFast: true,
    defaultReasoningEffort: 'medium',
  },
  {
    label: 'GPT-5.6 Luna',
    value: 'gpt-5.6-luna',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    contextWindow: 272_000,
    maxContextWindow: 872_000,
    supportsFast: true,
    defaultReasoningEffort: 'medium',
  },
  {
    label: 'GPT-5.5',
    value: 'gpt-5.5',
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    supportsFast: true,
    defaultReasoningEffort: 'medium',
  },
  {
    label: 'GPT-5.4 Mini',
    value: 'gpt-5.4-mini',
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    supportsFast: false,
    defaultReasoningEffort: 'medium',
  },
  {
    label: 'GPT-5.3-Codex-Spark',
    value: 'gpt-5.3-codex-spark',
    contextWindow: 128_000,
    maxContextWindow: 128_000,
    supportsFast: false,
    defaultReasoningEffort: 'high',
  },
];

/**
 * Resolves the capability metadata for a Codex model id. Prefers the live cache
 * (`codexModelOptions`); if the model is absent there (or the cache is empty),
 * falls back to the static {@link CODEX_MODEL_FALLBACK} table. Returns undefined
 * for unknown ids so callers can apply their own last-resort defaults.
 */
export function resolveCodexModelOption(
  model: string | undefined,
  codexModelOptions: CodexModelOption[] | undefined,
): CodexModelOption | undefined {
  if (!model) return undefined;
  const fromCache = codexModelOptions?.find((opt) => opt.value === model);
  if (fromCache) return fromCache;
  return CODEX_MODEL_FALLBACK.find((opt) => opt.value === model);
}
