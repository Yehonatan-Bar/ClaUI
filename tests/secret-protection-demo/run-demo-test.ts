/**
 * Secret Protection Board -- Automated Evidence Runner
 *
 * Runs the full SPB scanner/policy/redaction pipeline against the fixture
 * corpus and produces a comprehensive JSON evidence report.
 *
 * Usage:  npx tsx tests/secret-protection-demo/run-demo-test.ts
 */

import { CompositeSecretScanner } from '../../src/shared/secret-protection/scanners/CompositeSecretScanner';
import { SecretProtectionBroker } from '../../src/extension/secret-protection/SecretProtectionBroker';
import { PolicyEngine } from '../../src/shared/secret-protection/PolicyEngine';
import { RedactionEngine } from '../../src/shared/secret-protection/RedactionEngine';
import { classifyDestination, DestinationMetadata } from '../../src/shared/secret-protection/DestinationClassifier';
import { classifyCommandRisk } from '../../src/shared/secret-protection/CommandRiskClassifier';
import { getAllRulePacks } from '../../src/shared/secret-protection/rules';
import {
  DlpBoundary, SecretProtectionSettings,
  PolicyConfig, SecretProtectionMode, DlpAction, DlpDecision,
  DlpFinding, FindingSeverity, AuditEvent,
} from '../../src/shared/secret-protection/types';
import { ScanContext } from '../../src/shared/secret-protection/scanners/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixtureEntry {
  id: string;
  description: string;
  category: string;
  fixtureFile: string;
  sampleSelector: string;
  isClean: boolean;
  expectedFindingTypes: string[];
  expectedRuleIds: string[];
  expectedSeverityMin: FindingSeverity | null;
  minimumExpectedFindings?: number;
  applicableBoundaries: DlpBoundary[];
  mustBeHiddenWhenProtected: boolean;
  notes?: string;
}

interface ModeDefinition {
  id: string;
  enabled: boolean;
  mode: SecretProtectionMode;
  enableEntropyScanner: boolean;
  purpose: string;
}

interface CaseResult {
  fixtureId: string;
  boundary: string;
  mode: string;
  integrationStatus: 'wired' | 'scanner_only_not_wired' | 'disabled';
  executionPath: 'broker' | 'scanner_only' | 'disabled';
  contentHash: string;
  originalContentPreview?: string;
  findingsCount: number;
  findingRuleIds: string[];
  findingTypes: string[];
  maxSeverity: string | null;
  action: string;
  reason: string;
  redactedContentPreview?: string;
  renderedContentPreview?: string;
  latencyMs: number;
  secretVisibleInRenderedOutput: boolean;
  visibilityAllowedByPolicy: boolean;
  policyViolation: boolean;
  auditEvent?: AuditEvent;
}

interface CommandRiskResult {
  command: string;
  source: string;
  classes: string[];
  severity: string;
  requiresApproval: boolean;
  hardBlock: boolean;
  explanation: string;
}

interface BoundaryCoverageEntry {
  boundary: string;
  integrationStatus: 'wired' | 'scanner_only_not_wired';
  casesRun: number;
  findings: number;
  notes: string;
}

interface RuleCoverageEntry {
  ruleId: string;
  coveredByFixtureIds: string[];
  detected: boolean;
  boundaryEvidence: string[];
}

interface ModeStats {
  totalCases: number;
  secretsExposed: number;
  policyAllowedVisibleFindings: number;
  secretsBlocked: number;
  secretsRedacted: number;
  secretsWarned: number;
  secretsApprovalRequired: number;
  secretsAllowed: number;
  policyViolations: number;
}

interface PerformanceMetrics {
  totalScanCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
}

interface NoRegressionStepEvidence {
  stepId: string;
  description: string;
  boundary: DlpBoundary;
  mode: string;
  action: string;
  findingsCount: number;
  latencyMs: number;
  passed: boolean;
  notes: string;
}

interface NoRegressionEvidence {
  workflowId: string;
  generatedAt: string;
  evidenceKind: 'automated_clean_payload_proxy';
  modesCompared: string[];
  completion: 'pass' | 'fail';
  materialDelayMs: number;
  steps: NoRegressionStepEvidence[];
  summary: string;
}

interface PolicyDecisionMatrixEntry {
  boundary: string;
  mode: string;
  actionCounts: Record<string, number>;
  policyViolations: number;
  policyAllowedVisibleFindings: number;
}

interface ReportInputs {
  screenshots: string[];
  auditLogFiles: string[];
  outputLogFiles: string[];
}

