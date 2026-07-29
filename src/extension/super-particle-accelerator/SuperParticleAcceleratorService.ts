import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  SuperParticleAcceleratorStatus,
  SuperParticleAcceleratorAuditEvent,
  SuperParticleAcceleratorException,
} from '../../shared/super-particle-accelerator/types';
import {
  getSuperParticleAcceleratorSettings,
  onSuperParticleAcceleratorSettingsChanged,
} from './SuperParticleAcceleratorSettings';
import { buildSpaEnv } from './SuperParticleAcceleratorEnvBuilder';
import { SuperParticleAcceleratorHookManager } from './SuperParticleAcceleratorHookManager';
import { SuperParticleAcceleratorAuditReader } from './SuperParticleAcceleratorAuditReader';
import { SpaExceptionStore } from './SpaExceptionStore';

export class SuperParticleAcceleratorService implements vscode.Disposable {
  private hookManager: SuperParticleAcceleratorHookManager;
  private auditReader: SuperParticleAcceleratorAuditReader;
  private exceptionStore: SpaExceptionStore;
  private disposables: vscode.Disposable[] = [];
  readonly storeDir: string;
  private hooksDir: string;
  private initialized = false;

  constructor(private context: vscode.ExtensionContext) {
    this.storeDir = path.join(context.globalStorageUri.fsPath, 'super-particle-accelerator');
    this.hooksDir = path.join(this.storeDir, 'runtime', 'hooks');
    fs.mkdirSync(this.storeDir, { recursive: true });

    this.hookManager = new SuperParticleAcceleratorHookManager(this.hooksDir);
    this.auditReader = new SuperParticleAcceleratorAuditReader(this.storeDir);
    this.exceptionStore = new SpaExceptionStore(this.storeDir);

    this.disposables.push(
      onSuperParticleAcceleratorSettingsChanged(s => this.onSettingsChanged(s))
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.installRuntime();

    // Reconcile on-disk state with the setting in BOTH directions, so stale
    // artifacts from a previous session can never keep enforcing (or keep
    // reporting) a state the user turned off.
    await this.reconcile();
  }

  /**
   * Make on-disk reality (workspace hooks + runtime-enabled.json) match the
   * current VS Code setting. Safe to call repeatedly.
   */
  async reconcile(): Promise<void> {
    const settings = getSuperParticleAcceleratorSettings();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // The runtime file does not depend on a workspace being open - write it
    // first so already-running agent processes see the truth immediately.
    this.writeRuntimeSettings(settings);

    if (!workspaceRoot) return;

    if (settings.enabled) {
      this.exceptionStore.prune();
      await this.activate(workspaceRoot);
    } else {
      await this.deactivate(workspaceRoot);
    }
  }

  async activate(workspaceRoot: string): Promise<void> {
    const settings = getSuperParticleAcceleratorSettings();
    if (settings.enabled) {
      await this.hookManager.installClaudeHook(workspaceRoot);
      await this.hookManager.installCodexHook(workspaceRoot);
    }
  }

  async deactivate(workspaceRoot: string): Promise<void> {
    await this.hookManager.uninstallClaudeHook(workspaceRoot);
    await this.hookManager.uninstallCodexHook(workspaceRoot);
  }

  isEnabled(): boolean {
    return getSuperParticleAcceleratorSettings().enabled;
  }

  async getStatus(workspaceRoot?: string): Promise<SuperParticleAcceleratorStatus> {
    const settings = getSuperParticleAcceleratorSettings();
    if (!settings.enabled) {
      // "Disabled" must mean nothing on disk still enforces. Stale hooks or a
      // stale runtime-enabled.json would keep blocking while the UI says Off,
      // so verify, self-heal once, and report drift if cleanup failed.
      if (await this.hasEnforcementResidue(workspaceRoot)) {
        try { await this.reconcile(); } catch { /* re-checked below */ }
        if (await this.hasEnforcementResidue(workspaceRoot)) {
          return 'disabled-drift';
        }
      }
      return 'disabled';
    }

    if (!workspaceRoot) return 'enabled-hooks-missing';

    try {
      return await this.hookManager.getStatus(workspaceRoot);
    } catch {
      return 'error';
    }
  }

  /** True when any on-disk artifact could still enforce SPA despite enabled=false. */
  private async hasEnforcementResidue(workspaceRoot?: string): Promise<boolean> {
    if (this.isRuntimeFileEnabled()) return true;
    if (!workspaceRoot) return false;
    return this.hookManager.hasAnySpaHook(workspaceRoot);
  }

  private isRuntimeFileEnabled(): boolean {
    try {
      const raw = fs.readFileSync(this.runtimeSettingsPath, 'utf8');
      return JSON.parse(raw).enabled === true;
    } catch {
      return false;
    }
  }

  buildAgentEnv(): Record<string, string> {
    return buildSpaEnv(getSuperParticleAcceleratorSettings(), this.storeDir);
  }

  async getAuditEvents(limit?: number): Promise<SuperParticleAcceleratorAuditEvent[]> {
    return this.auditReader.read(limit);
  }

  getActiveExceptions(): SuperParticleAcceleratorException[] {
    return this.exceptionStore.listActive();
  }

  createException(
    input: Omit<SuperParticleAcceleratorException, 'id' | 'createdAt' | 'usedCount'>,
  ): SuperParticleAcceleratorException {
    return this.exceptionStore.add(input);
  }

  deleteException(id: string): boolean {
    return this.exceptionStore.delete(id);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.installRuntime();
    }
    // reconcile() reads the current setting, which the caller updates before
    // invoking us; it writes the runtime file even without a workspace so a
    // mid-session disable always reaches running agent processes.
    await this.reconcile();
  }

