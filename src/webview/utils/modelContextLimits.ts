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
  // GPT-5.4 and GPT-5.4-pro expose a larger 1.05M context window.
  if (lower.includes('gpt-5.4') && !lower.includes('mini')) {
    return 1_050_000;
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
  // All current Claude models (claude-3.x, claude-opus-4-6, claude-sonnet-4-6, etc.)
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
