import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ExtensionOutboundScanner } from '../../../src/extension/scanners/ExtensionOutboundScanner';

describe('ExtensionOutboundScanner', () => {
  const scanner = new ExtensionOutboundScanner();

  it('has the correct name', () => {
    assert.equal(scanner.name, 'extension-outbound');
  });

  it('detects hardcoded passwords in source code', () => {
    const input = 'const config = { password: "mySuperSecret123" };';
    const result = scanner.scan(input, {
      boundary: 'context.attach',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.ok(result.findings.length >= 1);
    assert.equal(result.findings[0].ruleId, 'ext-hardcoded-password');
    assert.equal(result.findings[0].type, 'hard_secret');
  });

  it('detects connection strings', () => {
    const input = 'connectionString = "Server=prod.db;Database=main;Password=hunter2!!"';
    const result = scanner.scan(input, {
      boundary: 'context.attach',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    const connStr = result.findings.find(f => f.ruleId === 'ext-connection-string');
    assert.ok(connStr);
    assert.equal(connStr!.severity, 'critical');
  });

  it('detects authorization headers in log output', () => {
    const input = 'Authorization: Bearer sk-ant-api03-AAAAAAAABBBBBBCCCCCC';
    const result = scanner.scan(input, {
      boundary: 'command.output',
      destination: { kind: 'terminal_stdout_to_agent', trustTier: 'trusted_local' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'ext-auth-header-leak'));
  });

  it('detects stack traces with internal paths', () => {
    const input = 'at UserService.create (C:\\Users\\admin\\src\\services\\user.ts:45:12)';
    const result = scanner.scan(input, {
      boundary: 'command.output',
      destination: { kind: 'terminal_stdout_to_agent', trustTier: 'trusted_local' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'ext-stack-trace-path'));
  });

  it('skips irrelevant boundaries', () => {
    const input = 'password: "shouldNotBeScanned"';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.equal(result.findings.length, 0);
  });

  it('scans without context (no boundary filter)', () => {
    const input = 'REDIS_URL=redis://user:pass1234@prod-redis:6379';
    const result = scanner.scan(input);
    assert.ok(result.findings.length >= 1);
  });

  it('detects database error leaks', () => {
    const input = 'SQLSTATE[HY000]: connection failed host=prod.db password=secret123';
    const result = scanner.scan(input, {
      boundary: 'command.output',
      destination: { kind: 'terminal_stdout_to_agent', trustTier: 'trusted_local' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'ext-db-error-leak'));
  });

  it('returns correct scannedBytes and latencyMs', () => {
    const input = 'some harmless text';
    const result = scanner.scan(input);
    assert.equal(result.scannedBytes, Buffer.byteLength(input, 'utf-8'));
    assert.ok(result.latencyMs >= 0);
  });
});
