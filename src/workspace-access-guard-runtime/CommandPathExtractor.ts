import { CommandPathExtractionResult, CommandAccessKind } from '../shared/workspace-access-guard/types';

const MAX_COMMAND_LENGTH = 256 * 1024;

const RECURSIVE_READ_COMMANDS = new Set([
  'grep', 'rg', 'ripgrep', 'find', 'fd', 'ag', 'ack', 'tree',
  'Get-ChildItem', 'gci', 'dir',
]);

const FILE_READ_COMMANDS = new Set([
  'cat', 'type', 'more', 'less', 'head', 'tail', 'wc',
  'bat', 'Get-Content', 'gc', 'Select-String', 'sls',
  'ls', 'stat', 'file',
]);

const FILE_WRITE_COMMANDS = new Set([
  'tee', 'Set-Content', 'sc', 'Add-Content', 'ac',
  'Out-File', 'New-Item', 'ni', 'touch',
]);

const FILE_DELETE_COMMANDS = new Set([
  'rm', 'del', 'erase', 'rmdir', 'rd',
  'Remove-Item', 'ri',
]);

const FILE_MOVE_COPY_COMMANDS = new Set([
  'cp', 'copy', 'xcopy', 'robocopy', 'mv', 'move', 'ren', 'rename',
  'Copy-Item', 'ci', 'Move-Item', 'mi',
]);

const GIT_COMMANDS = new Set([
  'git', 'gh',
]);

const BUILD_TEST_COMMANDS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'node', 'python', 'python3', 'py',
  'pip', 'pip3', 'cargo', 'rustc', 'go', 'make', 'cmake',
  'dotnet', 'msbuild', 'tsc', 'tsx', 'jest', 'vitest', 'mocha',
  'pytest', 'unittest',
]);

const NO_FILE_ACCESS_COMMANDS = new Set([
  'echo', 'printf', 'date', 'whoami', 'hostname', 'uname',
  'which', 'where', 'env', 'set', 'export', 'alias',
  'true', 'false', 'exit', 'cd', 'pwd', 'pushd', 'popd',
  'sleep', 'clear', 'cls',
]);

const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'fetch', 'ssh', 'scp', 'sftp', 'rsync',
  'ftp', 'Invoke-WebRequest', 'iwr', 'Invoke-RestMethod', 'irm',
]);

const REDIRECT_RE = /(?:>>?|[12]>>?)\s*("[^"]*"|'[^']*'|\S+)/g;
const SED_INPLACE_RE = /\bsed\s+-i\b/;
const PERL_INPLACE_RE = /\bperl\s+-(?:p|n)?i\b/;

const PATH_LIKE_RE = /^(?:[A-Za-z]:[\\\/]|\/[a-zA-Z]\/|\/mnt\/[a-zA-Z]\/|~[\/\\]|%[A-Za-z_]+%|\$[A-Za-z_]|\.\.?[\/\\]|\\\\[^\\]+\\)/;

export function extractCommandPaths(command: string, cwd: string): CommandPathExtractionResult {
  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      accessKind: 'unknown-file-access',
      paths: [],
      cwdIsTarget: false,
      confidence: 'low',
      reasons: ['Command exceeds maximum parse length'],
    };
  }

  const stripped = stripShellPreamble(command);
  const parts = splitCommandPipeline(stripped);
  const allPaths: string[] = [];
  let accessKind: CommandAccessKind = 'no-file-access';
  let cwdIsTarget = false;
  const reasons: string[] = [];
  let confidence: 'low' | 'medium' | 'high' = 'high';

  for (const part of parts) {
    const result = extractSingleCommand(part, cwd);
    for (const p of result.paths) {
      if (!allPaths.includes(p)) allPaths.push(p);
    }
    if (result.cwdIsTarget) cwdIsTarget = true;
    reasons.push(...result.reasons);
    if (priorityOf(result.accessKind) > priorityOf(accessKind)) {
      accessKind = result.accessKind;
    }
    if (result.confidence === 'low') confidence = 'low';
    else if (result.confidence === 'medium' && confidence === 'high') confidence = 'medium';
  }

  const redirectPaths = extractRedirectPaths(stripped);
  for (const rp of redirectPaths) {
    if (!allPaths.includes(rp)) allPaths.push(rp);
    if (priorityOf('file-write') > priorityOf(accessKind)) {
      accessKind = 'file-write';
    }
    reasons.push(`Redirect target: ${rp}`);
  }

  if (SED_INPLACE_RE.test(stripped) || PERL_INPLACE_RE.test(stripped)) {
    if (priorityOf('file-write') > priorityOf(accessKind)) {
      accessKind = 'file-write';
    }
  }

  return { accessKind, paths: allPaths, cwdIsTarget, confidence, reasons };
}

