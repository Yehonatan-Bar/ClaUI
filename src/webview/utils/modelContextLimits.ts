/**
 * Returns the maximum context window size (in tokens) for a given model name.
 * Used to compute context usage percentage.
 */
export function getModelMaxContext(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes('gemini-1.5-pro') || lower.includes('gemini-2')) {
    return 1_000_000;
  }
  if (lower.includes('gemini')) {
    return 1_000_000;
  }
  // Active context windows as reported by the Codex CLI model cache. GPT-5.4
  // advertises a larger max_context_window, but the active window is 272K.
  if (lower.includes('gpt-5.6')) {
    return 372_000;
  }
  if (lower.includes('gpt-5.5') || lower.includes('gpt-5.4')) {
    return 272_000;
  }
  if (lower.includes('gpt-5.3-codex-spark')) {
    return 128_000;
  }
  // GPT-5 and Codex GPT-5.x models use a 400K context window.
  if (lower.includes('gpt-5')) {
    return 400_000;
  }
  if (lower.includes('gpt-4o') || lower.includes('gpt-4-turbo')) {
    return 128_000;
  }
  if (lower.includes('gpt-4')) {
    return 8_192;
  }
  if (lower.includes('gpt-3.5')) {
    return 16_385;
  }
  // Claude models with a 1M-token context window: Fable 5, Opus 4.6/4.7/4.8,
  // Sonnet 4.6, and Sonnet 5.
  const oneMillionContextModels = [
    'claude-fable-5',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
  ];
  if (oneMillionContextModels.some((id) => lower.startsWith(id))) {
    return 1_000_000;
  }
  // All other Claude models (claude-3.x, Sonnet 4.5, Haiku 4.5, Mythos 5, etc.)
  return 200_000;
}

/**
 * Returns a color string based on context usage percentage.
 * green < 50%, yellow 50-80%, red > 80%
 */
export function getContextColor(pct: number): string {
  if (pct > 80) return '#e05252';
  if (pct > 50) return '#e0a030';
  return '#4caf80';
}
