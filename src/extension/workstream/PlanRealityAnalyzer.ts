import { spawn } from 'child_process';
import * as crypto from 'crypto';
import type {
  PlanReality,
  PlanSource,
  PlanStep,
  Station,
  Workstream,
  StationStatus,
} from '../types/workstreamTypes';

export class PlanRealityAnalyzer {
  async analyzePlanReality(
    workstream: Workstream,
    stations: Station[],
    planContent: string,
    planSource: PlanSource,
    cliPath: string,
    workspacePath: string,
  ): Promise<PlanReality> {
    const prompt = this.buildAnalysisPrompt(workstream, stations, planContent);
    return await this.callSonnet(prompt, planSource, cliPath, workspacePath);
  }

  detectPlanCandidates(
    workstream: Workstream,
    stations: Station[],
  ): { sessionId?: string; filePath?: string; confidence: number }[] {
    const candidates: { sessionId?: string; filePath?: string; confidence: number }[] = [];

    // Check for planning sessions
    for (const sid of workstream.sessionIds) {
      const planStations = stations.filter(
        s => s.sessionId === sid && s.type === 'plan_step'
      );
      if (planStations.length >= 2) {
        candidates.push({ sessionId: sid, confidence: 0.7 });
      }
    }

    // Check for plan files in modified files
    const planFilePatterns = [/plan/i, /roadmap/i, /checklist/i, /todo/i, /design/i];
    for (const filePath of workstream.metrics.filesModified) {
      if (planFilePatterns.some(p => p.test(filePath)) &&
          (filePath.endsWith('.md') || filePath.endsWith('.html'))) {
        candidates.push({ filePath, confidence: 0.5 });
      }
    }

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  private buildAnalysisPrompt(
    workstream: Workstream,
    stations: Station[],
    planContent: string,
  ): string {
    const stationBlock = stations
      .filter(s => s.workstreamId === workstream.id)
      .sort((a, b) => a.order - b.order)
      .map(s => JSON.stringify({
        type: s.type,
        label: s.label,
        status: s.status,
        timestamp: s.timestamp,
      }))
      .join('\n');

    return `Compare a project plan against actual work done.

Workstream: ${workstream.label}
Goal: ${workstream.goal}

Plan content:
${planContent.slice(0, 2000)}

Actual work stations:
${stationBlock}

Analyze:
1. Extract ordered plan steps from the plan
2. Match each plan step to actual stations
3. Identify: completed steps, missing steps, extra work not in plan, failed steps, reordered steps, deviations

Respond with ONLY valid JSON:
{
  "planLabel": "string",
  "steps": [{
    "id": "string",
    "label": "string",
    "description": "string",
    "order": 0,
    "status": "completed|partial|failed|pending|skipped",
    "linkedStationIds": ["string"],
    "deviationNote": "string or null",
    "confidence": 0.0-1.0
  }],
  "overallStatus": "on_track|deviated|blocked|completed|unknown",
  "deviationSummary": "string"
}`;
  }

  private async callSonnet(
    prompt: string,
    planSource: PlanSource,
    cliPath: string,
    workspacePath: string,
  ): Promise<PlanReality> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'json', '-m', 'sonnet'];
      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        env: { ...process.env },
        timeout: 45000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Plan analysis failed (exit ${code}): ${stderr}`));
          return;
        }
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON in plan analysis output'));
            return;
          }
          const parsed = JSON.parse(jsonMatch[0]);
          const planId = crypto.randomUUID();
          const now = new Date().toISOString();

          const planReality: PlanReality = {
            planId,
            planLabel: parsed.planLabel ?? 'Plan',
            planSource,
            steps: (parsed.steps ?? []).map((s: Record<string, unknown>, i: number) => ({
              id: (s.id as string) ?? crypto.randomUUID(),
              label: (s.label as string) ?? '',
              description: s.description as string | undefined,
              order: (s.order as number) ?? i,
              status: (s.status as StationStatus) ?? 'pending',
              linkedStationIds: (s.linkedStationIds as string[]) ?? [],
              deviationNote: s.deviationNote as string | undefined,
              confidence: (s.confidence as number) ?? 0.5,
            })),
            overallStatus: parsed.overallStatus ?? 'unknown',
            deviationSummary: parsed.deviationSummary ?? '',
            lastComparedAt: now,
            generatedBy: 'sonnet',
          };

          resolve(planReality);
        } catch (e) {
          reject(new Error(`Failed to parse plan analysis JSON: ${e}`));
        }
      });

      proc.on('error', reject);
    });
  }
}
