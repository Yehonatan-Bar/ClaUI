import { SuperParticleAcceleratorSettings } from '../../shared/super-particle-accelerator/types';

export function buildSpaEnv(
  settings: SuperParticleAcceleratorSettings,
  storeDir: string,
): Record<string, string> {
  // Always include CLAUI_SPA_STORE_DIR so running processes can detect
  // file-based activation when toggled on mid-session.
  if (!settings.enabled) {
    return {
      CLAUI_SPA: '0',
      CLAUI_SPA_STORE_DIR: storeDir,
    };
  }
  return {
    CLAUI_SPA: '1',
    CLAUI_SPA_MODE: settings.mode,
    CLAUI_SPA_STORE_DIR: storeDir,
    CLAUI_SPA_ENTROPY_THRESHOLD: String(settings.entropyThreshold),
    CLAUI_SPA_FRONTEND_GLOBS: JSON.stringify(settings.frontendPathGlobs),
    CLAUI_SPA_ALLOWED_SECRET_GLOBS: JSON.stringify(settings.allowedSecretFileGlobs),
    CLAUI_SPA_SCAN_EDIT: settings.scanEditTools ? '1' : '0',
    CLAUI_SPA_SCAN_BASH: settings.scanBashCommands ? '1' : '0',
    CLAUI_SPA_SCAN_MCP: settings.scanMcpTools ? '1' : '0',
    CLAUI_SPA_SCAN_STOP: settings.scanWorkingTreeOnStop ? '1' : '0',
    CLAUI_SPA_BLOCK_GIT: settings.blockGitCommitPush ? '1' : '0',
    CLAUI_SPA_ALLOW_IGNORED_ENV: settings.allowIgnoredEnvFiles ? '1' : '0',
  };
}
