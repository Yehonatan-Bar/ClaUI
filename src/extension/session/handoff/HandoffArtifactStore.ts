import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { HandoffArtifactPaths, HandoffCapsule } from './HandoffTypes';

const DEFAULT_JSON_DISK_BUDGET = 120_000;

function redactSecrets(text: string): string {
  const patterns: RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bghp_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\b(?:token|api[_-]?key|secret|password)\s*[:=]\s*['\"]?[^'\"\s]{6,}['\"]?/gi,
  ];

  let output = text;
  for (const pattern of patterns) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

function sanitizeCapsule(capsule: HandoffCapsule): HandoffCapsule {
  return JSON.parse(redactSecrets(JSON.stringify(capsule))) as HandoffCapsule;
}

function clampRecentTurnsForDisk(capsule: HandoffCapsule, budget: number): HandoffCapsule {
  const clone: HandoffCapsule = JSON.parse(JSON.stringify(capsule)) as HandoffCapsule;
  let raw = JSON.stringify(clone, null, 2);
  if (raw.length <= budget) {
    return clone;
  }

  while (clone.recentTurns.length > 2 && raw.length > budget) {
    clone.recentTurns.shift();
    clone.limits.truncated = true;
    raw = JSON.stringify(clone, null, 2);
  }

  if (raw.length > budget) {
    const overBy = raw.length - budget;
    const tail = clone.summaryText;
    const keep = Math.max(200, tail.length - overBy - 80);
    clone.summaryText = `${tail.slice(0, keep)}\n...[truncated for artifact budget]`;
    clone.limits.truncated = true;
  }

  return clone;
}

export class HandoffArtifactStore {
  private memoryOnlyArtifact: { capsule: HandoffCapsule; prompt: string } | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly log: (msg: string) => void,
    private readonly opts?: { persistToDisk?: boolean; jsonBudgetChars?: number },
  ) {}

  save(capsule: HandoffCapsule, prompt: string): HandoffArtifactPaths | undefined {
    const persistToDisk = this.opts?.persistToDisk ?? true;
    const sanitizedCapsule = sanitizeCapsule(capsule);
    const sanitizedPrompt = redactSecrets(prompt);

    if (!persistToDisk) {
      this.memoryOnlyArtifact = { capsule: sanitizedCapsule, prompt: sanitizedPrompt };
      this.log('[Handoff] Artifact store is configured for memory-only mode');
      return undefined;
    }

    const budget = Math.max(5_000, this.opts?.jsonBudgetChars ?? DEFAULT_JSON_DISK_BUDGET);
    const boundedCapsule = clampRecentTurnsForDisk(sanitizedCapsule, budget);

    const handoffDir = path.join(this.rootDir, 'handoffs');
    fs.mkdirSync(handoffDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const src = boundedCapsule.source.provider;
    const dst = boundedCapsule.target.provider;
    const baseName = `${timestamp}-${src}-to-${dst}-${boundedCapsule.source.tabId}`;

    const jsonPath = path.join(handoffDir, `${baseName}.json`);
    const markdownPath = path.join(handoffDir, `${baseName}.md`);

    const jsonText = JSON.stringify(boundedCapsule, null, 2);
    const promptHash = createHash('sha256').update(sanitizedPrompt, 'utf8').digest('hex').slice(0, 12);

    const markdown = [
      '# Handoff Capsule',
      '',
      `- Created: ${new Date().toISOString()}`,
      `- Source: ${src} (${boundedCapsule.source.tabId})`,
      `- Target: ${dst}`,
      `- Prompt SHA256: ${promptHash}`,
      '',
      '## Summary',
      '',
      boundedCapsule.summaryText || '(none)',
      '',
      '## Launch Prompt',
      '',
      '```text',
      sanitizedPrompt,
      '```',
      '',
      '## Capsule JSON',
      '',
      '```json',
      jsonText,
      '```',
      '',
    ].join('\n');

    fs.writeFileSync(jsonPath, `${jsonText}\n`, 'utf8');
    fs.writeFileSync(markdownPath, markdown, 'utf8');

    this.log(`[Handoff] Artifact saved json=${jsonPath} md=${markdownPath}`);
    return { jsonPath, markdownPath };
  }

  getMemoryOnlyArtifact(): { capsule: HandoffCapsule; prompt: string } | null {
    return this.memoryOnlyArtifact;
  }
}
