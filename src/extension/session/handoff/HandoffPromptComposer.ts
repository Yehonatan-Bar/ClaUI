import type { HandoffCapsule } from './HandoffTypes';

const DEFAULT_JSON_BUDGET = 12_000;

function clampJson(text: string, budget: number): { json: string; truncated: boolean } {
  if (text.length <= budget) {
    return { json: text, truncated: false };
  }
  const safeSlice = Math.max(300, budget - 40);
  return {
    json: `${text.slice(0, safeSlice)}\n...\n"_truncated": true\n}`,
    truncated: true,
  };
}

export class HandoffPromptComposer {
  compose(capsule: HandoffCapsule, opts?: { jsonBudgetChars?: number }): string {
    const jsonBudget = Math.max(1200, opts?.jsonBudgetChars ?? DEFAULT_JSON_BUDGET);
    const rawJson = JSON.stringify(capsule, null, 2);
    const clamped = clampJson(rawJson, jsonBudget);
    const objective = capsule.task.objective || 'Continue the in-progress task.';
    const blockers = capsule.task.blockers.length > 0 ? capsule.task.blockers.join(' | ') : 'None listed';
    const nextSteps = capsule.task.nextSteps.length > 0 ? capsule.task.nextSteps.join(' | ') : 'Confirm next action from current files.';
    const files = capsule.touchedFiles.length > 0 ? capsule.touchedFiles.join(', ') : 'Not explicitly captured';

    return [
      'Handoff context from a previous provider session.',
      'Use this as prior conversation history/context for the next user message in this tab.',
      '',
      'Handoff goals:',
      `- Objective: ${objective}`,
      `- Status: ${capsule.task.status}`,
      `- Blockers: ${blockers}`,
      `- Next steps from previous context: ${nextSteps}`,
      `- Recently touched files: ${files}`,
      '',
      'Handoff Capsule JSON (source of truth, may be truncated to fit budget):',
      '```json',
      clamped.json,
      '```',
    ].join('\n');
  }
}
