import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  WorkspaceAccessGuardStatus,
  WorkspaceAccessAuditEvent,
  WorkspaceAccessOrgPolicyStatus,
  WorkspaceAccessAllowedRootView,
  WorkspaceAccessDecision,
  WorkspaceAccessOrgPolicy,
  WorkspaceAccessGuardSettings,
  WorkspaceAccessPolicyInput,
} from '../../shared/workspace-access-guard/types';
import {
  getWorkspaceAccessGuardSettings,
  onWorkspaceAccessGuardSettingsChanged,
} from './WorkspaceAccessGuardSettings';
import { buildWagEnv } from './WorkspaceAccessGuardEnvBuilder';
import { WorkspaceAccessGuardHookManager } from './WorkspaceAccessGuardHookManager';
import { WorkspaceAccessGuardAuditReader } from './WorkspaceAccessGuardAuditReader';
import { UserAllowedRootsStore } from './UserAllowedRootsStore';
import { OrgPolicyLoader } from './OrgPolicyLoader';
import { evaluate } from '../../workspace-access-guard-runtime/PathPolicyEngine';
import { checkBroadRoot } from '../../workspace-access-guard-runtime/PathPolicyEngine';
import { isHardDeniedBroadRoot } from '../../workspace-access-guard-runtime/PathPolicyEngine';
import { extractCommandPaths } from '../../workspace-access-guard-runtime/CommandPathExtractor';
import { normalizePath } from '../../workspace-access-guard-runtime/PathNormalizer';

export class WorkspaceAccessGuardService implements vscode.Disposable {
  private hookManager: WorkspaceAccessGuardHookManager;
  private auditReader: WorkspaceAccessGuardAuditReader;
  private allowedRootsStore: UserAllowedRootsStore;
  private orgPolicyLoader: OrgPolicyLoader;
  private disposables: vscode.Disposable[] = [];
  readonly storeDir: string;
  private hooksDir: string;
  private initialized = false;