function extractSingleCommand(command: string, cwd: string): CommandPathExtractionResult {
  const tokens = tokenize(command);
  if (tokens.length === 0) {
    return { accessKind: 'no-file-access', paths: [], cwdIsTarget: false, confidence: 'high', reasons: [] };
  }

  const baseCommand = getBaseCommand(tokens[0]);
  const args = tokens.slice(1);

  if (NO_FILE_ACCESS_COMMANDS.has(baseCommand)) {
    return { accessKind: 'no-file-access', paths: [], cwdIsTarget: false, confidence: 'high', reasons: [] };
  }

  if (NETWORK_COMMANDS.has(baseCommand)) {
    return { accessKind: 'network-or-exfiltration', paths: [], cwdIsTarget: false, confidence: 'medium', reasons: [`Network command: ${baseCommand}`] };
  }

  if (GIT_COMMANDS.has(baseCommand)) {
    return handleGitCommand(args, cwd);
  }

  if (RECURSIVE_READ_COMMANDS.has(baseCommand)) {
    return handleRecursiveReadCommand(baseCommand, args, cwd);
  }

  if (FILE_READ_COMMANDS.has(baseCommand)) {
    return handleFileReadCommand(baseCommand, args, cwd);
  }

  if (FILE_WRITE_COMMANDS.has(baseCommand)) {
    return handleFileWriteCommand(baseCommand, args, cwd);
  }

  if (FILE_DELETE_COMMANDS.has(baseCommand)) {
    return handleFileDeleteCommand(args, cwd);
  }

  if (FILE_MOVE_COPY_COMMANDS.has(baseCommand)) {
    return handleFileMoveCopyCommand(args, cwd);
  }

  if (BUILD_TEST_COMMANDS.has(baseCommand)) {
    return { accessKind: 'build-or-test', paths: [], cwdIsTarget: true, confidence: 'medium', reasons: [`Build/test: ${baseCommand}`] };
  }

  const pathArgs = args.filter(a => looksLikePath(a));
  if (pathArgs.length > 0) {
    return {
      accessKind: 'unknown-file-access',
      paths: pathArgs.map(a => cleanPathArg(a)),
      cwdIsTarget: false,
      confidence: 'low',
      reasons: [`Unknown command with path-like arguments: ${baseCommand}`],
    };
  }

  return {
    accessKind: 'unknown-file-access',
    paths: [],
    cwdIsTarget: true,
    confidence: 'low',
    reasons: [`Unknown command may access files: ${baseCommand}`],
  };
}

function handleRecursiveReadCommand(
  cmd: string,
  args: string[],
  cwd: string,
): CommandPathExtractionResult {
  const pathArgs: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (looksLikePath(arg)) {
      pathArgs.push(cleanPathArg(arg));
    } else if (!arg.includes(' ') && (arg.includes('/') || arg.includes('\\'))) {
      pathArgs.push(cleanPathArg(arg));
    }
  }

  const cwdIsTarget = pathArgs.length === 0;
  if (cwdIsTarget) {
    pathArgs.push(cwd);
  }

  return {
    accessKind: 'recursive-file-read',
    paths: pathArgs,
    cwdIsTarget,
    confidence: 'high',
    reasons: [`Recursive search: ${cmd}`],
  };
}

function handleFileReadCommand(
  cmd: string,
  args: string[],
  _cwd: string,
): CommandPathExtractionResult {
  const pathArgs = extractNonFlagPaths(args);
  return {
    accessKind: 'file-read',
    paths: pathArgs,
    cwdIsTarget: pathArgs.length === 0,
    confidence: pathArgs.length > 0 ? 'high' : 'medium',
    reasons: [`File read: ${cmd}`],
  };
}

