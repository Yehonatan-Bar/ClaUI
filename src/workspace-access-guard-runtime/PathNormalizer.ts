import * as fs from 'fs';
import * as path from 'path';
import { NormalizedPathResult } from '../shared/workspace-access-guard/types';

const GIT_BASH_DRIVE_RE = /^\/([a-zA-Z])(\/.*)?$/;
const WSL_DRIVE_RE = /^\/mnt\/([a-zA-Z])(\/.*)?$/;
const WIN_ENV_RE = /%([^%]+)%/g;
const UNIX_ENV_RE = /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const TILDE_RE = /^~(?=[/\\]|$)/;

export function normalizePath(
  input: string,
  cwd: string,
  env: Record<string, string | undefined>,
): NormalizedPathResult {
  const warnings: string[] = [];
  const original = input.trim();
  let expanded = original;

  expanded = expandTilde(expanded, env);
  expanded = expandEnvVars(expanded, env);
  expanded = convertGitBashPath(expanded);
  expanded = convertWslPath(expanded);
  expanded = expanded.replace(/\//g, '\\');

  let absolutePath: string;
  if (path.win32.isAbsolute(expanded)) {
    absolutePath = path.win32.normalize(expanded);
  } else {
    const normalizedCwd = cwd.replace(/\//g, '\\');
    absolutePath = path.win32.resolve(normalizedCwd, expanded);
  }

  absolutePath = absolutePath.replace(/\\+$/, '');
  if (/^[a-zA-Z]:$/.test(absolutePath)) {
    absolutePath += '\\';
  }

  let realPath: string | undefined;
  let exists = false;
  let kind: 'file' | 'directory' | 'unknown' = 'unknown';

  try {
    realPath = fs.realpathSync.native(absolutePath);
    exists = true;
    try {
      const stat = fs.statSync(absolutePath);
      kind = stat.isDirectory() ? 'directory' : 'file';
    } catch { /* ignore */ }
  } catch {
    const resolved = resolveNearestExistingParent(absolutePath);
    if (resolved.parentReal) {
      realPath = path.win32.join(resolved.parentReal, resolved.suffix);
    }
    if (resolved.isSymlinkTraversal) {
      warnings.push('Path traverses a symlink or junction');
    }
  }

  const comparisonPath = (realPath ?? absolutePath).toLowerCase();

  return {
    original,
    expanded,
    absolutePath,
    realPath,
    comparisonPath,
    exists,
    kind,
    warnings,
  };
}

export function normalizeMany(
  inputs: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): NormalizedPathResult[] {
  return inputs.map(input => normalizePath(input, cwd, env));
}

export function normalizeDeniedRoots(
  deniedRoots: Array<{ path: string; enabled: boolean }>,
  env: Record<string, string | undefined>,
): Array<{ comparisonPath: string; isGlob: boolean; original: string; regex?: RegExp }> {
  const results: Array<{ comparisonPath: string; isGlob: boolean; original: string; regex?: RegExp }> = [];
  for (const root of deniedRoots) {
    if (!root.enabled) continue;
    let expanded = root.path;
    expanded = expandEnvVars(expanded, env);
    expanded = expanded.replace(/\//g, '\\');

    const isGlob = expanded.includes('*');
    const regex = isGlob ? globPatternToRegex(expanded) : undefined;
    let cleaned = expanded.replace(/\\\*\*$/, '').replace(/\\?\*$/, '');
    cleaned = cleaned.replace(/\\+$/, '');

    if (!path.win32.isAbsolute(cleaned)) continue;

    let compPath: string;
    try {
      compPath = fs.realpathSync.native(cleaned).toLowerCase();
    } catch {
      compPath = path.win32.normalize(cleaned).toLowerCase();
    }

    results.push({ comparisonPath: compPath, isGlob, original: root.path, regex });
  }
  return results;
}

function expandTilde(input: string, env: Record<string, string | undefined>): string {
  const home = env.USERPROFILE ?? env.HOME ?? (env.HOMEDRIVE && env.HOMEPATH
    ? `${env.HOMEDRIVE}${env.HOMEPATH}` : undefined);
  if (!home) return input;
  return input.replace(TILDE_RE, home);
}

function expandEnvVars(input: string, env: Record<string, string | undefined>): string {
  let result = input.replace(WIN_ENV_RE, (match, name) => env[name] ?? match);
  result = result.replace(UNIX_ENV_RE, (match, braced, bare) => {
    const name = braced || bare;
    return env[name] ?? match;
  });
  return result;
}

function convertGitBashPath(input: string): string {
  const m = GIT_BASH_DRIVE_RE.exec(input);
  if (m) {
    return `${m[1].toUpperCase()}:${m[2] ?? '\\'}`;
  }
  return input;
}

function convertWslPath(input: string): string {
  const m = WSL_DRIVE_RE.exec(input);
  if (m) {
    return `${m[1].toUpperCase()}:${m[2] ?? '\\'}`;
  }
  return input;
}

function resolveNearestExistingParent(
  targetPath: string,
): { parentReal: string | undefined; suffix: string; isSymlinkTraversal: boolean } {
  let current = targetPath;
  const suffixParts: string[] = [];
  let isSymlinkTraversal = false;

  for (let i = 0; i < 50; i++) {
    const parent = path.win32.dirname(current);
    if (parent === current) break;

    try {
      const real = fs.realpathSync.native(parent);
      if (real.toLowerCase() !== parent.toLowerCase()) {
        isSymlinkTraversal = true;
      }
      const suffix = suffixParts.reverse().join('\\');
      return { parentReal: real, suffix, isSymlinkTraversal };
    } catch {
      suffixParts.push(path.win32.basename(current));
      current = parent;
    }
  }

  return { parentReal: undefined, suffix: '', isSymlinkTraversal: false };
}

export function isPathInsideRoot(target: string, root: string): boolean {
  const normalizedTarget = target.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
  const normalizedRoot = root.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');

  if (normalizedTarget === normalizedRoot) return true;

  const relative = path.win32.relative(normalizedRoot, normalizedTarget);
  return relative !== '' && !relative.startsWith('..') && !path.win32.isAbsolute(relative);
}

function globPatternToRegex(pattern: string): RegExp {
  let normalized = path.win32.normalize(pattern.replace(/\//g, '\\')).toLowerCase();
  normalized = normalized.replace(/\\+$/, '');

  const trailingRecursive = normalized.endsWith('\\**');
  if (trailingRecursive) {
    normalized = normalized.slice(0, -3);
  }

  let source = '^';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^\\\\]*';
      }
      continue;
    }
    if (ch === '\\') {
      source += '\\\\';
      continue;
    }
    source += escapeRegexChar(ch);
  }

  if (trailingRecursive) {
    source += '(?:\\\\.*)?';
  }

  source += '$';
  return new RegExp(source, 'i');
}

function escapeRegexChar(ch: string): string {
  return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}
