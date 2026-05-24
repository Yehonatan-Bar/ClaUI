import * as vscode from 'vscode';
import { SuperParticleAcceleratorSettings } from '../../shared/super-particle-accelerator/types';

const SECTION = 'claudeMirror.superParticleAccelerator';

const DEFAULTS: SuperParticleAcceleratorSettings = {
  enabled: false,
  mode: 'block',
  scanEditTools: true,
  scanBashCommands: true,
  scanMcpTools: true,
  scanWorkingTreeOnStop: true,
  blockGitCommitPush: true,
  allowIgnoredEnvFiles: true,
  entropyThreshold: 4.2,
  frontendPathGlobs: [
    'public/**', 'static/**', 'dist/**', 'build/**',
    'client/**', 'frontend/**', 'web/**',
    'src/**/*.html', 'src/**/*.tsx', 'src/**/*.jsx',
    'src/**/*.js', 'src/**/*.ts',
  ],
  allowedSecretFileGlobs: [
    '.env.local', '.env.*.local', '*.local.env',
  ],
};

export function getSuperParticleAcceleratorSettings(): SuperParticleAcceleratorSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: cfg.get<boolean>('enabled', DEFAULTS.enabled),
    mode: cfg.get<'block' | 'audit'>('mode', DEFAULTS.mode),
    scanEditTools: cfg.get<boolean>('scanEditTools', DEFAULTS.scanEditTools),
    scanBashCommands: cfg.get<boolean>('scanBashCommands', DEFAULTS.scanBashCommands),
    scanMcpTools: cfg.get<boolean>('scanMcpTools', DEFAULTS.scanMcpTools),
    scanWorkingTreeOnStop: cfg.get<boolean>('scanWorkingTreeOnStop', DEFAULTS.scanWorkingTreeOnStop),
    blockGitCommitPush: cfg.get<boolean>('blockGitCommitPush', DEFAULTS.blockGitCommitPush),
    allowIgnoredEnvFiles: cfg.get<boolean>('allowIgnoredEnvFiles', DEFAULTS.allowIgnoredEnvFiles),
    entropyThreshold: cfg.get<number>('entropyThreshold', DEFAULTS.entropyThreshold),
    frontendPathGlobs: cfg.get<string[]>('frontendPathGlobs', DEFAULTS.frontendPathGlobs),
    allowedSecretFileGlobs: cfg.get<string[]>('allowedSecretFileGlobs', DEFAULTS.allowedSecretFileGlobs),
  };
}

export function onSuperParticleAcceleratorSettingsChanged(
  cb: (s: SuperParticleAcceleratorSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(SECTION)) {
      cb(getSuperParticleAcceleratorSettings());
    }
  });
}
