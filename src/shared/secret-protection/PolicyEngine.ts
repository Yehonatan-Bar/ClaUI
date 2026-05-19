import * as crypto from 'crypto';
import {
  DlpBoundary, DlpDestination, DlpFinding, DlpDecision, DlpAction,
  AuditEvent, DlpException, FindingSeverity, FindingType,
  PolicyConfig, DestinationKind, SecretProtectionMode,
} from './types';

type FindingCategory =
  | 'hard_secret'
  | 'api_key_or_cloud'
  | 'jwt'
  | 'pii'
  | 'internal_topology'
  | 'protected_path'
  | 'network_exfil'
  | 'other';

type DestinationCategory = 'terminal' | 'remote_model' | 'mcp' | 'git' | 'persistence';

function categorizeFinding(type: FindingType): FindingCategory {
  switch (type) {
    case 'hard_secret':
    case 'private_key':
      return 'hard_secret';
    case 'api_key':
    case 'cloud_credential':
    case 'database_credential':
    case 'webhook':
      return 'api_key_or_cloud';
    case 'jwt':
      return 'jwt';
    case 'pii':
      return 'pii';
    case 'internal_topology':
      return 'internal_topology';
    case 'protected_path':
    case 'agent_control_file':
    case 'git_control_file':
      return 'protected_path';
    case 'network_exfil_primitive':
      return 'network_exfil';
    default:
      return 'other';
  }
}

function categorizeDestination(kind: DestinationKind): DestinationCategory {
  switch (kind) {
    case 'terminal_stdout_to_agent':
      return 'terminal';
    case 'remote_model_provider':
      return 'remote_model';
    case 'mcp_server':
      return 'mcp';
    case 'git_remote':
      return 'git';
    default:
      return 'persistence';
  }
}

const DECISION_MATRIX: Record<FindingCategory, Record<DestinationCategory, DlpAction>> = {
  hard_secret: {
    terminal: 'redact',
    remote_model: 'block',
    mcp: 'block',
    git: 'block',
    persistence: 'redact',
  },
  api_key_or_cloud: {
    terminal: 'redact',
    remote_model: 'block',
    mcp: 'block',
    git: 'block',
    persistence: 'redact',
  },
  jwt: {
    terminal: 'redact',
    remote_model: 'redact',
    mcp: 'block',
    git: 'block',
    persistence: 'redact',
  },
  pii: {
    terminal: 'summarize_locally',
    remote_model: 'require_approval',
    mcp: 'block',
    git: 'block',
    persistence: 'redact',
  },
  internal_topology: {
    terminal: 'allow',
    remote_model: 'warn',
    mcp: 'require_approval',
    git: 'warn',
    persistence: 'allow',
  },
  protected_path: {
    terminal: 'block',
    remote_model: 'block',
    mcp: 'block',
    git: 'block',
    persistence: 'redact',
  },
  network_exfil: {
    terminal: 'warn',
    remote_model: 'warn',
    mcp: 'block',
    git: 'block',
    persistence: 'allow',
  },
  other: {
    terminal: 'allow',
    remote_model: 'warn',
    mcp: 'warn',
    git: 'warn',
    persistence: 'allow',
  },
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const ACTION_SEVERITY_ORDER: Record<DlpAction, number> = {
  allow: 0,
  summarize_locally: 1,
  warn: 2,
  redact: 3,
  require_approval: 4,
  block: 5,
};

function computeMaxSeverity(findings: DlpFinding[]): FindingSeverity | null {
  if (findings.length === 0) return null;
  let max: FindingSeverity = findings[0].severity;
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[max]) {
      max = f.severity;
    }
  }
  return max;
}

function mostRestrictiveAction(actions: DlpAction[]): DlpAction {
  if (actions.length === 0) return 'allow';
  let max = actions[0];
  for (const a of actions) {
    if (ACTION_SEVERITY_ORDER[a] > ACTION_SEVERITY_ORDER[max]) {
      max = a;
    }
  }
  return max;
}

function isExceptionValid(
  exception: DlpException,
  finding: DlpFinding,
  destination: DlpDestination,
): boolean {
  if (new Date(exception.expiresAt) < new Date()) return false;
  if (exception.usedCount >= exception.maxUses) return false;
  if (exception.ruleId !== finding.ruleId) return false;
  if (exception.destination.kind !== destination.kind) return false;
  return true;
}

