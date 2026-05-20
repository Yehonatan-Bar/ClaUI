import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ServerOutboundScanner } from '../../../src/server/scanners/ServerOutboundScanner';

describe('ServerOutboundScanner', () => {
  const scanner = new ServerOutboundScanner();

  it('has the correct name', () => {
    assert.equal(scanner.name, 'server-outbound');
  });

  it('detects database connection strings (ADO.NET style)', () => {
    const input = 'Server=prod.db;Database=main;User=admin;Password=hunter2!!';
    const result = scanner.scan(input, {
      boundary: 'mcp.request',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-db-connstr-leak'));
    assert.equal(result.findings[0].severity, 'critical');
  });

  it('detects database URLs with credentials', () => {
    const input = 'connecting to postgres://admin:s3cret@db-host:5432/production';
    const result = scanner.scan(input, {
      boundary: 'mcp.request',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-db-url-leak'));
  });

  it('detects URL token parameters', () => {
    const input = 'Fetching https://api.example.com/data?token=abc123def456ghi789jkl';
    const result = scanner.scan(input, {
      boundary: 'mcp.response',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-url-token-param'));
  });

  it('detects X-Api-Key headers', () => {
    const input = 'X-Api-Key: abcdef1234567890abcdef';
    const result = scanner.scan(input, {
      boundary: 'telemetry.export',
      destination: { kind: 'telemetry_backend', trustTier: 'public' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-api-key-header'));
  });

  it('detects OAuth client secrets', () => {
    const input = '{"client_secret": "abcdef1234567890abcdef1234567890"}';
    const result = scanner.scan(input, {
      boundary: 'diagnostic.export',
      destination: { kind: 'diagnostic_export', trustTier: 'public' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-oauth-client-secret'));
    assert.equal(result.findings[0].severity, 'critical');
  });

  it('detects certificate material', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANB...';
    const result = scanner.scan(input, {
      boundary: 'mcp.request',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-cert-material-leak'));
  });

  it('detects SSN patterns', () => {
    const input = 'User SSN is 123-45-6789';
    const result = scanner.scan(input, {
      boundary: 'diagnostic.export',
      destination: { kind: 'diagnostic_export', trustTier: 'public' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-ssn-in-payload'));
    assert.equal(result.findings[0].type, 'pii');
  });

  it('detects SMTP credentials', () => {
    const input = 'Mail server: smtp://user:mailpass123@smtp.provider.com:587';
    const result = scanner.scan(input, {
      boundary: 'mcp.request',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'server-smtp-creds'));
  });

  it('skips irrelevant boundaries', () => {
    const input = 'postgres://admin:secret@host/db';
    const result = scanner.scan(input, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.equal(result.findings.length, 0);
  });

  it('returns correct metadata for clean input', () => {
    const input = 'just a normal response';
    const result = scanner.scan(input, {
      boundary: 'mcp.response',
      destination: { kind: 'mcp_server', trustTier: 'approved_remote' },
    });
    assert.equal(result.scannedBytes, Buffer.byteLength(input, 'utf-8'));
    assert.equal(result.findings.length, 0);
  });
});
