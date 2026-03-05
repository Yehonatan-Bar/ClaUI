import * as path from 'path';
import type { SerializedChatMessage } from '../../types/webview-messages';
import type { HandoffCapsule, HandoffProvider, HandoffRecentTurn, HandoffSourceSnapshot } from './HandoffTypes';

const DEFAULT_TURN_BUDGET = 8;
const DEFAULT_TURN_TEXT_BUDGET = 1000;

function clampText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 16))}\n...[truncated]`,
    truncated: true,
  };
}

function extractText(content: SerializedChatMessage['content']): string {
  if (!Array.isArray(content)) {
    return '';
  }
  const textParts: string[] = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (block?.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool';
      textParts.push(`[tool_use:${name}]`);
    } else if (block?.type === 'tool_result') {
      textParts.push('[tool_result]');
    }
  }
  return textParts.join('\n').trim();
}

function extractFileCandidates(text: string): string[] {
  if (!text) {
    return [];
  }
  const files = new Set<string>();
  const patterns = [
    /\b[\w./-]+\.[a-zA-Z0-9]{1,8}\b/g,
    /`([^`]+\.[a-zA-Z0-9]{1,8})`/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = (match[1] || match[0] || '').trim();
      if (!raw || raw.length > 180) {
        continue;
      }
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        continue;
      }
      files.add(raw.replace(/^['"`]+|['"`]+$/g, ''));
      if (files.size >= 30) {
        return Array.from(files);
      }
    }
  }

  return Array.from(files);
}

function uniqueStrings(values: string[], max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    out.push(normalized);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export class HandoffContextBuilder {
  constructor(private readonly log: (msg: string) => void) {}

  buildCapsule(args: {
    source: HandoffSourceSnapshot;
    targetProvider: HandoffProvider;
    turnBudget?: number;
    perTurnTextBudget?: number;
  }): HandoffCapsule {
    const turnBudget = Math.max(1, args.turnBudget ?? DEFAULT_TURN_BUDGET);
    const perTurnTextBudget = Math.max(200, args.perTurnTextBudget ?? DEFAULT_TURN_TEXT_BUDGET);
    const { source } = args;

    const turns: HandoffRecentTurn[] = [];
    let truncated = false;
    const messages = Array.isArray(source.messages) ? source.messages : [];
    const recentMessages = messages.slice(-turnBudget);

    for (const msg of recentMessages) {
      const rawText = extractText(msg.content);
      const clamped = clampText(rawText, perTurnTextBudget);
      if (clamped.truncated) {
        truncated = true;
      }
      turns.push({
        role: msg.role,
        text: clamped.text,
        ts: new Date(msg.timestamp).toISOString(),
      });
    }

    if (messages.length > recentMessages.length) {
      truncated = true;
    }

    const userTexts = turns.filter((t) => t.role === 'user').map((t) => t.text).filter(Boolean);
    const assistantTexts = turns.filter((t) => t.role === 'assistant').map((t) => t.text).filter(Boolean);

    const objective =
      userTexts[userTexts.length - 1] ||
      userTexts[0] ||
      'Continue the in-progress implementation task from the previous provider.';

    const blockers = uniqueStrings(
      turns
        .map((t) => t.text)
        .filter((t) => /\b(blocked|blocking|cannot|can\'t|failed|error|missing)\b/i.test(t))
        .map((t) => t.split(/\r?\n/)[0] || t),
      6,
    );

    const nextSteps = uniqueStrings(
      [...assistantTexts, ...userTexts]
        .filter((t) => /\b(next|todo|then|after|remaining|follow-up)\b/i.test(t))
        .map((t) => t.split(/\r?\n/)[0] || t),
      6,
    );

    const decisions = uniqueStrings(
      assistantTexts
        .filter((t) => /\b(decid|chose|choice|because|tradeoff|prefer|selected)\b/i.test(t))
        .map((t) => t.split(/\r?\n/)[0] || t),
      6,
    ).map((decision) => ({ decision }));

    const touchedFiles = uniqueStrings(
      turns.flatMap((t) => extractFileCandidates(t.text)),
      30,
    );

    const status: 'active' | 'blocked' | 'done' =
      /\b(done|completed|finished|resolved)\b/i.test(objective) ? 'done' : blockers.length > 0 ? 'blocked' : 'active';

    const cwd = source.cwd;
    const repoRoot = source.repoRoot ?? cwd;

    const summaryParts = [
      `Objective: ${objective}`,
      decisions.length ? `Key decisions: ${decisions.map((d) => d.decision).join(' | ')}` : '',
      touchedFiles.length ? `Touched files: ${touchedFiles.join(', ')}` : '',
      blockers.length ? `Blockers: ${blockers.join(' | ')}` : '',
      nextSteps.length ? `Next steps: ${nextSteps.join(' | ')}` : '',
    ].filter(Boolean);

    const summaryText = summaryParts.join('\n');

    const capsule: HandoffCapsule = {
      schemaVersion: 1,
      source: {
        provider: source.provider,
        tabId: source.tabId,
        sessionId: source.sessionId,
        createdAtIso: source.createdAtIso,
      },
      target: {
        provider: args.targetProvider,
      },
      workspace: {
        cwd,
        repoRoot,
        branch: source.branch,
      },
      task: {
        objective,
        status,
        blockers,
        nextSteps,
      },
      decisions,
      touchedFiles,
      recentTurns: turns,
      summaryText,
      limits: {
        estimatedChars: JSON.stringify({ summaryText, turns }).length,
        truncated,
      },
    };

    const shortSource = `${source.provider}:${source.tabId}`;
    const repoLabel = repoRoot ? path.basename(repoRoot) : '(unknown)';
    this.log(`[Handoff] ContextBuilder built capsule source=${shortSource} target=${args.targetProvider} repo=${repoLabel} turns=${turns.length} truncated=${truncated}`);

    return capsule;
  }
}