  private async onSettingsChanged(
    settings: import('../../shared/super-particle-accelerator/types').SuperParticleAcceleratorSettings,
  ): Promise<void> {
    if (settings.enabled) {
      await this.installRuntime();
    }
    await this.reconcile();
  }

  private get runtimeSettingsPath(): string {
    return path.join(this.storeDir, 'runtime-enabled.json');
  }

  private writeRuntimeSettings(settings: import('../../shared/super-particle-accelerator/types').SuperParticleAcceleratorSettings): void {
    try {
      const data = {
        enabled: settings.enabled,
        mode: settings.mode,
        scanEditTools: settings.scanEditTools,
        scanBashCommands: settings.scanBashCommands,
        scanMcpTools: settings.scanMcpTools,
        scanWorkingTreeOnStop: settings.scanWorkingTreeOnStop,
        blockGitCommitPush: settings.blockGitCommitPush,
        allowIgnoredEnvFiles: settings.allowIgnoredEnvFiles,
        entropyThreshold: settings.entropyThreshold,
        frontendPathGlobs: settings.frontendPathGlobs,
        allowedSecretFileGlobs: settings.allowedSecretFileGlobs,
      };
      const tmpPath = `${this.runtimeSettingsPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
      fs.renameSync(tmpPath, this.runtimeSettingsPath);
    } catch { /* best-effort */ }
  }

  private async installRuntime(): Promise<void> {
    const distDir = path.join(this.context.extensionPath, 'dist', 'super-particle-accelerator-runtime', 'hooks');

    fs.mkdirSync(this.hooksDir, { recursive: true });

    const hookFiles = [
      { src: 'claude-spa.js', dest: 'claude-spa.js' },
      { src: 'codex-spa.js', dest: 'codex-spa.js' },
    ];

    for (const { src, dest } of hookFiles) {
      const srcPath = path.join(distDir, src);
      const destPath = path.join(this.hooksDir, dest);
      try {
        await fs.promises.copyFile(srcPath, destPath);
      } catch {
        // Hook files may not exist yet if not built
      }
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    // Best-effort cleanup of old baseline files
    try {
      const baselineDir = path.join(this.storeDir, 'baselines');
      if (fs.existsSync(baselineDir)) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(baselineDir);
        for (const file of files) {
          const filePath = path.join(baselineDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
              fs.unlinkSync(filePath);
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}
