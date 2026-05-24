# Super Particle Accelerator — Developer Implementation Guide (Rev 2)

## Revision Notes

This revision addresses 12 blockers identified during plan review. Each changed section is marked with `[Bx]` referencing the blocker number. Where a section is entirely new, the full section heading includes the tag.

---

## Overview

Super Particle Accelerator (SPA) is an independent feature that intercepts AI agent write operations (Edit, Write, Bash file-writes, MCP writes, git commit/push) and blocks them if they contain detected secrets — especially into client-side/public code. It runs as Claude Code and Codex hooks, similar to the existing Particle Accelerator hooks.

**Feature key:** `superParticleAccelerator`
**Config namespace:** `claudeMirror.superParticleAccelerator.*`
**Env prefix:** `CLAUI_SPA_*`
**Hook marker:** `--claui-spa-hook`

---

## Architecture Decision: Reuse vs. New Code

The codebase already has a mature secret scanning + policy + audit pipeline. The SPA must **reuse** these shared components rather than duplicating them:

| Reuse (shared/) | New (SPA-specific) |
|---|---|
| `CompositeSecretScanner` + all rule packs | `PathClassifier` (public/client vs server) |
| `PolicyEngine` decision matrix | `SecretWritePolicyEngine` (write-specific rules on top of base) |
| `AuditStore` + `AuditEventWriter` | SPA-specific audit event type |
| `ExceptionStore` pattern (not the instance) | `SpaExceptionStore` (time-limited, hash-scoped, atomic writes) |
| `RedactionEngine` (for preview redaction) | Hook scripts (Claude + Codex, multiple tool matchers) |
| `ISecretScanner` interface + `ScanContext` | `GitStateScanner` (per-file diff parsing) |
| All existing rule packs (AWS, GCP, OpenAI, etc.) | `SuperParticleAcceleratorService` (extension facade) |
| `CommandRiskClassifier` | Bash write-command detection logic |

---

## File Structure

```
src/
  extension/
    super-particle-accelerator/
      SuperParticleAcceleratorService.ts          # Facade, lifecycle, injected into TabManager
      SuperParticleAcceleratorSettings.ts         # Settings reader + change listener
      SuperParticleAcceleratorHookManager.ts      # Installs/uninstalls hooks in .claude/ and .codex/
      SuperParticleAcceleratorEnvBuilder.ts       # Builds env vars for agent processes
      SuperParticleAcceleratorTypes.ts            # Extension-side types (status, etc.)
      SuperParticleAcceleratorAuditReader.ts      # Reads SPA audit events for webview
      SpaExceptionStore.ts                # [B8] Exception CRUD with atomic writes

  super-particle-accelerator-runtime/             # Standalone Node.js (separate webpack entry)
    SecretScanner.ts                      # Thin wrapper around CompositeSecretScanner
    SecretWritePolicyEngine.ts            # Write-specific policy logic
    GitStateScanner.ts                    # git diff/status scanning (per-file)
    PathClassifier.ts                     # File risk classification
    AuditWriter.ts                        # Writes SPA audit JSONL
    ExceptionLoader.ts                    # [B8] Reads + consumes exceptions at runtime
    BaselineStore.ts                      # [B11] Per-session baseline for Stop hook
    hooks/
      claudeSuperParticleAccelerator.ts           # Claude hook (all matchers)
      codexSuperParticleAccelerator.ts            # Codex hook (all matchers)

  shared/
    super-particle-accelerator/
      types.ts                            # Shared types (findings, policy, audit events)

  webview/
    components/
      SuperParticleAccelerator/
        SuperParticleAcceleratorStatusBadge.tsx    # [B1] Status bar badge
        SuperParticleAcceleratorPanel.tsx          # [B1] Settings + audit modal
    store/
      superParticleAcceleratorSlice.ts            # Zustand slice

tests/
  super-particle-accelerator/
    SecretScanner.test.ts
    SecretWritePolicyEngine.test.ts
    PathClassifier.test.ts
    GitStateScanner.test.ts
    AuditWriter.test.ts
    ExceptionStore.test.ts                # [B8]
    BaselineStore.test.ts                 # [B11]
    hooks/
      claudeSuperParticleAccelerator.test.ts
      codexSuperParticleAccelerator.test.ts
    SuperParticleAcceleratorSettings.test.ts
    SuperParticleAcceleratorHookManager.test.ts
    security/
      noRawSecretPersistence.test.ts
```

---

## Phase 1: Types & Interfaces

### File: `src/shared/super-particle-accelerator/types.ts`

```ts
export type SecretFindingType =
  | "google_api_key"
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_token"
  | "aws_access_key"
  | "jwt"
  | "supabase_key"
  | "azure_key"
  | "private_key"
  | "database_url"
  | "generic_high_entropy_secret";

export type SecretFindingSeverity = "low" | "medium" | "high" | "critical";
export type SecretFindingConfidence = "low" | "medium" | "high";

export interface SecretFinding {
  ruleId: string;
  type: SecretFindingType;
  severity: SecretFindingSeverity;
  confidence: SecretFindingConfidence;
  filePath?: string;
  line?: number;
  column?: number;
  redactedPreview: string;   // e.g. "AIza***Yz" — see [B12] redaction rules
  valueSha256: string;        // SHA-256 of raw value — NEVER store raw
}

export type PathRisk =
  | "public-client-code"
  | "generated-public-artifact"
  | "server-code"
  | "local-secret-file"
  | "unknown-repository-file";

export type ScanSource =
  | "edit"
  | "bash-command"
  | "mcp-args"
  | "file"
  | "diff"
  | "staged-diff";

// [B3] Hook event types — passed via argv, not env
export type SpaHookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export interface SecretScanInput {
  text: string;
  source: ScanSource;
  provider: "claude" | "codex";
  toolName?: string;
  filePath?: string;
  cwd: string;
  sessionId?: string;
  turnId?: string;
}

// [B5] Per-file diff parse result
export interface DiffFileEntry {
  filePath: string;
  addedLines: Array<{ lineNumber: number; text: string }>;
}

export interface SecretWritePolicyInput {
  findings: SecretFinding[];
  filePath?: string;
  source: ScanSource;
  provider: "claude" | "codex";
  toolName?: string;
  command?: string;
  cwd: string;
  gitInfo?: GitInfo;
  settings: SuperParticleAcceleratorSettings;
  exceptions: SuperParticleAcceleratorException[];  // [B8] loaded by caller
}

export interface SecretWritePolicyDecision {
  action: "allow" | "deny" | "audit";
  reason: string;
  remediation?: string;
  findings: SecretFinding[];
  consumedExceptionIds: string[];  // [B8] caller must persist consumption
}

export interface GitInfo {
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
  hasStagedFindings: boolean;
  hasUnstagedFindings: boolean;
}

export interface SuperParticleAcceleratorSettings {
  enabled: boolean;                  // default: false
  mode: "block" | "audit";          // default: "block"
  scanEditTools: boolean;            // default: true
  scanBashCommands: boolean;         // default: true
  scanMcpTools: boolean;             // default: true
  scanWorkingTreeOnStop: boolean;    // default: true
  blockGitCommitPush: boolean;       // default: true
  allowIgnoredEnvFiles: boolean;     // default: true
  entropyThreshold: number;          // default: 4.2
  frontendPathGlobs: string[];
  allowedSecretFileGlobs: string[];
  customSecretRulesPath?: string;
}

export type SuperParticleAcceleratorStatus =
  | "disabled"
  | "enabled-hooks-installed"
  | "enabled-hooks-missing"
  | "enabled-trust-required"
  | "enabled-partial-coverage"
  | "error";

export interface SuperParticleAcceleratorAuditEvent {
  id: string;
  timestamp: string;
  provider: "claude" | "codex";
  sessionId?: string;
  turnId?: string;
  workspacePathHash: string;
  toolName: string;
  source: ScanSource;
  action: "allow" | "deny" | "audit";
  reason: string;
  filePath?: string;
  pathRisk?: PathRisk;
  findings: Array<{
    ruleId: string;
    type: SecretFindingType;
    severity: SecretFindingSeverity;
    confidence: SecretFindingConfidence;
    valueSha256: string;
    redactedPreview: string;
    line?: number;
  }>;
}

export interface SuperParticleAcceleratorException {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: "user";
  ruleId: string;
  valueSha256: string;
  filePathGlob: string;
  maxUses: number;
  usedCount: number;
  reason: string;
}

// [B11] Baseline for Stop hook
export interface SpaBaseline {
  sessionId: string;
  createdAt: string;
  entries: Array<{ valueSha256: string; filePath: string }>;
}
```

---

## Phase 2: Secret Scanner Wrapper

### File: `src/super-particle-accelerator-runtime/SecretScanner.ts`

Wraps `CompositeSecretScanner` from `src/shared/secret-protection/scanners/CompositeSecretScanner.ts`.

**Key integration point:** The existing `CompositeSecretScanner` already runs all 13 rule packs (Google, OpenAI, Anthropic, GitHub, AWS, Azure, etc.) and the `EntropyScanner`. SPA reuses it directly.

```ts
import { CompositeSecretScanner } from '../../shared/secret-protection/scanners/CompositeSecretScanner';
import { ScanContext } from '../../shared/secret-protection/scanners/types';
import { SecretScanInput, SecretFinding } from '../../shared/super-particle-accelerator/types';
import { createHash } from 'crypto';

export class SpaSecretScanner {
  private scanner: CompositeSecretScanner;

  constructor(entropyThreshold?: number) {
    this.scanner = new CompositeSecretScanner({ entropyThreshold });
  }

  scan(input: SecretScanInput): SecretFinding[] {
    const context: ScanContext = {
      boundary: 'persistence.write',
      filePath: input.filePath,
      source: input.source,
    };

    const result = this.scanner.scan(input.text, context);

    return result.findings.map(f => ({
      ruleId: f.ruleId,
      type: this.mapFindingType(f.type),
      severity: f.severity,
      confidence: f.confidence,
      filePath: input.filePath,
      line: f.line,
      column: f.column,
      redactedPreview: SpaSecretScanner.redact(f.matchedValue),
      valueSha256: createHash('sha256').update(f.matchedValue).digest('hex'),
    }));
  }

  private mapFindingType(type: string): SecretFinding['type'] { /* ... */ }

  // [B12] Safe redaction — reveals at most 30% of value, never the full secret
  static redact(value: string): string {
    if (value.length <= 12) return '***';
    const maxRevealed = Math.min(8, Math.floor(value.length * 0.25));
    const prefixLen = Math.ceil(maxRevealed * 0.6);
    const suffixLen = maxRevealed - prefixLen;
    return value.slice(0, prefixLen) + '***' + value.slice(-suffixLen);
  }
}
```

### [B12] Redaction Rules

The `redact()` function must satisfy these invariants:

| Secret length | Revealed chars | Example |
|---|---|---|
| 1–12 | 0 | `***` |
| 13–31 | max 8 (25% of length) | `AIza***Yz` |
| 32+ | exactly 8 | `AIza***Yz` |

