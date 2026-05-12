import { createSecretRedactor } from '../../src/local-boost-runtime/SecretRedactor';

describe('SecretRedactor', () => {
  // -----------------------------------------------------------
  // 1. Env-backed token in stdout is redacted
  // -----------------------------------------------------------
  it('redacts env-backed token found in text', () => {
    const redactor = createSecretRedactor({
      MY_SECRET: 'supersecretvalue12345',
    });
    const result = redactor.redact('Output: supersecretvalue12345 done');
    expect(result.text).toBe('Output: [REDACTED] done');
    expect(result.replacements).toBeGreaterThanOrEqual(1);
    expect(result.rulesTriggered).toContain('env-value');
  });

  // -----------------------------------------------------------
  // 2. Env-backed token in stderr is redacted (same redact fn)
  // -----------------------------------------------------------
  it('redacts env-backed token regardless of stream origin', () => {
    const redactor = createSecretRedactor({
      DATABASE_PASSWORD: 'mydbpassword99',
    });
    const stderrLine = 'Error: connection refused for mydbpassword99';
    const result = redactor.redact(stderrLine);
    expect(result.text).not.toContain('mydbpassword99');
    expect(result.text).toContain('[REDACTED]');
    expect(result.rulesTriggered).toContain('env-value');
  });

  // -----------------------------------------------------------
  // 3. JWT pattern is redacted
  // -----------------------------------------------------------
  it('redacts JWT tokens via regex rule', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Token: ${jwt}`);
    expect(result.text).not.toContain('eyJ');
    expect(result.text).toContain('[REDACTED]');
    expect(result.rulesTriggered).toContain('jwt');
  });

  // -----------------------------------------------------------
  // 4. Private key block is redacted
  // -----------------------------------------------------------
  it('redacts PEM private key blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB',
      'aLkNMkSRSMG0sXQBBELP9sP0JBNOsU7XwYEB0fO7RnoKbPX2WEE1lFFkBBQ==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Key:\n${pem}\nDone`);
    expect(result.text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.text).toContain('[REDACTED]');
    expect(result.rulesTriggered).toContain('private-key-block');
  });

  // -----------------------------------------------------------
  // 5. Database URL password is redacted
  // -----------------------------------------------------------
  it('redacts credentials in database connection URLs', () => {
    const dbUrl = 'postgres://admin:s3cretP4ss@db.example.com:5432/mydb';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Connecting to ${dbUrl}`);
    expect(result.text).not.toContain('s3cretP4ss');
    expect(result.rulesTriggered).toContain('db-url-creds');
  });

  // -----------------------------------------------------------
  // 6. Short env values (< 8 chars) are NOT matched
  // -----------------------------------------------------------
  it('does not redact short env values (fewer than 8 characters)', () => {
    const redactor = createSecretRedactor({
      API_KEY: 'short',       // 5 chars - too short
      MY_TOKEN: 'abc',        // 3 chars - too short
    });
    const result = redactor.redact('Values: short and abc should remain');
    expect(result.text).toBe('Values: short and abc should remain');
    expect(result.replacements).toBe(0);
    expect(result.rulesTriggered).toHaveLength(0);
  });

  // -----------------------------------------------------------
  // 7. Multiple secrets in one line are all redacted
  // -----------------------------------------------------------
  it('redacts multiple secrets in a single line', () => {
    const redactor = createSecretRedactor({
      API_KEY: 'firstsecretvalue',
      DB_PASSWORD: 'secondsecretval',
    });
    const line = 'creds: firstsecretvalue and secondsecretval here';
    const result = redactor.redact(line);
    expect(result.text).not.toContain('firstsecretvalue');
    expect(result.text).not.toContain('secondsecretval');
    expect(result.replacements).toBeGreaterThanOrEqual(2);
    expect(result.rulesTriggered).toContain('env-value');
  });

  // -----------------------------------------------------------
  // 8. Non-secret text passes through unchanged
  // -----------------------------------------------------------
  it('passes non-secret text through unchanged', () => {
    const redactor = createSecretRedactor({
      SOME_TOKEN: 'actualtoken1234567890',
    });
    const clean = 'Hello world, nothing secret here. Status: OK (code 200)';
    const result = redactor.redact(clean);
    expect(result.text).toBe(clean);
    expect(result.replacements).toBe(0);
    expect(result.rulesTriggered).toHaveLength(0);
  });

  // -----------------------------------------------------------
  // 9. GitHub PAT (ghp_xxx) is redacted
  // -----------------------------------------------------------
  it('redacts GitHub classic personal access tokens', () => {
    const ghToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`git clone https://${ghToken}@github.com/repo`);
    expect(result.text).not.toContain('ghp_');
    expect(result.rulesTriggered).toContain('github-classic-pat');
  });

  // -----------------------------------------------------------
  // 10. Bearer token is redacted
  // -----------------------------------------------------------
  it('redacts Bearer tokens in authorization headers', () => {
    const bearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz';
    const redactor = createSecretRedactor({});
    const result = redactor.redact(`Authorization: ${bearer}`);
    expect(result.text).not.toContain('eyJhbGci');
    expect(result.rulesTriggered).toContain('bearer-token');
  });
});
