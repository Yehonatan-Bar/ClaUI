import type { ReviewVerdict } from './reviewLoopTypes';

export const HANDOVER_BEGIN = '===CLAUI_HANDOVER_BEGIN===';
export const HANDOVER_END = '===CLAUI_HANDOVER_END===';

/** First-round prompt: the development work is already done, just produce the handover. */
export function buildHandoverPrompt(): string {
  return [
    'The development work for the task you just completed is finished. Write a handover',
    'for an INDEPENDENT reviewer who will read the real code and rigorously verify your',
    'work. The reviewer has NOT seen this conversation, the plan, or the requirements,',
    'so give them everything needed to judge it. Be thorough and specific, NOT brief —',
    'the reviewer can only catch problems you give them enough context to catch.',
    '',
    'Write the document in two clearly separated parts:',
    '',
    'PART 1 — THE TASK (what was REQUIRED), written objectively as the spec to check against:',
    '- The goal and the full scope of what had to be built.',
    '- EVERY pre-approved decision, constraint, rule, and boundary the implementation must',
    '  honor, so the reviewer can confirm none were violated. Be exhaustive about these.',
    '- Acceptance criteria, required deliverables, and the tricky edge cases that matter.',
    '- If a plan/spec/design document drove this work, name its repo-relative path.',
    '',
    'PART 2 — THE DEVELOPER REPORT (what you ACTUALLY did):',
    '- What you implemented, area by area, in enough detail to locate it in the code.',
    '- Every deviation from the spec and WHY; anything you did NOT do; known gaps or risks.',
    '- How correctness, security, and isolation are enforced (cross-cutting concerns).',
    '- Every file you created or modified, with repo-relative paths.',
    '- How to verify: tests added and their result, and concrete things to check.',
    '',
    'CRITICAL OUTPUT RULES:',
    '- Output ONLY the document, wrapped exactly between the two markers below.',
    '- Put NOTHING before the first marker and NOTHING after the last marker.',
    '- No preamble, no "here is the document", no closing remarks.',
    '',
    HANDOVER_BEGIN,
    '## The task (what was required)',
    '<goal, scope, every pre-approved decision/constraint/boundary, acceptance criteria, plan path>',
    '',
    '## Developer report (what was done)',
    '<implementation per area, deviations + why, what was NOT done, correctness/security/isolation>',
    '',
    '## Changed files',
    '<every created or modified file, repo-relative paths>',
    '',
    '## How to verify',
    '<tests + results, concrete checks>',
    HANDOVER_END,
  ].join('\n');
}

/** Later-round prompt: address the reviewer's feedback in code, then re-emit the handover. */
export function buildFixPrompt(reviewText: string): string {
  return [
    'An independent code reviewer examined your work and did NOT approve it yet.',
    'Their feedback is delimited below:',
    '',
    '----- REVIEWER FEEDBACK (start) -----',
    reviewText.trim(),
    '----- REVIEWER FEEDBACK (end) -----',
    '',
    'Address every required change in the code. Then write an UPDATED, thorough handover',
    'for the reviewer using the SAME two-part structure (the task/spec to verify against,',
    'then your report), including how you addressed each point of feedback. Be specific,',
    'not brief.',
    '',
    'CRITICAL OUTPUT RULES:',
    '- Output ONLY the document, wrapped exactly between the two markers below.',
    '- Put NOTHING before the first marker and NOTHING after the last marker.',
    '- No preamble and no closing remarks.',
    '',
    HANDOVER_BEGIN,
    '## The task (what was required)',
    '<goal, scope, every pre-approved decision/constraint, acceptance criteria, plan path>',
    '',
    '## Developer report (what was done, including how each feedback point was addressed)',
    '<updated implementation details, deviations + why, what was NOT done, correctness/isolation>',
    '',
    '## Changed files',
    '<every created or modified file, repo-relative paths>',
    '',
    '## How to verify',
    '<tests + results, concrete checks>',
    HANDOVER_END,
  ].join('\n');
}

/**
 * Extract the handover text the developer produced. Enforces the clean-handover
 * contract: returns ONLY the text strictly between a matched
 * `===CLAUI_HANDOVER_BEGIN===` / `===CLAUI_HANDOVER_END===` pair. Returns null
 * when a closed marker block is absent, so the orchestrator can retry or error
 * instead of forwarding unmarked text to the reviewer.
 */
