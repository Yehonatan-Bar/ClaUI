import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ParticleAcceleratorRuntimePaths, CLAUI_PARTICLE_ACCELERATOR_VERSION } from './ParticleAcceleratorTypes';

export class ParticleAcceleratorInstaller {
  constructor(
    private globalStorageUri: vscode.Uri,
    private extensionUri: vscode.Uri,
  ) {}

  async ensureRuntime(): Promise<ParticleAcceleratorRuntimePaths> {
    const baseDir = path.join(this.globalStorageUri.fsPath, 'particle-accelerator', 'runtime');
    const binDir = path.join(baseDir, 'bin');
    const hooksDir = path.join(baseDir, 'hooks');
    const storeDir = path.join(this.globalStorageUri.fsPath, 'particle-accelerator', 'store');
    const versionFile = path.join(baseDir, 'version.json');

    // Check current version
    const currentVersion = await this.readVersion(versionFile);
    const extensionVersion = CLAUI_PARTICLE_ACCELERATOR_VERSION;

    const runtimeSourceDir = path.join(this.extensionUri.fsPath, 'dist', 'particle-accelerator-runtime');
    const runnerJs = path.join(baseDir, 'cli.js');

    if (currentVersion !== extensionVersion) {
      // Create directory structure
      await ensureDir(baseDir);
      await ensureDir(binDir);
      await ensureDir(hooksDir);
      await ensureDir(storeDir);
      await ensureDir(path.join(storeDir, 'contexts'));
      await ensureDir(path.join(storeDir, 'traces'));
      await ensureDir(path.join(storeDir, 'raw'));
      await ensureDir(path.join(storeDir, 'reports'));
      await ensureDir(path.join(storeDir, 'config'));

      // Copy runtime files
      await copyFile(path.join(runtimeSourceDir, 'cli.js'), runnerJs);
      await copyFile(
        path.join(runtimeSourceDir, 'hooks', 'claude-pre-tool-use.js'),
        path.join(hooksDir, 'claude-pre-tool-use.js'),
      );
      await copyFile(
        path.join(runtimeSourceDir, 'hooks', 'codex-pre-tool-use.js'),
        path.join(hooksDir, 'codex-pre-tool-use.js'),
      );

      // Generate launcher scripts
      await this.generateLaunchers(binDir, runnerJs);

      // Create default filter config if missing
      const filterConfigPath = path.join(storeDir, 'config', 'filters.json');
      if (!await fileExists(filterConfigPath)) {
        await fs.promises.writeFile(filterConfigPath, JSON.stringify({
          budgetOverrides: {},
          extraImportantPatterns: [],
          disabledFilters: [],
        }, null, 2), 'utf8');
      }

      // Write version
      await fs.promises.writeFile(versionFile, JSON.stringify({
        version: extensionVersion,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
    }

    return { binDir, runnerJs, hooksDir, storeDir };
  }

  async isInstalled(): Promise<boolean> {
    const versionFile = path.join(
      this.globalStorageUri.fsPath, 'particle-accelerator', 'runtime', 'version.json',
    );
    return fileExists(versionFile);
  }

  async getVersion(): Promise<string | null> {
    const versionFile = path.join(
      this.globalStorageUri.fsPath, 'particle-accelerator', 'runtime', 'version.json',
    );
    return this.readVersion(versionFile);
  }

  async cleanRuntime(): Promise<void> {
    const baseDir = path.join(this.globalStorageUri.fsPath, 'particle-accelerator');
    try {
      await fs.promises.rm(baseDir, { recursive: true, force: true });
    } catch {
      // Already gone
    }
  }

  private async readVersion(versionFile: string): Promise<string | null> {
    try {
      const raw = await fs.promises.readFile(versionFile, 'utf8');
      const data = JSON.parse(raw);
      return data.version ?? null;
    } catch {
      return null;
    }
  }

  private async generateLaunchers(binDir: string, runnerJs: string): Promise<void> {
    const isWindows = process.platform === 'win32';

    // Unix launcher (use forward slashes for Git Bash / MSYS2 compatibility)
    const unixRunnerPath = runnerJs.replace(/\\/g, '/');
    const unixScript = `#!/usr/bin/env sh\nexec node "${unixRunnerPath}" "$@"\n`;
    const unixPath = path.join(binDir, 'claui-run');
    await fs.promises.writeFile(unixPath, unixScript, 'utf8');

    if (!isWindows) {
      await fs.promises.chmod(unixPath, 0o755);
    }

    // Windows launcher
    const winScript = `@echo off\nnode "${runnerJs}" %*\n`;
    await fs.promises.writeFile(path.join(binDir, 'claui-run.cmd'), winScript, 'utf8');
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

async function copyFile(src: string, dest: string): Promise<void> {
  await fs.promises.copyFile(src, dest);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
