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
  // ── JavaScript / Node ──────────────────────────────────────────────
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

  // ── TypeScript / ESLint ────────────────────────────────────────────
  { pattern: /^(npx\s+)?tsc\b/, family: 'tsc', filterHint: 'TypeScriptFilter' },
  { pattern: /^(npx\s+)?eslint\b/, family: 'eslint', filterHint: 'EslintFilter' },

  // ── Python ─────────────────────────────────────────────────────────
  { pattern: /^(python3?\s+-m\s+)?pytest\b/, family: 'pytest', filterHint: 'PytestFilter' },
  { pattern: /^python3?\s+.*\.py\b/, family: 'python-script', filterHint: 'GenericFilter' },
  { pattern: /^pip3?\s+(install|freeze|list)\b/, family: 'pip', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?mypy\b/, family: 'mypy', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?flake8\b/, family: 'flake8', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?black\b/, family: 'black', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?ruff\b/, family: 'ruff', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?pylint\b/, family: 'pylint', filterHint: 'DeclarativeFilter' },
  { pattern: /^(python3?\s+-m\s+)?unittest\b/, family: 'python-unittest', filterHint: 'DeclarativeFilter' },
  { pattern: /^(basedpyright|pyright)\b/, family: 'pyright', filterHint: 'DeclarativeFilter' },
  { pattern: /^uv\s+(sync|pip)\b/, family: 'uv', filterHint: 'DeclarativeFilter' },

  // ── Go ─────────────────────────────────────────────────────────────
  { pattern: /^go\s+(test|build|vet|run|install)\b/, family: 'go', filterHint: 'DeclarativeFilter' },
  { pattern: /^go\s+mod\s+(tidy|download|vendor)\b/, family: 'go-mod', filterHint: 'DeclarativeFilter' },
  { pattern: /^golangci-lint\b/, family: 'golangci-lint', filterHint: 'DeclarativeFilter' },

  // ── Rust / Cargo ───────────────────────────────────────────────────
  { pattern: /^cargo\s+(test|build|clippy|run|check|fmt|install)\b/, family: 'cargo', filterHint: 'DeclarativeFilter' },

  // ── Java / JVM ─────────────────────────────────────────────────────
  { pattern: /^(mvn|\.\/mvnw)\b/, family: 'maven', filterHint: 'DeclarativeFilter' },
  { pattern: /^(gradle|\.\/gradlew)\b/, family: 'gradle', filterHint: 'DeclarativeFilter' },

  // ── .NET ───────────────────────────────────────────────────────────
  { pattern: /^dotnet\s+(build|test|run|publish|restore)\b/, family: 'dotnet', filterHint: 'DeclarativeFilter' },

  // ── Docker ─────────────────────────────────────────────────────────
  { pattern: /^docker\s+(build|buildx)\b/, family: 'docker-build', filterHint: 'DeclarativeFilter' },
  { pattern: /^docker\s+compose\s+(up|down|build|logs|restart|stop|start)\b/, family: 'docker-compose', filterHint: 'DeclarativeFilter' },
  { pattern: /^docker\s+(push|pull)\b/, family: 'docker-push-pull', filterHint: 'DeclarativeFilter' },
  { pattern: /^docker\s+(ps|images|logs|image\s+ls|container\s+ls)\b/, family: 'docker', filterHint: 'DeclarativeFilter' },

  // ── Git ────────────────────────────────────────────────────────────
  { pattern: /^git\s+(diff|log|show|status|branch|blame|stash|merge)\b/, family: 'git', filterHint: 'GitSemanticFilter' },
  { pattern: /^git\s+(add|commit|push|pull|fetch|checkout|switch|rebase|cherry-pick|tag|remote|worktree)\b/, family: 'git', filterHint: 'GenericFilter' },

  // ── Kubernetes / Helm ──────────────────────────────────────────────
  { pattern: /^kubectl\s+(get|describe|apply|create|delete|logs|top|patch|replace)\b/, family: 'kubectl', filterHint: 'DeclarativeFilter' },
  { pattern: /^helm\s+(install|upgrade|list|status|template|rollback|uninstall)\b/, family: 'helm', filterHint: 'DeclarativeFilter' },

  // ── Cloud / Infrastructure ─────────────────────────────────────────
  { pattern: /^terraform\s+(plan|apply|destroy|init|validate|fmt)\b/, family: 'terraform', filterHint: 'DeclarativeFilter' },
  { pattern: /^tofu\s+(plan|apply|destroy|init|validate|fmt)\b/, family: 'tofu', filterHint: 'DeclarativeFilter' },
  { pattern: /^aws\s+/, family: 'aws', filterHint: 'DeclarativeFilter' },
  { pattern: /^gcloud\s+/, family: 'gcloud', filterHint: 'DeclarativeFilter' },
  { pattern: /^ansible-playbook\b/, family: 'ansible', filterHint: 'DeclarativeFilter' },
  { pattern: /^ansible\s+/, family: 'ansible', filterHint: 'DeclarativeFilter' },

  // ── C / C++ ────────────────────────────────────────────────────────
  { pattern: /^(gcc|g\+\+|clang|clang\+\+)\b/, family: 'gcc', filterHint: 'DeclarativeFilter' },
  { pattern: /^cmake\b/, family: 'cmake', filterHint: 'DeclarativeFilter' },

  // ── Playwright ─────────────────────────────────────────────────────
  { pattern: /^(npx\s+)?playwright\s+test\b/, family: 'playwright', filterHint: 'DeclarativeFilter' },

  // ── Linters / Formatters ───────────────────────────────────────────
  { pattern: /^(npx\s+)?prettier\b/, family: 'prettier', filterHint: 'DeclarativeFilter' },
  { pattern: /^(npx\s+)?biome\b/, family: 'biome', filterHint: 'DeclarativeFilter' },
  { pattern: /^markdownlint\b/, family: 'markdownlint', filterHint: 'DeclarativeFilter' },
  { pattern: /^yamllint\b/, family: 'yamllint', filterHint: 'DeclarativeFilter' },
  { pattern: /^shellcheck\b/, family: 'shellcheck', filterHint: 'DeclarativeFilter' },

  // ── Next.js / Vite / Prisma ────────────────────────────────────────
  { pattern: /^(npx\s+)?next\s+build\b/, family: 'next-build', filterHint: 'DeclarativeFilter' },
  { pattern: /^(npx\s+)?vite\s+build\b/, family: 'vite-build', filterHint: 'DeclarativeFilter' },
  { pattern: /^(npx\s+)?prisma\s+(generate|migrate|db|validate|format)\b/, family: 'prisma', filterHint: 'DeclarativeFilter' },

  // ── Task runners / Monorepo ────────────────────────────────────────
  { pattern: /^(npx\s+)?turbo\b/, family: 'turbo', filterHint: 'DeclarativeFilter' },
  { pattern: /^(npx\s+)?nx\s+/, family: 'nx', filterHint: 'DeclarativeFilter' },
  { pattern: /^just\b/, family: 'just', filterHint: 'DeclarativeFilter' },
  { pattern: /^pre-commit\s+run\b/, family: 'pre-commit', filterHint: 'DeclarativeFilter' },

  // ── Swift / Xcode ──────────────────────────────────────────────────
  { pattern: /^swift\s+(build|test|run)\b/, family: 'swift', filterHint: 'DeclarativeFilter' },
  { pattern: /^xcodebuild\b/, family: 'xcodebuild', filterHint: 'DeclarativeFilter' },

  // ── Package managers ───────────────────────────────────────────────
  { pattern: /^brew\s+(install|upgrade|update)\b/, family: 'brew', filterHint: 'DeclarativeFilter' },
  { pattern: /^composer\s+(install|update|require)\b/, family: 'composer', filterHint: 'DeclarativeFilter' },

  // ── Misc tools ─────────────────────────────────────────────────────
  { pattern: /^ping\b/, family: 'ping', filterHint: 'DeclarativeFilter' },
  { pattern: /^rsync\b/, family: 'rsync', filterHint: 'DeclarativeFilter' },
  { pattern: /^(du|df)\b/, family: 'disk-usage', filterHint: 'DeclarativeFilter' },

  // ── Generic build / shell ──────────────────────────────────────────
  { pattern: /^make\b/, family: 'make', filterHint: 'DeclarativeFilter' },
  { pattern: /^(cat|head|tail|wc|find|ls|dir)\b/, family: 'shell-read', filterHint: 'GenericFilter' },
  { pattern: /^(grep|rg|ag|ack)\b/, family: 'search', filterHint: 'GenericFilter' },
  { pattern: /^curl\b/, family: 'curl', filterHint: 'DeclarativeFilter' },
  { pattern: /^wget\b/, family: 'wget', filterHint: 'DeclarativeFilter' },
];

