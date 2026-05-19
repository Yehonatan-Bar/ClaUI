import { RedactionResult } from '../extension/particle-accelerator/ParticleAcceleratorTypes';

const REDACTED = '[REDACTED]';

export const SENSITIVE_KEY_PATTERNS = [
  /_TOKEN$/i, /_SECRET$/i, /_KEY$/i, /_PASSWORD$/i, /_CREDENTIAL$/i,
  /_AUTH$/i, /_PRIVATE$/i, /_API_KEY$/i, /_APIKEY$/i, /_ACCESS_KEY/i,
  /^AWS_/i, /^AZURE_/i,
  /^GITHUB_TOKEN$/i, /^GITHUB_PAT$/i, /^GH_TOKEN$/i,
  /^DATABASE_URL$/i, /^CONNECTION_STRING$/i,
  /^OPENAI_API_KEY$/i, /^ANTHROPIC_API_KEY$/i,
  /^SLACK_/i, /^STRIPE_/i, /^NUGET_/i,
];

export interface RegexRule {
  name: string;
  pattern: RegExp;
}

export const REGEX_RULES: RegexRule[] = [
  { name: 'github-classic-pat', pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'github-fine-grained', pattern: /github_pat_[A-Za-z0-9_]{82}/g },
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'aws-secret-key', pattern: /(?<==\s*)[A-Za-z0-9/+=]{40}(?=\s|$)/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9-]{20,}/g },
  { name: 'slack-token', pattern: /xox[bpras]-[A-Za-z0-9-]+/g },
  { name: 'stripe-key', pattern: /[rs]k_(live|test)_[A-Za-z0-9]{20,}/g },
  { name: 'google-api-key', pattern: /AIza[A-Za-z0-9_-]{35}/g },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'basic-auth-url', pattern: /:\/\/[^:@\s]+:[^@\s]+@/g },
  { name: 'db-url-creds', pattern: /(postgres|mysql|mongodb|redis):\/\/[^:@\s]+:[^@\s]+@/g },
  { name: 'bearer-token', pattern: /Bearer [A-Za-z0-9_.+/=-]{20,}/g },
];

export interface SecretRedactor {
  redact(text: string): RedactionResult;
  redactChunk(chunk: string): RedactionResult;
  flush(): RedactionResult;
}

export function createSecretRedactor(envSnapshot: Record<string, string>): SecretRedactor {
  const sensitiveValues: string[] = [];

  for (const [key, value] of Object.entries(envSnapshot)) {
    if (!value || value.length < 8) continue;
    if (SENSITIVE_KEY_PATTERNS.some(p => p.test(key))) {
      sensitiveValues.push(value);
    }
  }

  // Sort longest-first for replacement priority
  sensitiveValues.sort((a, b) => b.length - a.length);

  let heldBack = '';

  function redactText(text: string): RedactionResult {
    try {
      let result = text;
      let totalReplacements = 0;
      const rulesTriggered = new Set<string>();

      // Phase 1: Replace exact env values
      for (const val of sensitiveValues) {
        if (result.includes(val)) {
          const count = result.split(val).length - 1;
          result = result.split(val).join(REDACTED);
          totalReplacements += count;
          rulesTriggered.add('env-value');
        }
      }

      // Phase 2: Apply regex rules
      for (const rule of REGEX_RULES) {
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
        const matches = result.match(regex);
        if (matches) {
          result = result.replace(regex, REDACTED);
          totalReplacements += matches.length;
          rulesTriggered.add(rule.name);
        }
      }

      return {
        text: result,
        replacements: totalReplacements,
        rulesTriggered: Array.from(rulesTriggered),
      };
    } catch {
      // Fail-closed: suppress output on redaction error
      return {
        text: '[claui-particle-accelerator] Output suppressed: redaction error.',
        replacements: 0,
        rulesTriggered: ['ERROR'],
      };
    }
  }

  return {
    redact(text: string): RedactionResult {
      return redactText(text);
    },

    redactChunk(chunk: string): RedactionResult {
      const OVERLAP = 200;
      const combined = heldBack + chunk;

      if (combined.length <= OVERLAP) {
        heldBack = combined;
        return { text: '', replacements: 0, rulesTriggered: [] };
      }

      const processable = combined.slice(0, combined.length - OVERLAP);
      heldBack = combined.slice(combined.length - OVERLAP);

      return redactText(processable);
    },

    flush(): RedactionResult {
      if (!heldBack) {
        return { text: '', replacements: 0, rulesTriggered: [] };
      }
      const result = redactText(heldBack);
      heldBack = '';
      return result;
    },
  };
}
