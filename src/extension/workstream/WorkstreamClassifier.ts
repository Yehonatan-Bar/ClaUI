import { execSync, spawn } from 'child_process';
import * as crypto from 'crypto';
import type {
  CandidateCluster,
  ClassificationOptions,
  ClassificationOutput,
  EnrichedSessionData,
  ProjectMapState,
  UserEdit,
} from '../types/workstreamTypes';

const DEBOUNCE_MS = 5 * 60 * 1000;

export class WorkstreamClassifier {
  private lastFullRunAt = 0;
  private lastInputHash = '';

  constructor(private readonly log: (msg: string) => void = () => {}) {}

  async classify(
    sessions: EnrichedSessionData[],
    existingState: ProjectMapState | null,
    options: ClassificationOptions,
    cliPath: string,
    workspacePath: string,
  ): Promise<ClassificationOutput> {
    this.log(`[Classifier] classify() called: sessions=${sessions.length}, force=${options.force}, existingWorkstreams=${existingState?.workstreams.length ?? 0}`);

    if (!options.force && !this.shouldRun(sessions)) {
      this.log(`[Classifier] Debounced: lastRunAge=${Date.now() - this.lastFullRunAt}ms, hashMatch=${this.computeInputHash(sessions) === this.lastInputHash}`);
      throw new Error('Classification debounced - not enough time since last run');
    }

    const protectedEdits = existingState?.userEdits.filter(e => e.protectedFromAiOverwrite) ?? [];
    const protectedSessionAssignments = this.buildProtectedAssignments(protectedEdits, existingState);
    this.log(`[Classifier] Protected assignments: ${protectedSessionAssignments.size}`);

    const clusters = this.heuristicPreCluster(sessions);
    this.log(`[Classifier] Pre-clusters: ${clusters.length} (sessions: ${clusters.map(c => c.sessionIds.length).join(',')})`);

    const prompt = this.buildClassificationPrompt(sessions, clusters, existingState, protectedSessionAssignments);
    this.log(`[Classifier] Prompt built: ${prompt.length} chars`);

    const result = await this.callSonnet(prompt, cliPath, workspacePath);
    this.lastFullRunAt = Date.now();
    this.lastInputHash = this.computeInputHash(sessions);

    this.log(`[Classifier] Result: ${result.workstreams.length} workstreams, ${result.splits?.length ?? 0} splits, ${result.merges?.length ?? 0} merges`);
    return result;
  }

  heuristicPreCluster(sessions: EnrichedSessionData[]): CandidateCluster[] {
    const clusters: CandidateCluster[] = [];
    const assigned = new Set<string>();

    // Group by git branch
    const branchGroups = new Map<string, EnrichedSessionData[]>();
    for (const s of sessions) {
      if (s.gitBranch && s.gitBranch !== 'main' && s.gitBranch !== 'master') {
        const group = branchGroups.get(s.gitBranch) || [];
        group.push(s);
        branchGroups.set(s.gitBranch, group);
      }
    }
    for (const [branch, group] of branchGroups) {
      if (group.length >= 2) {
        const ids = group.map(s => s.sessionId);
        clusters.push({
          id: crypto.randomUUID(),
          sessionIds: ids,
          labelHint: `Branch: ${branch}`,
          reasons: [`${ids.length} sessions on branch "${branch}"`],
          confidence: 0.7,
        });
        ids.forEach(id => assigned.add(id));
      }
    }

    // Group by high file overlap
    const unassigned = sessions.filter(s => !assigned.has(s.sessionId));
    for (let i = 0; i < unassigned.length; i++) {
      for (let j = i + 1; j < unassigned.length; j++) {
        const a = unassigned[i];
        const b = unassigned[j];
        const overlap = this.computeFileOverlap(a, b);
        if (overlap >= 0.5) {
          const existingCluster = clusters.find(c =>
            c.sessionIds.includes(a.sessionId) || c.sessionIds.includes(b.sessionId)
          );
          if (existingCluster) {
            if (!existingCluster.sessionIds.includes(a.sessionId)) {
              existingCluster.sessionIds.push(a.sessionId);
            }
            if (!existingCluster.sessionIds.includes(b.sessionId)) {
              existingCluster.sessionIds.push(b.sessionId);
            }
            existingCluster.reasons.push(`High file overlap (${(overlap * 100).toFixed(0)}%) between sessions`);
          } else {
            clusters.push({
              id: crypto.randomUUID(),
              sessionIds: [a.sessionId, b.sessionId],
              reasons: [`High file overlap (${(overlap * 100).toFixed(0)}%)`],
              confidence: 0.5,
            });
          }
          assigned.add(a.sessionId);
          assigned.add(b.sessionId);
        }
      }
    }

    // Group by temporal proximity + similar first prompts
    const remaining = sessions.filter(s => !assigned.has(s.sessionId));
    const sorted = [...remaining].sort((a, b) =>
      new Date(a.startedAt ?? 0).getTime() - new Date(b.startedAt ?? 0).getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const timeDiff = Math.abs(
        new Date(b.startedAt ?? 0).getTime() - new Date(a.endedAt ?? a.startedAt ?? 0).getTime()
      );
      if (timeDiff < 2 * 60 * 60 * 1000 && this.promptsSimilar(a.firstPrompt, b.firstPrompt)) {
        clusters.push({
          id: crypto.randomUUID(),
          sessionIds: [a.sessionId, b.sessionId],
          reasons: ['Temporal proximity with similar prompts'],
          confidence: 0.4,
        });
      }
    }

    return clusters;
  }