**Constraints:**
- `redactedPreview` must always contain `***`
- `redactedPreview.replace('***', '')` must be strictly shorter than 30% of the original
- The preview must NOT match any known secret regex pattern (validated by tests)
- The full raw value must NOT appear as a substring of `redactedPreview`

**Important:** The scanner wrapper must NEVER pass raw secret values to any output (audit, logs, hook response). Only `redactedPreview` and `valueSha256` leave this layer.

---

## Phase 3: Path Classifier

### File: `src/super-particle-accelerator-runtime/PathClassifier.ts`

Classifies file paths by risk level. This is SPA-specific — the existing `DestinationClassifier` works on DLP boundaries, not file system paths.

```ts
import * as path from 'path';
import { minimatch } from 'minimatch';
import { PathRisk } from '../../shared/super-particle-accelerator/types';

// [B10] Public root directories — .env files inside these are NEVER allowed
const PUBLIC_ROOT_PREFIXES = [
  'public/', 'static/', 'dist/', 'build/',
  'client/', 'frontend/', 'web/',
];

export class PathClassifier {
  private frontendGlobs: string[];
  private allowedSecretGlobs: string[];

  constructor(frontendGlobs: string[], allowedSecretGlobs: string[]) {
    this.frontendGlobs = frontendGlobs;
    this.allowedSecretGlobs = allowedSecretGlobs;
  }

  classify(filePath: string, cwd: string): PathRisk {
    const rel = path.relative(cwd, filePath).replace(/\\/g, '/');

    // Generated/public artifacts (highest risk)
    if (this.isPublicRoot(rel) || this.matchesAny(rel, [
        '**/*.bundle.js', '**/*.min.js'])) {
      return 'generated-public-artifact';
    }

    // [B10] Allowed secret files — but NOT if inside a public root
    if (this.matchesAny(rel, this.allowedSecretGlobs)) {
      if (this.isInsidePublicRoot(rel)) {
        return 'public-client-code'; // deny path, even if gitignored
      }
      return 'local-secret-file';
    }

    // Frontend/client-side code
    if (this.matchesAny(rel, this.frontendGlobs)) {
      if (this.isServerSidePath(rel)) return 'server-code';
      return 'public-client-code';
    }

    return 'unknown-repository-file';
  }

  // [B10] Check if path is directly inside a public root
  isInsidePublicRoot(relPath: string): boolean {
    return PUBLIC_ROOT_PREFIXES.some(prefix => relPath.startsWith(prefix));
  }

  private isPublicRoot(rel: string): boolean {
    return PUBLIC_ROOT_PREFIXES.some(prefix =>
      rel.startsWith(prefix) || minimatch(rel, prefix + '**'));
  }

  private isServerSidePath(rel: string): boolean {
    if (/^(app|pages)\/api\//.test(rel)) return true;
    return false;
  }

  private matchesAny(rel: string, globs: string[]): boolean {
    return globs.some(g => minimatch(rel, g, { dot: true }));
  }
}
```

**Framework heuristics for `src/` files:**
- Contains `"use client"` directive -> `public-client-code`
- Under `app/api/` or `pages/api/` (Next.js) -> `server-code`
- Under React/Vite/CRA app with no server markers -> `public-client-code`
- When uncertain + real secret found -> **deny by default**

---

## Phase 4: Policy Engine [B2]

### File: `src/super-particle-accelerator-runtime/SecretWritePolicyEngine.ts`

**[B2] Fixed: Deny-first evaluation with explicit allow gates.**

The previous plan said "check allow-rules first" and "all allow rules must be true" which was contradictory. The corrected logic is a **waterfall** where deny is the default and each allow gate is an independent short-circuit. Deny always wins unless a specific allow condition overrides it.

```ts
import {
  SecretWritePolicyInput, SecretWritePolicyDecision,
  SecretFinding, SuperParticleAcceleratorException, PathRisk,
} from '../../shared/super-particle-accelerator/types';
import { PathClassifier } from './PathClassifier';
import { minimatch } from 'minimatch';

export class SecretWritePolicyEngine {
  private pathClassifier: PathClassifier;

  constructor(pathClassifier: PathClassifier) {
    this.pathClassifier = pathClassifier;
  }

  evaluate(input: SecretWritePolicyInput): SecretWritePolicyDecision {
    // ---- Gate 0: No findings -> allow ----
    if (input.findings.length === 0) {
      return { action: 'allow', reason: 'No secrets detected', findings: [], consumedExceptionIds: [] };
    }

    const pathRisk = input.filePath
      ? this.pathClassifier.classify(input.filePath, input.cwd)
      : 'unknown-repository-file';

    // ---- Gate 1: Filter out low-signal findings ----
    // Remove placeholder values and low-confidence-only findings.
    // If nothing remains after filtering, allow.
    const actionable = input.findings.filter(f => !this.isPlaceholder(f) && f.confidence !== 'low');
    if (actionable.length === 0) {
      return { action: 'allow', reason: 'All findings are placeholders or low-confidence', findings: input.findings, consumedExceptionIds: [] };
    }

    // ---- Gate 2: Hard deny (no exception can override) ----
    // Public/client/generated paths with any actionable finding -> always deny.
    if (pathRisk === 'public-client-code' || pathRisk === 'generated-public-artifact') {
      return this.deny(input, actionable, pathRisk, 'Secrets must never appear in client-side or public code. No exceptions.');
    }

    // ---- Gate 3: Allowed .env file ----
    // [B10] local-secret-file classification already excludes public roots.
    // So if pathRisk === 'local-secret-file', the file is NOT inside public/.
    if (pathRisk === 'local-secret-file' && input.settings.allowIgnoredEnvFiles) {
      // Caller (hook) must have verified git-ignored status via GitStateScanner.isGitIgnored()
      // before passing this input. If the file were not ignored, PathClassifier would
      // return 'unknown-repository-file', not 'local-secret-file'.
      return { action: 'audit', reason: 'Secret in gitignored local env file', findings: actionable, consumedExceptionIds: [] };
    }

    // ---- Gate 4: Exceptions ----
    // [B8] Each actionable finding is checked against loaded exceptions.
    const now = new Date().toISOString();
    const consumed: string[] = [];
    const uncovered: SecretFinding[] = [];

    for (const finding of actionable) {
      const match = input.exceptions.find(ex =>
        ex.ruleId === finding.ruleId &&
        ex.valueSha256 === finding.valueSha256 &&
        (input.filePath ? minimatch(input.filePath, ex.filePathGlob, { dot: true }) : false) &&
        ex.expiresAt > now &&
        ex.usedCount < ex.maxUses
      );
      if (match) {
        consumed.push(match.id);
      } else {
        uncovered.push(finding);
      }
    }

    if (uncovered.length === 0) {
      return { action: 'audit', reason: 'All findings covered by valid exceptions', findings: actionable, consumedExceptionIds: consumed };
    }

    // ---- Default: deny (or audit in audit mode) ----
    return this.deny(input, uncovered, pathRisk);
  }

  private deny(
    input: SecretWritePolicyInput,
    findings: SecretFinding[],
    pathRisk: PathRisk,
    hardReason?: string,
  ): SecretWritePolicyDecision {
    const action = input.settings.mode === 'block' ? 'deny' : 'audit';
    return {
      action,
      reason: hardReason ?? this.buildReason(findings, pathRisk),
      remediation: this.buildRemediation(findings, pathRisk),
      findings,
      consumedExceptionIds: [],
    };
  }

  private isPlaceholder(finding: SecretFinding): boolean {
    const preview = finding.redactedPreview.toLowerCase();
    const placeholders = [
      'your_api_key', 'your-api-key', 'xxx', 'placeholder',
      'replace_me', 'insert_key', 'todo', 'changeme', 'example',
    ];
    return placeholders.some(p => preview.includes(p));
  }

  private buildReason(findings: SecretFinding[], pathRisk: PathRisk): string { /* ... */ }
  private buildRemediation(findings: SecretFinding[], pathRisk: PathRisk): string { /* ... */ }
}
```

### [B2] Evaluation Waterfall (corrected)

```
Scan -> findings[]
  |
  v
Gate 0: findings.length === 0 ? ---------> ALLOW
  |
  v
Gate 1: filter placeholders + low-confidence
        nothing actionable left? ----------> ALLOW
  |
  v
Gate 2: pathRisk is public/client/generated? -> DENY (hard, no exceptions)
  |
  v
Gate 3: pathRisk is local-secret-file
        AND allowIgnoredEnvFiles? ----------> AUDIT (allowed)
  |
  v
Gate 4: all actionable findings covered
        by valid, unexpired exceptions? ----> AUDIT (consume exceptions)
  |
  v
Default: ---------------------------------> DENY (or AUDIT if mode=audit)
```

**Key rules:**
- Gate 2 (public/client paths) is a **hard deny** — no exception can override it
- Gate 3 requires that `PathClassifier` already blocked `.env` files inside public roots [B10]
- Gate 4 exceptions are consumed (usedCount incremented) only when they actually prevent a deny
- `action: 'audit'` means the operation is allowed but logged

---

## Phase 5: Git State Scanner [B5][B6]

### File: `src/super-particle-accelerator-runtime/GitStateScanner.ts`

**[B5] Fixed: Parse diffs per file, preserve filePath and line numbers on each finding.**
**[B6] Fixed: Use `execFileSync` with argument arrays instead of shell-interpolated commands.**

