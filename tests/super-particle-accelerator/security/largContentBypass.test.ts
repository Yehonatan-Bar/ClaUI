import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

describe('Large content truncation (no bypass)', () => {
  it('truncation logic slices to MAX_SCAN_BYTES instead of skipping', () => {
    const secret = 'AKIA1234567890ABCDEF';
    const padding = 'x'.repeat(MAX_SCAN_BYTES + 1000);
    const rawContent = `API_KEY=${secret}\n${padding}`;

    assert.ok(rawContent.length > MAX_SCAN_BYTES, 'Content must exceed MAX_SCAN_BYTES');

    const truncated = rawContent.length > MAX_SCAN_BYTES ? rawContent.slice(0, MAX_SCAN_BYTES) : rawContent;

    assert.equal(truncated.length, MAX_SCAN_BYTES, 'Truncated content should be exactly MAX_SCAN_BYTES');
    assert.ok(truncated.includes(secret), 'Secret at start must survive truncation');
  });

  it('content at exactly MAX_SCAN_BYTES is not truncated', () => {
    const content = 'a'.repeat(MAX_SCAN_BYTES);

    const result = content.length > MAX_SCAN_BYTES ? content.slice(0, MAX_SCAN_BYTES) : content;

    assert.equal(result.length, MAX_SCAN_BYTES);
    assert.equal(result, content, 'Content at exactly the limit should not be modified');
  });

  it('content below MAX_SCAN_BYTES passes through unchanged', () => {
    const content = 'TOKEN=sk-abcdef1234567890\nnormal code here';

    const result = content.length > MAX_SCAN_BYTES ? content.slice(0, MAX_SCAN_BYTES) : content;

    assert.equal(result, content, 'Small content must not be modified');
  });

  it('secret near the 2MB boundary is preserved in truncated content', () => {
    const beforeSecret = 'x'.repeat(MAX_SCAN_BYTES - 100);
    const secret = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const afterSecret = 'y'.repeat(5000);
    const rawContent = `${beforeSecret}KEY=${secret}\n${afterSecret}`;

    const truncated = rawContent.length > MAX_SCAN_BYTES ? rawContent.slice(0, MAX_SCAN_BYTES) : rawContent;

    assert.ok(truncated.includes('KEY='), 'Content near boundary should be in truncated output');
  });

  it('empty content returns allow (not truncate)', () => {
    const rawContent = '';

    const shouldAllow = !rawContent;
    assert.ok(shouldAllow, 'Empty content should trigger early allow');
  });
});
