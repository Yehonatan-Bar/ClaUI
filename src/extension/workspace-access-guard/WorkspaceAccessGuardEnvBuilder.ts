import { WorkspaceAccessGuardSettings } from '../../shared/workspace-access-guard/types';

export function buildWagEnv(
  settings: WorkspaceAccessGuardSettings,
  storeDir: string,
  userRootsPath: string,
  workspacePath?: string,
): Record<string, string> {
  if (!settings.enabled) {
    return {
      CLAUI_WORKSPACE_ACCESS_GUARD: '0',
      CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR: storeDir,
    };
  }
  return {
    CLAUI_WORKSPACE_ACCESS_GUARD: '1',
    CLAUI_WORKSPACE_ACCESS_GUARD_MODE: settings.mode,
    CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR: storeDir,
    CLAUI_WORKSPACE_ACCESS_GUARD_USER_ROOTS_PATH: userRootsPath,
    CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH: settings.orgPolicyPath,
    CLAUI_WAG_AUTO_ALLOW_WORKSPACE: settings.autoAllowWorkspaceFolders ? '1' : '0',
    CLAUI_WAG_SCAN_BASH: settings.scanBashCommands ? '1' : '0',
    CLAUI_WAG_SCAN_FILE_TOOLS: settings.scanFileTools ? '1' : '0',
    CLAUI_WAG_SCAN_MCP: settings.scanMcpTools ? '1' : '0',
    CLAUI_WAG_BLOCK_OUTSIDE_ALLOWED_ROOTS: settings.blockOutsideAllowedRoots ? '1' : '0',
    CLAUI_WAG_BLOCK_DENIED_ROOTS: settings.blockDeniedRoots ? '1' : '0',
    CLAUI_WAG_WARN_BROAD_ALLOWED_ROOTS: settings.warnOnBroadAllowedRoots ? '1' : '0',
    CLAUI_WAG_DENY_UNRESOLVED_SYMLINKS: settings.denyUnresolvedSymlinkTargets ? '1' : '0',
    CLAUI_WAG_DENY_UNKNOWN: settings.denyUnknownFileAccessCommands ? '1' : '0',
    CLAUI_WAG_AUDIT_RETENTION_DAYS: String(settings.auditRetentionDays),
    CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH: workspacePath ?? '',
  };
}