```ts
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SpaSecretScanner } from './SecretScanner';
import { SecretFinding, GitInfo, DiffFileEntry, ScanSource } from '../../shared/super-particle-accelerator/types';

export class GitStateScanner {
  private scanner: SpaSecretScanner;
  private cwd: string;
  private maxScanBytes: number;
  private provider: 'claude' | 'codex';

  constructor(
    scanner: SpaSecretScanner,
    cwd: string,
    provider: 'claude' | 'codex',
    maxScanBytes = 20 * 1024 * 1024,
  ) {
    this.scanner = scanner;
    this.cwd = cwd;
    this.provider = provider;
    this.maxScanBytes = maxScanBytes;
  }

  scanStagedDiff(): SecretFinding[] {
    const diff = this.git('diff', '--cached', '--unified=0');
    return this.scanParsedDiff(diff, 'staged-diff');
  }

  scanUnstagedDiff(): SecretFinding[] {
    const diff = this.git('diff', '--unified=0');
    return this.scanParsedDiff(diff, 'diff');
  }

  scanUntrackedFiles(): SecretFinding[] {
    const listing = this.git('ls-files', '--others', '--exclude-standard');
    const files = listing.split('\n').filter(Boolean);

    const findings: SecretFinding[] = [];
    let totalBytes = 0;

    for (const relFile of files) {
      const absPath = path.resolve(this.cwd, relFile);
      let stat: fs.Stats;
      try { stat = fs.statSync(absPath); } catch { continue; }
      if (totalBytes + stat.size > this.maxScanBytes) break;

      const buf = Buffer.alloc(8192);
      let fd: number;
      try { fd = fs.openSync(absPath, 'r'); } catch { continue; }
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      fs.closeSync(fd);
      if (buf.slice(0, bytesRead).includes(0)) continue; // binary

      const content = fs.readFileSync(absPath, 'utf-8');
      totalBytes += Buffer.byteLength(content);

      const fileFindings = this.scanner.scan({
        text: content,
        source: 'file',
        provider: this.provider,
        filePath: relFile,
        cwd: this.cwd,
      });

      findings.push(...fileFindings.map(f => ({ ...f, filePath: relFile })));
    }

    return findings;
  }

  getGitInfo(): GitInfo {
    const status = this.git('status', '--porcelain');
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of status.split('\n').filter(Boolean)) {
      const x = line[0], y = line[1];
      const file = line.slice(3);
      if (x === '?') untracked.push(file);
      else if (x !== ' ') staged.push(file);
      if (y !== ' ' && y !== '?') modified.push(file);
    }

    return {
      stagedFiles: staged,
      modifiedFiles: modified,
      untrackedFiles: untracked,
      hasStagedFindings: false, // populated by caller after scan
      hasUnstagedFindings: false,
    };
  }

  // [B6] No shell interpolation — execFileSync with argument array
  isGitIgnored(filePath: string): boolean {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', filePath], {
        cwd: this.cwd,
        timeout: 3000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  // [B5] Parse unified diff into per-file entries with line numbers
  private parseDiff(rawDiff: string): DiffFileEntry[] {
    const entries: DiffFileEntry[] = [];
    const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

    for (const section of fileSections) {
      // Extract file path from "+++ b/path" line
      const pathMatch = section.match(/^\+\+\+ b\/(.+)$/m);
      if (!pathMatch) continue;
      const filePath = pathMatch[1];

      const addedLines: DiffFileEntry['addedLines'] = [];

      // Parse each hunk: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm;
      let hunkMatch: RegExpExecArray | null;

      while ((hunkMatch = hunkRegex.exec(section)) !== null) {
        let currentLine = parseInt(hunkMatch[1], 10);
        const hunkStart = hunkMatch.index + hunkMatch[0].length;
        const nextHunk = section.indexOf('\n@@ ', hunkStart);
        const nextDiff = section.indexOf('\ndiff --git ', hunkStart);
        const hunkEnd = Math.min(
          nextHunk === -1 ? section.length : nextHunk,
          nextDiff === -1 ? section.length : nextDiff,
        );
        const hunkBody = section.slice(hunkStart, hunkEnd);

        for (const line of hunkBody.split('\n')) {
          if (line.startsWith('+')) {
            addedLines.push({ lineNumber: currentLine, text: line.slice(1) });
            currentLine++;
          } else if (line.startsWith('-')) {
            // deleted line — don't increment newLine counter
          } else if (line.startsWith(' ') || line === '') {
            currentLine++;
          }
        }
      }

      if (addedLines.length > 0) {
        entries.push({ filePath, addedLines });
      }
    }

    return entries;
  }

  // [B5] Scan each file's added lines separately, preserving filePath and line
  private scanParsedDiff(rawDiff: string, source: ScanSource): SecretFinding[] {
    const entries = this.parseDiff(rawDiff);
    const allFindings: SecretFinding[] = [];

    for (const entry of entries) {
      const text = entry.addedLines.map(l => l.text).join('\n');
      if (!text.trim()) continue;

      const findings = this.scanner.scan({
        text,
        source,
        provider: this.provider,
        filePath: entry.filePath,
        cwd: this.cwd,
      });

      // Map scanner-reported line numbers (relative to concatenated text)
      // back to actual file line numbers
      for (const finding of findings) {
        if (finding.line !== undefined && finding.line < entry.addedLines.length) {
          finding.line = entry.addedLines[finding.line].lineNumber;
        }
        finding.filePath = entry.filePath;
      }

      allFindings.push(...findings);
    }

    return allFindings;
  }

  // [B6] All git commands use execFileSync — no shell, no injection
  private git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
  }
}
```

---

## Phase 6: Audit Writer [B9]

### File: `src/super-particle-accelerator-runtime/AuditWriter.ts`

Reuse `AuditStore` from `src/shared/audit/AuditStore.ts`. SPA audit goes to a **separate directory** from main DLP audit.

**[B9] Fixed: Explicit directory path computation with eager mkdir.**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorAuditEvent } from '../../shared/super-particle-accelerator/types';

export class SpaAuditWriter {
  private auditDir: string;

  constructor(storeDir: string) {
    // storeDir = env var CLAUI_SPA_STORE_DIR
    //          = <globalStoragePath>/super-particle-accelerator
    // Audit files go in the /audit/ subdirectory
    this.auditDir = path.join(storeDir, 'audit');
  }

