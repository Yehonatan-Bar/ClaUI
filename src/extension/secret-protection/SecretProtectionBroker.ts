import * as crypto from 'crypto';
import {
  DlpBoundary, DlpDecision, DlpException,
  SecretProtectionSettings, PolicyConfig,
} from '../../shared/secret-protection/types';
import { ScanContext } from '../../shared/secret-protection/scanners/types';
import { CompositeSecretScanner } from '../../shared/secret-protection/scanners/CompositeSecretScanner';
import { PolicyEngine } from '../../shared/secret-protection/PolicyEngine';
import { RedactionEngine } from '../../shared/secret-protection/RedactionEngine';
import { AuditEventWriter } from '../../shared/secret-protection/AuditEventWriter';
import { classifyDestination, DestinationMetadata } from '../../shared/secret-protection/DestinationClassifier';
import { classifyCommandRisk } from '../../shared/secret-protection/CommandRiskClassifier';
import { getAllRulePacks } from '../../shared/secret-protection/rules/index';

export class SecretProtectionBroker {
  private readonly scanner: CompositeSecretScanner;
  private readonly policyEngine: PolicyEngine;
  private readonly redactionEngine: RedactionEngine;
  private readonly auditWriter: AuditEventWriter;
  private readonly exceptions: DlpException[] = [];

  constructor(
    private readonly settings: SecretProtectionSettings,
    policyConfig: PolicyConfig,
    private readonly auditStoreDir: string,
    private readonly sessionId?: string,
  ) {
    this.scanner = new CompositeSecretScanner(settings, getAllRulePacks());
    // VS Code settings mode takes precedence over policy file mode
    const effectiveConfig = { ...policyConfig, mode: settings.mode };
    this.policyEngine = new PolicyEngine(effectiveConfig);
    this.redactionEngine = new RedactionEngine();
    this.auditWriter = new AuditEventWriter();
  }

  async scanPromptSubmission(prompt: string, provider?: 'anthropic' | 'openai'): Promise<DlpDecision> {
    return this.scan(prompt, 'prompt.submit', { provider });
  }

  async scanContextExpansion(content: string, filePath?: string): Promise<DlpDecision> {
    return this.scan(content, 'context.attach', { filePath });
  }

  async scanFileExposure(filePath: string, content: string): Promise<DlpDecision> {
    return this.scan(content, 'file.read_for_context', { filePath });
  }

  async scanCommandPreflight(command: string): Promise<DlpDecision> {
    const risk = classifyCommandRisk(command);
    if (risk.hardBlock) {
      const contentHash = crypto.createHash('sha256').update(command).digest('hex').slice(0, 16);
      const boundary: DlpBoundary = 'command.preflight';
      const destination = classifyDestination(boundary, {});
      const decision = this.policyEngine.evaluate(
        boundary, destination,
        [{
          id: crypto.randomUUID(),
          ruleId: 'command_risk_hard_block',
          type: 'network_exfil_primitive',
          severity: 'critical',
          confidence: 'high',
          location: {},
          redaction: {
            text: '<REDACTED type="command" />',
            type: 'command',
            stableId: contentHash,
            hashPrefix: contentHash.slice(0, 8),
            originalLength: command.length,
          },
        }],
        this.exceptions,
        contentHash,
        this.sessionId,
      );
      if (this.auditStoreDir) {
        await this.auditWriter.writeEvent(decision.audit, this.auditStoreDir);
      }
      return decision;
    }
    return this.scan(command, 'command.preflight', {});
  }

  async scanTerminalOutput(stdout: string, stderr: string): Promise<DlpDecision> {
    const combined = stdout + (stderr ? '\n' + stderr : '');
    return this.scan(combined, 'command.output', {});
  }

  async scanMcpRequest(toolName: string, args: string, serverUrl?: string): Promise<DlpDecision> {
    const content = `${toolName}: ${args}`;
    return this.scan(content, 'mcp.request', { mcpServerUrl: serverUrl, host: serverUrl });
  }

  async scanGitPublication(diff: string, commitMsg?: string, remoteName?: string): Promise<DlpDecision> {
    const content = (commitMsg ? commitMsg + '\n' : '') + diff;
    return this.scan(content, 'git.publish', { remoteName });
  }

  async scanPersistence(key: string, value: string): Promise<DlpDecision> {
    return this.scan(value, 'persistence.write', {});
  }

  addException(exception: DlpException): void {
    this.exceptions.push(exception);
  }

  getActiveExceptions(): DlpException[] {
    const now = new Date();
    return this.exceptions.filter(e =>
      new Date(e.expiresAt) > now && e.usedCount < e.maxUses
    );
  }

  private async scan(
    content: string,
    boundary: DlpBoundary,
    metadata: DestinationMetadata & { filePath?: string },
  ): Promise<DlpDecision> {
    try {
      const destination = classifyDestination(boundary, metadata);
      const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

      const scanContext: ScanContext = {
        boundary,
        destination,
        filePath: metadata.filePath,
      };

      const scanResult = this.scanner.scan(content, scanContext);

      const decision = this.policyEngine.evaluate(
        boundary, destination, scanResult.findings,
        this.exceptions, contentHash, this.sessionId,
      );

      if (decision.action === 'redact' && scanResult.findings.length > 0) {
        const redactionResult = this.redactionEngine.redact(content, scanResult.findings);
        decision.redactedContent = redactionResult.redacted;
        decision.audit.redactedBytes = Buffer.byteLength(redactionResult.redacted, 'utf8');
        decision.audit.redactionCount = redactionResult.replacementCount;
      }

      if (this.auditStoreDir) {
        await this.auditWriter.writeEvent(decision.audit, this.auditStoreDir);
      }

      return decision;
    } catch (err) {
      // Fail-closed: scan errors result in block
      const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
      const errorAudit = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        boundary,
        action: 'block' as const,
        ruleIds: ['scan-error'],
        findingTypes: [],
        severityMax: null,
        destinationKind: 'local_disk' as const,
        contentHash,
        redactedBytes: 0,
        redactionCount: 0,
      };

      return {
        action: 'block',
        reason: `Scan error: ${err instanceof Error ? err.message : String(err)}`,
        findings: [],
        audit: errorAudit,
      };
    }
  }
}