interface DemoResults {
  metadata: {
    testRunId: string;
    timestamp: string;
    sourceCommit: string;
    scannerCountExpected: number;
    rulePackCountExpected: number;
    boundaryCountExpected: number;
  };
  summary: {
    fixturesTotal: number;
    secretFixtures: number;
    cleanFixtures: number;
    boundariesTested: number;
    modesTested: number;
    expectedRuleCoverageRate: number;
    expectedDetectionPassRate: number;
    cleanFalsePositiveRate: number;
    policyViolatingExposures: number;
    policyAllowedVisibleFindings: number;
    p95ScanLatencyMs: number;
  };
  boundaryCoverage: BoundaryCoverageEntry[];
  ruleCoverage: RuleCoverageEntry[];
  modeComparison: Record<string, ModeStats>;
  caseResults: CaseResult[];
  commandRiskResults: CommandRiskResult[];
  noRegressionEvidence: NoRegressionEvidence[];
  performanceMetrics: PerformanceMetrics;
  policyDecisionMatrix: Record<string, PolicyDecisionMatrixEntry>;
  reportInputs: ReportInputs;
  acceptanceFailures: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMO_DIR = path.resolve(__dirname);
const FIXTURES_DIR = path.join(DEMO_DIR, 'fixtures');
const RESULTS_DIR = path.join(DEMO_DIR, 'results');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const DEMO_RESULTS_PATH = path.join(RESULTS_DIR, 'demo-results.json');
const LIVE_EVIDENCE_PATH = path.join(RESULTS_DIR, 'live-evidence.json');
const SCREENSHOT_MANIFEST_PATH = path.join(RESULTS_DIR, 'screenshot-manifest.json');

const ALL_BOUNDARIES: DlpBoundary[] = [
  'prompt.submit', 'context.attach', 'file.read_for_context',
  'command.preflight', 'command.output',
  'git.diff', 'git.publish',
  'mcp.request', 'mcp.response',
  'browser.capture', 'persistence.write',
  'telemetry.export', 'diagnostic.export',
];

const WIRED_BOUNDARIES = new Set<DlpBoundary>([
  'prompt.submit', 'context.attach', 'file.read_for_context',
  'command.preflight', 'command.output',
  'git.publish', 'mcp.request',
  'browser.capture', 'persistence.write', 'diagnostic.export',
]);

const SCANNER_ONLY_BOUNDARIES = new Set<DlpBoundary>(
  ALL_BOUNDARIES.filter(boundary => !WIRED_BOUNDARIES.has(boundary)),
);

const MODES: ModeDefinition[] = [
  { id: 'off_exposed',        enabled: false, mode: 'off',       enableEntropyScanner: false, purpose: 'Shows what is visible without protection' },
  { id: 'off_oracle_scan',    enabled: true,  mode: 'off',       enableEntropyScanner: false, purpose: 'Finds what would be detected while still allowing' },
  { id: 'observe',            enabled: true,  mode: 'observe',   enableEntropyScanner: false, purpose: 'Audit-only mode' },
  { id: 'balanced',           enabled: true,  mode: 'balanced',  enableEntropyScanner: false, purpose: 'Default protection' },
  { id: 'strict',             enabled: true,  mode: 'strict',    enableEntropyScanner: false, purpose: 'Aggressive protection' },
  { id: 'balanced_entropy',   enabled: true,  mode: 'balanced',  enableEntropyScanner: true,  purpose: 'Entropy-specific capability check' },
];

const BASE_SETTINGS_TEMPLATE: Omit<SecretProtectionSettings, 'enabled' | 'mode' | 'enableEntropyScanner'> = {
  blockProtectedPaths: true,
  scanPrompts: true,
  scanTerminalOutput: true,
  scanGitPublication: true,
  scanMcp: true,
  requireBrowserCaptureApproval: true,
  exceptionMaxMinutes: 60,
  auditRetentionDays: 30,
};

const BASE_POLICY_CONFIG: PolicyConfig = {
  schemaVersion: 1,
  mode: 'balanced',
  protectedPaths: [],
  internalDomains: [],
  allowedModelProviders: ['anthropic', 'openai'],
  allowedMcpServers: [],
  allowedGitRemotes: ['github.com'],
  blockedCommands: [],
  approvalRequiredCommandClasses: ['credential_discovery', 'secret_file_read', 'network_upload', 'agent_control_write'],
  hardBlockRules: [],
  exceptionMaxMinutes: 60,
  allowlistedSecretHmacs: [],
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSettings(modeDef: ModeDefinition): SecretProtectionSettings {
  return {
    ...BASE_SETTINGS_TEMPLATE,
    enabled: modeDef.enabled,
    mode: modeDef.mode,
    enableEntropyScanner: modeDef.enableEntropyScanner,
  };
}

function buildPolicyConfig(modeDef: ModeDefinition): PolicyConfig {
  return {
    ...BASE_POLICY_CONFIG,
    mode: modeDef.mode,
  };
}

function buildDestinationMetadata(boundary: DlpBoundary): DestinationMetadata {
  switch (boundary) {
    case 'prompt.submit':
    case 'context.attach':
    case 'file.read_for_context':
      return { provider: 'anthropic' };
    case 'command.preflight':
    case 'command.output':
      return {};
    case 'git.diff':
      return {};
    case 'git.publish':
      return { host: 'github.com' };
    case 'mcp.request':
    case 'mcp.response':
      return { mcpServerUrl: 'https://mcp.example.com' };
    case 'browser.capture':
      return {};
    case 'persistence.write':
      return {};
    case 'telemetry.export':
      return { host: 'telemetry.example.com' };
    case 'diagnostic.export':
      return { host: 'diagnostics.example.com' };
    default:
      return {};
  }
}

function extractContent(fullContent: string, selector: string): string {
  if (selector === 'full-file') {
    return fullContent;
  }

  const lineMatch = selector.match(/^line:(\d+)$/);
  if (lineMatch) {
    const lineNum = parseInt(lineMatch[1], 10);
    const lines = fullContent.split('\n');
    if (lineNum < 1 || lineNum > lines.length) {
      console.warn(`  [WARN] line:${lineNum} out of range (file has ${lines.length} lines)`);
      return '';
    }
    return lines[lineNum - 1];
  }

  const rangeMatch = selector.match(/^lines:(\d+)-(\d+)$/);
  if (rangeMatch) {
    const startLine = parseInt(rangeMatch[1], 10);
    const endLine = parseInt(rangeMatch[2], 10);
    const lines = fullContent.split('\n');
    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      console.warn(`  [WARN] lines:${startLine}-${endLine} out of range (file has ${lines.length} lines)`);
      return '';
    }
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  console.warn(`  [WARN] Unknown selector format: ${selector}, using full file`);
  return fullContent;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function getMaxSeverity(findings: DlpFinding[]): string | null {
  if (findings.length === 0) return null;
  let max: FindingSeverity = findings[0].severity;
  for (const f of findings) {
    if ((SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[max] ?? 0)) {
      max = f.severity;
    }
  }
  return max;
}

function isSecretVisible(action: DlpAction): boolean {
  // Secret is visible in rendered output if the action does not remove/replace it
  return action === 'allow' || action === 'warn' || action === 'summarize_locally';
}

function isVisibilityAllowedByPolicy(mode: SecretProtectionMode, action: DlpAction): boolean {
  if (mode === 'off' || mode === 'observe') return true;
  return action !== 'block' && action !== 'redact';
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function getSourceCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function previewContent(content: string, maxLength = 240): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}... [truncated]`
    : normalized;
}

function getIntegrationStatus(boundary: DlpBoundary): 'wired' | 'scanner_only_not_wired' {
  return SCANNER_ONLY_BOUNDARIES.has(boundary) ? 'scanner_only_not_wired' : 'wired';
}

function renderOutputPreview(decision: DlpDecision, originalContent: string): string {
  switch (decision.action) {
    case 'block':
      return '[BLOCKED]';
    case 'require_approval':
      return '[APPROVAL REQUIRED]';
    case 'redact':
      return previewContent(decision.redactedContent ?? '[REDACTION OUTPUT UNAVAILABLE]');
    case 'summarize_locally':
      return decision.safeSummary ?? '[SUMMARIZED LOCALLY]';
    case 'allow':
    case 'warn':
    default:
      return previewContent(originalContent);
  }
}

async function scanWithBroker(
  boundary: DlpBoundary,
  entry: FixtureEntry,
  content: string,
  settings: SecretProtectionSettings,
  policyConfig: PolicyConfig,
  auditStoreDir: string,
  sessionId: string,
): Promise<DlpDecision> {
  const broker = new SecretProtectionBroker(settings, policyConfig, auditStoreDir, sessionId);

  switch (boundary) {
    case 'prompt.submit':
      return broker.scanPromptSubmission(content, 'anthropic');
    case 'context.attach':
      return broker.scanContextExpansion(content, entry.fixtureFile);
    case 'file.read_for_context':
      return broker.scanFileExposure(entry.fixtureFile, content);
    case 'command.preflight':
      return broker.scanCommandPreflight(content);
    case 'command.output':
      return broker.scanTerminalOutput(content, '');
    case 'git.publish':
      return broker.scanGitPublication(content, `SPB demo fixture ${entry.id}`, 'origin');
    case 'mcp.request':
      return broker.scanMcpRequest(`fixture.${entry.id}`, content, 'https://mcp.example.com');
    case 'browser.capture':
      return broker.scanBrowserCapture(`fixture=${entry.id}; ${previewContent(content, 500)}`, 'example.com');
    case 'persistence.write':
      return broker.scanPersistence(entry.id, content);
    case 'diagnostic.export':
      return broker.scanDiagnosticExport(content, 'diagnostics.example.com');
    default:
      throw new Error(`No broker path is defined for scanner-only boundary ${boundary}`);
  }
}

function scanWithComposite(
  boundary: DlpBoundary,
  content: string,
  settings: SecretProtectionSettings,
  policyConfig: PolicyConfig,
): DlpDecision {
  const destination = classifyDestination(boundary, buildDestinationMetadata(boundary));
  const scanner = new CompositeSecretScanner(settings, getAllRulePacks());
  const policyEngine = new PolicyEngine(policyConfig);
  const scanContext: ScanContext = { boundary, destination };
  const scanResult = scanner.scan(content, scanContext);
  const contentHash = hashContent(content);
  const decision = policyEngine.evaluate(boundary, destination, scanResult.findings, [], contentHash);

  if (decision.action === 'redact' && scanResult.findings.length > 0) {
    const redactionEngine = new RedactionEngine();
    const redactionResult = redactionEngine.redact(content, scanResult.findings);
    decision.redactedContent = redactionResult.redacted;
    decision.audit.redactedBytes = redactionResult.replacedBytes;
    decision.audit.redactionCount = redactionResult.replacementCount;
  }

  return decision;
}

function createDisabledDecision(boundary: DlpBoundary, content: string): DlpDecision {
  const destination = classifyDestination(boundary, buildDestinationMetadata(boundary));
  const contentHash = hashContent(content);
  const audit: AuditEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    boundary,
    action: 'allow',
    ruleIds: [],
    findingTypes: [],
    severityMax: null,
    destinationKind: destination.kind,
    contentHash,
    redactedBytes: 0,
    redactionCount: 0,
  };

  return {
    action: 'allow',
    reason: 'Secret protection disabled for off_exposed mode',
    findings: [],
    audit,
  };
}

function collectAuditLogFiles(auditStoreDir: string): string[] {
  const auditDir = path.join(auditStoreDir, 'audit');
  if (!fs.existsSync(auditDir)) return [];
  return fs.readdirSync(auditDir)
    .filter(file => file.endsWith('.jsonl'))
    .sort()
    .map(file => path.relative(DEMO_DIR, path.join(auditDir, file)).replace(/\\/g, '/'));
}

async function runNoRegressionEvidence(
  testRunId: string,
  auditStoreDir: string,
): Promise<NoRegressionEvidence[]> {
  const extensionPath = path.resolve(DEMO_DIR, '..', '..', 'src', 'extension', 'extension.ts');
  const extensionExcerpt = fs.existsSync(extensionPath)
    ? fs.readFileSync(extensionPath, 'utf-8').slice(0, 6000)
    : 'src/extension/extension.ts not found during no-regression evidence collection';

  let gitStatus = '';
  const gitStart = performance.now();
  try {
    gitStatus = execSync('git status --short', { encoding: 'utf-8' }).trim() || '(working tree clean)';
  } catch (err: unknown) {
    gitStatus = `git status failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  const gitLatencyMs = performance.now() - gitStart;

  const workflowSteps: Array<{ stepId: string; description: string; boundary: DlpBoundary; content: string }> = [
    {
      stepId: 'create-ts-utility-request',
      description: 'Clean prompt asking Claude Code to create a small TypeScript utility',
      boundary: 'prompt.submit',
      content: 'Create a small TypeScript utility in a temp demo folder that formats elapsed milliseconds for display.',
    },
    {
      stepId: 'usage-snippet-request',
      description: 'Clean prompt asking for a usage snippet',
      boundary: 'prompt.submit',
      content: 'Add a short usage snippet for the elapsed-time formatter. Use public example values only.',
    },
    {
      stepId: 'build-output',
      description: 'Representative successful build command output',
      boundary: 'command.output',
      content: 'npm run build\nwebpack 5 compiled successfully\nexit code 0',
    },
    {
      stepId: 'extension-summary-context',
      description: 'Read and summarize src/extension/extension.ts clean context',
      boundary: 'file.read_for_context',
      content: extensionExcerpt,
    },
    {
      stepId: 'git-status-output',
      description: `Actual git status output captured in ${gitLatencyMs.toFixed(1)}ms`,
      boundary: 'command.output',
      content: gitStatus,
    },
  ];

  const modesToCompare = MODES.filter(mode => mode.id === 'off_exposed' || mode.id === 'balanced');
  const steps: NoRegressionStepEvidence[] = [];
  const totals = new Map<string, number>();

  for (const modeDef of modesToCompare) {
    const settings = buildSettings(modeDef);
    const policyConfig = buildPolicyConfig(modeDef);
    let modeLatency = 0;

    for (const step of workflowSteps) {
      const started = performance.now();
      const decision = modeDef.enabled
        ? await scanWithBroker(
          step.boundary,
          {
            id: step.stepId,
            description: step.description,
            category: 'no-regression',
            fixtureFile: step.stepId,
            sampleSelector: 'full-file',
            isClean: true,
            expectedFindingTypes: [],
            expectedRuleIds: [],
            expectedSeverityMin: null,
            applicableBoundaries: [step.boundary],
            mustBeHiddenWhenProtected: false,
          },
          step.content,
          settings,
          policyConfig,
          auditStoreDir,
          `${testRunId}:no-regression:${modeDef.id}`,
        )
        : createDisabledDecision(step.boundary, step.content);
      const latencyMs = performance.now() - started;
      modeLatency += latencyMs;

      const passed = decision.findings.length === 0
        && decision.action !== 'block'
        && decision.action !== 'redact'
        && decision.action !== 'require_approval';

      steps.push({
        stepId: step.stepId,
        description: step.description,
        boundary: step.boundary,
        mode: modeDef.id,
        action: decision.action,
        findingsCount: decision.findings.length,
        latencyMs: parseFloat(latencyMs.toFixed(3)),
        passed,
        notes: passed ? 'No DLP interference on clean workflow step' : decision.reason,
      });
    }

    totals.set(modeDef.id, modeLatency);
  }

  const offLatency = totals.get('off_exposed') ?? 0;
  const balancedLatency = totals.get('balanced') ?? 0;
  const protectedFailures = steps.filter(step => step.mode === 'balanced' && !step.passed);

  return [{
    workflowId: 'claude-code-clean-workflow-proxy',
    generatedAt: new Date().toISOString(),
    evidenceKind: 'automated_clean_payload_proxy',
    modesCompared: modesToCompare.map(mode => mode.id),
    completion: protectedFailures.length === 0 ? 'pass' : 'fail',
    materialDelayMs: parseFloat((balancedLatency - offLatency).toFixed(3)),
    steps,
    summary: protectedFailures.length === 0
      ? 'Automated clean payload proxy completed without DLP block, redaction, or approval gate in balanced mode.'
      : `${protectedFailures.length} balanced-mode clean workflow step(s) had DLP interference.`,
  }];
}

function buildPolicyDecisionMatrix(caseResults: CaseResult[]): Record<string, PolicyDecisionMatrixEntry> {
  const matrix: Record<string, PolicyDecisionMatrixEntry> = {};

  for (const caseResult of caseResults) {
    const key = `${caseResult.mode}:${caseResult.boundary}`;
    if (!matrix[key]) {
      matrix[key] = {
        boundary: caseResult.boundary,
        mode: caseResult.mode,
        actionCounts: {},
        policyViolations: 0,
        policyAllowedVisibleFindings: 0,
      };
    }

    const entry = matrix[key];
    entry.actionCounts[caseResult.action] = (entry.actionCounts[caseResult.action] ?? 0) + 1;
    if (caseResult.policyViolation) entry.policyViolations++;
    if (
      caseResult.secretVisibleInRenderedOutput
      && caseResult.visibilityAllowedByPolicy
      && caseResult.findingsCount > 0
    ) {
      entry.policyAllowedVisibleFindings++;
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runDemoTest(): Promise<void> {
  const startTime = performance.now();
  const testRunId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sourceCommit = getSourceCommit();

  console.log('==========================================================');
  console.log('  Secret Protection Board -- Evidence Runner');
  console.log('==========================================================');
  console.log(`  Run ID:    ${testRunId}`);
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Commit:    ${sourceCommit}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: Load manifest
  // -----------------------------------------------------------------------
  console.log('[1/9] Loading manifest...');
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`  FATAL: manifest.json not found at ${MANIFEST_PATH}`);
    console.error('  Create the manifest first, then re-run.');
    process.exit(1);
  }

  const manifestRaw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  const manifestJson = JSON.parse(manifestRaw);
  const manifest: FixtureEntry[] = Array.isArray(manifestJson) ? manifestJson : manifestJson.fixtures;
  if (!Array.isArray(manifest)) {
    console.error('  FATAL: manifest.json must contain a "fixtures" array');
    process.exit(1);
  }
  console.log(`  Loaded ${manifest.length} fixture entries`);

  const secretFixtures = manifest.filter(f => !f.isClean);
  const cleanFixtures = manifest.filter(f => f.isClean);
  console.log(`  Secret fixtures: ${secretFixtures.length}, Clean fixtures: ${cleanFixtures.length}`);

  // -----------------------------------------------------------------------
  // Step 2: Load fixture files
  // -----------------------------------------------------------------------
  console.log('[2/9] Loading fixture file contents...');
  const fixtureContents = new Map<string, string>();
  const missingFiles: string[] = [];

  for (const entry of manifest) {
    const filePath = path.resolve(FIXTURES_DIR, entry.fixtureFile);
    if (fs.existsSync(filePath)) {
      fixtureContents.set(entry.fixtureFile, fs.readFileSync(filePath, 'utf-8'));
    } else {
      missingFiles.push(entry.fixtureFile);
      console.warn(`  [WARN] Missing fixture file: ${entry.fixtureFile}`);
    }
  }
  console.log(`  Loaded ${fixtureContents.size} files, ${missingFiles.length} missing`);

  // -----------------------------------------------------------------------
  // Step 3: Enumerate rule packs
  // -----------------------------------------------------------------------
  console.log('[3/9] Enumerating rule packs...');
  const rulePacks = getAllRulePacks();
  const allRuleIds = new Set<string>();
  for (const pack of rulePacks) {
    for (const rule of pack.rules) {
      allRuleIds.add(rule.id);
    }
  }
  console.log(`  ${rulePacks.length} enabled rule packs, ${allRuleIds.size} total rules`);

  // -----------------------------------------------------------------------
  // Step 4: Build the test matrix
  // -----------------------------------------------------------------------
  console.log('[4/9] Building boundary x mode x fixture matrix...');
  const caseResults: CaseResult[] = [];
  const allLatencies: number[] = [];
  const auditStoreDir = path.join(RESULTS_DIR, 'audit', testRunId);

  // Collect unique boundaries from manifest
  const manifestBoundaries = new Set<DlpBoundary>();
  for (const entry of manifest) {
    for (const b of entry.applicableBoundaries) {
      manifestBoundaries.add(b);
    }
  }

  let totalCases = 0;
  for (const entry of manifest) {
    totalCases += entry.applicableBoundaries.length * MODES.length;
  }
  console.log(`  Total cases to run: ${totalCases}`);

  // -----------------------------------------------------------------------
  // Step 5: Execute the matrix
  // -----------------------------------------------------------------------
  console.log('[5/9] Running scanner/policy/redaction pipeline...');
  let processedCount = 0;
  let errorCount = 0;

  for (const entry of manifest) {
    const rawContent = fixtureContents.get(entry.fixtureFile);
    if (rawContent === undefined) {
      // Missing file -- skip all cases for this fixture
      for (const boundary of entry.applicableBoundaries) {
        for (const modeDef of MODES) {
          caseResults.push({
            fixtureId: entry.id,
            boundary,
            mode: modeDef.id,
            integrationStatus: modeDef.enabled ? getIntegrationStatus(boundary) : 'disabled',
            executionPath: modeDef.enabled
              ? (WIRED_BOUNDARIES.has(boundary) ? 'broker' : 'scanner_only')
              : 'disabled',
            contentHash: 'missing-file',
            originalContentPreview: '',
            findingsCount: 0,
            findingRuleIds: [],
            findingTypes: [],
            maxSeverity: null,
            action: 'allow',
            reason: 'Fixture file missing',
            renderedContentPreview: '',
            latencyMs: 0,
            secretVisibleInRenderedOutput: !entry.isClean,
            visibilityAllowedByPolicy: true,
            policyViolation: false,
          });
          processedCount++;
        }
      }
      continue;
    }

    const content = extractContent(rawContent, entry.sampleSelector);
    const contentHash = hashContent(content);

    for (const boundary of entry.applicableBoundaries) {
      for (const modeDef of MODES) {
        try {
          const settings = buildSettings(modeDef);
          const policyConfig = buildPolicyConfig(modeDef);
          const integrationStatus = modeDef.enabled ? getIntegrationStatus(boundary) : 'disabled';
          const executionPath: CaseResult['executionPath'] = modeDef.enabled
            ? (WIRED_BOUNDARIES.has(boundary) ? 'broker' : 'scanner_only')
            : 'disabled';

          const scanStart = performance.now();
          const decision = !modeDef.enabled
            ? createDisabledDecision(boundary, content)
            : WIRED_BOUNDARIES.has(boundary)
              ? await scanWithBroker(
                boundary,
                entry,
                content,
                settings,
                policyConfig,
                auditStoreDir,
                `${testRunId}:${modeDef.id}`,
              )
              : scanWithComposite(boundary, content, settings, policyConfig);
          const scanLatency = performance.now() - scanStart;
          if (modeDef.enabled) {
            allLatencies.push(scanLatency);
          }

          // --- Visibility computation ---
          const secretVisible = isSecretVisible(decision.action);
          const visibilityAllowed = isVisibilityAllowedByPolicy(modeDef.mode, decision.action);

          // For off_exposed mode with disabled scanner, all non-clean content is visible
          let effectiveSecretVisible = secretVisible;
          if (modeDef.id === 'off_exposed' && !entry.isClean) {
            effectiveSecretVisible = true;
          }

          const policyViolation = effectiveSecretVisible && !visibilityAllowed && !entry.isClean;

          caseResults.push({
            fixtureId: entry.id,
            boundary,
            mode: modeDef.id,
            integrationStatus,
            executionPath,
            contentHash,
            originalContentPreview: previewContent(content),
            findingsCount: decision.findings.length,
            findingRuleIds: decision.findings.map(f => f.ruleId),
            findingTypes: [...new Set(decision.findings.map(f => f.type))],
            maxSeverity: getMaxSeverity(decision.findings),
            action: decision.action,
            reason: decision.reason,
            redactedContentPreview: decision.redactedContent ? previewContent(decision.redactedContent) : undefined,
            renderedContentPreview: renderOutputPreview(decision, content),
            latencyMs: scanLatency,
            secretVisibleInRenderedOutput: effectiveSecretVisible,
            visibilityAllowedByPolicy: visibilityAllowed,
            policyViolation,
            auditEvent: modeDef.enabled ? decision.audit : undefined,
          });
        } catch (err: unknown) {
          errorCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  [ERROR] ${entry.id} / ${boundary} / ${modeDef.id}: ${msg}`);
          caseResults.push({
            fixtureId: entry.id,
            boundary,
            mode: modeDef.id,
            integrationStatus: modeDef.enabled ? getIntegrationStatus(boundary) : 'disabled',
            executionPath: modeDef.enabled
              ? (WIRED_BOUNDARIES.has(boundary) ? 'broker' : 'scanner_only')
              : 'disabled',
            contentHash,
            originalContentPreview: previewContent(content),
            findingsCount: 0,
            findingRuleIds: [],
            findingTypes: [],
            maxSeverity: null,
            action: 'allow',
            reason: `Scanner error: ${msg}`,
            renderedContentPreview: previewContent(content),
            latencyMs: 0,
            secretVisibleInRenderedOutput: !entry.isClean,
            visibilityAllowedByPolicy: true,
            policyViolation: false,
          });
        }

        processedCount++;
        if (processedCount % 100 === 0 || processedCount === totalCases) {
          process.stdout.write(`  Progress: ${processedCount}/${totalCases} cases (${errorCount} errors)\r`);
        }
      }
    }
  }
  console.log(''); // newline after progress
  console.log(`  Completed ${processedCount} cases, ${errorCount} errors`);
  const acceptanceFailures: string[] = [];
  if (missingFiles.length > 0) {
    acceptanceFailures.push(`Missing fixture files: ${missingFiles.join(', ')}`);
  }
  if (errorCount > 0) {
    acceptanceFailures.push(`${errorCount} scanner/policy case(s) errored`);
  }
  for (const boundary of ALL_BOUNDARIES) {
    if (!manifestBoundaries.has(boundary)) {
      acceptanceFailures.push(`Boundary ${boundary} is not represented in manifest`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 6: Validate expected detections
  // -----------------------------------------------------------------------
  console.log('[6/10] Validating expected detections...');

  // For each secret fixture, check if expectedRuleIds were detected in at least one
  // active scanning mode (exclude off_exposed which has scanners disabled)
  const activeModeIds = MODES.filter(m => m.enabled).map(m => m.id);
  let detectionPassCount = 0;
  let detectionTotalCount = 0;

  for (const entry of secretFixtures) {
    if (entry.expectedRuleIds.length === 0) continue;

    // Gather all detected ruleIds across active modes and applicable boundaries
    const detectedRuleIds = new Set<string>();
    const detectedFindingTypes = new Set<string>();
    const activeEntryCases = caseResults.filter(caseResult =>
      caseResult.fixtureId === entry.id && activeModeIds.includes(caseResult.mode)
    );
    const activeFindingCount = activeEntryCases.reduce((sum, caseResult) => sum + caseResult.findingsCount, 0);
    for (const caseResult of caseResults) {
      if (caseResult.fixtureId !== entry.id) continue;
      if (!activeModeIds.includes(caseResult.mode)) continue;
      for (const ruleId of caseResult.findingRuleIds) {
        detectedRuleIds.add(ruleId);
      }
      for (const findingType of caseResult.findingTypes) {
        detectedFindingTypes.add(findingType);
      }
    }

    const minimumExpectedFindings = entry.minimumExpectedFindings ?? 1;
    if (activeFindingCount < minimumExpectedFindings) {
      const msg = `Fixture "${entry.id}" expected at least ${minimumExpectedFindings} finding(s), got ${activeFindingCount}`;
      console.warn(`  [MISS] ${msg}`);
      acceptanceFailures.push(msg);
    }

    for (const expectedRuleId of entry.expectedRuleIds) {
      detectionTotalCount++;
      if (detectedRuleIds.has(expectedRuleId)) {
        detectionPassCount++;
      } else {
        const msg = `Fixture "${entry.id}" expected rule "${expectedRuleId}" but it was not detected`;
        console.warn(`  [MISS] ${msg}`);
        acceptanceFailures.push(msg);
      }
    }

    for (const expectedFindingType of entry.expectedFindingTypes) {
      if (!detectedFindingTypes.has(expectedFindingType)) {
        const msg = `Fixture "${entry.id}" expected finding type "${expectedFindingType}" but it was not detected`;
        console.warn(`  [MISS] ${msg}`);
        acceptanceFailures.push(msg);
      }
    }

    if (entry.expectedSeverityMin) {
      const maxRank = Math.max(
        0,
        ...activeEntryCases
          .map(caseResult => caseResult.maxSeverity ? (SEVERITY_RANK[caseResult.maxSeverity] ?? 0) : 0),
      );
      const minRank = SEVERITY_RANK[entry.expectedSeverityMin] ?? 0;
      if (maxRank < minRank) {
        const msg = `Fixture "${entry.id}" expected severity >= ${entry.expectedSeverityMin}`;
        console.warn(`  [MISS] ${msg}`);
        acceptanceFailures.push(msg);
      }
    }
  }

  const expectedDetectionPassRate = detectionTotalCount > 0
    ? detectionPassCount / detectionTotalCount
    : 1;
  console.log(`  Detection pass rate: ${(expectedDetectionPassRate * 100).toFixed(1)}% (${detectionPassCount}/${detectionTotalCount})`);

  // -----------------------------------------------------------------------
  // Step 7: Validate clean corpus false positives
  // -----------------------------------------------------------------------
  console.log('[7/10] Validating clean corpus false positives...');
  let cleanCasesTotal = 0;
  let cleanFalsePositives = 0;

  for (const caseResult of caseResults) {
    const entry = manifest.find(e => e.id === caseResult.fixtureId);
    if (!entry || !entry.isClean) continue;
    if (!activeModeIds.includes(caseResult.mode)) continue;

    cleanCasesTotal++;
    if (caseResult.findingsCount > 0) {
      cleanFalsePositives++;
      console.warn(`  [FP] Clean fixture "${caseResult.fixtureId}" / ${caseResult.boundary} / ${caseResult.mode}: ${caseResult.findingsCount} finding(s) - rules: ${caseResult.findingRuleIds.join(', ')}`);
      if (caseResult.mode === 'balanced' || caseResult.mode === 'strict' || caseResult.mode === 'balanced_entropy') {
        acceptanceFailures.push(
          `Clean fixture "${caseResult.fixtureId}" produced findings in protected mode ${caseResult.mode} (${caseResult.boundary})`,
        );
      }
    }
  }

  const cleanFalsePositiveRate = cleanCasesTotal > 0
    ? cleanFalsePositives / cleanCasesTotal
    : 0;
  console.log(`  False positive rate: ${(cleanFalsePositiveRate * 100).toFixed(1)}% (${cleanFalsePositives}/${cleanCasesTotal})`);

  // -----------------------------------------------------------------------
  // Step 8: Run command risk tests
  // -----------------------------------------------------------------------
  console.log('[8/10] Running command risk classifier...');
  const commandRiskResults: CommandRiskResult[] = [];

  // Scan all files in the commands directory
  const commandsDir = path.join(FIXTURES_DIR, 'commands');
  if (fs.existsSync(commandsDir)) {
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.txt'));

    for (const cmdFile of commandFiles) {
      const cmdFilePath = path.join(commandsDir, cmdFile);
      const cmdContent = fs.readFileSync(cmdFilePath, 'utf-8');
      const lines = cmdContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        try {
          const risk = classifyCommandRisk(trimmed);
          commandRiskResults.push({
            command: trimmed,
            source: cmdFile,
            classes: risk.classes,
            severity: risk.severity,
            requiresApproval: risk.requiresApproval,
            hardBlock: risk.hardBlock,
            explanation: risk.explanation,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  [ERROR] Command "${trimmed}": ${msg}`);
          commandRiskResults.push({
            command: trimmed,
            source: cmdFile,
            classes: [],
            severity: 'low',
            requiresApproval: false,
            hardBlock: false,
            explanation: `Error: ${msg}`,
          });
        }
      }
    }
  }
  console.log(`  Classified ${commandRiskResults.length} commands`);

  // -----------------------------------------------------------------------
  // Step 9: Run no-regression clean workflow proxy
  // -----------------------------------------------------------------------
  console.log('[9/10] Running no-regression clean workflow proxy...');
  const noRegressionEvidence = await runNoRegressionEvidence(testRunId, auditStoreDir);
  for (const workflow of noRegressionEvidence) {
    if (workflow.completion !== 'pass') {
      acceptanceFailures.push(`No-regression workflow "${workflow.workflowId}" failed: ${workflow.summary}`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 10: Aggregate and write report
  // -----------------------------------------------------------------------
  console.log('[10/10] Aggregating results and writing report...');

  // --- Boundary coverage ---
  const boundaryCoverage: BoundaryCoverageEntry[] = [];
  for (const boundary of ALL_BOUNDARIES) {
    const boundaryCases = caseResults.filter(c => c.boundary === boundary);
    const totalFindings = boundaryCases.reduce((sum, c) => sum + c.findingsCount, 0);
    const isWired = WIRED_BOUNDARIES.has(boundary);

    boundaryCoverage.push({
      boundary,
      integrationStatus: isWired ? 'wired' : 'scanner_only_not_wired',
      casesRun: boundaryCases.length,
      findings: totalFindings,
      notes: boundaryCases.length === 0
        ? 'No fixtures target this boundary'
        : `${totalFindings} total findings across ${boundaryCases.length} cases`,
    });
  }

  // --- Rule coverage ---
  // Collect all expected rule IDs from the manifest
  const expectedRuleIdSet = new Set<string>();
  for (const entry of manifest) {
    for (const ruleId of entry.expectedRuleIds) {
      expectedRuleIdSet.add(ruleId);
    }
  }

  const ruleCoverage: RuleCoverageEntry[] = [];
  for (const ruleId of expectedRuleIdSet) {
    // Which fixtures expect this rule?
    const coveringFixtureIds: string[] = [];
    for (const entry of manifest) {
      if (entry.expectedRuleIds.includes(ruleId)) {
        coveringFixtureIds.push(entry.id);
      }
    }

    // Was this rule actually detected?
    let detected = false;
    const boundaryEvidence = new Set<string>();
    for (const caseResult of caseResults) {
      if (!activeModeIds.includes(caseResult.mode)) continue;
      if (caseResult.findingRuleIds.includes(ruleId)) {
        detected = true;
        boundaryEvidence.add(caseResult.boundary);
      }
    }

    ruleCoverage.push({
      ruleId,
      coveredByFixtureIds: coveringFixtureIds,
      detected,
      boundaryEvidence: [...boundaryEvidence],
    });
  }

  const expectedRuleCoverageRate = ruleCoverage.length > 0
    ? ruleCoverage.filter(r => r.detected).length / ruleCoverage.length
    : 1;

  // --- Mode comparison ---
  const modeComparison: Record<string, ModeStats> = {};
  for (const modeDef of MODES) {
    const modeCases = caseResults.filter(c => c.mode === modeDef.id);
    const stats: ModeStats = {
      totalCases: modeCases.length,
      secretsExposed: 0,
      policyAllowedVisibleFindings: 0,
      secretsBlocked: 0,
      secretsRedacted: 0,
      secretsWarned: 0,
      secretsApprovalRequired: 0,
      secretsAllowed: 0,
      policyViolations: 0,
    };

    for (const c of modeCases) {
      const entry = manifest.find(e => e.id === c.fixtureId);
      if (!entry || entry.isClean) continue; // Only count secret fixtures

      if (c.secretVisibleInRenderedOutput) stats.secretsExposed++;
      if (c.secretVisibleInRenderedOutput && c.visibilityAllowedByPolicy && c.findingsCount > 0) {
        stats.policyAllowedVisibleFindings++;
      }
      switch (c.action) {
        case 'block': stats.secretsBlocked++; break;
        case 'redact': stats.secretsRedacted++; break;
        case 'warn': stats.secretsWarned++; break;
        case 'require_approval': stats.secretsApprovalRequired++; break;
        case 'allow': stats.secretsAllowed++; break;
        case 'summarize_locally': stats.secretsAllowed++; break;
      }
      if (c.policyViolation) stats.policyViolations++;
    }

    modeComparison[modeDef.id] = stats;
  }

  // --- Performance metrics ---
  const sortedLatencies = [...allLatencies].sort((a, b) => a - b);
  const performanceMetrics: PerformanceMetrics = {
    totalScanCount: allLatencies.length,
    avgLatencyMs: allLatencies.length > 0
      ? parseFloat((allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length).toFixed(3))
      : 0,
    p50LatencyMs: parseFloat(percentile(sortedLatencies, 50).toFixed(3)),
    p95LatencyMs: parseFloat(percentile(sortedLatencies, 95).toFixed(3)),
    p99LatencyMs: parseFloat(percentile(sortedLatencies, 99).toFixed(3)),
    maxLatencyMs: sortedLatencies.length > 0
      ? parseFloat(sortedLatencies[sortedLatencies.length - 1].toFixed(3))
      : 0,
  };

  // --- Policy violations ---
  const policyViolatingExposures = caseResults.filter(c => c.policyViolation).length;
  const policyAllowedVisibleFindings = caseResults.filter(c =>
    c.secretVisibleInRenderedOutput && c.visibilityAllowedByPolicy && c.findingsCount > 0 && !c.fixtureId.startsWith('clean-')
  ).length;
  if (policyViolatingExposures > 0) {
    acceptanceFailures.push(`${policyViolatingExposures} protected-mode policy-violating exposure(s) detected`);
  }

  const policyDecisionMatrix = buildPolicyDecisionMatrix(caseResults);
  const screenshotManifest = {
    schema: 'screenshot-manifest-v1',
    generatedAt: new Date().toISOString(),
    screenshots: [] as Array<{
      id: string;
      scenario: string;
      path: string;
      capturedAt: string;
      notes?: string;
    }>,
    notes: 'Populate this file during the live VS Code demo; automated harness records the file even when no screenshots are captured.',
  };
  const liveEvidence = {
    schema: 'live-evidence-v1',
    generatedAt: new Date().toISOString(),
    status: 'not_recorded',
    scenarios: [] as Array<Record<string, unknown>>,
    noRegressionEvidence,
    notes: 'Live VS Code screenshots/audit observations are captured manually using DEMO_GUIDE.md; automated proxy evidence is embedded here.',
  };
  const reportInputs: ReportInputs = {
    screenshots: screenshotManifest.screenshots.map(s => s.path),
    auditLogFiles: collectAuditLogFiles(auditStoreDir),
    outputLogFiles: [],
  };

  // --- Build final results ---
  const results: DemoResults = {
    metadata: {
      testRunId,
      timestamp,
      sourceCommit,
      scannerCountExpected: 10, // Env, Regex, Entropy, Path, Structured, PII, Extension, Webview, Server, Git
      rulePackCountExpected: rulePacks.length,
      boundaryCountExpected: ALL_BOUNDARIES.length,
    },
    summary: {
      fixturesTotal: manifest.length,
      secretFixtures: secretFixtures.length,
      cleanFixtures: cleanFixtures.length,
      boundariesTested: manifestBoundaries.size,
      modesTested: MODES.length,
      expectedRuleCoverageRate: parseFloat(expectedRuleCoverageRate.toFixed(4)),
      expectedDetectionPassRate: parseFloat(expectedDetectionPassRate.toFixed(4)),
      cleanFalsePositiveRate: parseFloat(cleanFalsePositiveRate.toFixed(4)),
      policyViolatingExposures,
      policyAllowedVisibleFindings,
      p95ScanLatencyMs: performanceMetrics.p95LatencyMs,
    },
    boundaryCoverage,
    ruleCoverage,
    modeComparison,
    caseResults,
    commandRiskResults,
    noRegressionEvidence,
    performanceMetrics,
    policyDecisionMatrix,
    reportInputs,
    acceptanceFailures,
  };

  // --- Ensure results directory exists ---
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  fs.writeFileSync(DEMO_RESULTS_PATH, JSON.stringify(results, null, 2), 'utf-8');
  fs.writeFileSync(LIVE_EVIDENCE_PATH, JSON.stringify(liveEvidence, null, 2), 'utf-8');
  fs.writeFileSync(SCREENSHOT_MANIFEST_PATH, JSON.stringify(screenshotManifest, null, 2), 'utf-8');

  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);

  // --- Print summary ---
  console.log('');
  console.log('==========================================================');
  console.log('  Results Summary');
  console.log('==========================================================');
  console.log(`  Total fixtures:           ${manifest.length} (${secretFixtures.length} secret, ${cleanFixtures.length} clean)`);
  console.log(`  Boundaries tested:        ${manifestBoundaries.size}/${ALL_BOUNDARIES.length}`);
  console.log(`  Modes tested:             ${MODES.length}`);
  console.log(`  Total cases executed:     ${processedCount}`);
  console.log(`  Errors:                   ${errorCount}`);
  console.log('');
  console.log(`  Rule coverage rate:       ${(expectedRuleCoverageRate * 100).toFixed(1)}%`);
  console.log(`  Detection pass rate:      ${(expectedDetectionPassRate * 100).toFixed(1)}%`);
  console.log(`  Clean FP rate:            ${(cleanFalsePositiveRate * 100).toFixed(1)}%`);
  console.log(`  Policy violations:        ${policyViolatingExposures}`);
  console.log(`  Policy-allowed visible:   ${policyAllowedVisibleFindings}`);
  console.log(`  Acceptance failures:      ${acceptanceFailures.length}`);
  console.log('');
  console.log('  Mode Comparison:');
  for (const modeDef of MODES) {
    const s = modeComparison[modeDef.id];
    console.log(`    ${modeDef.id.padEnd(20)} | blocked=${s.secretsBlocked} redacted=${s.secretsRedacted} warned=${s.secretsWarned} approval=${s.secretsApprovalRequired} allowed=${s.secretsAllowed} exposed=${s.secretsExposed} violations=${s.policyViolations}`);
  }
  console.log('');
  console.log(`  Performance (${allLatencies.length} scans):`);
  console.log(`    avg=${performanceMetrics.avgLatencyMs}ms  p50=${performanceMetrics.p50LatencyMs}ms  p95=${performanceMetrics.p95LatencyMs}ms  p99=${performanceMetrics.p99LatencyMs}ms  max=${performanceMetrics.maxLatencyMs}ms`);
  console.log('');
  console.log(`  Command risk:             ${commandRiskResults.length} commands classified`);
  console.log(`  No-regression:            ${noRegressionEvidence[0]?.completion ?? 'unknown'}`);
  console.log(`  Total duration:           ${totalDuration}s`);
  console.log(`  Output:                   ${DEMO_RESULTS_PATH}`);
  console.log(`  Live evidence:            ${LIVE_EVIDENCE_PATH}`);
  console.log(`  Screenshot manifest:      ${SCREENSHOT_MANIFEST_PATH}`);
  console.log('==========================================================');

  if (acceptanceFailures.length > 0) {
    console.error('');
    console.error('Acceptance failures:');
    for (const failure of acceptanceFailures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
runDemoTest().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
