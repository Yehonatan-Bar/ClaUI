import type { AuditEvent } from '../secret-protection/types';
import type { AuditEventFilter, AuditStoreStats } from './AuditStore';
import { AuditStore } from './AuditStore';

export interface ComplianceControlSummary {
  id: 'soc2-cc6' | 'soc2-cc7' | 'gdpr-32' | 'gdpr-5';
  label: string;
  evidence: string[];
}

export interface ComplianceReport {
  generatedAt: string;
  period: {
    startDate?: string;
    endDate?: string;
  };
  stats: AuditStoreStats;
  recentEvents: AuditEvent[];
  controls: ComplianceControlSummary[];
}

export class ComplianceReporter {
  constructor(private readonly store: AuditStore) {}

  async generate(filter?: AuditEventFilter): Promise<ComplianceReport> {
    const [stats, recentEvents] = await Promise.all([
      this.store.getStats(filter),
      this.store.read(filter, 50),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      period: {
        startDate: filter?.startDate,
        endDate: filter?.endDate,
      },
      stats,
      recentEvents,
      controls: [
        {
          id: 'soc2-cc6',
          label: 'SOC 2 CC6 logical access controls',
          evidence: [
            `${stats.byAction.block ?? 0} blocked boundary crossing(s)`,
            `${stats.byAction.require_approval ?? 0} approval-gated event(s)`,
          ],
        },
        {
          id: 'soc2-cc7',
          label: 'SOC 2 CC7 monitoring and detection',
          evidence: [
            `${stats.totalEvents} DLP decision event(s) recorded`,
            `${Object.keys(stats.byBoundary).length} boundary type(s) observed`,
          ],
        },
        {
          id: 'gdpr-32',
          label: 'GDPR Article 32 security of processing',
          evidence: [
            `${stats.redactionCount} redaction(s) applied`,
            `${stats.redactedBytes} byte(s) replaced before storage or transmission`,
          ],
        },
        {
          id: 'gdpr-5',
          label: 'GDPR Article 5 data minimization',
          evidence: [
            `${stats.byAction.summarize_locally ?? 0} local summarization decision(s)`,
            `${stats.byAction.warn ?? 0} warning-only low risk event(s)`,
          ],
        },
      ],
    };
  }
}
