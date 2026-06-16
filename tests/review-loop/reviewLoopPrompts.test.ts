import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  HANDOVER_BEGIN,
  HANDOVER_END,
  extractHandover,
  parseVerdictLine,
  parseClassifierOutput,
  buildReviewerPrompt,
} from '../../src/extension/review-loop/reviewLoopPrompts';

describe('extractHandover', () => {
  it('returns only the text strictly between the markers', () => {
    const raw = `Sure, here is the doc.\n${HANDOVER_BEGIN}\nTask: x\nWhat was done: y\n${HANDOVER_END}\nThanks!`;
    assert.equal(extractHandover(raw), 'Task: x\nWhat was done: y');
  });
  it('returns null when no markers are present', () => {
    assert.equal(extractHandover('just some unmarked text'), null);
  });
  it('returns null when only the begin marker is present', () => {
    assert.equal(extractHandover(`${HANDOVER_BEGIN}\nTask: x`), null);
  });
  it('returns null for an empty marker block', () => {
    assert.equal(extractHandover(`${HANDOVER_BEGIN}\n   \n${HANDOVER_END}`), null);
  });
});

describe('parseVerdictLine', () => {
  it('approves an exact final verdict line', () => {
    assert.equal(parseVerdictLine('Looks good.\nVERDICT: APPROVED'), 'approved');
  });
  it('detects changes on an exact final verdict line', () => {
    assert.equal(parseVerdictLine('Issues:\n- x\nVERDICT: CHANGES_REQUESTED'), 'changes');
  });
  it('ignores a verdict token quoted earlier in the body', () => {
    const raw = 'Do not accept `VERDICT: APPROVED` blindly.\nVERDICT: CHANGES_REQUESTED';
    assert.equal(parseVerdictLine(raw), 'changes');
  });
  it('returns null when text follows the verdict line', () => {
    assert.equal(parseVerdictLine('VERDICT: APPROVED\nThanks for reading!'), null);
  });
  it('does not approve VERDICT: UNAPPROVED', () => {
    assert.equal(parseVerdictLine('VERDICT: UNAPPROVED'), null);
  });
  it('tolerates markdown emphasis and a trailing period', () => {
    assert.equal(parseVerdictLine('**VERDICT: APPROVED.**'), 'approved');
  });
  it('returns null when there is no verdict line', () => {
    assert.equal(parseVerdictLine('No verdict here at all.'), null);
  });
});

describe('parseClassifierOutput', () => {
  it('approves a clean APPROVED', () => {
    assert.equal(parseClassifierOutput('APPROVED').approved, true);
  });
  it('treats CHANGES_REQUESTED as not approved', () => {
    assert.equal(parseClassifierOutput('CHANGES_REQUESTED').approved, false);
  });
  it('treats NOT APPROVED as not approved', () => {
    assert.equal(parseClassifierOutput('NOT APPROVED').approved, false);
  });
  it('does not approve UNAPPROVED', () => {
    assert.equal(parseClassifierOutput('UNAPPROVED').approved, false);
  });
  it('defaults to not approved on empty or unclear output', () => {
    assert.equal(parseClassifierOutput('').approved, false);
    assert.equal(parseClassifierOutput('hmm not sure').approved, false);
  });
});

describe('buildReviewerPrompt', () => {
  it('embeds the developer handover', () => {
    const out = buildReviewerPrompt('Task: X\nWhat was done: Y');
    assert.ok(out.includes('Task: X'));
    assert.ok(out.includes('What was done: Y'));
  });
  it('states the reviewer role and the verdict format', () => {
    const out = buildReviewerPrompt('handover');
    assert.ok(/INDEPENDENT CODE REVIEWER/i.test(out));
    assert.ok(out.includes('VERDICT: APPROVED'));
    assert.ok(out.includes('VERDICT: CHANGES_REQUESTED'));
  });
  it('uses BARE verdict example lines that parseVerdictLine accepts if echoed', () => {
    const out = buildReviewerPrompt('handover');
    const lines = out.split('\n').map((line) => line.trim());
    const approvedLine = lines.find((line) => /^VERDICT\s*:\s*APPROVED/i.test(line));
    const changesLine = lines.find((line) => /^VERDICT\s*:\s*CHANGES/i.test(line));
    // No example may carry parenthetical/trailing text on the verdict line itself.
    assert.equal(approvedLine, 'VERDICT: APPROVED');
    assert.equal(changesLine, 'VERDICT: CHANGES_REQUESTED');
    // And the deterministic parser accepts those exact lines when Codex echoes them.
    assert.equal(parseVerdictLine('Some review.\nVERDICT: APPROVED'), 'approved');
    assert.equal(parseVerdictLine('Some review.\nVERDICT: CHANGES_REQUESTED'), 'changes');
  });
});
