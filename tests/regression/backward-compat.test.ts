import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AuditEventWriter as CompatWriter } from '../../src/shared/secret-protection/AuditEventWriter';
import { AuditEventWriter as NewWriter } from '../../src/shared/audit/AuditEventWriter';
import { buildCodexDlpInstructions } from '../../src/server/Codex';

describe('Secret Protection backward compatibility', () => {
  it('keeps the old AuditEventWriter import path working', () => {
    assert.equal(typeof CompatWriter, typeof NewWriter);
  });

  it('builds Codex DLP instructions without raw secret values', () => {
    const text = buildCodexDlpInstructions({ action: 'redact', reason: 'test' });
    assert.ok(text.includes('<REDACTED'));
    assert.equal(text.includes('supersecretvalue123'), false);
  });
});
