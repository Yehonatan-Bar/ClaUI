import { CommandEligibilityResult } from '../extension/particle-accelerator/ParticleAcceleratorTypes';

const DENY_LIST: RegExp[] = [
  /^ssh\b/, /^scp\b/, /^rsync\b.*:/, /^sudo\b/, /^su\b/, /^passwd\b/,
  /^(vim|vi|nano|emacs)\b/, /^(less|more)\b/, /^man\b/,
  /^(top|htop)\b/, /^watch\b/, /^tail\s+-f\b/,
  /\bnpm\s+run\s+dev\b/, /\bvite\s+dev\b/, /\bnext\s+dev\b/,
  /\bserve\b/, /\bpython\s+-m\s+http\.server\b/,
  /\bdocker\s+run\s+.*-it?\b/, /\bkubectl\s+exec\s+.*-it?\b/,
  /\bread\s+-/,
];

interface AllowEntry {
  pattern: RegExp;
  family: string;
  filterHint: string;
}

const ALLOW_LIST: AllowEntry[] = [
  // JavaScript/Node ecosystem
  { pattern: /^npm\s+(test|t)\b/, family: 'npm-test', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^npm\s+(run\s+)?(build|compile)\b/, family: 'npm-build', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^npm\s+(install|ci|i)\b/, family: 'npm-install', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^npm\s+(run\s+)?lint\b/, family: 'npm-lint', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^npm\s+audit\b/, family: 'npm-audit', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^pnpm\s+(test|build|install|lint|audit)\b/, family: 'pnpm', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^yarn\s+(test|build|install|lint|audit)\b/, family: 'yarn', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^bun\s+(test|build|install|lint)\b/, family: 'bun', filterHint: 'JavaScriptPackageFilter' },
  { pattern: /^npx\s+jest\b/, family: 'jest', filterHint: 'JestVitestFilter' },
  { pattern: /^npx\s+vitest\b/, family: 'vitest', filterHint: 'JestVitestFilter' },
  { pattern: /^jest\b/, family: 'jest', filterHint: 'JestVitestFilter' },
  { pattern: /^vitest\b/, family: 'vitest', filterHint: 'JestVitestFilter' },

  // TypeScript
  { pattern: /^(npx\s+)?tsc\b/, family: 'tsc', filterHint: 'TypeScriptFilter' },

  // ESLint
  { pattern: /^(npx\s+)?eslint\b/, family: 'eslint', filterHint: 'EslintFilter' },

  // Python
  { pattern: /^(python\s+-m\s+)?pytest\b/, family: 'pytest', filterHint: 'PytestFilter' },
  { pattern: /^python\s+.*\.py\b/, family: 'python-script', filterHint: 'GenericFilter' },
  { pattern: /^pip\s+(install|freeze|list)\b/, family: 'pip', filterHint: 'GenericFilter' },
  { pattern: /^(python\s+-m\s+)?mypy\b/, family: 'mypy', filterHint: 'GenericFilter' },
  { pattern: /^(python\s+-m\s+)?flake8\b/, family: 'flake8', filterHint: 'GenericFilter' },
  { pattern: /^(python\s+-m\s+)?black\b/, family: 'black', filterHint: 'GenericFilter' },
  { pattern: /^(python\s+-m\s+)?ruff\b/, family: 'ruff', filterHint: 'GenericFilter' },

  // Go
  { pattern: /^go\s+(test|build|vet|run)\b/, family: 'go', filterHint: 'GoFilter' },

  // Rust
  { pattern: /^cargo\s+(test|build|clippy|run|check)\b/, family: 'cargo', filterHint: 'CargoFilter' },

  // Java/JVM
  { pattern: /^(mvn|\.\/mvnw)\b/, family: 'maven', filterHint: 'MavenGradleFilter' },
  { pattern: /^(gradle|\.\/gradlew)\b/, family: 'gradle', filterHint: 'MavenGradleFilter' },

  // Docker
  { pattern: /^docker\s+(build|compose\s+build)\b/, family: 'docker-build', filterHint: 'DockerFilter' },
  { pattern: /^docker\s+compose\s+(up|down|logs)\b/, family: 'docker-compose', filterHint: 'DockerFilter' },
  { pattern: /^docker\s+logs\b/, family: 'docker-logs', filterHint: 'DockerFilter' },

  // Git (read-only operations)
  { pattern: /^git\s+(diff|log|show|status|branch)\b/, family: 'git', filterHint: 'GitDiffFilter' },

  // Playwright
  { pattern: /^(npx\s+)?playwright\s+test\b/, family: 'playwright', filterHint: 'PlaywrightFilter' },

  // Generic build/test commands
  { pattern: /^make\b/, family: 'make', filterHint: 'GenericFilter' },
  { pattern: /^cmake\b/, family: 'cmake', filterHint: 'GenericFilter' },
  { pattern: /^dotnet\s+(build|test|run|publish)\b/, family: 'dotnet', filterHint: 'GenericFilter' },

  // Shell utilities that produce output
  { pattern: /^(cat|head|tail|wc|find|ls|dir)\b/, family: 'shell-read', filterHint: 'GenericFilter' },
  { pattern: /^(grep|rg|ag|ack)\b/, family: 'search', filterHint: 'GenericFilter' },
  { pattern: /^curl\b/, family: 'curl', filterHint: 'GenericFilter' },
  { pattern: /^wget\b/, family: 'wget', filterHint: 'GenericFilter' },
];

