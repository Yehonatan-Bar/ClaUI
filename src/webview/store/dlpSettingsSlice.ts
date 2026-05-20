import type { AuditEvent, SecretProtectionSettings } from '../../shared/secret-protection/types';

export interface SecretProtectionUiState {
  secretProtectionEnabled: boolean;
  secretProtectionSettings: SecretProtectionSettings;
  secretProtectionAuditCount: number;
  secretProtectionLastEvent: AuditEvent | null;
  secretProtectionPanelOpen: boolean;
  secretProtectionPanelTab: 'settings' | 'audit' | 'manifest';
}

export const defaultSecretProtectionSettings: SecretProtectionSettings = {
  enabled: false,
  mode: 'balanced',
  blockProtectedPaths: true,
  scanPrompts: true,
  scanTerminalOutput: true,
  scanGitPublication: true,
  scanMcp: true,
  requireBrowserCaptureApproval: true,
  exceptionMaxMinutes: 30,
  auditRetentionDays: 90,
  enableEntropyScanner: false,
};

export const initialSecretProtectionUiState: SecretProtectionUiState = {
  secretProtectionEnabled: false,
  secretProtectionSettings: defaultSecretProtectionSettings,
  secretProtectionAuditCount: 0,
  secretProtectionLastEvent: null,
  secretProtectionPanelOpen: false,
  secretProtectionPanelTab: 'settings',
};
