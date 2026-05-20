import type { AuditEvent, SecretProtectionSettings } from '../../shared/secret-protection/types';

export interface OutboundManifestPreview {
  enabled: boolean;
  mode: string;
  guardedBoundaries: string[];
  lastDecision: string;
  lastBoundary: string;
  redactionSummary: string;
}

export function buildOutboundManifestPreview(
  settings: SecretProtectionSettings,
  lastEvent: AuditEvent | null,
): OutboundManifestPreview {
  const guardedBoundaries = [
    settings.scanPrompts ? 'prompt.submit' : null,
    settings.scanTerminalOutput ? 'command.output' : null,
    settings.scanGitPublication ? 'git.publish' : null,
    settings.scanMcp ? 'mcp.request' : null,
    settings.blockProtectedPaths ? 'file.read_for_context' : null,
    settings.requireBrowserCaptureApproval ? 'browser.capture' : null,
  ].filter((value): value is string => !!value);

  return {
    enabled: settings.enabled,
    mode: settings.mode,
    guardedBoundaries,
    lastDecision: lastEvent?.action ?? 'none',
    lastBoundary: lastEvent?.boundary ?? 'none',
    redactionSummary: lastEvent
      ? `${lastEvent.redactionCount} replacement(s), ${lastEvent.redactedBytes} byte(s)`
      : '0 replacement(s), 0 byte(s)',
  };
}
