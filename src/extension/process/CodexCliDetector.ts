/**
 * CodexCliDetector - standalone utility for finding and verifying Codex CLI installations.
 *
 * Extracted from CodexMessageHandler so that both CodexSessionTab (runtime missing-CLI
 * recovery) and CodexMessageHandler (auto-setup / auto-detect UI flows) share the same
 * detection logic.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';

export interface CodexCliCandidate {
  path: string;
  source: 'path' | 'official-extension-bundled' | 'npm-prefix' | 'common-location';
  version?: string;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function execShellCommand(
  command: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const rawCode = (err as { code?: unknown } | null)?.code;
        resolve({
          ok: !err,
          code: typeof rawCode === 'number' ? rawCode : err ? null : 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim() || (err ? err.message : ''),
        });
      },
    );
  });
}

export function quoteForShell(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return 'codex';
  }
  if (!/[\\/\s"]/u.test(trimmed)) {
    return trimmed;
  }
  if (process.platform === 'win32') {
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  return `'${trimmed.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

export async function probeCodexCliVersion(cliPath: string): Promise<string | null> {
  const quoted = quoteForShell(cliPath);
  const result = await execShellCommand(`${quoted} --version`, 10000);
  if (!result.ok) {
    return null;
  }
  const line = result.stdout.split(/\r?\n/).find((s) => s.trim())?.trim();
  return line || 'codex-cli';
}

async function probeCodexCliExecCapability(cliPath: string): Promise<boolean> {
  const quoted = quoteForShell(cliPath);
  const result = await execShellCommand(`${quoted} exec --help`, 10000);
  if (result.ok) {
    return true;
  }
  const combined = `${result.stderr} ${result.stdout}`.toLowerCase();
  const fatalPatterns = [
    /the system cannot find the (path|file) specified/i,
    /\bno such file or directory\b/i,
  ];
  if (fatalPatterns.some((p) => p.test(combined))) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Candidate discovery
// ---------------------------------------------------------------------------

function findBundledEditorCodexCliCandidates(): string[] {
  const home = os.homedir();
  const roots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.windsurf', 'extensions'),
  ];
  const matches: string[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      if (!(name.startsWith('openai.chatgpt-') || name.startsWith('openai.codex-') || name.includes('openai'))) {
        continue;
      }
      const base = path.join(root, entry.name, 'bin');
      if (!fs.existsSync(base)) continue;
      try {
        const platformDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const pdir of platformDirs) {
          const binDir = path.join(base, pdir.name);
          const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
          for (const candidateName of names) {
            const full = path.join(binDir, candidateName);
            if (fs.existsSync(full)) {
              matches.push(full);
            }
          }
        }
      } catch {
        // ignore broken extension dir
      }
    }
  }
  return matches;
}

function findCommonCodexCliLocations(): string[] {
  const locations: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const userProfile = process.env.USERPROFILE || os.homedir();
    const localApp = process.env.LOCALAPPDATA || '';
    locations.push(
      path.join(appData, 'npm', 'codex.cmd'),
      path.join(appData, 'npm', 'codex'),
      path.join(appData, 'npm', 'codex.exe'),
      path.join(userProfile, '.npm-global', 'bin', 'codex.cmd'),
      path.join(userProfile, '.npm-global', 'bin', 'codex.exe'),
      path.join(localApp, 'Programs', 'Codex', 'codex.exe'),
      path.join(localApp, 'Programs', 'OpenAI Codex', 'codex.exe'),
    );
  } else {
    locations.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', path.join(os.homedir(), '.local', 'bin', 'codex'));
  }
  return locations.filter((p) => !!p && fs.existsSync(p));
}

async function findNpmPrefixCodexCandidates(): Promise<string[]> {
  const result = await execShellCommand('npm config get prefix', 10000);
  const prefix = result.stdout?.split(/\r?\n/)[0]?.trim();
  if (!result.ok || !prefix) {
    return [];
  }
  const candidates =
    process.platform === 'win32'
      ? [path.join(prefix, 'codex.cmd'), path.join(prefix, 'codex.exe'), path.join(prefix, 'codex')]
      : [path.join(prefix, 'bin', 'codex'), path.join(prefix, 'codex')];
  return candidates.filter((p) => fs.existsSync(p));
}

async function findCodexCliCandidates(
  options?: { includeNpmPrefixFallback?: boolean },
): Promise<CodexCliCandidate[]> {
  const candidates: CodexCliCandidate[] = [];
  const seen = new Set<string>();
  const add = (pathValue: string, source: CodexCliCandidate['source']) => {
    const normalized = pathValue.trim();
    if (!normalized) return;
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ path: normalized, source });
  };

  // Prefer PATH shorthand if available.
  if (await probeCodexCliVersion('codex')) {
    add('codex', 'path');
  }

  const pathCommand = process.platform === 'win32' ? 'where.exe codex' : 'command -v codex || which codex';
  const pathResult = await execShellCommand(pathCommand, 5000);
  if (pathResult.stdout) {
    for (const line of pathResult.stdout.split(/\r?\n/)) {
      add(line, 'path');
    }
  }

  for (const bundled of findBundledEditorCodexCliCandidates()) {
    add(bundled, 'official-extension-bundled');
  }

  for (const common of findCommonCodexCliLocations()) {
    add(common, 'common-location');
  }

  if (options?.includeNpmPrefixFallback) {
    for (const npmCandidate of await findNpmPrefixCodexCandidates()) {
      add(npmCandidate, 'npm-prefix');
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for working Codex CLI executables across PATH, bundled editor
 * extensions, common install locations, and (optionally) npm prefix.
 * Each candidate is verified with `codex --version`; extension-bundled
 * binaries also pass an `exec --help` smoke test.
 */
export async function findWorkingCodexCliCandidates(
  options?: { includeNpmPrefixFallback?: boolean },
): Promise<CodexCliCandidate[]> {
  const rawCandidates = await findCodexCliCandidates(options);
  const verified: CodexCliCandidate[] = [];
  for (const candidate of rawCandidates) {
    const version = await probeCodexCliVersion(candidate.path);
    if (!version) {
      continue;
    }
    if (candidate.source === 'official-extension-bundled') {
      const execOk = await probeCodexCliExecCapability(candidate.path);
      if (!execOk) {
        continue;
      }
    }
    verified.push({ ...candidate, version });
  }
  // De-dupe by path while preserving order.
  return verified.filter(
    (c, idx, arr) => arr.findIndex((x) => x.path.toLowerCase() === c.path.toLowerCase()) === idx,
  );
}

/**
 * Given a list of verified candidates, pick the best one using a scoring
 * heuristic (prefers `codex` shorthand, then `.cmd` wrappers, then PATH sources).
 */
export function pickPreferredCodexCliCandidate(candidates: CodexCliCandidate[]): CodexCliCandidate {
  const score = (c: CodexCliCandidate): number => {
    const p = c.path.toLowerCase();
    let s = 0;
    if (p === 'codex') s += 200;
    if (p.endsWith('codex.cmd')) s += 120;
    if (p.includes('\\appdata\\roaming\\npm\\')) s += 100;
    if (c.source === 'path') s += 50;
    if (c.source === 'official-extension-bundled') s += 10;
    // Prefer non-alpha versions when possible
    if (c.version && !/alpha|beta|rc/i.test(c.version)) s += 20;
    return s;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}
