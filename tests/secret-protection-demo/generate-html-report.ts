/**
 * Secret Protection Demo - HTML Report Generator
 *
 * Reads ./results/demo-results.json, live-evidence.json, screenshot-manifest.json and generates
 * ./results/secret-protection-demo-report.html
 *
 * Run: npx tsx tests/secret-protection-demo/generate-html-report.ts
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    policyAllowedVisibleFindings?: number;
    p95ScanLatencyMs: number;
  };
  boundaryCoverage: Array<{
    boundary: string;
    integrationStatus: "wired" | "scanner_only_not_wired";
    casesRun: number;
    findings: number;
    notes: string;
  }>;
  ruleCoverage: Array<{
    ruleId: string;
    coveredByFixtureIds: string[];
    detected: boolean;
    boundaryEvidence: string[];
  }>;
  modeComparison: Record<
    string,
    {
      totalCases: number;
      secretsExposed: number;
      policyAllowedVisibleFindings?: number;
      secretsBlocked: number;
      secretsRedacted: number;
      secretsWarned: number;
      secretsApprovalRequired: number;
      secretsAllowed: number;
      policyViolations: number;
    }
  >;
  caseResults: Array<{
    fixtureId: string;
    boundary: string;
    mode: string;
    integrationStatus?: "wired" | "scanner_only_not_wired" | "disabled";
    executionPath?: "broker" | "scanner_only" | "disabled";
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
    auditEvent?: {
      id: string;
      timestamp: string;
      boundary: string;
      action: string;
      ruleIds: string[];
      findingTypes: string[];
      severityMax: string | null;
      destinationKind: string;
      redactedBytes: number;
      redactionCount: number;
    };
  }>;
  commandRiskResults: Array<{
    command: string;
    source: string;
    classes: string[];
    severity: string;
    requiresApproval: boolean;
    hardBlock: boolean;
    explanation: string;
  }>;
  performanceMetrics: {
    totalScanCount: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
  };
  noRegressionEvidence?: Array<{
    workflowId: string;
    generatedAt: string;
    evidenceKind: string;
    modesCompared: string[];
    completion: "pass" | "fail";
    materialDelayMs: number;
    steps: Array<{
      stepId: string;
      description: string;
      boundary: string;
      mode: string;
      action: string;
      findingsCount: number;
      latencyMs: number;
      passed: boolean;
      notes: string;
    }>;
    summary: string;
  }>;
  policyDecisionMatrix?: Record<string, {
    boundary: string;
    mode: string;
    actionCounts: Record<string, number>;
    policyViolations: number;
    policyAllowedVisibleFindings: number;
  }>;
  reportInputs?: {
    screenshots: string[];
    auditLogFiles: string[];
    outputLogFiles: string[];
  };
  acceptanceFailures?: string[];
}

interface LiveEvidence {
  schema?: string;
  generatedAt?: string;
  status?: string;
  scenarios?: Array<Record<string, unknown>>;
  noRegressionEvidence?: DemoResults["noRegressionEvidence"];
  notes?: string;
}

interface ScreenshotManifest {
  schema?: string;
  generatedAt?: string;
  screenshots?: Array<{
    id: string;
    scenario: string;
    path: string;
    capturedAt: string;
    notes?: string;
  }>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent XSS */