export class PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  evaluate(
    boundary: DlpBoundary,
    destination: DlpDestination,
    findings: DlpFinding[],
    exceptions: DlpException[],
    contentHash: string,
    sessionId?: string,
    turnId?: string,
  ): DlpDecision {
    const auditId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    if (findings.length === 0) {
      return this.buildDecision(
        'allow', 'No secrets detected', findings,
        boundary, destination, contentHash, auditId, timestamp, sessionId, turnId,
      );
    }

    if (this.config.mode === 'off') {
      return this.buildDecision(
        'allow', 'Secret protection mode is off', findings,
        boundary, destination, contentHash, auditId, timestamp, sessionId, turnId,
      );
    }

    if (this.config.mode === 'observe') {
      return this.buildDecision(
        'allow', `Observe mode: ${findings.length} finding(s) logged but not blocked`, findings,
        boundary, destination, contentHash, auditId, timestamp, sessionId, turnId,
      );
    }

    const destCategory = categorizeDestination(destination.kind);
    const findingActions: Array<{ finding: DlpFinding; action: DlpAction }> = [];

    for (const finding of findings) {
      if (this.config.hardBlockRules.some(rule => finding.ruleId.includes(rule))) {
        findingActions.push({ finding, action: 'block' });
        continue;
      }

      const exception = exceptions.find(e => isExceptionValid(e, finding, destination));
      if (exception) {
        findingActions.push({ finding, action: 'allow' });
        continue;
      }

      if (this.config.allowlistedSecretHmacs.includes(finding.redaction.stableId)) {
        findingActions.push({ finding, action: 'allow' });
        continue;
      }

      const findingCategory = categorizeFinding(finding.type);
      let action = DECISION_MATRIX[findingCategory][destCategory];

      // Strict mode: escalate to block for medium+ severity
      if (this.config.mode === 'strict' && SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER['medium']) {
        if (ACTION_SEVERITY_ORDER[action] < ACTION_SEVERITY_ORDER['block']) {
          action = 'block';
        }
      }

      findingActions.push({ finding, action });
    }

    const overallAction = mostRestrictiveAction(findingActions.map(fa => fa.action));

    const blockReasons = findingActions
      .filter(fa => fa.action === 'block')
      .map(fa => `${fa.finding.type} (${fa.finding.ruleId})`);

    let reason: string;
    switch (overallAction) {
      case 'block':
        reason = `Blocked: ${blockReasons.join(', ')}`;
        break;
      case 'redact':
        reason = `Redacting ${findingActions.filter(fa => fa.action === 'redact').length} finding(s)`;
        break;
      case 'require_approval':
        reason = `Approval required for ${findings.length} finding(s)`;
        break;
      case 'warn':
        reason = `Warning: ${findings.length} finding(s) detected`;
        break;
      default:
        reason = `${findings.length} finding(s) processed`;
    }

    const decision = this.buildDecision(
      overallAction, reason, findings,
      boundary, destination, contentHash, auditId, timestamp, sessionId, turnId,
    );

    if (overallAction === 'require_approval') {
      const approvalFinding = findingActions.find(fa => fa.action === 'require_approval')?.finding ?? findings[0];
      decision.approvalRequest = {
        findingId: approvalFinding.id,
        boundary,
        destination,
        description: `${approvalFinding.type} detected in ${boundary} heading to ${destination.kind}`,
        options: ['redact_and_continue', 'remove_from_context', 'approve_once', 'block'],
      };
    }

    return decision;
  }

  private buildDecision(
    action: DlpAction,
    reason: string,
    findings: DlpFinding[],
    boundary: DlpBoundary,
    destination: DlpDestination,
    contentHash: string,
    auditId: string,
    timestamp: string,
    sessionId?: string,
    turnId?: string,
  ): DlpDecision {
    const audit: AuditEvent = {
      id: auditId,
      timestamp,
      sessionId,
      turnId,
      boundary,
      action,
      ruleIds: findings.map(f => f.ruleId),
      findingTypes: [...new Set(findings.map(f => f.type))],
      severityMax: computeMaxSeverity(findings),
      destinationKind: destination.kind,
      contentHash,
      redactedBytes: 0,
      redactionCount: 0,
    };

    return { action, reason, findings, audit };
  }
}
