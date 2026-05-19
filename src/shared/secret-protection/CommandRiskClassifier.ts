import { CommandRisk, CommandRiskClass, FindingSeverity } from './types';
import { classifyCommand } from '../../particle-accelerator-runtime/CommandEligibility';

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

interface ClassificationRule {
  riskClass: CommandRiskClass;
  severity: FindingSeverity;
  test: (segment: string) => boolean;
}

function matchesAny(segment: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(segment));
}

const CREDENTIAL_DISCOVERY_PATTERNS: RegExp[] = [
  /\b(cat|type|less|more|head|tail)\s+\.env\b/,
  /\b(cat|type|less|more|head|tail)\s+.*\.env\./,
  /\bprintenv\b/,
  /^env$/,
  /^set$/,
  /\baws\s+configure\s+export-credentials\b/,
  /\b(cat|type|less|more|head|tail)\s+~?\/?\.ssh\//,
  /\b(cat|type|less|more|head|tail)\s+~?\/?\.aws\//,
];

const SECRET_FILE_PATTERNS: RegExp[] = [
  /\b(cat|type|less|more|head|tail)\s+\S*\.pem\b/,
  /\b(cat|type|less|more|head|tail)\s+\S*\.key\b/,
  /\b(cat|type|less|more|head|tail)\s+\S*\.p12\b/,
  /\bterraform\.tfstate\b/,
  /\bsecrets\.json\b/,
  /\bcredentials\b/,
];

const NETWORK_UPLOAD_PATTERNS: RegExp[] = [
  /\bcurl\b.*\s-X\s*(POST|PUT|PATCH)\b/i,
  /\bcurl\b.*\s(-d|--data|--data-raw|--data-binary|--data-urlencode)\b/,
  /\bcurl\b.*--upload-file\b/,
  /\bwget\b.*--post-(data|file)\b/,
  /\bncat?\b/,
  /\bscp\b.*\s\S+:/,
  /\brsync\b.*\s\S+:/,
];

const GIT_PUBLISH_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+create\b/,
  /\bgh\s+issue\s+(comment|create)\b/,
];

const GIT_CONTROL_WRITE_PATTERNS: RegExp[] = [
  /\b(echo|cat|tee|printf|>)\b.*\.git\/(hooks|config)\b/,
  /\bchmod\b.*\.git\/hooks\//,
  /\bmv\b.*\.git\/hooks\//,
  /\bcp\b.*\.git\/hooks\//,
];

const AGENT_CONTROL_WRITE_PATTERNS: RegExp[] = [
  /\b(echo|cat|tee|printf|>)\b.*\.(claude|codex|cursor)\//,
  /\b(echo|cat|tee|printf|>)\b.*\.vscode\/settings\.json\b/,
  /\bmv\b.*\.(claude|codex|cursor)\//,
  /\bcp\b.*\.(claude|codex|cursor)\//,
  /\brm\b.*\.(claude|codex|cursor)\//,
];

const ENV_DUMP_PATTERNS: RegExp[] = [
  /\b(env|printenv|set)\b.*\|/,
  /^export$/,
];

const SAFE_READ_PATTERNS: RegExp[] = [
  /^\s*(ls|dir)\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*wc\b/,
  /^\s*find\b/,
  /^\s*grep\b/,
  /^\s*git\s+(status|diff|log|show|branch)\b/,
];

const BUILD_OR_TEST_PATTERNS: RegExp[] = [
  /\bnpm\s+(test|run\s+build|run\s+test)\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\btsc\b/,
  /\beslint\b/,
  /\bnpx\s+jest\b/,
  /\bmake\b/,
];

const PACKAGE_INSTALL_PATTERNS: RegExp[] = [
  /\bnpm\s+install\b/,
  /\bnpm\s+i\b/,
  /\bpip\s+install\b/,
  /\bgo\s+get\b/,
  /\bcargo\s+add\b/,
  /\byarn\s+add\b/,
  /\bpnpm\s+add\b/,
];