export function classifyCommand(command: string): CommandEligibilityResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { eligible: false, reason: 'Empty command' };
  }

  if (trimmed.includes('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1')) {
    return { eligible: false, reason: 'Bypass marker present' };
  }

  if (trimmed.startsWith('claui-run')) {
    return { eligible: false, reason: 'Already wrapped by claui-run' };
  }

  // Reject output redirections (PA would interfere with intended file I/O)
  if (/(?:^|[^|2>&])\s*>{1,2}\s*[^&]/.test(trimmed) || /\s<\s/.test(trimmed)) {
    return { eligible: false, reason: 'Command uses output redirection' };
  }

  // Reject command substitutions
  if (/\$\(/.test(trimmed) || /`[^`]+`/.test(trimmed)) {
    return { eligible: false, reason: 'Command uses command substitution' };
  }

  // Strip prefixes for classification
  const stripped = stripCdPrefix(stripLeadingEnvVars(trimmed));
  // Strip pipe suffix for allow-list matching (pipes still execute correctly)
  const baseCommand = stripPipeSuffix(stripped);

  // Check deny list against ALL segments: pipes (|), chains (&&, ||), and sequences (;)
  const allSegments = stripped.split(/\s*(?:\|{1,2}|&&|;)\s*/);
  for (const segment of allSegments) {
    const segTrimmed = stripLeadingEnvVars(segment.trim());
    if (!segTrimmed) continue;
    for (const pattern of DENY_LIST) {
      if (pattern.test(segTrimmed)) {
        return { eligible: false, reason: 'Command is on deny list (interactive/long-running)' };
      }
    }
  }

  // Match against allow list using pipe-stripped command
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

  // Default: eligible with generic classification
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
  return command.replace(/^cd\s+[^\s;|&]+\s*(?:&&|;)\s*/, '');
}

function stripPipeSuffix(command: string): string {
  return command.replace(/\s*\|.*$/, '').trim();
}

function detectFamily(command: string): string {
  const first = command.split(/\s/)[0].replace(/^.*[/\\]/, '');
  const known: Record<string, string> = {
    npm: 'npm', npx: 'npx', node: 'node', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun',
    git: 'git', python: 'python', python3: 'python', pip: 'pip', pip3: 'pip', pytest: 'pytest',
    cargo: 'cargo', go: 'go', make: 'make', docker: 'docker',
    tsc: 'tsc', eslint: 'eslint', jest: 'jest', vitest: 'vitest',
    dotnet: 'dotnet', kubectl: 'kubectl', helm: 'helm',
    terraform: 'terraform', tofu: 'tofu', aws: 'aws', gcloud: 'gcloud',
    ansible: 'ansible', gcc: 'gcc', 'g++': 'gcc', clang: 'gcc', cmake: 'cmake',
    mvn: 'maven', gradle: 'gradle', javac: 'javac',
    swift: 'swift', xcodebuild: 'xcodebuild',
    ruff: 'ruff', mypy: 'mypy', black: 'black', flake8: 'flake8', pylint: 'pylint',
    prettier: 'prettier', biome: 'biome',
    golangci: 'golangci-lint',
    brew: 'brew', composer: 'composer',
    turbo: 'turbo', nx: 'nx', just: 'just',
    ping: 'ping', curl: 'curl', wget: 'wget', rsync: 'rsync',
    ls: 'shell-read', dir: 'shell-read', cat: 'shell-read', find: 'shell-read',
    grep: 'search', rg: 'search',
  };
  return known[first] ?? 'unknown';
}
