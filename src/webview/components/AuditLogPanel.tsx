import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { postToExtension } from '../hooks/useClaudeStream';

const ACTIONS = ['', 'allow', 'warn', 'redact', 'require_approval', 'block', 'summarize_locally'];
const SEVERITIES = ['', 'low', 'medium', 'high', 'critical'];

export const AuditLogPanel: React.FC = () => {
  const events = useAppStore((s) => s.secretProtectionAuditEvents);
  const loading = useAppStore((s) => s.secretProtectionAuditLoading);
  const error = useAppStore((s) => s.secretProtectionAuditError);
  const report = useAppStore((s) => s.secretProtectionComplianceReport);
  const setLoading = useAppStore((s) => s.setSecretProtectionAuditLoading);
  const [action, setAction] = useState('');
  const [severityMin, setSeverityMin] = useState('');

  const requestData = React.useCallback(() => {
    setLoading(true);
    const filter = {
      ...(action ? { action } : {}),
      ...(severityMin ? { severityMin } : {}),
    };
    postToExtension({ type: 'secretProtectionGetAuditEvents', filter, limit: 100 });
    postToExtension({ type: 'secretProtectionGetComplianceReport', filter });
  }, [action, severityMin, setLoading]);

  useEffect(() => {
    requestData();
  }, [requestData]);

  const totals = useMemo(() => ({
    blocked: report?.stats.byAction.block ?? 0,
    redacted: report?.stats.redactionCount ?? 0,
    events: report?.stats.totalEvents ?? events.length,
  }), [events.length, report]);

  return (
    <div className="audit-log-panel">
      <div className="dlp-metric-row">
        <div className="dlp-metric"><span>Events</span><strong>{totals.events}</strong></div>
        <div className="dlp-metric"><span>Blocked</span><strong>{totals.blocked}</strong></div>
        <div className="dlp-metric"><span>Redacted</span><strong>{totals.redacted}</strong></div>
      </div>

      <div className="dlp-filter-row">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter">
          {ACTIONS.map((value) => <option key={value} value={value}>{value || 'Any action'}</option>)}
        </select>
        <select value={severityMin} onChange={(e) => setSeverityMin(e.target.value)} aria-label="Severity filter">
          {SEVERITIES.map((value) => <option key={value} value={value}>{value || 'Any severity'}</option>)}
        </select>
        <button className="dlp-secondary-btn" onClick={requestData} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="dlp-error">{error}</div>}

      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Boundary</th>
              <th>Action</th>
              <th>Severity</th>
              <th>Rules</th>
              <th>Redactions</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr><td colSpan={6} className="audit-empty">{loading ? 'Loading...' : 'No audit events'}</td></tr>
            ) : events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.timestamp).toLocaleString()}</td>
                <td>{event.boundary}</td>
                <td><span className={`audit-action audit-action--${event.action}`}>{event.action}</span></td>
                <td>{event.severityMax ?? 'none'}</td>
                <td>{event.ruleIds.slice(0, 3).join(', ') || 'none'}</td>
                <td>{event.redactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