// Full-command patterns checked BEFORE splitting on pipes/chains,
// so cross-pipe obfuscation like `base64 | curl` is caught intact.
const FULL_COMMAND_OBFUSCATION_PATTERNS: RegExp[] = [
  /\bbase64\b.*\|\s*(curl|nc|ncat|wget)\b/,
  /\beval\s+\$\(/,
  /\beval\s+`/,
];

const RULES: ClassificationRule[] = [
  {
    riskClass: 'agent_control_write',
    severity: 'critical',
    test: (s) => matchesAny(s, AGENT_CONTROL_WRITE_PATTERNS),
  },
  {
    riskClass: 'credential_discovery',
    severity: 'high',
    test: (s) => matchesAny(s, CREDENTIAL_DISCOVERY_PATTERNS),
  },
  {
    riskClass: 'secret_file_read',
    severity: 'high',
    test: (s) => matchesAny(s, SECRET_FILE_PATTERNS),
  },
  {
    riskClass: 'network_upload',
    severity: 'high',
    test: (s) => matchesAny(s, NETWORK_UPLOAD_PATTERNS),
  },
  {
    riskClass: 'git_control_write',
    severity: 'high',
    test: (s) => matchesAny(s, GIT_CONTROL_WRITE_PATTERNS),
  },
  {
    riskClass: 'git_publish',
    severity: 'medium',
    test: (s) => matchesAny(s, GIT_PUBLISH_PATTERNS),
  },
  {
    riskClass: 'env_dump',
    severity: 'medium',
    test: (s) => matchesAny(s, ENV_DUMP_PATTERNS),
  },
  {
    riskClass: 'safe_read',
    severity: 'low',
    test: (s) => matchesAny(s, SAFE_READ_PATTERNS),
  },
  {
    riskClass: 'build_or_test',
    severity: 'low',
    test: (s) => matchesAny(s, BUILD_OR_TEST_PATTERNS),
  },
  {
    riskClass: 'package_install',
    severity: 'low',
    test: (s) => matchesAny(s, PACKAGE_INSTALL_PATTERNS),
  },
];

function detectCrossSegmentThreats(segments: string[]): { classes: CommandRiskClass[]; severity: FindingSeverity } | null {
  const secretReaders = /\b(cat\s+\.env|printenv|env|cat\s+.*\.(pem|key)|cat\s+~?\/?\.ssh|cat\s+~?\/?\.aws|base64)\b/;
  const networkCommands = /\b(curl|wget|nc|ncat|scp|rsync)\b/;

  let hasSecretReader = false;
  let hasBase64 = false;
  let hasNetworkAfterThreat = false;

  for (const seg of segments) {
    if (secretReaders.test(seg)) hasSecretReader = true;
    if (/\bbase64\b/.test(seg)) hasBase64 = true;
    if ((hasSecretReader || hasBase64) && networkCommands.test(seg)) {
      hasNetworkAfterThreat = true;
    }
  }

  if (hasNetworkAfterThreat) {
    return { classes: ['shell_obfuscation', 'network_upload'], severity: 'critical' };
  }
  return null;
}

function classifySegment(segment: string): Array<{ riskClass: CommandRiskClass; severity: FindingSeverity }> {
  const matches: Array<{ riskClass: CommandRiskClass; severity: FindingSeverity }> = [];
  for (const rule of RULES) {
    if (rule.test(segment)) {
      matches.push({ riskClass: rule.riskClass, severity: rule.severity });
    }
  }
  return matches;
}

function splitCommand(command: string): string[] {
  return command
    .split(/\s*(?:\|{1,2}|&&|;)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function maxSeverity(severities: FindingSeverity[]): FindingSeverity {
  if (severities.length === 0) return 'low';
  return severities.reduce((max, s) =>
    SEVERITY_RANK[s] > SEVERITY_RANK[max] ? s : max
  );
}

export function classifyCommandRisk(command: string): CommandRisk {
  const trimmed = command.trimStart();

  const allClasses = new Set<CommandRiskClass>();
  const allSeverities: FindingSeverity[] = [];
  const explanations: string[] = [];

  // Check full-command obfuscation patterns BEFORE splitting
  for (const pattern of FULL_COMMAND_OBFUSCATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      allClasses.add('shell_obfuscation');
      allSeverities.push('critical');
      break;
    }
  }

  // Consult CommandEligibility for filter hints
  const eligibility = classifyCommand(trimmed);
  if (eligibility && !eligibility.eligible) {
    allClasses.add('interactive');
    allSeverities.push('medium');
  }

  const segments = splitCommand(trimmed);

  for (const segment of segments) {
    const matches = classifySegment(segment);
    for (const m of matches) {
      allClasses.add(m.riskClass);
      allSeverities.push(m.severity);
    }
  }

  // Cross-segment pipeline analysis
  const pipelineThreat = detectCrossSegmentThreats(segments);
  if (pipelineThreat) {
    for (const cls of pipelineThreat.classes) {
      allClasses.add(cls);
    }
    allSeverities.push(pipelineThreat.severity);
  }

  if (allClasses.size === 0) {
    allClasses.add('safe_read');
    allSeverities.push('low');
  }

  const severity = maxSeverity(allSeverities);
  const requiresApproval = SEVERITY_RANK[severity] >= SEVERITY_RANK['high'];
  const hardBlock =
    allClasses.has('agent_control_write') && allClasses.has('shell_obfuscation');

  if (hardBlock) {
    explanations.push('Agent control file write combined with obfuscation is hard-blocked');
  }
  if (allClasses.has('shell_obfuscation')) {
    explanations.push('Shell obfuscation detected');
  }
  if (allClasses.has('network_upload')) {
    explanations.push('Network upload detected');
  }
  if (allClasses.has('credential_discovery')) {
    explanations.push('Credential discovery command');
  }
  if (allClasses.has('secret_file_read')) {
    explanations.push('Secret/key file read');
  }
  if (allClasses.has('agent_control_write')) {
    explanations.push('Write to agent control directory');
  }
  if (allClasses.has('git_control_write')) {
    explanations.push('Write to git control file');
  }
  if (allClasses.has('git_publish')) {
    explanations.push('Git publish operation');
  }
  if (allClasses.has('env_dump')) {
    explanations.push('Environment variable dump');
  }

  const classArray = Array.from(allClasses);
  const explanation =
    explanations.length > 0
      ? explanations.join('; ')
      : classArray.join(', ');

  return {
    classes: classArray,
    severity,
    requiresApproval,
    hardBlock,
    explanation,
  };
}
