export interface ClaudeModelOption {
  label: string;
  value: string;
}

export const CLAUDE_MODEL_OPTIONS: ClaudeModelOption[] = [
  { label: 'Default', value: '' },
  { label: 'Opus 4.7', value: 'claude-opus-4-7' },
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
  { label: 'Opus 4.6', value: 'claude-opus-4-6' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
];

const STATUS_VALUES = new Set(['connecting...', 'connected', 'unknown']);
const CLAUDE_FAMILIES = new Set(['opus', 'sonnet', 'haiku']);

function inferClaudeModelLabel(model: string): string | null {
  const lower = model.toLowerCase();
  if (!lower.startsWith('claude-')) {
    return null;
  }

  const parts = lower
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
    .filter(Boolean);
  const familyIndex = parts.findIndex((part) => CLAUDE_FAMILIES.has(part));
  if (familyIndex < 0) {
    return null;
  }

  const family = parts[familyIndex][0].toUpperCase() + parts[familyIndex].slice(1);
  const versionAfterFamily = parts
    .slice(familyIndex + 1)
    .filter((part) => /^\d+$/.test(part));
  const versionBeforeFamily = parts
    .slice(0, familyIndex)
    .filter((part) => /^\d+$/.test(part));
  const versionParts = versionAfterFamily.length >= 2
    ? versionAfterFamily
    : versionBeforeFamily;

  if (versionParts.length >= 2) {
    return `${family} ${versionParts[0]}.${versionParts[1]}`;
  }
  if (versionParts.length === 1) {
    return `${family} ${versionParts[0]}`;
  }
  return family;
}

export function getClaudeModelLabel(model: string | null | undefined): string {
  const value = (model ?? '').trim();
  if (!value) {
    return '';
  }

  const lower = value.toLowerCase();
  if (STATUS_VALUES.has(lower)) {
    return value;
  }

  const known = CLAUDE_MODEL_OPTIONS.find((option) => {
    if (!option.value) {
      return false;
    }
    const optionValue = option.value.toLowerCase();
    return lower === optionValue ||
      lower.startsWith(`${optionValue}-`);
  });
  if (known) {
    return known.label;
  }

  return inferClaudeModelLabel(value) ?? value;
}

export function getClaudeModelCompactLabel(model: string | null | undefined): string {
  const label = getClaudeModelLabel(model);
  if (!label) {
    return '';
  }
  const raw = (model ?? '').trim();
  if (label !== raw) {
    return label;
  }
  return label
    .replace(/^claude-/i, '')
    .replace(/-\d{8}$/, '');
}