function handleFileWriteCommand(
  cmd: string,
  args: string[],
  _cwd: string,
): CommandPathExtractionResult {
  const pathArgs = extractNonFlagPaths(args);
  return {
    accessKind: 'file-write',
    paths: pathArgs,
    cwdIsTarget: pathArgs.length === 0,
    confidence: pathArgs.length > 0 ? 'high' : 'medium',
    reasons: [`File write: ${cmd}`],
  };
}

function handleFileDeleteCommand(
  args: string[],
  _cwd: string,
): CommandPathExtractionResult {
  const pathArgs = extractNonFlagPaths(args);
  return {
    accessKind: 'file-delete',
    paths: pathArgs,
    cwdIsTarget: false,
    confidence: pathArgs.length > 0 ? 'high' : 'medium',
    reasons: ['File delete'],
  };
}

function handleFileMoveCopyCommand(
  args: string[],
  _cwd: string,
): CommandPathExtractionResult {
  const pathArgs = extractNonFlagPaths(args);
  return {
    accessKind: 'file-move-copy',
    paths: pathArgs,
    cwdIsTarget: false,
    confidence: pathArgs.length > 0 ? 'high' : 'medium',
    reasons: ['File move/copy'],
  };
}

function handleGitCommand(
  args: string[],
  cwd: string,
): CommandPathExtractionResult {
  const pathArgs: string[] = [];
  let afterDashDash = false;

  for (const arg of args) {
    if (arg === '--') {
      afterDashDash = true;
      continue;
    }
    if (afterDashDash && looksLikePath(arg)) {
      pathArgs.push(cleanPathArg(arg));
    }
  }

  return {
    accessKind: 'git-operation',
    paths: pathArgs.length > 0 ? pathArgs : [cwd],
    cwdIsTarget: pathArgs.length === 0,
    confidence: 'high',
    reasons: ['Git operation'],
  };
}

function extractNonFlagPaths(args: string[]): string[] {
  const paths: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const cleaned = cleanPathArg(arg);
    if (cleaned) paths.push(cleaned);
  }
  return paths;
}

function extractRedirectPaths(command: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  REDIRECT_RE.lastIndex = 0;
  while ((match = REDIRECT_RE.exec(command)) !== null) {
    const target = cleanPathArg(match[1]);
    if (target) paths.push(target);
  }
  return paths;
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingleQuote) {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(ch) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function splitCommandPipeline(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (inSingle || inDouble) { current += ch; continue; }

    if (ch === '(' || ch === '{') { depth++; current += ch; continue; }
    if (ch === ')' || ch === '}') { depth--; current += ch; continue; }

    if (depth === 0 && (ch === '|' || ch === ';' || ch === '&')) {
      if (ch === '&' && command[i + 1] === '&') {
        parts.push(current.trim());
        current = '';
        i++;
        continue;
      }
      if (ch === '|' && command[i + 1] === '|') {
        parts.push(current.trim());
        current = '';
        i++;
        continue;
      }
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function getBaseCommand(token: string): string {
  const basename = token.replace(/^.*[/\\]/, '');
  return basename.replace(/\.exe$/i, '').replace(/\.cmd$/i, '').replace(/\.bat$/i, '');
}

function cleanPathArg(arg: string): string {
  return arg.replace(/^["']|["']$/g, '').trim();
}

function looksLikePath(arg: string): boolean {
  const cleaned = cleanPathArg(arg);
  if (!cleaned) return false;
  if (cleaned.startsWith('-')) return false;
  if (PATH_LIKE_RE.test(cleaned)) return true;
  if (/[/\\]/.test(cleaned) && !cleaned.startsWith('http')) return true;
  return false;
}

function priorityOf(kind: CommandAccessKind): number {
  const map: Record<CommandAccessKind, number> = {
    'no-file-access': 0,
    'build-or-test': 1,
    'git-operation': 2,
    'network-or-exfiltration': 3,
    'file-read': 4,
    'recursive-file-read': 5,
    'file-move-copy': 6,
    'file-write': 7,
    'file-delete': 8,
    'unknown-file-access': 9,
  };
  return map[kind] ?? 5;
}

function stripShellPreamble(cmd: string): string {
  return cmd.replace(/^(?:bash\s+-c\s+|sh\s+-c\s+|cmd\s+\/c\s+)/i, '').trim();
}
