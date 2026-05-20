import type {
  DlpAction,
  DlpBoundary,
  DlpDecision,
  DlpDestination,
  DlpException,
  DlpFinding,
  FindingSeverity,
} from '../../shared/secret-protection/types';

export interface ApprovalEngineOptions {
  mode: 'off' | 'observe' | 'balanced' | 'strict';
  allowApprovalBypass?: boolean;
}

export interface ApprovalDecision {
  action: DlpAction;
  allowed: boolean;
  reason: string;
  approvalRequired: boolean;
  exception?: DlpException;
  consumedExceptions?: DlpException[];
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function maxSeverity(findings: DlpFinding[]): FindingSeverity | null {
  let result: FindingSeverity | null = null;
  for (const finding of findings) {
    if (!result || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[result]) {
      result = finding.severity;
    }
  }
  return result;
}

function exceptionMatches(
  exception: DlpException,
  finding: DlpFinding,
  destination: DlpDestination,
): boolean {
  return (
    exception.ruleId === finding.ruleId &&
    exception.destination.kind === destination.kind &&
    new Date(exception.expiresAt) > new Date() &&
    exception.usedCount < exception.maxUses
  );
}

export class ApprovalEngine {
  constructor(private readonly options: ApprovalEngineOptions) {}

  evaluate(
    boundary: DlpBoundary,
    destination: DlpDestination,
    findings: DlpFinding[],
    baseDecision?: DlpDecision,
    exceptions: DlpException[] = [],
  ): ApprovalDecision {
    if (this.options.mode === 'off' || findings.length === 0) {
      return {
        action: 'allow',
        allowed: true,
        approvalRequired: false,
        reason: findings.length === 0 ? 'No DLP findings' : 'Secret protection mode is off',
      };
    }

    const allFindingsCovered = findings.every((finding) =>
      exceptions.some((exception) => exceptionMatches(exception, finding, destination))
    );
    if (allFindingsCovered) {
      const matched = new Map<string, DlpException>();
      for (const finding of findings) {
        const ex = exceptions.find((e) => exceptionMatches(e, finding, destination));
        if (ex && !matched.has(ex.id)) {
          matched.set(ex.id, ex);
        }
      }
      const allMatched = [...matched.values()];
      return {
        action: 'allow',
        allowed: true,
        approvalRequired: false,
        reason: `All ${findings.length} finding(s) covered by exceptions at ${boundary}`,
        exception: allMatched[0],
        consumedExceptions: allMatched,
      };
    }

    if (this.options.mode === 'observe') {
      return {
        action: 'allow',
        allowed: true,
        approvalRequired: false,
        reason: `Observe mode recorded ${findings.length} finding(s)`,
      };
    }

    if (baseDecision?.action === 'block') {
      return {
        action: 'block',
        allowed: false,
        approvalRequired: false,
        reason: baseDecision.reason,
      };
    }

    if (baseDecision?.action === 'redact') {
      return {
        action: 'redact',
        allowed: true,
        approvalRequired: false,
        reason: baseDecision.reason,
      };
    }

    if (baseDecision?.action === 'require_approval') {
      return {
        action: 'require_approval',
        allowed: !!this.options.allowApprovalBypass,
        approvalRequired: true,
        reason: baseDecision.reason,
      };
    }

    const severity = maxSeverity(findings);
    if (this.options.mode === 'strict' && severity && SEVERITY_RANK[severity] >= SEVERITY_RANK.medium) {
      return {
        action: 'block',
        allowed: false,
        approvalRequired: false,
        reason: `Strict mode blocked ${severity} DLP finding(s) at ${boundary}`,
      };
    }

    if (severity && SEVERITY_RANK[severity] >= SEVERITY_RANK.high) {
      return {
        action: 'require_approval',
        allowed: !!this.options.allowApprovalBypass,
        approvalRequired: true,
        reason: `Approval required for ${severity} DLP finding(s) at ${boundary}`,
      };
    }

    return {
      action: baseDecision?.action ?? 'warn',
      allowed: true,
      approvalRequired: false,
      reason: baseDecision?.reason ?? `${findings.length} DLP finding(s) allowed with warning`,
    };
  }
}