function esc(value: unknown): string {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a number as a percentage string with 1 decimal place */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Format a latency value with 1 decimal */
function lat(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/** Return a CSS class name based on a pass/fail/warn condition */
function statusClass(
  value: number,
  thresholds: { good: number; warn: number },
  higherIsBetter: boolean
): string {
  if (higherIsBetter) {
    if (value >= thresholds.good) return "card-good";
    if (value >= thresholds.warn) return "card-warn";
    return "card-bad";
  }
  if (value <= thresholds.good) return "card-good";
  if (value <= thresholds.warn) return "card-warn";
  return "card-bad";
}

/** Truncate a string to maxLen characters */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function readOptionalJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (err: unknown) {
    console.warn(`Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildStyles(): string {
  return `<style>
  :root {
    --blue: #2563eb;
    --blue-dark: #1d4ed8;
    --green: #16a34a;
    --green-bg: #dcfce7;
    --red: #dc2626;
    --red-bg: #fef2f2;
    --yellow: #d97706;
    --yellow-bg: #fefce8;
    --gray-50: #f9fafb;
    --gray-100: #f3f4f6;
    --gray-200: #e5e7eb;
    --gray-300: #d1d5db;
    --gray-500: #6b7280;
    --gray-700: #374151;
    --gray-900: #111827;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    color: var(--gray-900);
    background: var(--gray-50);
    line-height: 1.6;
    padding: 0;
  }

  .report-header {
    background: linear-gradient(135deg, var(--blue), var(--blue-dark));
    color: #fff;
    padding: 2rem 2.5rem;
  }
  .report-header h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
  .report-header .meta { font-size: 0.85rem; opacity: 0.85; }
  .report-header .meta span { margin-right: 1.5rem; }

  .container { max-width: 1280px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

  section { margin-bottom: 2.5rem; }
  section > h2 {
    font-size: 1.35rem;
    color: var(--blue);
    border-bottom: 2px solid var(--blue);
    padding-bottom: 0.35rem;
    margin-bottom: 1rem;
  }

  /* Card grid */
  .card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .card {
    flex: 1 1 180px;
    max-width: 220px;
    border-radius: 8px;
    padding: 1.1rem 1.2rem;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  .card .label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.3rem; }
  .card .value { font-size: 1.6rem; font-weight: 700; }
  .card-good  { background: var(--green-bg); color: var(--green); border: 1px solid #bbf7d0; }
  .card-bad   { background: var(--red-bg);   color: var(--red);   border: 1px solid #fecaca; }
  .card-warn  { background: var(--yellow-bg);color: var(--yellow); border: 1px solid #fde68a; }
  .card-neutral { background: #fff; color: var(--gray-700); border: 1px solid var(--gray-200); }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    background: #fff;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  }
  th {
    background: var(--blue);
    color: #fff;
    font-weight: 600;
    padding: 0.6rem 0.75rem;
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--gray-100);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: var(--gray-50); }
  tr:hover td { background: #eef2ff; }

  .cell-good { background: var(--green-bg) !important; color: var(--green); font-weight: 600; }
  .cell-bad  { background: var(--red-bg)   !important; color: var(--red);   font-weight: 600; }
  .cell-warn { background: var(--yellow-bg) !important; color: var(--yellow); font-weight: 600; }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge-green  { background: var(--green-bg); color: var(--green); border: 1px solid #bbf7d0; }
  .badge-yellow { background: var(--yellow-bg); color: var(--yellow); border: 1px solid #fde68a; }
  .badge-red    { background: var(--red-bg); color: var(--red); border: 1px solid #fecaca; }

  .check { color: var(--green); font-weight: 700; }
  .cross { color: var(--red); font-weight: 700; }

  /* Collapsible details */
  details { margin-bottom: 0.5rem; }
  details summary {
    cursor: pointer;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    background: var(--gray-100);
    border-radius: 6px;
    user-select: none;
  }
  details[open] summary { border-radius: 6px 6px 0 0; }
  details .detail-content {
    padding: 0.5rem 0.75rem;
    background: #fff;
    border: 1px solid var(--gray-200);
    border-top: none;
    border-radius: 0 0 6px 6px;
  }

  /* Performance bars */
  .perf-bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .perf-bar-label { width: 80px; font-size: 0.82rem; font-weight: 600; text-align: right; }
  .perf-bar-track { flex: 1; height: 22px; background: var(--gray-100); border-radius: 4px; overflow: hidden; position: relative; }
  .perf-bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding-left: 6px; font-size: 0.75rem; color: #fff; font-weight: 600; white-space: nowrap; }
  .perf-bar-value { width: 80px; font-size: 0.82rem; text-align: left; }

  /* Redaction example */
  .redaction-example {
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 0.75rem;
  }
  .redaction-example .example-header { font-weight: 600; margin-bottom: 0.4rem; color: var(--blue); }
  .redaction-example .example-meta { font-size: 0.8rem; color: var(--gray-500); margin-bottom: 0.5rem; }
  .redaction-example pre {
    background: var(--gray-50);
    padding: 0.6rem;
    border-radius: 4px;
    font-size: 0.82rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .no-data { color: var(--gray-500); font-style: italic; padding: 1rem; }

  .footer {
    text-align: center;
    font-size: 0.8rem;
    color: var(--gray-500);
    padding: 1.5rem 0;
    border-top: 1px solid var(--gray-200);
    margin-top: 2rem;
  }

  @media (max-width: 768px) {
    .container { padding: 1rem; }
    .card { max-width: 100%; }
    table { font-size: 0.8rem; }
    th, td { padding: 0.4rem; }
  }
</style>`;
}

function buildHeader(data: DemoResults): string {
  const m = data.metadata;
  return `<header class="report-header">
  <h1>Secret Protection Broker - Demo Evidence Report</h1>
  <div class="meta">
    <span>Test Run: ${esc(m.testRunId)}</span>
    <span>Timestamp: ${esc(m.timestamp)}</span>
    <span>Commit: ${esc(m.sourceCommit)}</span>
    <span>Scanners: ${esc(m.scannerCountExpected)}</span>
    <span>Rule Packs: ${esc(m.rulePackCountExpected)}</span>
    <span>Boundaries: ${esc(m.boundaryCountExpected)}</span>
  </div>
</header>`;
}

function buildExecutiveSummary(data: DemoResults): string {
  const s = data.summary;
  const cards = [
    {
      label: "Total Fixtures",
      value: String(s.fixturesTotal),
      cls: "card-neutral",
    },
    {
      label: "Detection Pass Rate",
      value: pct(s.expectedDetectionPassRate),
      cls: statusClass(s.expectedDetectionPassRate, { good: 0.95, warn: 0.8 }, true),
    },
    {
      label: "Rule Coverage Rate",
      value: pct(s.expectedRuleCoverageRate),
      cls: statusClass(s.expectedRuleCoverageRate, { good: 0.9, warn: 0.7 }, true),
    },
    {
      label: "False Positive Rate",
      value: pct(s.cleanFalsePositiveRate),
      cls: statusClass(s.cleanFalsePositiveRate, { good: 0.05, warn: 0.15 }, false),
    },
    {
      label: "Policy Violations",
      value: String(s.policyViolatingExposures),
      cls: s.policyViolatingExposures === 0 ? "card-good" : "card-bad",
    },
    {
      label: "Policy-Allowed Visible",
      value: String(s.policyAllowedVisibleFindings ?? 0),
      cls: "card-neutral",
    },
    {
      label: "Acceptance Failures",
      value: String(data.acceptanceFailures?.length ?? 0),
      cls: (data.acceptanceFailures?.length ?? 0) === 0 ? "card-good" : "card-bad",
    },
    {
      label: "P95 Latency",
      value: lat(s.p95ScanLatencyMs),
      cls: statusClass(s.p95ScanLatencyMs, { good: 50, warn: 200 }, false),
    },
  ];

  const cardsHtml = cards
    .map(
      (c) => `<div class="card ${c.cls}">
      <div class="label">${esc(c.label)}</div>
      <div class="value">${esc(c.value)}</div>
    </div>`
    )
    .join("\n    ");

  return `<section>
  <h2>Executive Summary</h2>
  <div class="card-grid">
    ${cardsHtml}
  </div>
  <p style="margin-top:1rem;font-size:0.85rem;color:var(--gray-500);">
    ${esc(s.secretFixtures)} secret fixtures, ${esc(s.cleanFixtures)} clean fixtures,
    ${esc(s.boundariesTested)} boundaries tested, ${esc(s.modesTested)} modes tested.
  </p>
</section>`;
}

function buildModeComparison(data: DemoResults): string {
  const modes = data.modeComparison;
  if (!modes || Object.keys(modes).length === 0) {
    return `<section><h2>Mode Comparison</h2><p class="no-data">No data</p></section>`;
  }

  // Preferred mode order
  const preferredOrder = ["off_exposed", "off_oracle_scan", "observe", "balanced", "strict", "balanced_entropy"];
  const modeKeys = Object.keys(modes).sort((a, b) => {
    const ia = preferredOrder.indexOf(a);
    const ib = preferredOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const rows = modeKeys
    .map((mode) => {
      const m = modes[mode];
      const exposedCls = m.secretsExposed > 0 ? "cell-bad" : "cell-good";
      const blockedCls = m.secretsBlocked > 0 ? "cell-good" : "";
      const redactedCls = m.secretsRedacted > 0 ? "cell-good" : "";
      const violationCls = m.policyViolations > 0 ? "cell-bad" : "cell-good";
      return `<tr>
      <td><strong>${esc(mode)}</strong></td>
      <td>${m.totalCases}</td>
      <td class="${exposedCls}">${m.secretsExposed}</td>
      <td class="${blockedCls}">${m.secretsBlocked}</td>
      <td class="${redactedCls}">${m.secretsRedacted}</td>
      <td>${m.secretsWarned}</td>
      <td>${m.secretsApprovalRequired}</td>
      <td>${m.secretsAllowed}</td>
      <td>${m.policyAllowedVisibleFindings ?? 0}</td>
      <td class="${violationCls}">${m.policyViolations}</td>
    </tr>`;
    })
    .join("\n    ");

  return `<section>
  <h2>Mode Comparison</h2>
  <table>
    <thead>
      <tr>
        <th>Mode</th><th>Total Cases</th><th>Secrets Exposed</th>
        <th>Blocked</th><th>Redacted</th><th>Warned</th>
        <th>Approval Required</th><th>Allowed</th><th>Policy-Allowed Visible</th><th>Policy Violations</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

function buildBoundaryCoverage(data: DemoResults): string {
  const boundaries = data.boundaryCoverage;
  if (!boundaries || boundaries.length === 0) {
    return `<section><h2>Boundary Coverage</h2><p class="no-data">No data</p></section>`;
  }

  const rows = boundaries
    .map((b) => {
      const badge =
        b.integrationStatus === "wired"
          ? '<span class="badge badge-green">Wired</span>'
          : '<span class="badge badge-yellow">Scanner Only</span>';
      return `<tr>
      <td>${esc(b.boundary)}</td>
      <td>${badge}</td>
      <td>${b.casesRun}</td>
      <td>${b.findings}</td>
      <td>${esc(b.notes)}</td>
    </tr>`;
    })
    .join("\n    ");

  return `<section>
  <h2>Boundary Coverage</h2>
  <table>
    <thead>
      <tr><th>Boundary</th><th>Integration Status</th><th>Cases Run</th><th>Findings</th><th>Notes</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

function buildRuleCoverage(data: DemoResults): string {
  const rules = data.ruleCoverage;
  if (!rules || rules.length === 0) {
    return `<section><h2>Rule Coverage</h2><p class="no-data">No data</p></section>`;
  }

  const rows = rules
    .map((r) => {
      const icon = r.detected
        ? '<span class="check">&#10003;</span>'
        : '<span class="cross">&#10007;</span>';
      const rowCls = r.detected ? "" : ' style="background:var(--red-bg);"';
      return `<tr${rowCls}>
      <td>${esc(r.ruleId)}</td>
      <td>${r.coveredByFixtureIds.map((f) => esc(f)).join(", ") || "-"}</td>
      <td>${icon}</td>
      <td>${r.boundaryEvidence.map((b) => esc(b)).join(", ") || "-"}</td>
    </tr>`;
    })
    .join("\n    ");

  return `<section>
  <h2>Rule Coverage</h2>
  <table>
    <thead>
      <tr><th>Rule ID</th><th>Covered By Fixtures</th><th>Detected</th><th>Boundary Evidence</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

function buildDetectionExamples(data: DemoResults): string {
  // Pick protected-mode cases that show before/after behavior.
  const examples = (data.caseResults || [])
    .filter(
      (c) =>
        c.originalContentPreview &&
        c.renderedContentPreview &&
        c.mode === "balanced" &&
        c.findingsCount > 0
    )
    .slice(0, 10);

  // If not enough from balanced, fill from any mode
  if (examples.length < 5) {
    const additional = (data.caseResults || [])
      .filter(
        (c) =>
          c.originalContentPreview &&
          c.renderedContentPreview &&
          c.findingsCount > 0 &&
          !examples.some((e) => e.fixtureId === c.fixtureId && e.boundary === c.boundary)
      )
      .slice(0, 10 - examples.length);
    examples.push(...additional);
  }

  if (examples.length === 0) {
    return `<section><h2>Detection Examples</h2><p class="no-data">No redaction examples available</p></section>`;
  }

  const examplesHtml = examples
    .map(
      (c) => `<div class="redaction-example">
    <div class="example-header">${esc(c.fixtureId)}</div>
    <div class="example-meta">
      Boundary: ${esc(c.boundary)} | Mode: ${esc(c.mode)} | Action: ${esc(c.action)}
      ${c.findingRuleIds.length > 0 ? " | Rules: " + c.findingRuleIds.map((r) => esc(r)).join(", ") : ""}
    </div>
    <strong>Before</strong>
    <pre>${esc(c.originalContentPreview)}</pre>
    <strong>After</strong>
    <pre>${esc(c.renderedContentPreview)}</pre>
  </div>`
    )
    .join("\n  ");

  return `<section>
  <h2>Detection Examples</h2>
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--gray-500);">
    Showing ${examples.length} before/after enforcement example(s) from scan results.
  </p>
  ${examplesHtml}
</section>`;
}

function buildCommandRisk(data: DemoResults): string {
  const cmds = data.commandRiskResults;
  if (!cmds || cmds.length === 0) {
    return `<section><h2>Command Risk Analysis</h2><p class="no-data">No data</p></section>`;
  }

  const severityClass = (sev: string): string => {
    const s = sev.toLowerCase();
    if (s === "critical" || s === "high") return "cell-bad";
    if (s === "medium") return "cell-warn";
    return "";
  };

  const rows = cmds
    .map(
      (c) => `<tr>
      <td><code>${esc(truncate(c.command, 60))}</code></td>
      <td>${esc(c.source)}</td>
      <td>${c.classes.map((cl) => esc(cl)).join(", ")}</td>
      <td class="${severityClass(c.severity)}">${esc(c.severity)}</td>
      <td>${c.requiresApproval ? '<span class="badge badge-yellow">Yes</span>' : "No"}</td>
      <td>${c.hardBlock ? '<span class="badge badge-red">Yes</span>' : "No"}</td>
    </tr>`
    )
    .join("\n    ");

  return `<section>
  <h2>Command Risk Analysis</h2>
  <table>
    <thead>
      <tr>
        <th>Command</th><th>Source</th><th>Risk Classes</th>
        <th>Severity</th><th>Requires Approval</th><th>Hard Block</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

function buildPerformanceMetrics(data: DemoResults): string {
  const p = data.performanceMetrics;
  if (!p) {
    return `<section><h2>Performance Metrics</h2><p class="no-data">No data</p></section>`;
  }

  const maxVal = Math.max(p.maxLatencyMs, 1); // avoid division by zero

  interface BarDef {
    label: string;
    value: number;
    color: string;
  }

  const bars: BarDef[] = [
    { label: "Avg", value: p.avgLatencyMs, color: "#3b82f6" },
    { label: "P50", value: p.p50LatencyMs, color: "#22c55e" },
    { label: "P95", value: p.p95LatencyMs, color: "#eab308" },
    { label: "P99", value: p.p99LatencyMs, color: "#f97316" },
    { label: "Max", value: p.maxLatencyMs, color: "#ef4444" },
  ];

  const barsHtml = bars
    .map((b) => {
      const widthPct = Math.max((b.value / maxVal) * 100, 2);
      return `<div class="perf-bar-container">
      <div class="perf-bar-label">${esc(b.label)}</div>
      <div class="perf-bar-track">
        <div class="perf-bar-fill" style="width:${widthPct.toFixed(1)}%;background:${b.color};">
          ${widthPct > 12 ? lat(b.value) : ""}
        </div>
      </div>
      <div class="perf-bar-value">${lat(b.value)}</div>
    </div>`;
    })
    .join("\n    ");

  return `<section>
  <h2>Performance Metrics</h2>
  <div class="card-grid" style="margin-bottom:1.25rem;">
    <div class="card card-neutral">
      <div class="label">Total Scans</div>
      <div class="value">${p.totalScanCount}</div>
    </div>
    <div class="card card-neutral">
      <div class="label">Avg Latency</div>
      <div class="value">${lat(p.avgLatencyMs)}</div>
    </div>
    <div class="card card-neutral">
      <div class="label">P50 Latency</div>
      <div class="value">${lat(p.p50LatencyMs)}</div>
    </div>
    <div class="card ${statusClass(p.p95LatencyMs, { good: 50, warn: 200 }, false)}">
      <div class="label">P95 Latency</div>
      <div class="value">${lat(p.p95LatencyMs)}</div>
    </div>
    <div class="card card-neutral">
      <div class="label">P99 Latency</div>
      <div class="value">${lat(p.p99LatencyMs)}</div>
    </div>
    <div class="card card-neutral">
      <div class="label">Max Latency</div>
      <div class="value">${lat(p.maxLatencyMs)}</div>
    </div>
  </div>
  <h3 style="font-size:1rem;margin-bottom:0.5rem;color:var(--gray-700);">Latency Distribution</h3>
  <div style="max-width:700px;">
    ${barsHtml}
  </div>
</section>`;
}

function buildAuditTimeline(data: DemoResults): string {
  const events = (data.caseResults || [])
    .filter((c) => Boolean(c.auditEvent))
    .map((c) => ({ fixtureId: c.fixtureId, mode: c.mode, auditEvent: c.auditEvent! }))
    .sort((a, b) => String(a.auditEvent.timestamp).localeCompare(String(b.auditEvent.timestamp)))
    .slice(0, 40);

  if (events.length === 0) {
    return `<section><h2>Audit Event Timeline</h2><p class="no-data">No audit events embedded in case results</p></section>`;
  }

  const rows = events
    .map((e) => `<tr>
      <td>${esc(e.auditEvent.timestamp)}</td>
      <td>${esc(e.mode)}</td>
      <td>${esc(e.auditEvent.boundary)}</td>
      <td>${esc(e.auditEvent.action)}</td>
      <td>${esc(e.auditEvent.severityMax ?? "-")}</td>
      <td>${esc(e.auditEvent.ruleIds?.join(", ") || "-")}</td>
      <td>${esc(e.fixtureId)}</td>
    </tr>`)
    .join("\n    ");

  return `<section>
  <h2>Audit Event Timeline</h2>
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--gray-500);">
    Showing first ${events.length} embedded audit event(s); full JSONL files are listed in report inputs.
  </p>
  <table>
    <thead>
      <tr><th>Timestamp</th><th>Mode</th><th>Boundary</th><th>Action</th><th>Severity</th><th>Rules</th><th>Fixture</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildNoRegressionEvidence(data: DemoResults, liveEvidence: LiveEvidence): string {
  const workflows = data.noRegressionEvidence || liveEvidence.noRegressionEvidence || [];
  if (workflows.length === 0) {
    return `<section><h2>No-Regression Evidence</h2><p class="no-data">No no-regression evidence recorded</p></section>`;
  }

  const workflowHtml = workflows.map((workflow) => {
    const rows = workflow.steps
      .map((step) => `<tr>
        <td>${esc(step.mode)}</td>
        <td>${esc(step.stepId)}</td>
        <td>${esc(step.boundary)}</td>
        <td>${esc(step.action)}</td>
        <td>${step.findingsCount}</td>
        <td>${lat(step.latencyMs)}</td>
        <td>${step.passed ? '<span class="badge badge-green">Pass</span>' : '<span class="badge badge-red">Fail</span>'}</td>
        <td>${esc(step.notes)}</td>
      </tr>`)
      .join("\n      ");

    return `<details open>
    <summary>${esc(workflow.workflowId)} - ${esc(workflow.completion)} (${lat(workflow.materialDelayMs)} delta)</summary>
    <div class="detail-content">
      <p>${esc(workflow.summary)}</p>
      <table>
        <thead><tr><th>Mode</th><th>Step</th><th>Boundary</th><th>Action</th><th>Findings</th><th>Latency</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
  }).join("\n  ");

  return `<section>
  <h2>No-Regression Evidence</h2>
  ${workflowHtml}
</section>`;
}

function buildPolicyDecisionMatrix(data: DemoResults): string {
  const matrix = Object.values(data.policyDecisionMatrix || {});
  if (matrix.length === 0) {
    return `<section><h2>Policy Decision Matrix</h2><p class="no-data">No policy matrix data</p></section>`;
  }

  const rows = matrix
    .sort((a, b) => `${a.mode}:${a.boundary}`.localeCompare(`${b.mode}:${b.boundary}`))
    .map((entry) => `<tr>
      <td>${esc(entry.mode)}</td>
      <td>${esc(entry.boundary)}</td>
      <td>${esc(Object.entries(entry.actionCounts).map(([k, v]) => `${k}=${v}`).join(", "))}</td>
      <td>${entry.policyAllowedVisibleFindings}</td>
      <td>${entry.policyViolations}</td>
    </tr>`)
    .join("\n    ");

  return `<section>
  <h2>Policy Decision Matrix</h2>
  <table>
    <thead><tr><th>Mode</th><th>Boundary</th><th>Actions</th><th>Policy-Allowed Visible</th><th>Violations</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildReportInputs(data: DemoResults, liveEvidence: LiveEvidence, screenshotManifest: ScreenshotManifest): string {
  const reportInputs = data.reportInputs || { screenshots: [], auditLogFiles: [], outputLogFiles: [] };
  const screenshots = screenshotManifest.screenshots || [];
  const failures = data.acceptanceFailures || [];

  const list = (items: string[]) => items.length > 0
    ? `<ul>${items.map((item) => `<li><code>${esc(item)}</code></li>`).join("")}</ul>`
    : '<p class="no-data">None recorded</p>';

  const screenshotRows = screenshots.length > 0
    ? `<table><thead><tr><th>ID</th><th>Scenario</th><th>Path</th><th>Captured</th><th>Notes</th></tr></thead><tbody>${
      screenshots.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.scenario)}</td><td>${esc(s.path)}</td><td>${esc(s.capturedAt)}</td><td>${esc(s.notes || "")}</td></tr>`).join("")
    }</tbody></table>`
    : '<p class="no-data">No screenshots recorded in screenshot-manifest.json</p>';

  const failureHtml = failures.length > 0
    ? `<div class="card card-bad"><div class="label">Acceptance Failures</div><pre>${esc(failures.join("\n"))}</pre></div>`
    : `<div class="card card-good"><div class="label">Acceptance Failures</div><div class="value">0</div></div>`;

  return `<section>
  <h2>Report Inputs</h2>
  <div class="card-grid">${failureHtml}</div>
  <h3 style="font-size:1rem;margin:1rem 0 0.5rem;color:var(--gray-700);">Live Evidence</h3>
  <p>Status: <strong>${esc(liveEvidence.status || "unknown")}</strong>. ${esc(liveEvidence.notes || "")}</p>
  <h3 style="font-size:1rem;margin:1rem 0 0.5rem;color:var(--gray-700);">Screenshots</h3>
  ${screenshotRows}
  <h3 style="font-size:1rem;margin:1rem 0 0.5rem;color:var(--gray-700);">Audit Log Files</h3>
  ${list(reportInputs.auditLogFiles || [])}
  <h3 style="font-size:1rem;margin:1rem 0 0.5rem;color:var(--gray-700);">Output Log Files</h3>
  ${list(reportInputs.outputLogFiles || [])}
</section>`;
}

function buildDetailedCaseResults(data: DemoResults): string {
  const cases = data.caseResults;
  if (!cases || cases.length === 0) {
    return `<section><h2>Detailed Case Results</h2><p class="no-data">No data</p></section>`;
  }

  // Group by fixtureId
  const groups = new Map<string, typeof cases>();
  for (const c of cases) {
    const existing = groups.get(c.fixtureId);
    if (existing) {
      existing.push(c);
    } else {
      groups.set(c.fixtureId, [c]);
    }
  }

  const groupsHtml = Array.from(groups.entries())
    .map(([fixtureId, groupCases]) => {
      const hasPolicyViolation = groupCases.some((c) => c.policyViolation);
      const summaryBadge = hasPolicyViolation
        ? ' <span class="badge badge-red">Policy Violation</span>'
        : "";

      const tableRows = groupCases
        .map((c) => {
          const violationCls = c.policyViolation ? "cell-bad" : "";
          const actionCls =
            c.action === "block"
              ? "cell-bad"
              : c.action === "redact"
                ? "cell-warn"
                : c.action === "allow" && c.secretVisibleInRenderedOutput
                  ? "cell-bad"
                  : "";
          return `<tr>
          <td>${esc(c.boundary)}</td>
          <td>${esc(c.mode)}</td>
          <td>${c.findingsCount}</td>
          <td>${c.findingRuleIds.map((r) => esc(r)).join(", ") || "-"}</td>
          <td>${c.maxSeverity ? esc(c.maxSeverity) : "-"}</td>
          <td class="${actionCls}">${esc(c.action)}</td>
          <td>${lat(c.latencyMs)}</td>
          <td class="${violationCls}">${c.policyViolation ? "YES" : "No"}</td>
        </tr>`;
        })
        .join("\n        ");

      return `<details>
    <summary>${esc(fixtureId)} (${groupCases.length} cases)${summaryBadge}</summary>
    <div class="detail-content">
      <table>
        <thead>
          <tr>
            <th>Boundary</th><th>Mode</th><th>Findings</th><th>Rule IDs</th>
            <th>Max Severity</th><th>Action</th><th>Latency</th><th>Policy Violation</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  </details>`;
    })
    .join("\n  ");

  return `<section>
  <h2>Detailed Case Results</h2>
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--gray-500);">
    ${cases.length} total cases across ${groups.size} fixtures. Click to expand.
  </p>
  ${groupsHtml}
</section>`;
}

function buildFooter(): string {
  const now = new Date().toISOString();
  return `<footer class="footer">
  Report generated on ${esc(now)}
</footer>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function generateReport(): void {
  const baseDir = path.resolve(__dirname, "results");
  const inputPath = path.join(baseDir, "demo-results.json");
  const liveEvidencePath = path.join(baseDir, "live-evidence.json");
  const screenshotManifestPath = path.join(baseDir, "screenshot-manifest.json");
  const outputPath = path.join(baseDir, "secret-protection-demo-report.html");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  const data: DemoResults = JSON.parse(raw);
  const liveEvidence = readOptionalJson<LiveEvidence>(liveEvidencePath, {
    status: "missing",
    scenarios: [],
    notes: "live-evidence.json was not found",
  });
  const screenshotManifest = readOptionalJson<ScreenshotManifest>(screenshotManifestPath, {
    screenshots: [],
    notes: "screenshot-manifest.json was not found",
  });

  console.log(`Read demo results from: ${inputPath}`);
  console.log(
    `  Test Run: ${data.metadata.testRunId}, Timestamp: ${data.metadata.timestamp}`
  );
  console.log(`Read live evidence from: ${liveEvidencePath}`);
  console.log(`Read screenshot manifest from: ${screenshotManifestPath}`);

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secret Protection Broker - Demo Evidence Report</title>
  ${buildStyles()}
</head>
<body>
${buildHeader(data)}
<div class="container">
  ${buildExecutiveSummary(data)}
  ${buildModeComparison(data)}
  ${buildBoundaryCoverage(data)}
  ${buildRuleCoverage(data)}
  ${buildDetectionExamples(data)}
  ${buildAuditTimeline(data)}
  ${buildCommandRisk(data)}
  ${buildNoRegressionEvidence(data, liveEvidence)}
  ${buildPolicyDecisionMatrix(data)}
  ${buildPerformanceMetrics(data)}
  ${buildReportInputs(data, liveEvidence, screenshotManifest)}
  ${buildDetailedCaseResults(data)}
</div>
${buildFooter()}
</body>
</html>`;

  fs.writeFileSync(outputPath, html, "utf-8");
  console.log(`HTML report generated: ${outputPath}`);
  console.log(
    `  Sections: Executive Summary, Mode Comparison, Boundary Coverage, Rule Coverage,`
  );
  console.log(
    `            Detection Examples, Audit Timeline, Command Risk, No-Regression, Policy Matrix, Performance Metrics, Report Inputs, Detailed Case Results`
  );
}

generateReport();
