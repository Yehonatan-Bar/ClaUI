import * as vscode from 'vscode';
import { SecretProtectionSettings, SecretProtectionMode } from '../../shared/secret-protection/types';

export type { SecretProtectionSettings };

const SECTION = 'claudeMirror.secretProtection';

const VALID_MODES: SecretProtectionMode[] = ['off', 'observe', 'balanced', 'strict'];

export function getSecretProtectionSettings(): SecretProtectionSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const rawMode = config.get<string>('mode', 'balanced');
  const mode: SecretProtectionMode = VALID_MODES.includes(rawMode as SecretProtectionMode)
    ? (rawMode as SecretProtectionMode)
    : 'balanced';

  return {
    enabled: config.get<boolean>('enabled', false),
    mode,
    blockProtectedPaths: config.get<boolean>('blockProtectedPaths', true),
    scanPrompts: config.get<boolean>('scanPrompts', true),
    scanTerminalOutput: config.get<boolean>('scanTerminalOutput', true),
    scanGitPublication: config.get<boolean>('scanGitPublication', true),
    scanMcp: config.get<boolean>('scanMcp', true),
    requireBrowserCaptureApproval: config.get<boolean>('requireBrowserCaptureApproval', true),
    exceptionMaxMinutes: clamp(config.get<number>('exceptionMaxMinutes', 30), 1, 1440),
    auditRetentionDays: clamp(config.get<number>('auditRetentionDays', 90), 1, 365),
    enableEntropyScanner: config.get<boolean>('enableEntropyScanner', false),
  };
}

export function onSecretProtectionSettingsChanged(
  callback: (settings: SecretProtectionSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(SECTION)) {
      callback(getSecretProtectionSettings());
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
