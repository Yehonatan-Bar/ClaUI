import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SpaSecretScanner } from '../../src/super-particle-accelerator-runtime/SecretScanner';

describe('SpaSecretScanner.redact', () => {
  it('returns *** for short values (<=12 chars)', () => {
    assert.equal(SpaSecretScanner.redact('short'), '***');
    assert.equal(SpaSecretScanner.redact('exactly12chr'), '***');
  });

  it('reveals prefix and suffix for longer values', () => {
    const value = 'sk-live-abcdefghijklmnopqrstuvwxyz';
    const redacted = SpaSecretScanner.redact(value);

    assert.ok(redacted.includes('***'));
    assert.ok(redacted.startsWith(value.slice(0, 5)));
    assert.ok(redacted.length < value.length);
  });

  it('caps revealed characters at 8', () => {
    const longValue = 'a'.repeat(200);
    const redacted = SpaSecretScanner.redact(longValue);
    const revealedChars = redacted.replace('***', '').length;
    assert.ok(revealedChars <= 8);
  });

  it('never reveals the full value', () => {
    const value = 'my-secret-api-key-12345';
    const redacted = SpaSecretScanner.redact(value);
    assert.notEqual(redacted, value);
    assert.ok(redacted.includes('***'));
  });
});

describe('SpaSecretScanner.scan', () => {
  it('returns empty array for text with no secrets', () => {
    const scanner = new SpaSecretScanner();
    const findings = scanner.scan({
      text: 'const x = 42;\nconst name = "hello";',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
    });
    assert.equal(findings.length, 0);
  });

  it('produces valueSha256 for detected findings', () => {
    const scanner = new SpaSecretScanner();
    const text = 'const key = "AKIA1234567890ABCDEF";';
    const findings = scanner.scan({
      text,
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
    });
    for (const f of findings) {
      assert.ok(f.valueSha256.length > 0);
      assert.ok(f.redactedPreview.length > 0);
    }
  });

  it('redactedPreview never contains the raw secret value', () => {
    const scanner = new SpaSecretScanner();
    const secretValue = 'AKIA1234567890ABCDEF';
    const text = `const key = "${secretValue}";`;
    const findings = scanner.scan({
      text,
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
    });
    for (const f of findings) {
      assert.notEqual(f.redactedPreview, secretValue);
    }
  });
});
