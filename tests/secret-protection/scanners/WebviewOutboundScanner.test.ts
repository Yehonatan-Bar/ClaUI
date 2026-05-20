import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { WebviewOutboundScanner } from '../../../src/webview/scanners/WebviewOutboundScanner';

describe('WebviewOutboundScanner', () => {
  const scanner = new WebviewOutboundScanner();

  it('has the correct name', () => {
    assert.equal(scanner.name, 'webview-outbound');
  });

  it('detects pasted OpenAI API keys', () => {
    const input = 'Here is my key: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-openai-key-paste'));
    assert.equal(result.findings[0].severity, 'critical');
  });

  it('detects pasted Anthropic API keys', () => {
    const input = 'Use this key: sk-ant-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-anthropic-key-paste'));
  });

  it('detects AWS access keys', () => {
    const input = 'My AWS key is AKIAIOSFODNN7EXAMPLE';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-aws-access-key-paste'));
    assert.equal(result.findings[0].type, 'cloud_credential');
  });

  it('detects pasted private keys', () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I
-----END RSA PRIVATE KEY-----`;
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-private-key-paste'));
    assert.equal(result.findings[0].severity, 'critical');
  });

  it('detects JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = scanner.scan(`Check this token: ${jwt}`, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-jwt-paste'));
  });

  it('detects URLs with embedded credentials', () => {
    const input = 'Connect to postgres://admin:secretpass@prod-db.example.com:5432/mydb';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-url-embedded-creds'));
    assert.equal(result.findings[0].type, 'database_credential');
  });

  it('detects Slack webhook URLs', () => {
    const input = 'Post to https://hooks.slack.com/services/T0123ABCD/B0123ABCD/a1b2c3d4e5f6g7h8i9j0';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-slack-webhook'));
  });

  it('detects pasted .env block', () => {
    const input = `DATABASE_URL=postgres://x:y@host/db
SECRET_KEY=abc123def456
API_TOKEN=tok_livexxxxxxxxxx
REDIS_URL=redis://localhost:6379`;
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'webview-env-block-paste'));
  });

  it('skips irrelevant boundaries', () => {
    const input = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = scanner.scan(input, {
      boundary: 'command.output',
      destination: { kind: 'terminal_stdout_to_agent', trustTier: 'trusted_local' },
    });
    assert.equal(result.findings.length, 0);
  });

  it('returns proper metadata', () => {
    const input = 'no secrets here';
    const result = scanner.scan(input);
    assert.equal(result.scannedBytes, Buffer.byteLength(input, 'utf-8'));
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.findings.length, 0);
  });
});
