import * as vscode from 'vscode';
import { WorkspaceAccessGuardSettings } from '../../shared/workspace-access-guard/types';

const SECTION = 'claudeMirror.workspaceAccessGuard';

const ORG_POLICY_DEFAULT_PATH = ['C:', 'ProgramData', 'ClaUi', 'workspace-access-guard.policy.json'].join('\\');

const DEFAULTS: WorkspaceAccessGuardSettings = {
  enabled: false,
  mode: 'block',
  userAllowedRoots: [],
  autoAllowWorkspaceFolders: true,
  orgPolicyPath: ORG_POLICY_DEFAULT_PATH,
  scanBashCommands: true,
  scanFileTools: true,
  scanMcpTools: true,
  blockOutsideAllowedRoots: true,
  blockDeniedRoots: true,
  warnOnBroadAllowedRoots: true,
  denyUnresolvedSymlinkTargets: true,
  denyUnknownFileAccessCommands: true,
  auditRetentionDays: 90,
};

export function getWorkspaceAccessGuardSettings(): WorkspaceAccessGuardSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: cfg.get<boolean>('enabled', DEFAULTS.enabled),
    mode: cfg.get<'block' | 'audit'>('mode', DEFAULTS.mode),
    userAllowedRoots: cfg.get<string[]>('userAllowedRoots', DEFAULTS.userAllowedRoots),
    autoAllowWorkspaceFolders: cfg.get<boolean>('autoAllowWorkspaceFolders', DEFAULTS.autoAllowWorkspaceFolders),
    orgPolicyPath: cfg.get<string>('orgPolicyPath', DEFAULTS.orgPolicyPath),
    scanBashCommands: cfg.get<boolean>('scanBashCommands', DEFAULTS.scanBashCommands),
    scanFileTools: cfg.get<boolean>('scanFileTools', DEFAULTS.scanFileTools),
    scanMcpTools: cfg.get<boolean>('scanMcpTools', DEFAULTS.scanMcpTools),
    blockOutsideAllowedRoots: cfg.get<boolean>('blockOutsideAllowedRoots', DEFAULTS.blockOutsideAllowedRoots),
    blockDeniedRoots: cfg.get<boolean>('blockDeniedRoots', DEFAULTS.blockDeniedRoots),
    warnOnBroadAllowedRoots: cfg.get<boolean>('warnOnBroadAllowedRoots', DEFAULTS.warnOnBroadAllowedRoots),
    denyUnresolvedSymlinkTargets: cfg.get<boolean>('denyUnresolvedSymlinkTargets', DEFAULTS.denyUnresolvedSymlinkTargets),
    denyUnknownFileAccessCommands: cfg.get<boolean>('denyUnknownFileAccessCommands', DEFAULTS.denyUnknownFileAccessCommands),
    auditRetentionDays: cfg.get<number>('auditRetentionDays', DEFAULTS.auditRetentionDays),
  };
}

export function onWorkspaceAccessGuardSettingsChanged(
  cb: (s: WorkspaceAccessGuardSettings) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(SECTION)) {
      cb(getWorkspaceAccessGuardSettings());
    }
  });
}