  constructor(private context: vscode.ExtensionContext) {
    this.storeDir = path.join(context.globalStorageUri.fsPath, 'workspace-access-guard');
    this.hooksDir = path.join(this.storeDir, 'runtime', 'hooks');
    fs.mkdirSync(this.storeDir, { recursive: true });

    this.hookManager = new WorkspaceAccessGuardHookManager(this.hooksDir);
    this.auditReader = new WorkspaceAccessGuardAuditReader(this.storeDir);
    this.allowedRootsStore = new UserAllowedRootsStore(this.storeDir);

    const settings = getWorkspaceAccessGuardSettings();
    this.orgPolicyLoader = new OrgPolicyLoader(settings.orgPolicyPath);

    this.disposables.push(
      onWorkspaceAccessGuardSettingsChanged(s => this.onSettingsChanged(s))
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.installRuntime();

    const settings = getWorkspaceAccessGuardSettings();
    if (settings.enabled) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        await this.activate(workspaceRoot);
      }
    }
  }

  async activate(workspaceRoot: string): Promise<void> {
    const settings = getWorkspaceAccessGuardSettings();
    if (settings.enabled) {
      await this.hookManager.installClaudeHook(workspaceRoot);
      await this.hookManager.installCodexHook(workspaceRoot);
      this.writeRuntimeSettings(settings);
    }
  }

  async deactivate(workspaceRoot: string): Promise<void> {
    await this.hookManager.uninstallClaudeHook(workspaceRoot);
    await this.hookManager.uninstallCodexHook(workspaceRoot);
    this.deleteRuntimeSettings();
  }

  isEnabled(): boolean {
    return getWorkspaceAccessGuardSettings().enabled;
  }

  async getStatus(workspaceRoot?: string): Promise<WorkspaceAccessGuardStatus> {
    const settings = getWorkspaceAccessGuardSettings();
    if (!settings.enabled) return 'disabled';

    if (!workspaceRoot) return 'enabled-hooks-missing';

    const policyStatus = this.orgPolicyLoader.getStatus();
    if (policyStatus.error) return 'enabled-org-policy-invalid';
    if (policyStatus.source === 'built-in-defaults') {
      try {
        return await this.hookManager.getStatus(workspaceRoot);
      } catch {
        return 'enabled-using-built-in-policy';
      }
    }

    try {
      return await this.hookManager.getStatus(workspaceRoot);
    } catch {
      return 'error';
    }
  }

  buildAgentEnv(): Record<string, string> {
    const settings = getWorkspaceAccessGuardSettings();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return buildWagEnv(settings, this.storeDir, this.allowedRootsStore.getPath(), workspacePath);
  }

  async getAuditEvents(limit?: number): Promise<WorkspaceAccessAuditEvent[]> {
    return this.auditReader.read(limit);
  }

  getAllowedRoots(): WorkspaceAccessAllowedRootView[] {
    const roots = this.allowedRootsStore.load();
    const policy = this.orgPolicyLoader.getPolicy();
    const env = this.buildPathEnv();

    return roots.map(rootPath => {
      const broad = checkBroadRoot(rootPath, policy, env);
      return {
        path: rootPath,
        isBroad: broad.isBroad,
        broadWarning: broad.warning,
      };
    });
  }

  addAllowedRoots(roots: string[]): WorkspaceAccessAllowedRootView[] {
    const policy = this.orgPolicyLoader.getPolicy();
    const env = this.buildPathEnv();
    const safeRoots = roots.filter(rootPath => !isHardDeniedBroadRoot(rootPath, policy, env));
    this.allowedRootsStore.addRoots(safeRoots);
    return this.getAllowedRoots();
  }

  removeAllowedRoot(root: string): WorkspaceAccessAllowedRootView[] {
    this.allowedRootsStore.removeRoot(root);
    return this.getAllowedRoots();
  }

  addCurrentWorkspace(): WorkspaceAccessAllowedRootView[] {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const paths = folders.map(f => f.uri.fsPath);
      return this.addAllowedRoots(paths);
    }
    return this.getAllowedRoots();
  }

  getOrgPolicyStatus(): WorkspaceAccessOrgPolicyStatus {
    return this.orgPolicyLoader.getStatus();
  }

  testPath(value: string): WorkspaceAccessDecision {
    const settings = getWorkspaceAccessGuardSettings();
    const env = this.buildPathEnv();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    return evaluate({
      provider: 'claude',
      toolName: 'Read',
      operation: 'read',
      cwd,
      extractedPaths: [value],
      userAllowedRoots: this.allowedRootsStore.load(),
      orgPolicy: this.orgPolicyLoader.getPolicy(),
      settings,
      env,
    });
  }

  testCommand(command: string, cwd?: string): WorkspaceAccessDecision {
    const settings = getWorkspaceAccessGuardSettings();
    const env = this.buildPathEnv();
    const effectiveCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const extracted = extractCommandPaths(command, effectiveCwd);
    if (extracted.accessKind === 'no-file-access') {
      return {
        action: 'allow',
        reason: 'No file paths detected and operation does not access files',
        normalizedPaths: [],
      };
    }

    let operation: WorkspaceAccessPolicyInput['operation'] = 'bash';
    let extractedPaths = extracted.paths;
    if (extracted.accessKind === 'build-or-test') {
      extractedPaths = extracted.cwdIsTarget ? [effectiveCwd] : extracted.paths;
    } else if (extracted.accessKind === 'unknown-file-access') {
      operation = 'unknown';
      extractedPaths = extracted.cwdIsTarget ? [effectiveCwd] : extracted.paths;
    }

    return evaluate({
      provider: 'claude',
      toolName: 'Bash',
      operation,
      command,
      cwd: effectiveCwd,
      extractedPaths,
      userAllowedRoots: this.allowedRootsStore.load(),
      orgPolicy: this.orgPolicyLoader.getPolicy(),
      settings,
      env,
    });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    if (enabled) {
      await this.installRuntime();
      await this.activate(workspaceRoot);
    } else {
      await this.deactivate(workspaceRoot);
    }
  }

  private async onSettingsChanged(settings: WorkspaceAccessGuardSettings): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    if (settings.enabled) {
      await this.installRuntime();
      await this.activate(workspaceRoot);
    } else {
      await this.deactivate(workspaceRoot);
    }
  }

  private get runtimeSettingsPath(): string {
    return path.join(this.storeDir, 'runtime-enabled.json');
  }

  private writeRuntimeSettings(settings: WorkspaceAccessGuardSettings): void {
    try {
      const data = {
        enabled: true,
        mode: settings.mode,
        userAllowedRoots: this.allowedRootsStore.load(),
        autoAllowWorkspaceFolders: settings.autoAllowWorkspaceFolders,
        orgPolicyPath: settings.orgPolicyPath,
        scanBashCommands: settings.scanBashCommands,
        scanFileTools: settings.scanFileTools,
        scanMcpTools: settings.scanMcpTools,
        blockOutsideAllowedRoots: settings.blockOutsideAllowedRoots,
        blockDeniedRoots: settings.blockDeniedRoots,
        warnOnBroadAllowedRoots: settings.warnOnBroadAllowedRoots,
        denyUnresolvedSymlinkTargets: settings.denyUnresolvedSymlinkTargets,
        denyUnknownFileAccessCommands: settings.denyUnknownFileAccessCommands,
        auditRetentionDays: settings.auditRetentionDays,
      };
      const tmpPath = `${this.runtimeSettingsPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
      fs.renameSync(tmpPath, this.runtimeSettingsPath);
    } catch { /* best-effort */ }
  }

  private deleteRuntimeSettings(): void {
    try { fs.unlinkSync(this.runtimeSettingsPath); } catch { /* ignore */ }
  }

  private async installRuntime(): Promise<void> {
    const distDir = path.join(this.context.extensionPath, 'dist', 'workspace-access-guard-runtime', 'hooks');
    fs.mkdirSync(this.hooksDir, { recursive: true });

    const hookFiles = [
      { src: 'claude-wag.js', dest: 'claude-wag.js' },
      { src: 'codex-wag.js', dest: 'codex-wag.js' },
    ];

    for (const { src, dest } of hookFiles) {
      const srcPath = path.join(distDir, src);
      const destPath = path.join(this.hooksDir, dest);
      try {
        await fs.promises.copyFile(srcPath, destPath);
      } catch { /* Hook files may not exist yet if not built */ }
    }
  }

  private buildPathEnv(): Record<string, string | undefined> {
    return {
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      HOME: process.env.HOME,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    };
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.orgPolicyLoader.dispose();
  }
}
