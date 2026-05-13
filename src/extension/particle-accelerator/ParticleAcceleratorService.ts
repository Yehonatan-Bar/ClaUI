import * as vscode from 'vscode';
import {
  ParticleAcceleratorStatus, ParticleAcceleratorRuntimePaths, ParticleAcceleratorEnvInput,
  ParticleAcceleratorSettings,
} from './ParticleAcceleratorTypes';
import { getParticleAcceleratorSettings, onSettingsChanged } from './ParticleAcceleratorSettings';
import { ParticleAcceleratorInstaller } from './ParticleAcceleratorInstaller';
import { ParticleAcceleratorContextStore } from './ParticleAcceleratorContextStore';
import { ParticleAcceleratorTraceReader } from './ParticleAcceleratorTraceReader';
import { ParticleAcceleratorDailyReportGenerator } from './ParticleAcceleratorDailyReportGenerator';
import { ParticleAcceleratorHookManager } from './ParticleAcceleratorHookManager';
import { buildParticleAcceleratorAgentEnv } from './ParticleAcceleratorEnvBuilder';

export class ParticleAcceleratorService implements vscode.Disposable {
  private settings: ParticleAcceleratorSettings;
  private installer: ParticleAcceleratorInstaller;
  private runtimePaths: ParticleAcceleratorRuntimePaths | null = null;
  private contextStore: ParticleAcceleratorContextStore | null = null;
  private traceReader: ParticleAcceleratorTraceReader | null = null;
  private hookManager: ParticleAcceleratorHookManager | null = null;
  private reportGenerator: ParticleAcceleratorDailyReportGenerator | null = null;
  private disposables: vscode.Disposable[] = [];
  private nodeAvailable = false;
  private cachedClaudeHookInstalled = false;
  private cachedCodexHookInstalled = false;
  private error: string | null = null;
  private log: (msg: string) => void;

  constructor(
    private context: vscode.ExtensionContext,
    logger?: (msg: string) => void,
  ) {
    this.settings = getParticleAcceleratorSettings();
    this.installer = new ParticleAcceleratorInstaller(context.globalStorageUri, context.extensionUri);
    this.log = logger ?? (() => {});
  }

  async initialize(): Promise<void> {
    if (!this.settings.enabled) {
      this.log('[ParticleAccelerator] Disabled by settings');
      return;
    }

    try {
      // Verify Node.js is available
      this.nodeAvailable = await this.checkNodeAvailable();
      if (!this.nodeAvailable) {
        this.error = 'Node.js not found in PATH';
        this.log('[ParticleAccelerator] Error: Node.js not found');
        return;
      }

      // Install/update runtime
      this.runtimePaths = await this.installer.ensureRuntime();
      this.log(`[ParticleAccelerator] Runtime installed at ${this.runtimePaths.binDir}`);

      // Determine store directory
      const storeDir = this.getStoreDir();

      // Create services
      this.contextStore = new ParticleAcceleratorContextStore(storeDir);
      this.traceReader = new ParticleAcceleratorTraceReader(storeDir);
      this.hookManager = new ParticleAcceleratorHookManager(this.runtimePaths, this.settings);
      this.reportGenerator = new ParticleAcceleratorDailyReportGenerator(storeDir, this.traceReader);

      // Generate yesterday's report if missing
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      void this.reportGenerator.generateIfMissing(yesterday).catch(() => {});

      // Schedule retention cleanup
      void this.traceReader.cleanExpired(this.settings).then(result => {
        if (result.deletedTraces + result.deletedRawLogs + result.deletedReports > 0) {
          this.log(`[ParticleAccelerator] Cleanup: deleted ${result.deletedTraces} traces, ${result.deletedRawLogs} raw logs, ${result.deletedReports} reports (freed ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB)`);
        }
      }).catch(() => {});

      // Listen for settings changes
      this.disposables.push(onSettingsChanged(newSettings => {
        this.settings = newSettings;
        if (this.hookManager) {
          this.hookManager = new ParticleAcceleratorHookManager(this.runtimePaths!, newSettings);
        }
      }));

      this.error = null;
      this.log('[ParticleAccelerator] Initialized successfully');
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.log(`[ParticleAccelerator] Initialization failed: ${this.error}`);
    }
  }

  isEnabled(): boolean {
    return this.settings.enabled && this.runtimePaths !== null;
  }

  getStatus(): ParticleAcceleratorStatus {
    return {
      enabled: this.settings.enabled,
      installed: this.runtimePaths !== null,
      version: this.runtimePaths ? '1.0.0' : null,
      claudeHookInstalled: this.cachedClaudeHookInstalled,
      codexHookInstalled: this.cachedCodexHookInstalled,
      codexMode: this.settings.codexMode,
      nodeAvailable: this.nodeAvailable,
      error: this.error,
    };
  }

  async refreshHookStatus(): Promise<void> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath || !this.hookManager) return;
    this.cachedClaudeHookInstalled = await this.hookManager.isClaudeHookInstalled(workspacePath);
    this.cachedCodexHookInstalled = await this.hookManager.isCodexHookInstalled(workspacePath);
  }

  getRuntimePaths(): ParticleAcceleratorRuntimePaths | null {
    return this.runtimePaths;
  }

  getSettings(): ParticleAcceleratorSettings {
    return this.settings;
  }

  buildAgentEnv(input: ParticleAcceleratorEnvInput): NodeJS.ProcessEnv {
    return buildParticleAcceleratorAgentEnv(input);
  }

  getContextStore(): ParticleAcceleratorContextStore | null {
    return this.contextStore;
  }

  getTraceReader(): ParticleAcceleratorTraceReader | null {
    return this.traceReader;
  }

  getHookManager(): ParticleAcceleratorHookManager | null {
    return this.hookManager;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('claudeMirror.particleAccelerator')
      .update('enabled', enabled, vscode.ConfigurationTarget.Global);
    this.settings = { ...this.settings, enabled };
    if (enabled && !this.runtimePaths) {
      await this.initialize();
    }
  }

  dispose(): void {
    // Generate partial day report on shutdown
    if (this.reportGenerator && this.settings.enabled) {
      const today = new Date().toISOString().slice(0, 10);
      void this.reportGenerator.generateIfMissing(today).catch(() => {});
    }

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  private getStoreDir(): string {
    if (this.settings.workspaceLocalStorage) {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspacePath) {
        return require('path').join(workspacePath, '.claui', 'particle-accelerator');
      }
    }
    return this.runtimePaths?.storeDir ?? require('path').join(
      this.context.globalStorageUri.fsPath, 'particle-accelerator', 'store',
    );
  }

  private async checkNodeAvailable(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('node --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
