import * as fs from 'fs';
import * as path from 'path';
import { ParticleAcceleratorRuntimePaths, ParticleAcceleratorSettings } from './ParticleAcceleratorTypes';

const MANAGED_MARKER = '--claui-managed-hook';

export class ParticleAcceleratorHookManager {
  constructor(
    private runtimePaths: ParticleAcceleratorRuntimePaths,
    private settings: ParticleAcceleratorSettings,
  ) {}

  async installClaudeHook(workspacePath: string): Promise<void> {
    const settingsDir = path.join(workspacePath, '.claude');
    const settingsFile = path.join(settingsDir, 'settings.json');

    await ensureDir(settingsDir);

    let data: Record<string, unknown> = {};
    if (await fileExists(settingsFile)) {
      const raw = await fs.promises.readFile(settingsFile, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `Cannot install hook: ${settingsFile} contains invalid JSON. ` +
          'Please fix the file manually or delete it to start fresh.',
        );
      }

      // Create backup
      const backupFile = `${settingsFile}.claui-backup-${Date.now()}`;
      await fs.promises.writeFile(backupFile, raw, 'utf8');
    }

    // Build hook entry
    const hookCommand = `node "${path.join(this.runtimePaths.hooksDir, 'claude-pre-tool-use.js')}" ${MANAGED_MARKER} claude-pre-tool-use`;

    const hookEntry = {
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: hookCommand,
      }],
    };

    // Merge into settings
    if (!data.hooks) data.hooks = {};
    const hooks = data.hooks as Record<string, unknown[]>;
    if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];

    // Don't duplicate
    const existing = hooks.PreToolUse as Array<Record<string, unknown>>;
    const alreadyInstalled = existing.some(entry => {
      const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
      return entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' claude-pre-tool-use'));
    });

    if (!alreadyInstalled) {
      existing.push(hookEntry);
    }

    await fs.promises.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async uninstallClaudeHook(workspacePath: string): Promise<void> {
    const settingsFile = path.join(workspacePath, '.claude', 'settings.json');

    if (!await fileExists(settingsFile)) return;

    const raw = await fs.promises.readFile(settingsFile, 'utf8');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const hooks = data.hooks as Record<string, unknown[]> | undefined;
    if (!hooks?.PreToolUse || !Array.isArray(hooks.PreToolUse)) return;

    hooks.PreToolUse = (hooks.PreToolUse as Array<Record<string, unknown>>).filter(entry => {
      const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
      return !entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' claude-pre-tool-use'));
    });

    if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
    if (Object.keys(hooks).length === 0) delete data.hooks;

    await fs.promises.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async isClaudeHookInstalled(workspacePath: string): Promise<boolean> {
    const settingsFile = path.join(workspacePath, '.claude', 'settings.json');
    try {
      const raw = await fs.promises.readFile(settingsFile, 'utf8');
      const data = JSON.parse(raw);
      const hooks = data.hooks?.PreToolUse as Array<Record<string, unknown>> | undefined;
      if (!hooks) return false;
      return hooks.some(entry => {
        const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
        return entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' claude-pre-tool-use'));
      });
    } catch {
      return false;
    }
  }

  async installCodexHook(workspacePath: string): Promise<void> {
    const hooksDir = path.join(workspacePath, '.codex');
    const hooksFile = path.join(hooksDir, 'hooks.json');

    await ensureDir(hooksDir);

    let data: Record<string, unknown> = {};
    if (await fileExists(hooksFile)) {
      const raw = await fs.promises.readFile(hooksFile, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `Cannot install hook: ${hooksFile} contains invalid JSON. ` +
          'Please fix the file manually or delete it to start fresh.',
        );
      }

      const backupFile = `${hooksFile}.claui-backup-${Date.now()}`;
      await fs.promises.writeFile(backupFile, raw, 'utf8');
    }

    const hookCommand = `node "${path.join(this.runtimePaths.hooksDir, 'codex-pre-tool-use.js')}" ${MANAGED_MARKER} codex-pre-tool-use`;

    const hookEntry = {
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: hookCommand,
      }],
    };

    if (!data.hooks) data.hooks = {};
    const hooks = data.hooks as Record<string, unknown[]>;
    if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];

    const existing = hooks.PreToolUse as Array<Record<string, unknown>>;
    const alreadyInstalled = existing.some(entry => {
      const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
      return entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' codex-pre-tool-use'));
    });

    if (!alreadyInstalled) {
      existing.push(hookEntry);
    }

    await fs.promises.writeFile(hooksFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async uninstallCodexHook(workspacePath: string): Promise<void> {
    const hooksFile = path.join(workspacePath, '.codex', 'hooks.json');

    if (!await fileExists(hooksFile)) return;

    const raw = await fs.promises.readFile(hooksFile, 'utf8');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const hooks = data.hooks as Record<string, unknown[]> | undefined;
    if (!hooks?.PreToolUse || !Array.isArray(hooks.PreToolUse)) return;

    hooks.PreToolUse = (hooks.PreToolUse as Array<Record<string, unknown>>).filter(entry => {
      const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
      return !entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' codex-pre-tool-use'));
    });

    if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
    if (Object.keys(hooks).length === 0) delete data.hooks;

    await fs.promises.writeFile(hooksFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async isCodexHookInstalled(workspacePath: string): Promise<boolean> {
    const hooksFile = path.join(workspacePath, '.codex', 'hooks.json');
    try {
      const raw = await fs.promises.readFile(hooksFile, 'utf8');
      const data = JSON.parse(raw);
      const hooks = data.hooks?.PreToolUse as Array<Record<string, unknown>> | undefined;
      if (!hooks) return false;
      return hooks.some(entry => {
        const entryHooks = entry.hooks as Array<Record<string, string>> | undefined;
        return entryHooks?.some(h => h.command?.includes(MANAGED_MARKER + ' codex-pre-tool-use'));
      });
    } catch {
      return false;
    }
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