  write(event: SuperParticleAcceleratorAuditEvent): void {
    // Ensure audit directory exists on every write (idempotent)
    fs.mkdirSync(this.auditDir, { recursive: true });

    const dateStr = event.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(this.auditDir, `${dateStr}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }
}
```

### [B9] Directory Layout (Explicit)

```
<globalStoragePath>/                                    # context.globalStorageUri.fsPath
  super-particle-accelerator/                                   # CLAUI_SPA_STORE_DIR
    audit/                                              # JSONL audit files
      2026-05-20.jsonl
      2026-05-21.jsonl
    exceptions.json                                     # [B8] exception store
    baselines/                                          # [B11] per-session baselines
      <sessionId>.json
```

All directories are created with `mkdirSync({ recursive: true })` on first write. The env var `CLAUI_SPA_STORE_DIR` points to the `super-particle-accelerator/` directory (not the `audit/` subdirectory). Hook code computes subdirectory paths from that root.

**Hard rule:** Audit events contain only `redactedPreview` and `valueSha256`. Raw secret values MUST NOT appear. Verify this in `noRawSecretPersistence.test.ts`.

---

## Phase 7: Exception Store [B8]

### File: `src/extension/super-particle-accelerator/SpaExceptionStore.ts` (Extension Side)

**[B8] Full wiring: storage, creation, deletion, persistence with atomic writes.**

The extension side owns the exception file. It handles create/delete operations from the webview and persists to disk.

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { SuperParticleAcceleratorException } from '../../shared/super-particle-accelerator/types';

export class SpaExceptionStore {
  private filePath: string;

  constructor(storeDir: string) {
    // storeDir = <globalStoragePath>/super-particle-accelerator
    this.filePath = path.join(storeDir, 'exceptions.json');
  }

  // ---- Reads ----

  listActive(now = new Date().toISOString()): SuperParticleAcceleratorException[] {
    return this.readAll().filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
  }

  // ---- Mutations (extension-side only) ----

  add(input: Omit<SuperParticleAcceleratorException, 'id' | 'createdAt' | 'usedCount'>): SuperParticleAcceleratorException {
    const exception: SuperParticleAcceleratorException = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      usedCount: 0,
    };
    const all = this.readAll();
    all.push(exception);
    this.writeAllAtomic(all);
    return exception;
  }

  delete(exceptionId: string): boolean {
    const all = this.readAll();
    const idx = all.findIndex(ex => ex.id === exceptionId);
    if (idx === -1) return false;
    all.splice(idx, 1);
    this.writeAllAtomic(all);
    return true;
  }

  prune(now = new Date().toISOString()): number {
    const all = this.readAll();
    const active = all.filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
    const removed = all.length - active.length;
    if (removed > 0) this.writeAllAtomic(active);
    return removed;
  }

  // ---- File I/O ----

  private readAll(): SuperParticleAcceleratorException[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Atomic write: write to temp file in same directory, then rename
  private writeAllAtomic(exceptions: SuperParticleAcceleratorException[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.exceptions.tmp.${process.pid}`);
    fs.writeFileSync(tmpPath, JSON.stringify(exceptions, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
```

### File: `src/super-particle-accelerator-runtime/ExceptionLoader.ts` (Hook Runtime Side)

**[B8] The hook process reads exceptions from disk but does NOT write back directly.** Exception consumption (incrementing usedCount) is done via a separate atomic write to avoid race conditions between hook processes.

```ts
import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorException } from '../../shared/super-particle-accelerator/types';

export class ExceptionLoader {
  private filePath: string;

  constructor(storeDir: string) {
    this.filePath = path.join(storeDir, 'exceptions.json');
  }

  loadActive(now = new Date().toISOString()): SuperParticleAcceleratorException[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const all: SuperParticleAcceleratorException[] = JSON.parse(raw);
      return all.filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
    } catch {
      return [];
    }
  }

  // Consume exceptions by incrementing usedCount
  // Uses read-modify-write with atomic rename
  consumeMany(exceptionIds: string[]): void {
    if (exceptionIds.length === 0) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const all: SuperParticleAcceleratorException[] = JSON.parse(raw);
      const idSet = new Set(exceptionIds);
      for (const ex of all) {
        if (idSet.has(ex.id)) ex.usedCount++;
      }
      const dir = path.dirname(this.filePath);
      const tmpPath = path.join(dir, `.exceptions.tmp.${process.pid}`);
      fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Best-effort: if consumption fails, the exception may be used beyond maxUses
      // This is acceptable — it's a leniency, not a security gap
    }
  }
}
```

### Env Var Wiring [B8]

The env builder (Phase 10) passes the exception file path to hook processes:

```
CLAUI_SPA_STORE_DIR = <globalStoragePath>/super-particle-accelerator
```

The hook runtime computes `${CLAUI_SPA_STORE_DIR}/exceptions.json`.

**No separate env var is needed for the exceptions path** — it's derived from `STORE_DIR`.

---

## Phase 8: Baseline Store [B11]

### File: `src/super-particle-accelerator-runtime/BaselineStore.ts`

**[B11] The Stop hook needs a baseline to avoid re-blocking on pre-existing secrets.**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { SpaBaseline, SecretFinding } from '../../shared/super-particle-accelerator/types';

export class BaselineStore {
  private baselineDir: string;

  constructor(storeDir: string) {
    this.baselineDir = path.join(storeDir, 'baselines');
  }

  load(sessionId: string): SpaBaseline | null {
    const filePath = this.pathFor(sessionId);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  save(sessionId: string, findings: SecretFinding[]): void {
    fs.mkdirSync(this.baselineDir, { recursive: true });
    const baseline: SpaBaseline = {
      sessionId,
      createdAt: new Date().toISOString(),
      entries: findings.map(f => ({
        valueSha256: f.valueSha256,
        filePath: f.filePath ?? '',
      })),
    };
    const tmpPath = this.pathFor(sessionId) + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(baseline, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.pathFor(sessionId));
  }

  // Filter out findings that exist in the baseline
  filterNew(sessionId: string, findings: SecretFinding[]): SecretFinding[] {
    const baseline = this.load(sessionId);
    if (!baseline) return findings; // no baseline = all are new

    const baselineSet = new Set(
      baseline.entries.map(e => `${e.valueSha256}:${e.filePath}`)
    );

    return findings.filter(f =>
      !baselineSet.has(`${f.valueSha256}:${f.filePath ?? ''}`)
    );
  }

  private pathFor(sessionId: string): string {
    // Sanitize sessionId for filesystem safety
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baselineDir, `${safe}.json`);
  }
}
```

### Stop Hook Baseline Flow [B11]

```
Stop hook fires
  |
  v
Scan working tree (staged + unstaged + untracked)
  |
  v
Load baseline for this sessionId
  |
  v
Baseline exists?
  |--- NO: This is first Stop for this session.
  |        Save current findings as baseline.
  |        Return ALLOW (don't block on pre-existing secrets).
  |
  |--- YES: Filter findings through baseline.
            newFindings = currentFindings - baselineFindings
            |
            v
            newFindings.length > 0?
              |--- YES: DENY (or AUDIT) with only the new findings.
              |         Update baseline: add new findings to it.
              |--- NO:  ALLOW (nothing new since baseline).
```

Baseline files are per-session. Old baselines are cleaned up when the extension's `SuperParticleAcceleratorService.dispose()` is called (best-effort), or by a periodic prune that removes baselines older than 7 days.

---

## Phase 9: Hook Scripts [B3][B4][B7]

These are the runtime scripts that Claude Code / Codex invoke via their hook system. They read JSON from stdin, run the scan/policy pipeline, and write JSON to stdout.

### [B3] Hook Event Detection — argv, not env

**Problem in v1:** The plan used `process.env.CLAUI_SPA_HOOK_EVENT` but the hook commands passed the event type as an argv argument. The PA hook doesn't use argv for event type at all — it infers from stdin `tool_name`.

**Fix:** SPA uses **a single script per provider** with the hook event type passed as the argv argument AFTER the marker. The stdin JSON provides tool-specific data (`tool_name`, `tool_input` for PreToolUse; different structure for Stop).

```
Hook command format:
  node "/path/to/hook.js" --claui-spa-hook <EVENT>

Where <EVENT> is one of: PreToolUse, PostToolUse, Stop
```

The hook script parses argv to determine the event:

```ts
function parseHookEvent(): SpaHookEvent {
  const markerIdx = process.argv.indexOf('--claui-spa-hook');
  if (markerIdx === -1 || markerIdx + 1 >= process.argv.length) {
    throw new Error('Missing hook event argument after --claui-spa-hook');
  }
  const event = process.argv[markerIdx + 1];
  if (!['PreToolUse', 'PostToolUse', 'Stop'].includes(event)) {
    throw new Error(`Unknown hook event: ${event}`);
  }
  return event as SpaHookEvent;
}
```

### [B7] Timeout Behavior — Fail-Closed for Writes

**Problem in v1:** Timeout was described as `process.exit(0)` for everything, which would fail-open for writes.

**Fix:** When the timeout fires during a write-like operation (PreToolUse), the hook outputs a deny response and exits 0. Claude Code treats exit-0-with-deny-output as an intentional block.

```ts
const TIMEOUT_MS = 5000;

function installTimeout(hookEvent: SpaHookEvent): void {
  const timer = setTimeout(() => {
    const isWriteOp = hookEvent === 'PreToolUse';
    if (isWriteOp) {
      // [B7] Fail-closed: emit deny before exiting
      const deny = {
        hookSpecificOutput: {
          hookEventName: hookEvent,
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Super Particle Accelerator timed out scanning this operation. Blocked as a precaution.',
        },
      };
      process.stdout.write(JSON.stringify(deny));
    }
    // PostToolUse/Stop: fail-open (exit silently)
    process.exit(0);
  }, TIMEOUT_MS);
  timer.unref();
}
```

### File: `src/super-particle-accelerator-runtime/hooks/claudeSuperParticleAccelerator.ts`

```ts
import { SpaSecretScanner } from '../SecretScanner';
import { SecretWritePolicyEngine } from '../SecretWritePolicyEngine';
import { PathClassifier } from '../PathClassifier';
import { GitStateScanner } from '../GitStateScanner';
import { SpaAuditWriter } from '../AuditWriter';
import { ExceptionLoader } from '../ExceptionLoader';
import { BaselineStore } from '../BaselineStore';
import { SpaHookEvent, SuperParticleAcceleratorSettings } from '../../shared/super-particle-accelerator/types';

async function main() {
  // [B3] Parse event from argv, not env
  const hookEvent = parseHookEvent();

  // [B7] Install fail-closed timeout before any work
  installTimeout(hookEvent);

  if (process.env.CLAUI_SPA !== '1') {
    return allow();
  }

  const storeDir = process.env.CLAUI_SPA_STORE_DIR!;
  const settings = loadSettingsFromEnv();
  const scanner = new SpaSecretScanner(settings.entropyThreshold);
  const pathClassifier = new PathClassifier(settings.frontendPathGlobs, settings.allowedSecretFileGlobs);
  const policy = new SecretWritePolicyEngine(pathClassifier);
  const audit = new SpaAuditWriter(storeDir);
  const exceptionLoader = new ExceptionLoader(storeDir);
  const baselineStore = new BaselineStore(storeDir);

  const raw = await readStdin();
  const input = JSON.parse(raw);

  switch (hookEvent) {
    case 'PreToolUse':
      return handlePreToolUse(input, scanner, policy, audit, exceptionLoader, settings);
    case 'PostToolUse':
      return handlePostToolUse(input, scanner, audit, settings);
    case 'Stop':
      return handleStop(input, scanner, policy, audit, exceptionLoader, baselineStore, settings);
    default:
      return allow();
  }
}

async function handlePreToolUse(
  input: { tool_name: string; tool_input: Record<string, unknown> },
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  const toolName = input.tool_name;

  // Edit/Write/MultiEdit
  if (/^(Edit|Write|MultiEdit)$/.test(toolName) && settings.scanEditTools) {
    return handleEditWrite(input, scanner, policy, audit, exceptionLoader, settings);
  }

  // Bash
  if (toolName === 'Bash' && settings.scanBashCommands) {
    return handleBash(input, scanner, policy, audit, exceptionLoader, settings);
  }

  // MCP tools
  if (toolName.startsWith('mcp__') && settings.scanMcpTools) {
    return handleMcp(input, scanner, policy, audit, exceptionLoader, settings);
  }

  return allow();
}

// [B11] Stop hook with baseline
async function handleStop(
  input: Record<string, unknown>,
  scanner: SpaSecretScanner,
  policy: SecretWritePolicyEngine,
  audit: SpaAuditWriter,
  exceptionLoader: ExceptionLoader,
  baselineStore: BaselineStore,
  settings: SuperParticleAcceleratorSettings,
): Promise<void> {
  if (!settings.scanWorkingTreeOnStop) return allow();

  const cwd = process.cwd();
  const sessionId = process.env.CLAUI_SESSION_ID ?? 'unknown';
  const gitScanner = new GitStateScanner(scanner, cwd, 'claude');

  // Scan everything
  const stagedFindings = gitScanner.scanStagedDiff();
  const unstagedFindings = gitScanner.scanUnstagedDiff();
  const untrackedFindings = gitScanner.scanUntrackedFiles();
  const allFindings = [...stagedFindings, ...unstagedFindings, ...untrackedFindings];

  // [B11] Filter through baseline
  const newFindings = baselineStore.filterNew(sessionId, allFindings);

  if (newFindings.length === 0) {
    // First scan or no new findings — update baseline with all current findings
    if (!baselineStore.load(sessionId)) {
      baselineStore.save(sessionId, allFindings);
    }
    return allow();
  }

  // New findings detected — evaluate policy
  const exceptions = exceptionLoader.loadActive();
  const decision = policy.evaluate({
    findings: newFindings,
    source: 'diff',
    provider: 'claude',
    cwd,
    settings,
    exceptions,
  });

  // Consume exceptions if used
  if (decision.consumedExceptionIds.length > 0) {
    exceptionLoader.consumeMany(decision.consumedExceptionIds);
  }

  // Update baseline with current findings (so we don't re-alert on same findings)
  baselineStore.save(sessionId, allFindings);

  audit.write(buildAuditEvent(decision, 'Stop', 'diff', 'claude', sessionId));

  if (decision.action === 'deny') {
    return deny(decision.reason + '\n\n' + (decision.remediation ?? ''));
  }

  return allow();
}

// ... handleEditWrite, handleBash, handleMcp implementations follow same pattern

function allow(): void {
  // Exit cleanly — no output = allow
  process.exit(0);
}

function deny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse', // overridden per-event where needed
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch(() => {
  // [B7] Unhandled error in write-like context = fail-closed
  const event = (() => { try { return parseHookEvent(); } catch { return 'PreToolUse'; } })();
  if (event === 'PreToolUse') {
    deny('Super Particle Accelerator encountered an error. Write blocked as a precaution.');
  }
  process.exit(0);
});
```

### File: `src/super-particle-accelerator-runtime/hooks/codexSuperParticleAccelerator.ts`

Same structure as Claude hook with these Codex-specific differences:
- File edits use `apply_patch` tool name (matcher: `apply_patch` or `Edit|Write`)
- Additional `PermissionRequest` event for Bash (treated like PreToolUse for scanning purposes)
- Provider set to `'codex'` everywhere

### Hook Dispatch by Tool Name

| Tool Match | Hook Event | Action |
|---|---|---|
| `Edit\|Write\|MultiEdit` | PreToolUse | Scan `tool_input.content` / `tool_input.new_string`. Deny if policy blocks. |
| `apply_patch` (Codex) | PreToolUse | Parse patch content, scan added lines per file. |
| `Bash` | PreToolUse | Scan command text. Detect file-write commands. If git commit/push/deploy: run `GitStateScanner`. |
| `Bash` | PostToolUse | Scan output for accidental secret echo (optional, lower priority). |
| `mcp__.*` | PreToolUse | Recursively scan all string values in `tool_input`. Deny write-like ops with secrets. |
| (all) | Stop | [B11] Run full working tree scan, filter through session baseline, block only new findings. |

### Bash File-Write Command Detection

Detect these patterns in the command string before allowing execution:

```
echo ... > <file>
echo ... >> <file>
cat > <file> <<EOF
cat <<EOF > <file>
tee <file>
printf ... > <file>
sed -i ...
perl -pi ...
node -e "...fs.writeFileSync..."
python -c "...open(...,'w')..."
```

### Git/Deploy Command Detection

Block these when `blockGitCommitPush` is enabled AND staged/worktree has findings:

```
git add, git commit, git commit -a, git push
gh pr create
npm run deploy, pnpm deploy, yarn deploy
vercel deploy, netlify deploy, firebase deploy, gcloud app deploy
```

### Deny Response Format (Claude)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Super Particle Accelerator blocked this action.\n\nReason: A detected google_api_key would be written to src/config.tsx, which is classified as public-client-code.\n\nDo not put API keys or credentials in client-side/public code.\n\nRequired fix:\n- Move the secret to a server-side environment variable.\n- Expose a server-side proxy endpoint.\n- The browser/client should call the proxy, not the external API directly.\n- Use a placeholder in code, e.g. process.env.GOOGLE_API_KEY, without the raw value.\n- Ensure the secret file is gitignored."
  }
}
```

---

## Phase 10: Hook Manager (Extension Side) [B4]

### File: `src/extension/super-particle-accelerator/SuperParticleAcceleratorHookManager.ts`

**Template:** Follow `src/extension/particle-accelerator/ParticleAcceleratorHookManager.ts`.

**[B4] Fixed: Hook ordering with Particle Accelerator.**

### Hook Ordering Rationale [B4]

When both PA and SPA are installed, their hooks coexist in the same hooks arrays. For `Bash PreToolUse`, the order matters:

1. PA rewrites the Bash command to `claui-run --claui-encoded-shell-command <base64>`.
2. If PA runs first, SPA would see the rewritten/encoded command, NOT the original. SPA cannot detect `echo "API_KEY=AIza..." > config.js` after PA encodes it.
3. If SPA runs first, SPA scans the original command and can properly detect file-writes and git operations. If SPA denies, PA never runs (Claude Code stops on first deny).

**Rule: SPA hooks must be inserted BEFORE PA hooks in every hooks array.**

### Implementation

```ts
const SPA_MARKER = '--claui-spa-hook';
const PA_MARKER = '--claui-managed-hook';

private insertBeforePa(hooksArray: HookEntry[], newEntry: HookEntry): void {
  // Find the index of the first PA entry
  const paIndex = hooksArray.findIndex(entry =>
    this.getCommand(entry).includes(PA_MARKER)
  );

  if (paIndex === -1) {
    // No PA hooks — append normally
    hooksArray.push(newEntry);
  } else {
    // Insert SPA entry BEFORE the first PA entry
    hooksArray.splice(paIndex, 0, newEntry);
  }
}
```

### Claude Hooks to Install

Each hook event + matcher combination is a separate entry. The hook command includes the event type as an argv argument [B3]:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "node \"/path/to/claude-spa.js\" --claui-spa-hook PreToolUse"
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node \"/path/to/claude-spa.js\" --claui-spa-hook PreToolUse"
        }]
      },
      {
        "matcher": "mcp__.*",
        "hooks": [{
          "type": "command",
          "command": "node \"/path/to/claude-spa.js\" --claui-spa-hook PreToolUse"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node \"/path/to/claude-spa.js\" --claui-spa-hook PostToolUse"
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "node \"/path/to/claude-spa.js\" --claui-spa-hook Stop"
        }]
      }
    ]
  }
}
```

**Note the event names are now `PreToolUse`, `PostToolUse`, `Stop` (PascalCase matching the enum), not `pre-tool-use` (kebab-case).**

### Codex Hooks to Install

Same tool matchers plus:
- `apply_patch` matcher for PreToolUse and PostToolUse
- `PermissionRequest` event for `Bash`

### Completeness Check

`getStatus()` must verify ALL required hook entries exist. Return:
- `enabled-hooks-installed` -- all entries present for both providers
- `enabled-hooks-missing` -- some entries missing
- `enabled-partial-coverage` -- one provider covered, other missing
- `enabled-trust-required` -- Codex hooks need manual trust approval

### Installation Order Verification

After installation, `getStatus()` must verify SPA hooks appear before PA hooks in every hooks array where both coexist. If ordering is wrong (e.g., user manually reordered), return `enabled-partial-coverage` with a warning.

---

## Phase 11: Settings

### File: `src/extension/super-particle-accelerator/SuperParticleAcceleratorSettings.ts`

**Template:** Follow `src/extension/particle-accelerator/ParticleAcceleratorSettings.ts`.

```ts
import * as vscode from 'vscode';
import { SuperParticleAcceleratorSettings } from '../../shared/super-particle-accelerator/types';

const SECTION = 'claudeMirror.superParticleAccelerator';

const DEFAULTS: SuperParticleAcceleratorSettings = {
  enabled: false,
  mode: 'block',
  scanEditTools: true,
  scanBashCommands: true,
  scanMcpTools: true,
  scanWorkingTreeOnStop: true,
  blockGitCommitPush: true,
  allowIgnoredEnvFiles: true,
  entropyThreshold: 4.2,
  frontendPathGlobs: [
    'public/**', 'static/**', 'dist/**', 'build/**',
    'client/**', 'frontend/**', 'web/**',
    'src/**/*.html', 'src/**/*.tsx', 'src/**/*.jsx',
    'src/**/*.js', 'src/**/*.ts',
  ],
  allowedSecretFileGlobs: [
    '.env.local', '.env.*.local', '*.local.env',
  ],
};

export function getSuperParticleAcceleratorSettings(): SuperParticleAcceleratorSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: cfg.get<boolean>('enabled', DEFAULTS.enabled),
    mode: cfg.get<'block' | 'audit'>('mode', DEFAULTS.mode),
    scanEditTools: cfg.get<boolean>('scanEditTools', DEFAULTS.scanEditTools),
    scanBashCommands: cfg.get<boolean>('scanBashCommands', DEFAULTS.scanBashCommands),
    scanMcpTools: cfg.get<boolean>('scanMcpTools', DEFAULTS.scanMcpTools),
    scanWorkingTreeOnStop: cfg.get<boolean>('scanWorkingTreeOnStop', DEFAULTS.scanWorkingTreeOnStop),
    blockGitCommitPush: cfg.get<boolean>('blockGitCommitPush', DEFAULTS.blockGitCommitPush),
    allowIgnoredEnvFiles: cfg.get<boolean>('allowIgnoredEnvFiles', DEFAULTS.allowIgnoredEnvFiles),
    entropyThreshold: cfg.get<number>('entropyThreshold', DEFAULTS.entropyThreshold),
    frontendPathGlobs: cfg.get<string[]>('frontendPathGlobs', DEFAULTS.frontendPathGlobs),
    allowedSecretFileGlobs: cfg.get<string[]>('allowedSecretFileGlobs', DEFAULTS.allowedSecretFileGlobs),
  };
}

