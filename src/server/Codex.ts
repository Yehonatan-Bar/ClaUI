import type { DlpDecision } from '../shared/secret-protection/types';

export function buildCodexDlpInstructions(decision?: Pick<DlpDecision, 'action' | 'reason'>): string {
  const decisionLine = decision
    ? `The current DLP decision is ${decision.action}: ${decision.reason}`
    : 'Secret Protection Broker is enabled for this session.';

  return [
    'ClaUi Secret Protection Broker is active.',
    decisionLine,
    'Treat <REDACTED ... /> tokens as intentionally removed sensitive data.',
    'Do not ask the user to reveal redacted values. Work with the safe token or request a non-secret substitute.',
    'Before publishing to Git, MCP, telemetry, browser capture, or other remote boundaries, keep secrets redacted and prefer summaries over raw sensitive content.',
  ].join(' ');
}
