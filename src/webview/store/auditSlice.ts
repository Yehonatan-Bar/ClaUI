import type { AuditEvent } from '../../shared/secret-protection/types';
import type { ComplianceReport } from '../../shared/audit/ComplianceReporter';

export interface AuditUiState {
  secretProtectionAuditEvents: AuditEvent[];
  secretProtectionAuditLoading: boolean;
  secretProtectionAuditError: string | null;
  secretProtectionComplianceReport: ComplianceReport | null;
}

export const initialAuditUiState: AuditUiState = {
  secretProtectionAuditEvents: [],
  secretProtectionAuditLoading: false,
  secretProtectionAuditError: null,
  secretProtectionComplianceReport: null,
};

export function prependAuditEvent(
  events: AuditEvent[],
  event: AuditEvent | null,
  maxEvents = 100,
): AuditEvent[] {
  if (!event) return events;
  const withoutDuplicate = events.filter((existing) => existing.id !== event.id);
  return [event, ...withoutDuplicate].slice(0, maxEvents);
}
