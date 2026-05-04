import { spawn } from 'child_process';
import type {
  ProjectCurrentState,
  ProjectMapState,
  Station,
  Workstream,
  WorkstreamBlocker,
  WorkstreamCurrentState,
  ModelTier,
} from '../types/workstreamTypes';

export interface CurrentStateSynthesisResult {
  projectState: ProjectCurrentState;
  workstreamStates: Map<string, WorkstreamCurrentState>;
}

export class CurrentStateSynthesizer {
  async synthesize(
    state: ProjectMapState,
    cliPath: string,
    workspacePath: string,
  ): Promise<CurrentStateSynthesisResult> {
    const activeWorkstreams = state.workstreams.filter(
      ws => ws.status === 'active' || ws.status === 'blocked' || ws.status === 'uncertain'
    );

    const prompt = this.buildSynthesisPrompt(activeWorkstreams, state.stations, state);
    const result = await this.callSonnet(prompt, cliPath, workspacePath);

    return result;
  }

  private buildSynthesisPrompt(
    workstreams: Workstream[],
    stations: Station[],
    state: ProjectMapState,
  ): string {
    const workstreamBlock = workstreams.map(ws => {
      const wsStations = stations
        .filter(s => s.workstreamId === ws.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5);

      return JSON.stringify({
        id: ws.id,
        label: ws.label,
        goal: ws.goal,
        status: ws.status,
        type: ws.type,
        sessionCount: ws.sessionIds.length,
        lastActivity: ws.lastActivityAt,
        recentStations: wsStations.map(s => ({
          type: s.type,
          label: s.label,
          status: s.status,
          timestamp: s.timestamp,
        })),
        existingBlockers: ws.currentState.blockers.filter(b => !b.resolvedAt),
        existingDecisions: ws.currentState.pendingDecisions,
      });
    }).join('\n');

    return `You are a project state synthesizer. Analyze the current state of this project's workstreams and provide an actionable summary.

Your goal: help the user understand WHERE THEY ARE and WHAT TO DO NEXT without reading every session.

Workstreams:
${workstreamBlock}

Project has ${state.workstreams.length} total workstreams, ${state.stations.length} stations.
Last classified: ${state.lastClassifiedAt}

Be concise. Prefer concrete state over generic summaries. Identify blockers and pending decisions.
Recommend the next action based on evidence, not generic advice.

Respond with ONLY valid JSON:
{
  "projectState": {
    "summary": "string (2-3 sentences, what's the current situation)",
    "activeWorkstreamIds": ["string"],
    "blockedWorkstreamIds": ["string"],
    "completedWorkstreamIds": ["string"],
    "uncertainWorkstreamIds": ["string"],
    "recommendedResumeWorkstreamId": "string or null",
    "recommendedResumeStationId": "string or null",
    "recommendedNextAction": "string (specific, actionable)",
    "openQuestions": ["string"],
    "blockers": [{
      "id": "string",
      "label": "string",
      "description": "string",
      "severity": "low|medium|high",
      "stationId": "string or null",
      "sessionId": "string or null",
      "createdAt": "${new Date().toISOString()}"
    }]
  },
  "workstreamStates": {
    "<workstream_id>": {
      "phase": "not_started|planning|implementation|debugging|testing|review|blocked|complete|abandoned|unknown",
      "summary": "string",
      "lastMeaningfulProgress": "string",
      "nextLikelyAction": "string",
      "openQuestions": ["string"],
      "blockers": [],
      "pendingDecisions": [],
      "evidenceSessionIds": ["string"],
      "evidenceStationIds": ["string"]
    }
  }
}`;
  }

  private async callSonnet(
    prompt: string,
    cliPath: string,
    workspacePath: string,
  ): Promise<CurrentStateSynthesisResult> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'json', '-m', 'sonnet'];
      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        env: { ...process.env },
        timeout: 60000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Current state synthesis failed (exit ${code}): ${stderr}`));
          return;
        }
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON in synthesis output'));
            return;
          }
          const parsed = JSON.parse(jsonMatch[0]);
          const now = new Date().toISOString();
          const tier: ModelTier = 'sonnet';

          const projectState: ProjectCurrentState = {
            summary: parsed.projectState?.summary ?? '',
            activeWorkstreamIds: parsed.projectState?.activeWorkstreamIds ?? [],
            blockedWorkstreamIds: parsed.projectState?.blockedWorkstreamIds ?? [],
            completedWorkstreamIds: parsed.projectState?.completedWorkstreamIds ?? [],
            uncertainWorkstreamIds: parsed.projectState?.uncertainWorkstreamIds ?? [],
            recommendedResumeWorkstreamId: parsed.projectState?.recommendedResumeWorkstreamId,
            recommendedResumeStationId: parsed.projectState?.recommendedResumeStationId,
            recommendedNextAction: parsed.projectState?.recommendedNextAction,
            openQuestions: parsed.projectState?.openQuestions ?? [],
            blockers: (parsed.projectState?.blockers ?? []).map((b: Partial<WorkstreamBlocker>) => ({
              id: b.id ?? crypto.randomUUID(),
              label: b.label ?? '',
              description: b.description ?? '',
              severity: b.severity ?? 'medium',
              stationId: b.stationId,
              sessionId: b.sessionId,
              createdAt: b.createdAt ?? now,
            })),
            generatedAt: now,
            generatedBy: tier,
          };

          const workstreamStates = new Map<string, WorkstreamCurrentState>();
          if (parsed.workstreamStates && typeof parsed.workstreamStates === 'object') {
            for (const [wsId, wsState] of Object.entries(parsed.workstreamStates)) {
              const raw = wsState as Record<string, unknown>;
              workstreamStates.set(wsId, {
                phase: (raw.phase as WorkstreamCurrentState['phase']) ?? 'unknown',
                summary: (raw.summary as string) ?? '',
                lastMeaningfulProgress: (raw.lastMeaningfulProgress as string) ?? '',
                nextLikelyAction: (raw.nextLikelyAction as string) ?? '',
                openQuestions: (raw.openQuestions as string[]) ?? [],
                blockers: [],
                pendingDecisions: [],
                evidenceSessionIds: (raw.evidenceSessionIds as string[]) ?? [],
                evidenceStationIds: (raw.evidenceStationIds as string[]) ?? [],
                generatedBy: tier,
                generatedAt: now,
              });
            }
          }

          resolve({ projectState, workstreamStates });
        } catch (e) {
          reject(new Error(`Failed to parse synthesis JSON: ${e}`));
        }
      });

      proc.on('error', reject);
    });
  }
}