export function extractHandover(rawText: string): string | null {
  const text = rawText ?? '';
  const startIdx = text.indexOf(HANDOVER_BEGIN);
  if (startIdx === -1) {
    return null;
  }
  const endIdx = text.indexOf(HANDOVER_END, startIdx);
  if (endIdx === -1) {
    return null;
  }
  const body = text.slice(startIdx, endIdx);
  const cleaned = body.split(HANDOVER_BEGIN).join('').split(HANDOVER_END).join('').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** System prompt (Codex `instructions`) that turns Codex into a rigorous read-only reviewer. */
export const REVIEWER_SYSTEM_PROMPT = [
  'You are a senior, independent code reviewer with READ-ONLY access to the entire workspace.',
  'You will receive a developer summary of a task and the work that was done.',
  '',
  'Your single goal: decide whether the code has any BLOCKING bug — a defect that',
  'breaks correctness, crashes, loses data, opens a security hole, or otherwise',
  'prevents the task from actually working. Read the real changed code to verify',
  '(use the "Changed files" list and explore further as needed).',
  '',
  'Rules:',
  '- Do NOT request changes for style, naming, formatting, minor improvements, missing-but-optional tests, or any non-blocking nit.',
  '- Only a genuine blocking bug warrants changes.',
  '- Do not modify anything; this is strictly read-only.',
  '',
  'Output format:',
  '- If there is a blocking bug, list the blocking bug(s) FIRST, concise and prioritized.',
  '- End your review with EXACTLY ONE final line, with nothing after it, in one of these two forms:',
  '  VERDICT: APPROVED',
  '  VERDICT: CHANGES_REQUESTED',
  '- Output APPROVED only when there is NO blocking bug.',
].join('\n');

/**
 * Wrap the developer's clean handover with an explicit reviewer task, so the
 * message actually SENT to Codex states the role (review, judge, return a
 * verdict) instead of just describing what was done. This does not rely on the
 * separate Codex `instructions` channel being honored.
 */
export function buildReviewerPrompt(handover: string): string {
  return [
    'You are an INDEPENDENT CODE REVIEWER. Your job is to REVIEW the developer work',
    'described below, JUDGE whether it is sound, and RETURN A VERDICT — not to chat.',
    '',
    'Do this:',
    '1. Read PART 1 (the task) to understand exactly what was required, including every pre-approved decision/constraint the implementation must honor. If a plan/spec document path is named in the handover, open and read it to confirm the real requirements.',
    '2. Read the ACTUAL code in the workspace (read-only). Do NOT trust the report — verify it against the task.',
    '3. A BLOCKING issue is anything that breaks correctness, crashes, loses data, opens a security hole, FAILS TO MEET a stated requirement, or VIOLATES a pre-approved constraint/decision. Ignore pure style, naming, and non-blocking nits.',
    '4. If a blocking issue exists, list the blocking issue(s) concisely and prioritized, each with the file/location and why it is blocking.',
    '5. End your reply with EXACTLY ONE final line: output APPROVED only when there is NO blocking issue, otherwise CHANGES_REQUESTED. The final line must be BARE — no parentheses, no trailing text — exactly one of:',
    '   VERDICT: APPROVED',
    '   VERDICT: CHANGES_REQUESTED',
    '',
    "DEVELOPER'S HANDOVER (the task spec + their report of what they did):",
    '--------------------------------------------',
    handover.trim(),
    '--------------------------------------------',
    '',
    'Now review the real code and return your verdict.',
  ].join('\n');
}

/**
 * Deterministic first-pass parse of the reviewer's mandatory verdict line.
 * Returns null when no verdict line is present (caller then asks the classifier).
 */
export function parseVerdictLine(reviewText: string): 'approved' | 'changes' | null {
  const lines = (reviewText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  // The reviewer is instructed to END with EXACTLY one verdict line and nothing
  // after it. Trust the deterministic path only when the LAST non-empty line
  // matches a canonical verdict EXACTLY (tolerating markdown emphasis and a single
  // trailing period). Anything else -> null, so the conservative classifier decides.
  // The exact anchors also reject lookalikes such as "VERDICT: UNAPPROVED".
  const normalized = lines[lines.length - 1]
    .replace(/[*`]/g, '')
    .replace(/\.\s*$/, '')
    .trim()
    .toUpperCase();
  if (/^VERDICT\s*:\s*APPROVED$/.test(normalized)) {
    return 'approved';
  }
  if (/^VERDICT\s*:\s*CHANGES[_ ]?REQUESTED$/.test(normalized)) {
    return 'changes';
  }
  return null;
}

/** Prompt for the lightweight classifier when the verdict line is ambiguous/missing. */
export function buildClassifierPrompt(reviewText: string): string {
  const truncated = (reviewText ?? '').slice(0, 4000);
  return [
    "You are classifying a code reviewer's verdict.",
    "Decide whether the developer's work was APPROVED (no required changes) or CHANGES_REQUESTED (the reviewer wants fixes).",
    '',
    'Reply with ONLY one token on the first line: APPROVED or CHANGES_REQUESTED.',
    'Optionally add a one-sentence reason on a second line.',
    '',
    "Reviewer's text:",
    truncated,
  ].join('\n');
}

/**
 * Parse the classifier's output into a verdict. Conservative on ambiguity:
 * defaults to NOT approved so the loop never falsely declares success.
 */
export function parseClassifierOutput(raw: string): ReviewVerdict {
  const text = (raw ?? '').trim();
  const lines = text.split('\n');
  const firstLine = (lines[0] ?? '').trim();
  const rest = lines.slice(1).join(' ').trim();

  // "Changes" wins on any change signal OR negated/declined approval, so we never
  // falsely approve outputs like "NOT APPROVED" / "rejected".
  const hasChanges = (s: string): boolean =>
    s.includes('CHANGES') || s.includes('NOT APPROVED') || s.includes('REJECT') || s.includes('DENIED');
  const hasApproved = (s: string): boolean => /\bAPPROVED\b/.test(s);

  const primary = (firstLine || text).toUpperCase();
  if (hasChanges(primary)) {
    return { approved: false, reason: rest || 'Reviewer requested changes.' };
  }
  if (hasApproved(primary)) {
    return { approved: true, reason: rest || 'Reviewer approved the work.' };
  }

  const whole = text.toUpperCase();
  if (hasChanges(whole)) {
    return { approved: false, reason: 'Reviewer requested changes.' };
  }
  if (hasApproved(whole)) {
    return { approved: true, reason: 'Reviewer approved the work.' };
  }
  return { approved: false, reason: 'Verdict unclear; treating as changes requested.' };
}