export function onSuperParticleAcceleratorSettingsChanged(
  cb: (s: SuperParticleAcceleratorSettings) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(SECTION)) {
      cb(getSuperParticleAcceleratorSettings());
    }
  });
}
```

### package.json Registration

Add under `contributes.configuration.properties`:

```json
"claudeMirror.superParticleAccelerator.enabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable Super Particle Accelerator: blocks AI agents from writing detected secrets into code, git commits, MCP writes, and public assets.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.mode": {
  "type": "string",
  "enum": ["block", "audit"],
  "default": "block",
  "description": "block = deny write operations containing secrets. audit = log only, don't block.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.scanEditTools": {
  "type": "boolean",
  "default": true,
  "description": "Scan Edit/Write/MultiEdit tool calls for secrets before files are modified.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.scanBashCommands": {
  "type": "boolean",
  "default": true,
  "description": "Scan Bash commands for file-write operations and git commits containing secrets.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.scanMcpTools": {
  "type": "boolean",
  "default": true,
  "description": "Scan MCP tool arguments for secrets in write-like operations.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.scanWorkingTreeOnStop": {
  "type": "boolean",
  "default": true,
  "description": "Scan the git working tree at the end of each agent turn for newly introduced secrets.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.blockGitCommitPush": {
  "type": "boolean",
  "default": true,
  "description": "Block git commit, push, and deploy commands when staged or modified files contain secrets.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.allowIgnoredEnvFiles": {
  "type": "boolean",
  "default": true,
  "description": "Allow secrets in .env.local and similar files when they are gitignored and outside public directories.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.entropyThreshold": {
  "type": "number",
  "default": 4.2,
  "description": "Shannon entropy threshold for detecting high-entropy strings as potential secrets.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.frontendPathGlobs": {
  "type": "array",
  "items": { "type": "string" },
  "default": ["public/**","static/**","dist/**","build/**","client/**","frontend/**","web/**","src/**/*.html","src/**/*.tsx","src/**/*.jsx","src/**/*.js","src/**/*.ts"],
  "description": "Glob patterns for paths classified as frontend/client-side code.",
  "scope": "resource"
},
"claudeMirror.superParticleAccelerator.allowedSecretFileGlobs": {
  "type": "array",
  "items": { "type": "string" },
  "default": [".env.local", ".env.*.local", "*.local.env"],
  "description": "Glob patterns for files where secrets are allowed (only when gitignored and outside public directories).",
  "scope": "resource"
}
```

---

## Phase 12: Env Builder

### File: `src/extension/super-particle-accelerator/SuperParticleAcceleratorEnvBuilder.ts`

**Template:** Follow `src/extension/particle-accelerator/ParticleAcceleratorEnvBuilder.ts`.

```ts
export function buildSpaEnv(settings: SuperParticleAcceleratorSettings, storeDir: string): Record<string, string> {
  if (!settings.enabled) return {};
  return {
    CLAUI_SPA: '1',
    CLAUI_SPA_MODE: settings.mode,
    CLAUI_SPA_STORE_DIR: storeDir,
    CLAUI_SPA_ENTROPY_THRESHOLD: String(settings.entropyThreshold),
    CLAUI_SPA_FRONTEND_GLOBS: JSON.stringify(settings.frontendPathGlobs),
    CLAUI_SPA_ALLOWED_SECRET_GLOBS: JSON.stringify(settings.allowedSecretFileGlobs),
    CLAUI_SPA_SCAN_EDIT: settings.scanEditTools ? '1' : '0',
    CLAUI_SPA_SCAN_BASH: settings.scanBashCommands ? '1' : '0',
    CLAUI_SPA_SCAN_MCP: settings.scanMcpTools ? '1' : '0',
    CLAUI_SPA_SCAN_STOP: settings.scanWorkingTreeOnStop ? '1' : '0',
    CLAUI_SPA_BLOCK_GIT: settings.blockGitCommitPush ? '1' : '0',
    CLAUI_SPA_ALLOW_IGNORED_ENV: settings.allowIgnoredEnvFiles ? '1' : '0',
  };
}
```

### Process Manager Integration

In `SessionTab.ts`, wire up the env builder alongside the existing PA env builder:

```ts
// In SessionTab.setSuperParticleAcceleratorService():
this.processManager.superParticleAcceleratorEnvBuilder = (baseEnv) => {
  const settings = getSuperParticleAcceleratorSettings();
  return buildSpaEnv(settings, this.spaService.storeDir);
};
```

Add `superParticleAcceleratorEnvBuilder` field to both `ClaudeProcessManager` and `CodexExecProcessManager`, following the `particleAcceleratorEnvBuilder` pattern.

---

## Phase 13: Extension Facade Service

### File: `src/extension/super-particle-accelerator/SuperParticleAcceleratorService.ts`

**Template:** Follow `src/extension/particle-accelerator/ParticleAcceleratorService.ts`.

```ts
export class SuperParticleAcceleratorService implements vscode.Disposable {
  private hookManager: SuperParticleAcceleratorHookManager;
  private auditReader: SuperParticleAcceleratorAuditReader;
  private exceptionStore: SpaExceptionStore;  // [B8]
  private disposables: vscode.Disposable[] = [];
  readonly storeDir: string;

  constructor(context: vscode.ExtensionContext) {
    this.storeDir = path.join(context.globalStorageUri.fsPath, 'super-particle-accelerator');
    // [B9] Ensure base directory exists
    fs.mkdirSync(this.storeDir, { recursive: true });
    this.hookManager = new SuperParticleAcceleratorHookManager(/* ... */);
    this.auditReader = new SuperParticleAcceleratorAuditReader(this.storeDir);
    this.exceptionStore = new SpaExceptionStore(this.storeDir);  // [B8]

    this.disposables.push(
      onSuperParticleAcceleratorSettingsChanged(s => this.onSettingsChanged(s))
    );
  }

  async activate(workspaceRoot: string): Promise<void> {
    const settings = getSuperParticleAcceleratorSettings();
    if (settings.enabled) {
      await this.hookManager.install(workspaceRoot);
    }
  }

  async deactivate(workspaceRoot: string): Promise<void> {
    await this.hookManager.uninstall(workspaceRoot);
  }

  getStatus(): SuperParticleAcceleratorStatus { /* ... */ }

  buildAgentEnv(): Record<string, string> {
    return buildSpaEnv(getSuperParticleAcceleratorSettings(), this.storeDir);
  }

  async getAuditEvents(limit?: number): Promise<SuperParticleAcceleratorAuditEvent[]> {
    return this.auditReader.read(limit);
  }

  // [B8] Exception management
  getActiveExceptions(): SuperParticleAcceleratorException[] {
    return this.exceptionStore.listActive();
  }

  createException(input: Omit<SuperParticleAcceleratorException, 'id' | 'createdAt' | 'usedCount'>): SuperParticleAcceleratorException {
    return this.exceptionStore.add(input);
  }

  deleteException(id: string): boolean {
    return this.exceptionStore.delete(id);
  }

  private onSettingsChanged(settings: SuperParticleAcceleratorSettings): void {
    // Re-install or uninstall hooks based on enabled state
    // Prune old exceptions
    if (settings.enabled) {
      this.exceptionStore.prune();
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    // [B11] Best-effort: clean up old baseline files
  }
}
```

### Registration in `extension.ts`

```ts
// In activate():
const spaService = new SuperParticleAcceleratorService(context);
context.subscriptions.push(spaService);
tabManager.setSuperParticleAcceleratorService(spaService);
```

---

## Phase 14: UI Implementation [B1]

### [B1] Status Bar Badge

**File:** `src/webview/components/SuperParticleAccelerator/SuperParticleAcceleratorStatusBadge.tsx`

**Pattern:** Follow `SecretProtectionStatusBadge.tsx` — a small badge in the status bar right section that shows current status and opens a settings/audit panel on click.

```tsx
import React from 'react';
import { useStore } from '../../state/store';

export const SuperParticleAcceleratorStatusBadge: React.FC = () => {
  const enabled = useStore(s => s.superParticleAcceleratorEnabled);
  const status = useStore(s => s.superParticleAcceleratorStatus);
  const lastEvent = useStore(s => s.superParticleAcceleratorLastEvent);
  const setPanelOpen = useStore(s => s.setSuperParticleAcceleratorPanelOpen);

  const label = enabled ? 'SPA' : 'SPA Off';
  const statusColor = getStatusColor(status, lastEvent);

  return (
    <button
      className="status-badge spa-badge"
      onClick={() => setPanelOpen(true)}
      title={getStatusTitle(status)}
      style={{ color: statusColor }}
    >
      {label}
      {lastEvent?.action === 'deny' && (
        <span className="spa-badge-alert" />
      )}
    </button>
  );
};

function getStatusColor(status: string, lastEvent?: { action: string }): string {
  if (status === 'disabled') return 'var(--vscode-descriptionForeground)';
  if (status === 'error' || status === 'enabled-hooks-missing') return 'var(--vscode-errorForeground)';
  if (lastEvent?.action === 'deny') return 'var(--vscode-charts-red)';
  if (status === 'enabled-hooks-installed') return 'var(--vscode-charts-green)';
  return 'var(--vscode-charts-yellow)';
}

function getStatusTitle(status: string): string {
  switch (status) {
    case 'disabled': return 'Super Particle Accelerator: Disabled';
    case 'enabled-hooks-installed': return 'Super Particle Accelerator: Active';
    case 'enabled-hooks-missing': return 'Super Particle Accelerator: Hooks Missing';
    case 'enabled-trust-required': return 'Super Particle Accelerator: Codex Trust Required';
    case 'enabled-partial-coverage': return 'Super Particle Accelerator: Partial Coverage';
    case 'error': return 'Super Particle Accelerator: Error';
    default: return 'Super Particle Accelerator';
  }
}
```

### [B1] Settings Panel (Modal)

**File:** `src/webview/components/SuperParticleAccelerator/SuperParticleAcceleratorPanel.tsx`

**Pattern:** Follow `SettingsPanel.tsx` (Secret Protection panel) — a full-screen modal dialog opened from the badge.

```tsx
import React from 'react';
import { useStore } from '../../state/store';

export const SuperParticleAcceleratorPanel: React.FC = () => {
  const panelOpen = useStore(s => s.superParticleAcceleratorPanelOpen);
  const enabled = useStore(s => s.superParticleAcceleratorEnabled);
  const mode = useStore(s => s.superParticleAcceleratorMode);
  const status = useStore(s => s.superParticleAcceleratorStatus);
  const auditEvents = useStore(s => s.superParticleAcceleratorAuditEvents);
  const error = useStore(s => s.superParticleAcceleratorError);
  const setPanelOpen = useStore(s => s.setSuperParticleAcceleratorPanelOpen);
  const postToExtension = useStore(s => s.postToExtension);

  if (!panelOpen) return null;

  return (
    <div className="dlp-panel-backdrop" role="dialog" onClick={e => {
      if (e.target === e.currentTarget) setPanelOpen(false);
    }}>
      <div className="dlp-panel spa-panel">
        <div className="dlp-panel-header">
          <h2>Super Particle Accelerator</h2>
          <button className="dlp-panel-close" onClick={() => setPanelOpen(false)}>X</button>
        </div>

        <div className="dlp-panel-body">
          {/* Main Enable/Disable Toggle with hover tooltip */}
          <div
            className="spa-main-toggle"
            title="Super Particle Accelerator intercepts every AI agent write operation — file edits, shell commands, MCP calls, and git commits — and blocks any attempt to write API keys, tokens, credentials, or other secrets into your codebase. Especially strict for client-side and public code. Secrets are never logged; only redacted previews and hashes are stored."
          >
            <label className="spa-toggle-label">
              <span>Super Particle Accelerator</span>
              <span className="spa-toggle-description">
                Extra protection: blocks Claude Code and Codex from writing
                detected secrets into code, git commits, MCP writes, and public assets.
              </span>
            </label>
            <button
              className={`spa-toggle-button ${enabled ? 'spa-toggle-on' : 'spa-toggle-off'}`}
              onClick={() => postToExtension({ type: 'superParticleAcceleratorSetEnabled', enabled: !enabled })}
            >
              {enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          {/* Status indicator */}
          <div className="spa-status-row">
            <span className={`spa-status-dot spa-status-${status}`} />
            <span>{getStatusLabel(status)}</span>
          </div>

          {error && <div className="spa-error">{error}</div>}

          {enabled && (
            <>
              {/* Mode selector */}
              <div className="spa-mode-selector">
                <label>Mode:</label>
                <select
                  value={mode}
                  onChange={e => postToExtension({
                    type: 'superParticleAcceleratorSetMode',
                    mode: e.target.value as 'block' | 'audit',
                  })}
                >
                  <option value="block">Block (deny writes with secrets)</option>
                  <option value="audit">Audit (log only, don't block)</option>
                </select>
              </div>

              {/* Recent audit events */}
              <div className="spa-audit-section">
                <h3>Recent Events ({auditEvents.length})</h3>
                {auditEvents.slice(0, 20).map(event => (
                  <div key={event.id} className={`spa-audit-event spa-audit-${event.action}`}>
                    <span className="spa-audit-time">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="spa-audit-action">{event.action.toUpperCase()}</span>
                    <span className="spa-audit-tool">{event.toolName}</span>
                    {event.filePath && (
                      <span className="spa-audit-file">{event.filePath}</span>
                    )}
                    <span className="spa-audit-reason">{event.reason}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function getStatusLabel(status: string): string {
  switch (status) {
    case 'disabled': return 'Disabled';
    case 'enabled-hooks-installed': return 'Active - protecting Claude and Codex';
    case 'enabled-hooks-missing': return 'Hooks not installed - click to fix';
    case 'enabled-trust-required': return 'Codex hook trust required';
    case 'enabled-partial-coverage': return 'Partial coverage - check hook order';
    case 'error': return 'Error';
    default: return status;
  }
}
```

### Status Bar Integration

In `StatusBar.tsx`, add the SPA badge alongside existing badges in `.status-bar-right`:

```tsx
<div className="status-bar-right">
  <SuperParticleAcceleratorStatusBadge />   {/* NEW */}
  <SecretProtectionStatusBadge />
  <ParticleAcceleratorStatusBadge />
  {/* ... */}
</div>
```

Render `<SuperParticleAcceleratorPanel />` at the top level of the webview app (same level as `<SettingsPanel />`).

### CSS Classes

Add to `src/webview/styles/global.css`:

```css
/* SPA Badge */
.spa-badge { position: relative; }
.spa-badge-alert {
  position: absolute;
  top: -2px; right: -2px;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--vscode-charts-red);
}

/* SPA Panel — reuses dlp-panel-* classes from Secret Protection */
.spa-panel { max-width: 600px; }

.spa-main-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  margin-bottom: 12px;
}

.spa-toggle-label { display: flex; flex-direction: column; gap: 2px; }
.spa-toggle-description { font-size: 11px; color: var(--vscode-descriptionForeground); }

.spa-toggle-button {
  padding: 4px 12px;
  border-radius: 3px;
  border: 1px solid var(--vscode-button-border, transparent);
  font-size: 12px;
  cursor: pointer;
}
.spa-toggle-on {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.spa-toggle-off {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.spa-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.spa-status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
}
.spa-status-disabled { background: var(--vscode-descriptionForeground); }
.spa-status-enabled-hooks-installed { background: var(--vscode-charts-green); }
.spa-status-enabled-hooks-missing { background: var(--vscode-charts-red); }
.spa-status-enabled-trust-required { background: var(--vscode-charts-yellow); }
.spa-status-enabled-partial-coverage { background: var(--vscode-charts-yellow); }
.spa-status-error { background: var(--vscode-charts-red); }

.spa-error {
  padding: 8px; border-radius: 4px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  margin-bottom: 12px;
}

.spa-mode-selector { margin-bottom: 16px; }
.spa-mode-selector select {
  padding: 4px 8px;
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
}

.spa-audit-event {
  display: flex; gap: 8px; align-items: baseline;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 12px;
  margin-bottom: 2px;
}
.spa-audit-deny { background: rgba(255,0,0,0.08); }
.spa-audit-allow { background: transparent; }
.spa-audit-audit { background: rgba(255,200,0,0.08); }

.spa-audit-time { color: var(--vscode-descriptionForeground); min-width: 70px; }
.spa-audit-action { font-weight: 600; min-width: 50px; }
.spa-audit-tool { color: var(--vscode-textLink-foreground); }
.spa-audit-file { color: var(--vscode-descriptionForeground); font-style: italic; }
.spa-audit-reason { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

---

## Phase 15: Webview Integration

### Webview Messages

Add to `src/extension/types/webview-messages.ts`:

```ts
// Webview -> Extension
interface SuperParticleAcceleratorGetStatusRequest { type: 'superParticleAcceleratorGetStatus'; }
interface SuperParticleAcceleratorSetEnabledRequest { type: 'superParticleAcceleratorSetEnabled'; enabled: boolean; }
interface SuperParticleAcceleratorSetModeRequest { type: 'superParticleAcceleratorSetMode'; mode: 'block' | 'audit'; }
interface SuperParticleAcceleratorGetAuditEventsRequest { type: 'superParticleAcceleratorGetAuditEvents'; limit?: number; }
interface SuperParticleAcceleratorCreateExceptionRequest { type: 'superParticleAcceleratorCreateException'; exception: Omit<SuperParticleAcceleratorException, 'id' | 'createdAt' | 'usedCount'>; }
interface SuperParticleAcceleratorDeleteExceptionRequest { type: 'superParticleAcceleratorDeleteException'; exceptionId: string; }

// Extension -> Webview
interface SuperParticleAcceleratorStatusMessage { type: 'superParticleAcceleratorStatus'; status: SuperParticleAcceleratorStatus; enabled: boolean; mode: 'block' | 'audit'; }
interface SuperParticleAcceleratorAuditEventsMessage { type: 'superParticleAcceleratorAuditEvents'; events: SuperParticleAcceleratorAuditEvent[]; }
interface SuperParticleAcceleratorLastEventMessage { type: 'superParticleAcceleratorLastEvent'; event: SuperParticleAcceleratorAuditEvent; }
interface SuperParticleAcceleratorErrorMessage { type: 'superParticleAcceleratorError'; error: string; }
```

Add all to the `WebviewToExtensionMessage` and `ExtensionToWebviewMessage` unions.

### Zustand Slice

Add `src/webview/store/superParticleAcceleratorSlice.ts`:

```ts
export interface SuperParticleAcceleratorUiState {
  superParticleAcceleratorEnabled: boolean;
  superParticleAcceleratorMode: 'block' | 'audit';
  superParticleAcceleratorStatus: SuperParticleAcceleratorStatus;
  superParticleAcceleratorAuditEvents: SuperParticleAcceleratorAuditEvent[];
  superParticleAcceleratorLastEvent?: SuperParticleAcceleratorAuditEvent;
  superParticleAcceleratorError?: string;
  superParticleAcceleratorPanelOpen: boolean;  // [B1]

  // Actions
  setSuperParticleAcceleratorPanelOpen: (open: boolean) => void;
}

export const superParticleAcceleratorSliceDefaults: SuperParticleAcceleratorUiState = {
  superParticleAcceleratorEnabled: false,
  superParticleAcceleratorMode: 'block',
  superParticleAcceleratorStatus: 'disabled',
  superParticleAcceleratorAuditEvents: [],
  superParticleAcceleratorPanelOpen: false,
  setSuperParticleAcceleratorPanelOpen: () => {},
};
```

Merge into the main store in `src/webview/state/store.ts` following the existing `dlpSettingsSlice` pattern.

### MessageHandler Integration

In `MessageHandler.ts`, handle SPA messages alongside existing PA/SP handlers:

```ts
case 'superParticleAcceleratorGetStatus':
  const status = this.spaService.getStatus();
  const settings = getSuperParticleAcceleratorSettings();
  this.postToWebview({ type: 'superParticleAcceleratorStatus', status, enabled: settings.enabled, mode: settings.mode });
  break;

case 'superParticleAcceleratorSetEnabled':
  await vscode.workspace.getConfiguration('claudeMirror.superParticleAccelerator')
    .update('enabled', msg.enabled, vscode.ConfigurationTarget.Workspace);
  break;

case 'superParticleAcceleratorSetMode':
  await vscode.workspace.getConfiguration('claudeMirror.superParticleAccelerator')
    .update('mode', msg.mode, vscode.ConfigurationTarget.Workspace);
  break;

case 'superParticleAcceleratorGetAuditEvents':
  const events = await this.spaService.getAuditEvents(msg.limit);
  this.postToWebview({ type: 'superParticleAcceleratorAuditEvents', events });
  break;

case 'superParticleAcceleratorCreateException':
  this.spaService.createException(msg.exception);
  break;

case 'superParticleAcceleratorDeleteException':
  this.spaService.deleteException(msg.exceptionId);
  break;
```

---

## Phase 16: Webpack Config

Add a new entry group under the existing `particle-accelerator-runtime` config in `webpack.config.js`, or add a fourth config block:

```js
{
  name: 'super-particle-accelerator-runtime',
  target: 'node',
  mode: argv.mode || 'production',
  entry: {
    'hooks/claude-spa': './src/super-particle-accelerator-runtime/hooks/claudeSuperParticleAccelerator.ts',
    'hooks/codex-spa': './src/super-particle-accelerator-runtime/hooks/codexSuperParticleAccelerator.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist', 'super-particle-accelerator-runtime'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
  },
  externals: { vscode: 'commonjs vscode' },
}
```

The hook manager installer (`SuperParticleAcceleratorHookManager`) copies compiled hooks from `dist/super-particle-accelerator-runtime/hooks/` to `globalStorageUri/super-particle-accelerator/runtime/hooks/`, mirroring the PA installer pattern.

---

## Phase 17: Performance Constraints [B7]

| Constraint | Value | Enforcement |
|---|---|---|
| PreToolUse scan latency | < 300ms for small edits | Keep scanner synchronous, no network calls |
| Hard timeout | 5s per hook execution | [B7] `setTimeout` + deny output for writes, silent exit for reads |
| Max single scan input | 2 MB | Truncate text before scanning |
| Max Stop hook scan | 20 MB total changed text | Sum tracked; skip files beyond cap |
| Binary files | Skip | Check for null bytes in first 8KB |
| Large generated files | Chunk scan | 512KB chunks with overlap |

### [B7] Fail-Closed vs Fail-Open (Revised)

| Scenario | Behavior | Mechanism |
|---|---|---|
| Edit/Write/apply_patch with unreadable content | **DENY** | Hook outputs deny JSON, exits 0 |
| Bash command can't be parsed | **DENY** | Hook outputs deny JSON, exits 0 |
| Git commit/push + can't read staged diff | **DENY** | Hook outputs deny JSON, exits 0 |
| **Hook timeout (PreToolUse)** | **DENY** | [B7] setTimeout outputs deny JSON, exits 0 |
| **Hook unhandled error (PreToolUse)** | **DENY** | [B7] catch handler outputs deny JSON |
| Hook timeout (PostToolUse/Stop) | ALLOW | setTimeout exits 0 silently |
| Hook unhandled error (PostToolUse/Stop) | ALLOW | catch handler exits 0 silently |
| Read-only commands | ALLOW | Not scanned |
| Status/listing commands | ALLOW | Not scanned |
| Audit UI load failure | ALLOW | Degrade gracefully in webview |

---

## Phase 18: Remediation Message Templates

### Generic Template

```
Super Particle Accelerator blocked this action.

Reason:
A detected {secretType} would be written to {filePath}, which is classified as {pathRisk}.

Do not put API keys or credentials in client-side/public code.

Required fix:
- Move the secret to a server-side environment variable.
- Expose a server-side proxy endpoint.
- The browser/client should call the proxy, not the external API directly.
- Use a placeholder in code, for example process.env.GOOGLE_API_KEY, without the raw value.
- Ensure the secret file is gitignored.
```

### Google/Gemini/TTS-Specific Template

```
Use a server-side proxy for Gemini/TTS. Keep the Google API key in server-side .env only.
The browser must call the proxy endpoint, not Google directly.
```

### Git Commit/Push Template

```
Super Particle Accelerator blocked this git operation.

Staged changes contain a detected {secretType} in {filePath}.

Remove the secret before committing:
- Replace the raw value with process.env.{SUGGESTED_VAR_NAME}.
- Store the actual value in a gitignored .env.local file.
- Run 'git diff --cached' to review staged changes.
```

---

## Phase 19: Tests [B12]

### Test Matrix (minimum coverage)

| Test Case | Expected Result | File |
|---|---|---|
| Google API key in `.tsx` file | DENY | `SecretWritePolicyEngine.test.ts` |
| Google API key in `public/index.html` | DENY (hard, no exception override) | `SecretWritePolicyEngine.test.ts` |
| OpenAI key in `.env.local` (gitignored, outside public/) | ALLOW / AUDIT | `SecretWritePolicyEngine.test.ts` |
| [B10] OpenAI key in `public/.env.local` (gitignored but inside public/) | DENY | `SecretWritePolicyEngine.test.ts` |
| OpenAI key in tracked `.env` | DENY | `SecretWritePolicyEngine.test.ts` |
| [B5] GitHub token in staged diff -> filePath + line preserved | DENY commit, findings have correct filePath and lineNumber | `GitStateScanner.test.ts` |
| Secret in MCP write args | DENY | `claudeSuperParticleAccelerator.test.ts` |
| Placeholder `YOUR_API_KEY_HERE` | ALLOW | `SecretWritePolicyEngine.test.ts` |
| High-entropy string in normal prose | No false positive / low confidence | `SecretScanner.test.ts` |
| [B12] Raw secret never in audit output | Verified (see below) | `noRawSecretPersistence.test.ts` |
| Feature disabled -> no blocking | Verified | `SuperParticleAcceleratorSettings.test.ts` |
| `echo "API_KEY=AIza..." > config.js` | DENY | `claudeSuperParticleAccelerator.test.ts` |
| `git push` with staged secrets | DENY | `claudeSuperParticleAccelerator.test.ts` |
| [B11] Stop hook: first scan creates baseline, no block | ALLOW, baseline file created | `claudeSuperParticleAccelerator.test.ts` |
| [B11] Stop hook: new secret after baseline | DENY only the new finding | `claudeSuperParticleAccelerator.test.ts` |
| [B11] Stop hook: only pre-existing secrets | ALLOW (in baseline) | `claudeSuperParticleAccelerator.test.ts` |
| Path classifier: `dist/bundle.js` | `generated-public-artifact` | `PathClassifier.test.ts` |
| Path classifier: `app/api/route.ts` | `server-code` | `PathClassifier.test.ts` |
| Path classifier: `src/App.tsx` | `public-client-code` | `PathClassifier.test.ts` |
| [B10] Path classifier: `public/.env.local` | NOT `local-secret-file` | `PathClassifier.test.ts` |
| [B2] Exception covers finding, pathRisk not public | AUDIT (allowed) | `SecretWritePolicyEngine.test.ts` |
| [B2] Exception covers finding, pathRisk is public | DENY (hard deny, exception ignored) | `SecretWritePolicyEngine.test.ts` |
| [B8] Exception: valid, unexpired, matching hash | AUDIT, usedCount incremented | `ExceptionStore.test.ts` |
| [B8] Exception: expired | DENY, usedCount not changed | `ExceptionStore.test.ts` |
| [B8] Exception: maxUses reached | DENY | `ExceptionStore.test.ts` |
| [B4] SPA hooks installed before PA hooks | Verified via getStatus() | `SuperParticleAcceleratorHookManager.test.ts` |
| [B7] Hook timeout on PreToolUse | DENY output emitted | `claudeSuperParticleAccelerator.test.ts` |
| [B7] Hook unhandled error on PreToolUse | DENY output emitted | `claudeSuperParticleAccelerator.test.ts` |
| [B6] Malicious filePath in git check-ignore | No shell injection | `GitStateScanner.test.ts` |

### [B12] Security Test (`noRawSecretPersistence.test.ts`) — Strengthened

The test must verify that the **full raw secret value** appears NOWHERE in any output artifact. This includes `redactedPreview` — which in v1 could reveal the full secret for short values.

```ts
const TEST_SECRETS = [
  // Short secrets (most dangerous for redaction leaks)
  { raw: 'sk-short1234', type: 'openai_api_key' },
  { raw: 'ghp_abc123XYZ', type: 'github_token' },
  // Standard-length secrets
  { raw: 'AIzaSyAbcDeFgHiJkLmNoPqRsTuVwXyZ0123456', type: 'google_api_key' },
  { raw: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345678901234567AB', type: 'openai_api_key' },
  { raw: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF', type: 'anthropic_api_key' },
  { raw: 'AKIAIOSFODNN7EXAMPLE', type: 'aws_access_key' },
];

for (const secret of TEST_SECRETS) {
  // 1. redactedPreview must NOT contain the full raw value
  const preview = SpaSecretScanner.redact(secret.raw);
  assert(!preview.includes(secret.raw),
    `redactedPreview contains full raw secret for ${secret.type}`);

  // 2. redactedPreview must contain '***'
  assert(preview.includes('***'),
    `redactedPreview missing *** for ${secret.type}`);

  // 3. Revealed characters must be < 30% of original length
  const revealed = preview.replace('***', '');
  assert(revealed.length < secret.raw.length * 0.3,
    `redactedPreview reveals ${revealed.length}/${secret.raw.length} chars for ${secret.type}`);

  // 4. For secrets <= 12 chars, preview must be exactly '***'
  if (secret.raw.length <= 12) {
    assert(preview === '***',
      `Short secret ${secret.type} (${secret.raw.length} chars) must redact to just ***`);
  }

  // 5. redactedPreview must NOT match known secret regex patterns
  const secretPatterns = [
    /AIza[0-9A-Za-z_-]{35}/,
    /sk-[a-zA-Z0-9-]{20,}/,
    /sk-ant-[a-zA-Z0-9-]{20,}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /AKIA[0-9A-Z]{16}/,
  ];
  for (const pattern of secretPatterns) {
    assert(!pattern.test(preview),
      `redactedPreview matches secret pattern ${pattern} for ${secret.type}`);
  }

  // 6. Full pipeline test: scan -> policy -> audit -> hook output
  // Feed the secret through the full pipeline, capture all outputs,
  // grep for the raw value in serialized JSON of every output
  const auditEvent = buildAuditEventFromFinding(/* ... */);
  const hookOutput = buildDenyResponse(/* ... */);
  const auditJson = JSON.stringify(auditEvent);
  const hookJson = JSON.stringify(hookOutput);

  assert(!auditJson.includes(secret.raw),
    `Raw secret leaked into audit event JSON for ${secret.type}`);
  assert(!hookJson.includes(secret.raw),
    `Raw secret leaked into hook output JSON for ${secret.type}`);
}
```

---

## Implementation Order (Revised)

| Phase | What | Dependencies | Estimated Size |
|---|---|---|---|
| 1 | Types & interfaces | None | S |
| 11 | Settings (extension + package.json) | Phase 1 | S |
| 2 | Secret Scanner wrapper + [B12] redaction | Phase 1, existing `CompositeSecretScanner` | S |
| 3 | Path Classifier + [B10] public root guard | Phase 1 | S |
| 7 | Exception Store [B8] + Exception Loader | Phase 1 | M |
| 8 | Baseline Store [B11] | Phase 1 | S |
| 4 | Policy Engine [B2] (corrected waterfall) | Phases 1-3, 7 | M |
| 5 | Git State Scanner [B5][B6] (per-file diff) | Phases 1-2 | M |
| 6 | Audit Writer [B9] | Phase 1, existing `AuditStore` | S |
| 9 | Hook scripts [B3][B7] (Claude + Codex) | Phases 2-8 | L |
| 16 | Webpack config | Phase 9 | S |
| 10 | Hook Manager [B4] (SPA-before-PA ordering) | Phase 9 | M |
| 12 | Env Builder | Phase 11 | S |
| 13 | Service facade + extension.ts wiring | Phases 10-12 | M |
| 14 | UI: Badge + Panel [B1] | Phase 1 | M |
| 15 | Webview messages + Zustand slice | Phases 1, 14 | M |
| 17-19 | Performance, Templates, Tests [B12] | All phases | L |

**Recommended build order:** 1 -> 11 -> 2 -> 3 -> 7 -> 8 -> 4 -> 5 -> 6 -> 9 -> 16 -> 10 -> 12 -> 13 -> 14 -> 15 -> 17-19

---

## Key Integration Points Summary

| Existing Component | Where | How SPA Uses It |
|---|---|---|
| `CompositeSecretScanner` | `src/shared/secret-protection/scanners/` | Wrapped by `SpaSecretScanner` — reuse all 13 rule packs |
| `AuditStore` | `src/shared/audit/` | Pattern reused; SPA has own writer with separate dir [B9] |
| `ExceptionStore` | `src/server/enforcement/` | Pattern reused; SPA has own store with atomic writes [B8] |
| `PolicyEngine` | `src/shared/secret-protection/` | SPA policy engine uses corrected waterfall [B2] |
| `ParticleAcceleratorHookManager` | `src/extension/particle-accelerator/` | Template for hook installation; SPA inserts BEFORE PA [B4] |
| `ParticleAcceleratorInstaller` | `src/extension/particle-accelerator/` | Template for copying compiled hooks to globalStorage |
| `ParticleAcceleratorEnvBuilder` | `src/extension/particle-accelerator/` | Template for env var builder |
| `claudePreToolUse.ts` | `src/particle-accelerator-runtime/hooks/` | Template for hook I/O; SPA uses argv for event type [B3] |
| `SessionTab` | `src/extension/session/` | Add `setSuperParticleAcceleratorService()` alongside existing patterns |
| `ClaudeProcessManager` | `src/extension/process/` | Add `superParticleAcceleratorEnvBuilder` field |
| `CodexExecProcessManager` | `src/extension/process/` | Add `superParticleAcceleratorEnvBuilder` field |
| `webview-messages.ts` | `src/extension/types/` | Add SPA message types to unions |
| `store.ts` | `src/webview/state/` | Merge SPA slice |
| `dlpSettingsSlice.ts` | `src/webview/store/` | Template for SPA Zustand slice |
| `SecretProtectionStatusBadge` | `src/webview/components/` | Template for SPA status badge [B1] |
| `SettingsPanel.tsx` | `src/webview/components/` | Template for SPA settings modal [B1] |
| `StatusBar.tsx` | `src/webview/components/StatusBar/` | Mount SPA badge in `.status-bar-right` [B1] |

---

## Blocker Resolution Checklist

| # | Blocker | Resolution | Phases Affected |
|---|---------|------------|-----------------|
| B1 | No UI implementation for SPA toggle | Added Phase 14: `SuperParticleAcceleratorStatusBadge` + `SuperParticleAcceleratorPanel` with explicit component specs, CSS, and StatusBar integration | 14, 15 |
| B2 | Allow/deny precedence contradictory | Replaced with deny-first waterfall: Gate 0 (no findings) -> Gate 1 (filter placeholders) -> Gate 2 (hard deny public paths) -> Gate 3 (allowed env files) -> Gate 4 (exceptions) -> Default deny | 4 |
| B3 | Hook event detection argv/env mismatch | Event type passed as argv after marker (`--claui-spa-hook PreToolUse`), parsed by `parseHookEvent()`. Removed env var. | 1, 9, 10 |
| B4 | Hook ordering with PA undefined | SPA hooks inserted BEFORE PA hooks via `insertBeforePa()`. `getStatus()` verifies ordering. | 10 |
| B5 | Git diffs not parsed per file | New `parseDiff()` splits unified diff by `diff --git` boundaries, extracts `filePath` from `+++ b/` lines, tracks line numbers from `@@ +N,M @@` hunks. Scan runs per file. | 5 |
| B6 | Shell injection in git check-ignore | All git commands use `execFileSync('git', [...args])` with argument arrays. `--` separator before filePath. No shell interpolation anywhere. | 5 |
| B7 | Timeout not fail-closed for writes | `installTimeout()` outputs deny JSON + exit 0 for PreToolUse. Unhandled error catch also outputs deny for PreToolUse. PostToolUse/Stop fail-open. | 9, 17 |
| B8 | Exceptions not fully wired | Added `SpaExceptionStore` (extension-side, atomic writes via temp+rename), `ExceptionLoader` (hook runtime, read + consumeMany), env path derived from `STORE_DIR`. Policy engine receives loaded exceptions, returns `consumedExceptionIds`. | 1, 4, 7, 9, 12, 13 |
| B9 | Audit directory path ambiguous | Explicit: `CLAUI_SPA_STORE_DIR` = `<globalStoragePath>/super-particle-accelerator`. Audit at `/audit/YYYY-MM-DD.jsonl`. `mkdirSync` on every write. Directory layout diagram added. | 6, 13 |
| B10 | Allowed .env inside public roots | `PathClassifier.classify()` checks `isInsidePublicRoot()` BEFORE returning `local-secret-file`. Files matching `allowedSecretFileGlobs` inside `public/`, `client/`, `frontend/`, etc. return `public-client-code` instead. Policy Gate 2 hard-denies. | 3, 4, 19 |
| B11 | Stop hook has no baseline | Added `BaselineStore` with per-session JSON files. First Stop creates baseline (no block). Subsequent Stops filter findings through baseline, only block new ones. Baseline updated after each scan. | 1, 8, 9, 19 |
| B12 | redactedPreview can leak full secret | Redaction: secrets <= 12 chars -> `***`. Longer secrets reveal max 25% (capped at 8 chars). Tests verify: no full raw value in preview, preview doesn't match secret regexes, < 30% revealed, full pipeline grep for raw values in all output JSON. | 2, 19 |