export function classifyCommand(command: string): CommandEligibilityResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { eligible: false, reason: 'Empty command' };
  }

  // Check for bypass marker
  if (trimmed.includes('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1')) {
    return { eligible: false, reason: 'Bypass marker present' };
  }

  // Check for already-wrapped commands
  if (trimmed.startsWith('claui-run')) {
    return { eligible: false, reason: 'Already wrapped by claui-run' };
  }

  // Strip leading env vars and cd prefixes to get the actual command
  const baseCommand = stripCdPrefix(stripLeadingEnvVars(trimmed));

  // Check deny list
  for (const pattern of DENY_LIST) {
    if (pattern.test(baseCommand)) {
      return { eligible: false, reason: 'Command is on deny list (interactive/long-running)' };
    }
  }

  // Match against allow list for family classification (best-effort)
  for (const entry of ALLOW_LIST) {
    if (entry.pattern.test(baseCommand)) {
      return {
        eligible: true,
        reason: `Matched allow-list pattern for ${entry.family}`,
        filterHint: entry.filterHint,
        commandFamily: entry.family,
      };
    }
  }

  // Default: eligible with generic classification (deny-list-only approach)
  return {
    eligible: true,
    reason: 'Not on deny list',
    filterHint: 'GenericFilter',
    commandFamily: detectFamily(baseCommand),
  };
}

function stripLeadingEnvVars(command: string): string {
  return command.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)+/, '');
}

function stripCdPrefix(command: string): string {
  // Strip `cd /path &&` or `cd /path ;` prefixes so the actual command is classified
  return command.replace(/^cd\s+[^\s;|&]+\s*(?:&&|;)\s*/, '');
}

function detectFamily(command: string): string {
  const first = command.split(/\s/)[0].replace(/^.*[/\\]/, '');
  const known: Record<string, string> = {
    npm: 'npm', npx: 'npx', node: 'node', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun',
    git: 'git', python: 'python', pip: 'pip', pytest: 'pytest',
    cargo: 'cargo', go: 'go', make: 'make', docker: 'docker',
    tsc: 'tsc', eslint: 'eslint', jest: 'jest', vitest: 'vitest',
    ls: 'shell-read', dir: 'shell-read', cat: 'shell-read', find: 'shell-read',
    grep: 'search', rg: 'search', curl: 'curl', wget: 'wget',
  };
  return known[first] ?? 'unknown';
}