  private shouldRun(sessions: EnrichedSessionData[]): boolean {
    const inputHash = this.computeInputHash(sessions);
    if (inputHash === this.lastInputHash) { return false; }
    if (Date.now() - this.lastFullRunAt < DEBOUNCE_MS) { return false; }
    return true;
  }

  private computeInputHash(sessions: EnrichedSessionData[]): string {
    const data = sessions.map(s => `${s.sessionId}:${s.summary ?? ''}:${s.outcome ?? ''}`).join('|');
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private computeFileOverlap(a: EnrichedSessionData, b: EnrichedSessionData): number {
    const filesA = new Set([...(a.filesModified ?? []), ...(a.filesRead ?? [])]);
    const filesB = new Set([...(b.filesModified ?? []), ...(b.filesRead ?? [])]);
    if (filesA.size === 0 || filesB.size === 0) { return 0; }

    let intersection = 0;
    for (const f of filesA) {
      if (filesB.has(f)) { intersection++; }
    }
    return intersection / Math.min(filesA.size, filesB.size);
  }

  private promptsSimilar(a?: string, b?: string): boolean {
    if (!a || !b) { return false; }
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) { return false; }

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) { overlap++; }
    }
    return overlap / Math.min(wordsA.size, wordsB.size) > 0.3;
  }

  private buildProtectedAssignments(
    edits: UserEdit[],
    state: ProjectMapState | null,
  ): Map<string, string> {
    const assignments = new Map<string, string>();
    if (!state) { return assignments; }

    for (const edit of edits) {
      if (edit.type === 'move_session') {
        const details = edit.details as { sessionId?: string; toWorkstreamId?: string };
        if (details.sessionId && details.toWorkstreamId) {
          assignments.set(details.sessionId, details.toWorkstreamId);
        }
      }
    }
    return assignments;
  }

  private buildClassificationPrompt(
    sessions: EnrichedSessionData[],
    clusters: CandidateCluster[],
    existingState: ProjectMapState | null,
    protectedAssignments: Map<string, string>,
  ): string {
    const sessionBlock = sessions.map(s => JSON.stringify({
      id: s.sessionId,
      firstPrompt: s.firstPrompt?.slice(0, 200),
      summary: s.summary?.slice(0, 300),
      filesModified: s.filesModified?.slice(0, 20),
      filesRead: s.filesRead?.slice(0, 10),
      gitBranch: s.gitBranch,
      taskType: s.taskType,
      outcome: s.outcome,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      totalTurns: s.totalTurns,
      totalCostUsd: s.totalCostUsd,
    })).join('\n');

    const clusterBlock = clusters.length > 0
      ? `\n\nHeuristic pre-clusters (suggestions, not binding):\n${clusters.map(c => JSON.stringify(c)).join('\n')}`
      : '';

    const existingBlock = existingState?.workstreams.length
      ? `\n\nExisting workstreams (preserve ids when sessions still belong):\n${existingState.workstreams.map(w => JSON.stringify({
          id: w.id,
          label: w.label,
          goal: w.goal,
          type: w.type,
          status: w.status,
          sessionIds: w.sessionIds,
          confidence: w.confidence,
        })).join('\n')}`
      : '';

    const protectedBlock = protectedAssignments.size > 0
      ? `\n\nProtected user assignments (MUST be respected):\n${[...protectedAssignments.entries()].map(([sid, wid]) => `Session ${sid} -> Workstream ${wid}`).join('\n')}`
      : '';

    return `You are a project work classifier. Group these coding sessions into coherent workstreams.

A workstream is a coherent thread of work with a clear goal. Examples: "Add onboarding flow", "Fix session refresh bug", "Rewrite auth middleware".

Rules:
- Prefer fewer meaningful workstreams over many tiny ones
- Do not merge unrelated work just because it happened nearby in time
- Do not split one coherent bug investigation into many lines unless the goal actually diverged
- Respect all protected user assignments exactly
- Sessions that don't clearly belong anywhere should go into an "Uncertain Work" workstream
- Never include "ultrathink" in workstream labels - it is a thinking activation keyword, not part of the actual work content. Strip it from any user prompt text before deriving labels
- Return confidence scores (0-1) and reasons
- Identify possible splits and merges between workstreams
- Identify stale or abandoned work
- For each workstream, identify current phase and next likely action

Sessions:
${sessionBlock}${clusterBlock}${existingBlock}${protectedBlock}

Respond with ONLY valid JSON matching this schema:
{
  "workstreams": [{
    "id": "string (use existing id if updating, omit for new)",
    "label": "string (human-readable, max 50 chars)",
    "goal": "string (one sentence)",
    "type": "feature|bug_fix|research|refactor|infrastructure|experiment|abandoned_experiment|uncategorized",
    "status": "active|completed|blocked|uncertain|research|abandoned|planning",
    "sessionIds": ["string"],
    "confidence": 0.0-1.0,
    "confidenceReasons": ["string"],
    "importanceScore": 0.0-1.0,
    "currentState": {
      "phase": "not_started|planning|implementation|debugging|testing|review|blocked|complete|abandoned|unknown",
      "summary": "string",
      "lastMeaningfulProgress": "string",
      "nextLikelyAction": "string",
      "openQuestions": ["string"],
      "blockers": []
    }
  }],
  "splits": [{
    "fromSessionId": "string",
    "reason": "string",
    "childLabels": ["string"],
    "confidence": 0.0-1.0
  }],
  "merges": [{
    "workstreamLabels": ["string"],
    "reason": "string",
    "confidence": 0.0-1.0
  }],
  "projectCurrentState": {
    "summary": "string",
    "recommendedResumeWorkstreamId": "string or null",
    "recommendedNextAction": "string",
    "openQuestions": ["string"]
  }
}`;
  }

  private async callSonnet(prompt: string, cliPath: string, workspacePath: string): Promise<ClassificationOutput> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-4-6'];
      this.log(`[Classifier] Spawning CLI: path="${cliPath}", args=[${args.join(', ')}], cwd="${workspacePath}", promptLen=${prompt.length}`);

      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      this.log(`[Classifier] Process spawned, pid=${proc.pid ?? 'unknown'}`);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          this.log(`[Classifier] TIMEOUT after 90s, killing process`);
          reject(new Error('Classification timed out after 90s'));
        }
      }, 90_000);

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.log(`[Classifier] Process closed: exitCode=${code}, stdoutLen=${stdout.length}, stderrLen=${stderr.length}`);
        if (stderr.length > 0) {
          this.log(`[Classifier] stderr: ${stderr.slice(-500)}`);
        }
        if (code !== 0) {
          reject(new Error(`Sonnet classification failed (exit ${code}): ${stderr.slice(-500)}`));
          return;
        }
        this.log(`[Classifier] stdout first 300 chars: ${stdout.slice(0, 300)}`);
        try {
          let textToSearch = stdout;
          try {
            const envelope = JSON.parse(stdout);
            if (envelope?.result && typeof envelope.result === 'string') {
              textToSearch = envelope.result;
              this.log(`[Classifier] Unwrapped CLI envelope, result length=${textToSearch.length}`);
            }
          } catch { /* not an envelope, use stdout directly */ }

          const jsonMatch = textToSearch.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            this.log(`[Classifier] No JSON found in text (length=${textToSearch.length})`);
            reject(new Error(`No JSON found in classification output (text length=${textToSearch.length}, first 200 chars: ${textToSearch.slice(0, 200)})`));
            return;
          }
          this.log(`[Classifier] JSON extracted: ${jsonMatch[0].length} chars`);
          const parsed = JSON.parse(jsonMatch[0]) as ClassificationOutput;
          if (!parsed.workstreams || !Array.isArray(parsed.workstreams)) {
            this.log(`[Classifier] Parsed JSON has no workstreams array`);
            reject(new Error('Invalid classification output: missing workstreams array'));
            return;
          }
          this.log(`[Classifier] Parsed OK: ${parsed.workstreams.length} workstreams`);
          resolve(parsed);
        } catch (e) {
          this.log(`[Classifier] JSON parse error: ${e}`);
          reject(new Error(`Failed to parse classification JSON: ${e}`));
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.log(`[Classifier] Process error: ${err.message}`);
          reject(err);
        }
      });

      proc.stdin?.write(prompt, 'utf-8');
      proc.stdin?.end();
      this.log(`[Classifier] Prompt written to stdin and closed`);
    });
  }
}
