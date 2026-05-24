import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorStatus } from '../../shared/super-particle-accelerator/types';

const SPA_MARKER = '--claui-spa-hook';
const PA_MARKER = '--claui-managed-hook';

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

export class SuperParticleAcceleratorHookManager {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

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
          `Cannot install SPA hook: ${settingsFile} contains invalid JSON.`,
        );
      }
      const backupFile = `${settingsFile}.claui-backup-${Date.now()}`;
      await fs.promises.writeFile(backupFile, raw, 'utf8');
    }

    const hookScript = path.join(this.hooksDir, 'claude-spa.js');

    if (!data.hooks) data.hooks = {};
    const hooks = data.hooks as Record<string, unknown[]>;

    // PreToolUse hooks
    if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];
    const preToolUse = hooks.PreToolUse as HookEntry[];

    this.installHookEntry(preToolUse, {
      matcher: 'Edit|Write|MultiEdit',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });
    this.installHookEntry(preToolUse, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });
    this.installHookEntry(preToolUse, {
      matcher: 'mcp__.*',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });

    // PostToolUse hooks
    if (!Array.isArray(hooks.PostToolUse)) hooks.PostToolUse = [];
    const postToolUse = hooks.PostToolUse as HookEntry[];

    this.installHookEntry(postToolUse, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PostToolUse` }],
    });

    // Stop hooks
    if (!Array.isArray(hooks.Stop)) hooks.Stop = [];
    const stop = hooks.Stop as HookEntry[];

    this.installHookEntry(stop, {
      matcher: '',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} Stop` }],
    });

    await fs.promises.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async uninstallClaudeHook(workspacePath: string): Promise<void> {
    const settingsFile = path.join(workspacePath, '.claude', 'settings.json');
    if (!await fileExists(settingsFile)) return;

    const raw = await fs.promises.readFile(settingsFile, 'utf8');
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }

    const hooks = data.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return;

    for (const eventKey of ['PreToolUse', 'PostToolUse', 'Stop']) {
      if (Array.isArray(hooks[eventKey])) {
        hooks[eventKey] = (hooks[eventKey] as HookEntry[]).filter(entry =>
          !entry.hooks?.some(h => h.command?.includes(SPA_MARKER))
        );
        if ((hooks[eventKey] as unknown[]).length === 0) delete hooks[eventKey];
      }
    }

    if (Object.keys(hooks).length === 0) delete data.hooks;
    await fs.promises.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async isClaudeHookInstalled(workspacePath: string): Promise<boolean> {
    const settingsFile = path.join(workspacePath, '.claude', 'settings.json');
    try {
      const raw = await fs.promises.readFile(settingsFile, 'utf8');
      const data = JSON.parse(raw);
      const hooks = data.hooks;
      if (!hooks) return false;

      const hasSpaWithMatcher = (eventKey: string, matcher?: string) => {
        const entries = hooks[eventKey] as HookEntry[] | undefined;
        if (!entries) return false;
        return entries.some(entry =>
          entry.hooks?.some(h => h.command?.includes(SPA_MARKER)) &&
          (matcher === undefined || entry.matcher === matcher)
        );
      };

      return (
        hasSpaWithMatcher('PreToolUse', 'Edit|Write|MultiEdit') &&
        hasSpaWithMatcher('PreToolUse', 'Bash') &&
        hasSpaWithMatcher('PreToolUse', 'mcp__.*') &&
        hasSpaWithMatcher('PostToolUse', 'Bash') &&
        hasSpaWithMatcher('Stop', '')
      );
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
      try { data = JSON.parse(raw); } catch {
        throw new Error(`Cannot install SPA hook: ${hooksFile} contains invalid JSON.`);
      }
      const backupFile = `${hooksFile}.claui-backup-${Date.now()}`;
      await fs.promises.writeFile(backupFile, raw, 'utf8');
    }

    const hookScript = path.join(this.hooksDir, 'codex-spa.js');

    if (!data.hooks) data.hooks = {};
    const hooks = data.hooks as Record<string, unknown[]>;

    if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];
    const preToolUse = hooks.PreToolUse as HookEntry[];

    this.installHookEntry(preToolUse, {
      matcher: 'Edit|Write|MultiEdit|apply_patch',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });
    this.installHookEntry(preToolUse, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });
    this.installHookEntry(preToolUse, {
      matcher: 'mcp__.*',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PreToolUse` }],
    });

    // PermissionRequest hooks (Codex-specific, Bash approval)
    if (!Array.isArray(hooks.PermissionRequest)) hooks.PermissionRequest = [];
    const permissionRequest = hooks.PermissionRequest as HookEntry[];

    this.installHookEntry(permissionRequest, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PermissionRequest` }],
    });

    // PostToolUse hooks (scan Bash output for echoed secrets)
    if (!Array.isArray(hooks.PostToolUse)) hooks.PostToolUse = [];
    const postToolUse = hooks.PostToolUse as HookEntry[];

    this.installHookEntry(postToolUse, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} PostToolUse` }],
    });

    if (!Array.isArray(hooks.Stop)) hooks.Stop = [];
    const stop = hooks.Stop as HookEntry[];

    this.installHookEntry(stop, {
      matcher: '',
      hooks: [{ type: 'command', command: `node "${hookScript}" ${SPA_MARKER} Stop` }],
    });

    await fs.promises.writeFile(hooksFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async uninstallCodexHook(workspacePath: string): Promise<void> {
    const hooksFile = path.join(workspacePath, '.codex', 'hooks.json');
    if (!await fileExists(hooksFile)) return;

    const raw = await fs.promises.readFile(hooksFile, 'utf8');
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }

    const hooks = data.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return;

    for (const eventKey of ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop']) {
      if (Array.isArray(hooks[eventKey])) {
        hooks[eventKey] = (hooks[eventKey] as HookEntry[]).filter(entry =>
          !entry.hooks?.some(h => h.command?.includes(SPA_MARKER))
        );
        if ((hooks[eventKey] as unknown[]).length === 0) delete hooks[eventKey];
      }
    }

    if (Object.keys(hooks).length === 0) delete data.hooks;
    await fs.promises.writeFile(hooksFile, JSON.stringify(data, null, 2), 'utf8');
  }

  async isCodexHookInstalled(workspacePath: string): Promise<boolean> {
    const hooksFile = path.join(workspacePath, '.codex', 'hooks.json');
    try {
      const raw = await fs.promises.readFile(hooksFile, 'utf8');
      const data = JSON.parse(raw);
      const hooks = data.hooks;
      if (!hooks) return false;

      const hasSpaWithMatcher = (eventKey: string, matcher?: string) => {
        const entries = hooks[eventKey] as HookEntry[] | undefined;
        if (!entries) return false;
        return entries.some(entry =>
          entry.hooks?.some(h => h.command?.includes(SPA_MARKER)) &&
          (matcher === undefined || entry.matcher === matcher)
        );
      };

      return (
        hasSpaWithMatcher('PreToolUse', 'Edit|Write|MultiEdit|apply_patch') &&
        hasSpaWithMatcher('PreToolUse', 'Bash') &&
        hasSpaWithMatcher('PreToolUse', 'mcp__.*') &&
        hasSpaWithMatcher('PermissionRequest', 'Bash') &&
        hasSpaWithMatcher('PostToolUse', 'Bash') &&
        hasSpaWithMatcher('Stop', '')
      );
    } catch {
      return false;
    }
  }

  async getStatus(workspacePath: string): Promise<SuperParticleAcceleratorStatus> {
    const claudeInstalled = await this.isClaudeHookInstalled(workspacePath);
    const codexInstalled = await this.isCodexHookInstalled(workspacePath);

    if (claudeInstalled && codexInstalled) {
      // Verify ordering (SPA before PA)
      const orderOk = await this.verifySpaBeforePa(workspacePath);
      return orderOk ? 'enabled-hooks-installed' : 'enabled-partial-coverage';
    }

    if (claudeInstalled || codexInstalled) {
      return 'enabled-partial-coverage';
    }

    return 'enabled-hooks-missing';
  }

  private async verifySpaBeforePa(workspacePath: string): Promise<boolean> {
    const checkFile = async (filePath: string): Promise<boolean> => {
      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const data = JSON.parse(raw);
        const hooks = data.hooks;
        if (!hooks) return true;

        for (const eventKey of Object.keys(hooks)) {
          const entries = hooks[eventKey] as HookEntry[] | undefined;
          if (!Array.isArray(entries)) continue;

          const spaIdx = entries.findIndex(e =>
            e.hooks?.some(h => h.command?.includes(SPA_MARKER)));
          const paIdx = entries.findIndex(e =>
            e.hooks?.some(h => h.command?.includes(PA_MARKER)));

          if (spaIdx !== -1 && paIdx !== -1 && spaIdx > paIdx) return false;
        }
        return true;
      } catch {
        return true;
      }
    };

    const claudeOk = await checkFile(path.join(workspacePath, '.claude', 'settings.json'));
    const codexOk = await checkFile(path.join(workspacePath, '.codex', 'hooks.json'));
    return claudeOk && codexOk;
  }

  // Insert SPA hook entry BEFORE any PA hooks
  private installHookEntry(hooksArray: HookEntry[], newEntry: HookEntry): void {
    const alreadyInstalled = hooksArray.some(entry =>
      entry.matcher === newEntry.matcher &&
      entry.hooks?.some(h => h.command?.includes(SPA_MARKER) &&
        h.command?.includes(newEntry.hooks[0].command.split(SPA_MARKER)[1]))
    );
    if (alreadyInstalled) return;

    const paIndex = hooksArray.findIndex(entry =>
      entry.hooks?.some(h => h.command?.includes(PA_MARKER))
    );

    if (paIndex === -1) {
      hooksArray.push(newEntry);
    } else {
      hooksArray.splice(paIndex, 0, newEntry);
    }
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
