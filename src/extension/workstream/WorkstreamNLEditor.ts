import { spawn } from 'child_process';
import * as crypto from 'crypto';
import type {
  MapInteractionContext,
  NLEditResult,
  ProjectMapState,
  UserEdit,
} from '../types/workstreamTypes';

const SIMPLE_COMMANDS: Array<{
  pattern: RegExp;
  handler: (match: RegExpMatchArray, context: MapInteractionContext, state: ProjectMapState) => UserEdit[] | null;
}> = [
  {
    pattern: /^hide\s+inactive\s+(streams?|workstreams?|lines?)$/i,
    handler: (_match, _context, state) =>
      state.workstreams
        .filter(ws => ws.status === 'abandoned' || ws.status === 'completed')
        .map(ws => ({
          id: crypto.randomUUID(),
          projectId: state.projectId,
          type: 'change_status' as const,
          timestamp: new Date().toISOString(),
          actor: 'ai_assisted_user' as const,
          details: { workstreamId: ws.id, action: 'collapse' },
          protectedFromAiOverwrite: true,
        })),
  },
  {
    pattern: /^mark\s+(?:selected|current|this)\s+(?:line|stream|workstream)\s+as\s+(complete|completed|done)$/i,
    handler: (_match, context, state) => {
      if (!context.focusedWorkstreamId) { return null; }
      return [{
        id: crypto.randomUUID(),
        projectId: state.projectId,
        type: 'mark_complete',
        timestamp: new Date().toISOString(),
        actor: 'ai_assisted_user',
        details: { workstreamId: context.focusedWorkstreamId },
        protectedFromAiOverwrite: true,
      }];
    },
  },
  {
    pattern: /^mark\s+(?:selected|current|this)\s+(?:line|stream|workstream)\s+as\s+(abandoned|dead)$/i,
    handler: (_match, context, state) => {
      if (!context.focusedWorkstreamId) { return null; }
      return [{
        id: crypto.randomUUID(),
        projectId: state.projectId,
        type: 'mark_abandoned',
        timestamp: new Date().toISOString(),
        actor: 'ai_assisted_user',
        details: { workstreamId: context.focusedWorkstreamId },
        protectedFromAiOverwrite: true,
      }];
    },
  },
  {
    pattern: /^show\s+only\s+blockers?$/i,
    handler: (_match, _context, state) => [{
      id: crypto.randomUUID(),
      projectId: state.projectId,
      type: 'change_status',
      timestamp: new Date().toISOString(),
      actor: 'ai_assisted_user',
      details: { action: 'filter_blocked_only' },
      protectedFromAiOverwrite: false,
    }],
  },
];

export class WorkstreamNLEditor {
  async processCommand(
    text: string,
    context: MapInteractionContext,
    state: ProjectMapState,
    cliPath: string,
    workspacePath: string,
  ): Promise<NLEditResult> {
    // Try simple pattern matching first
    const simpleResult = this.trySimpleCommand(text, context, state);
    if (simpleResult) {
      return simpleResult;
    }

    // Fall through to Sonnet for semantic edits
    return await this.semanticEdit(text, context, state, cliPath, workspacePath);
  }

  private trySimpleCommand(
    text: string,
    context: MapInteractionContext,
    state: ProjectMapState,
  ): NLEditResult | null {
    const trimmed = text.trim();
    for (const cmd of SIMPLE_COMMANDS) {
      const match = trimmed.match(cmd.pattern);
      if (match) {
        const edits = cmd.handler(match, context, state);
        if (edits && edits.length > 0) {
          return {
            edits,
            explanation: `Matched simple command: "${trimmed}"`,
            requiresConfirmation: false,
            confidence: 1.0,
          };
        }
      }
    }
    return null;
  }

  private async semanticEdit(
    text: string,
    context: MapInteractionContext,
    state: ProjectMapState,
    cliPath: string,
    workspacePath: string,
  ): Promise<NLEditResult> {
    const prompt = this.buildSemanticPrompt(text, context, state);

    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'json', '-m', 'sonnet'];
      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        env: { ...process.env },
        timeout: 30000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`NL edit failed (exit ${code}): ${stderr}`));
          return;
        }
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON in NL edit output'));
            return;
          }
          const parsed = JSON.parse(jsonMatch[0]);
          const edits: UserEdit[] = (parsed.edits ?? []).map((e: Record<string, unknown>) => ({
            id: crypto.randomUUID(),
            projectId: state.projectId,
            type: e.type ?? 'change_status',
            timestamp: new Date().toISOString(),
            actor: 'ai_assisted_user',
            details: (e.details as Record<string, unknown>) ?? {},
            protectedFromAiOverwrite: true,
          }));

          const confidence = parsed.confidence ?? 0.5;
          const movedSessionCount = edits.filter(e => e.type === 'move_session').length;
          const affectsMultipleWorkstreams = new Set(
            edits.map(e => (e.details as Record<string, string>).workstreamId).filter(Boolean)
          ).size > 1;

          resolve({
            edits,
            explanation: parsed.explanation ?? '',
            confidence,
            requiresConfirmation:
              confidence < 0.75 ||
              affectsMultipleWorkstreams ||
              movedSessionCount > 3 ||
              edits.some(e => e.type === 'merge_workstreams' || e.type === 'split_workstream'),
          });
        } catch (e) {
          reject(new Error(`Failed to parse NL edit JSON: ${e}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private buildSemanticPrompt(
    text: string,
    context: MapInteractionContext,
    state: ProjectMapState,
  ): string {
    const workstreamBlock = state.workstreams.map(ws => JSON.stringify({
      id: ws.id,
      label: ws.label,
      status: ws.status,
      sessionIds: ws.sessionIds,
    })).join('\n');

    return `You are a workstream map editor. The user wants to modify the project workstream map.

User command: "${text}"

Context:
- Focused workstream: ${context.focusedWorkstreamId ?? 'none'}
- Selected station: ${context.selectedStationId ?? 'none'}
- Visible workstreams: ${context.visibleWorkstreamIds.join(', ')}

Current workstreams:
${workstreamBlock}

Edit types:
- move_session: { sessionId, fromWorkstreamId, toWorkstreamId }
- merge_workstreams: { workstreamIds: string[], targetLabel: string }
- split_workstream: { workstreamId, splitAtStationId, newLabel }
- rename_workstream: { workstreamId, newLabel }
- reclassify_workstream: { workstreamId, newType }
- hide_station: { stationId }
- add_milestone: { workstreamId, label, description }
- mark_complete: { workstreamId }
- mark_abandoned: { workstreamId }
- change_status: { workstreamId, newStatus }
- pin_workstream: { workstreamId }
- unpin_workstream: { workstreamId }

Respond with ONLY valid JSON:
{
  "edits": [{
    "type": "string (edit type)",
    "details": { ... (type-specific details) }
  }],
  "explanation": "string (what will change and why)",
  "confidence": 0.0-1.0
}`;
  }
}
