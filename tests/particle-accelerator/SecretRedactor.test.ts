import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createSecretRedactor } from '../../src/particle-accelerator-runtime/SecretRedactor';

describe('SecretRedactor', () => {
  it('redacts env-backed token found in text', () => {
    const redactor = createSecretRedactor({
      MY_SECRET: 'supersecretvalue12345',
    });
    const result = redactor.redact('Output: supersecretvalue12345 done');
    assert.equal(result.text, 'Output: [REDACTED] done');
    assert.ok(result.replacements >= 1);
    assert.ok(result.rulesTriggered.includes('env-value'));
  });

  it('redacts env-backed token regardless of stream origin', () => {
    const redactor = createSecretRedactor({
      DATABASE_PASSWORD: 'mydbpassword99',
    });
    const stderrLine = 'Error: connection refused for mydbpassword99';
    const result = redactor.redact(stderrLine);
    assert.ok(!result.text.includes('mydbpassword99'));
    assert.ok(result.text.includes('[REDACTED]'));
    assert.ok(result.rulesTriggered.includes('env-value'));
  });

  it('redacts JWT tokens via regex rule', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Token: ${jwt}`);
    assert.ok(!result.text.includes('eyJ'));
    assert.ok(result.text.includes('[REDACTED]'));
    assert.ok(result.rulesTriggered.includes('jwt'));
  });

  it('redacts PEM private key blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB',
      'aLkNMkSRSMG0sXQBBELP9sP0JBNOsU7XwYEB0fO7RnoKbPX2WEE1lFFkBBQ==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Key:\n${pem}\nDone`);
    assert.ok(!result.text.includes('BEGIN RSA PRIVATE KEY'));
    assert.ok(result.text.includes('[REDACTED]'));
    assert.ok(result.rulesTriggered.includes('private-key-block'));
  });

  it('redacts credentials in database connection URLs', () => {
    const dbUrl = 'postgres://admin:s3cretP4ss@db.example.com:5432/mydb';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Connecting to ${dbUrl}`);
    assert.ok(!result.text.includes('s3cretP4ss'));
    assert.ok(result.rulesTriggered.some(r => r === 'db-url-creds' || r === 'basic-auth-url'));
  });

  it('does not redact short env values (fewer than 8 characters)', () => {
    const redactor = createSecretRedactor({
      API_KEY: 'short',
      MY_TOKEN: 'abc',
    });
    const result = redactor.redact('Values: short and abc should remain');
    assert.equal(result.text, 'Values: short and abc should remain');
    assert.equal(result.replacements, 0);
    assert.equal(result.rulesTriggered.length, 0);
  });

  it('redacts multiple secrets in a single line', () => {
    const redactor = createSecretRedactor({
      API_KEY: 'firstsecretvalue',
      DB_PASSWORD: 'secondsecretval',
    });
    const line = 'creds: firstsecretvalue and secondsecretval here';
    const result = redactor.redact(line);
    assert.ok(!result.text.includes('firstsecretvalue'));
    assert.ok(!result.text.includes('secondsecretval'));
    assert.ok(result.replacements >= 2);
    assert.ok(result.rulesTriggered.includes('env-value'));
  });

  it('passes non-secret text through unchanged', () => {
    const redactor = createSecretRedactor({
      SOME_TOKEN: 'actualtoken1234567890',
    });
    const clean = 'Hello world, nothing secret here. Status: OK (code 200)';
    const result = redactor.redact(clean);
    assert.equal(result.text, clean);
    assert.equal(result.replacements, 0);
    assert.equal(result.rulesTriggered.length, 0);
  });

  it('redacts GitHub classic personal access tokens', () => {
    const ghToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`git clone https://${ghToken}@github.com/repo`);
    assert.ok(!result.text.includes('ghp_'));
    assert.ok(result.rulesTriggered.includes('github-classic-pat'));
  });

  it('redacts Bearer tokens in authorization headers', () => {
    const bearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Authorization: ${bearer}`);
    assert.ok(!result.text.includes('eyJhbGci'));
    assert.ok(result.rulesTriggered.includes('bearer-token'));
  });
});
