/**
 * DiagnosticsCollector - collects system/environment info and recent logs
 * for bug reports. Pure utility, no state.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export interface DiagnosticsSummary {
  os: string;
  vsCodeVersion: string;
  extensionVersion: string;
  nodeVersion: string;
  claudeCliVersion: string | null;
  codexCliVersion: string | null;
  logFileCount: number;
  logTotalSize: number;
}

export interface DiagnosticsResult {
  systemInfo: string;
  recentLogs: string;
  /** Full paths of log files included in the report */
  logFilePaths: string[];
  summary: DiagnosticsSummary;
}

const MAX_LOGS_BYTES = 512 * 1024; // 500KB cap for logs
const LOG_RECENCY_MS = 30 * 60 * 1000; // 30 minutes
const CLI_TIMEOUT_MS = 5_000;

function execVersion(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: CLI_TIMEOUT_MS, shell: true }, (err, stdout) => {
        if (err) { resolve(null); return; }
        resolve(stdout.trim().split('\n')[0] || null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function collectDiagnostics(
  extensionVersion: string,
  logDir: string,
): Promise<DiagnosticsResult> {
  // Collect CLI versions in parallel
  const [claudeVer, codexVer] = await Promise.all([
    execVersion('claude', ['--version']),
    execVersion('codex', ['--version']),
  ]);

  const summary: DiagnosticsSummary = {
    os: `${process.platform} ${os.release()} (${os.arch()})`,
    vsCodeVersion: vscode.version,
    extensionVersion,
    nodeVersion: process.version,
    claudeCliVersion: claudeVer,
    codexCliVersion: codexVer,
    logFileCount: 0,
    logTotalSize: 0,
  };

  // Build system info text
  const lines = [
    '=== ClaUi Bug Report Diagnostics ===',
    `Date: ${new Date().toISOString()}`,
    '',
    '--- System ---',
    `OS: ${summary.os}`,
    `VS Code: ${summary.vsCodeVersion}`,
    `ClaUi Extension: ${summary.extensionVersion}`,
    `Node.js: ${summary.nodeVersion}`,
    `Claude CLI: ${claudeVer ?? 'not found'}`,
    `Codex CLI: ${codexVer ?? 'not found'}`,
    '',
    '--- VS Code ---',
    `Language: ${vscode.env.language}`,
    `Shell: ${vscode.env.shell}`,
    `App Host: ${vscode.env.appHost}`,
    `Remote Name: ${vscode.env.remoteName ?? 'none'}`,
    '',
    '--- Workspace ---',
    `Folders: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') ?? 'none'}`,
    '',
    '--- ClaUi Settings ---',
    ...getClaUiSettings(),
  ];

  // Collect recent logs
  const { text: recentLogs, fileCount, totalSize, filePaths } = collectRecentLogs(logDir);
  summary.logFileCount = fileCount;
  summary.logTotalSize = totalSize;

  return {
    systemInfo: lines.join('\n'),
    recentLogs,
    logFilePaths: filePaths,
    summary,
  };
}

function getClaUiSettings(): string[] {
  const config = vscode.workspace.getConfiguration('claudeMirror');
  const keys = [
    'cliPath', 'model', 'permissionMode', 'autoNameSessions',
    'restoreSessionsOnStartup',
    'sessionVitals', 'adventureWidget', 'weatherWidget', 'chatFontSize', 'typingTheme',
  ];
  return keys.map(k => `  ${k}: ${JSON.stringify(config.get(k))}`);
}

function collectRecentLogs(logDir: string): { text: string; fileCount: number; totalSize: number; filePaths: string[] } {
  if (!logDir || !fs.existsSync(logDir)) {
    return { text: '(no log directory found)', fileCount: 0, totalSize: 0, filePaths: [] };
  }

  const cutoff = Date.now() - LOG_RECENCY_MS;
  let files: Array<{ name: string; fullPath: string; mtime: number; size: number }>;

  try {
    files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const fullPath = path.join(logDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, fullPath, mtime: stat.mtimeMs, size: stat.size };
      })
      .filter(f => f.mtime >= cutoff)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return { text: '(failed to read log directory)', fileCount: 0, totalSize: 0, filePaths: [] };
  }

  if (files.length === 0) {
    return { text: '(no recent log files in the last 30 minutes)', fileCount: 0, totalSize: 0, filePaths: [] };
  }

  const parts: string[] = [];
  const includedPaths: string[] = [];
  let totalSize = 0;

  for (const f of files) {
    if (totalSize >= MAX_LOGS_BYTES) break;
    try {
      const content = fs.readFileSync(f.fullPath, 'utf-8');
      const trimmed = content.slice(-(MAX_LOGS_BYTES - totalSize));
      parts.push(`\n=== ${f.name} ===\n${trimmed}`);
      totalSize += trimmed.length;
      includedPaths.push(f.fullPath);
    } catch {
      parts.push(`\n=== ${f.name} === (read error)`);
    }
  }

  return { text: parts.join('\n'), fileCount: files.length, totalSize, filePaths: includedPaths };
}
