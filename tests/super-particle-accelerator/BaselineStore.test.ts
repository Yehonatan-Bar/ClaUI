import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaselineStore } from '../../src/super-particle-accelerator-runtime/BaselineStore';
import { SecretFinding } from '../../src/shared/super-particle-accelerator/types';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `spa-baseline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFinding(overrides: Partial<SecretFinding> = {}): SecretFinding {
  return {
    ruleId: 'generic-api-key',
    type: 'generic_high_entropy_secret',
    severity: 'high',
    confidence: 'high',
    valueSha256: 'sha256-abc123',
    redactedPreview: 'sk-li***qrst',
    filePath: 'src/config.ts',
    line: 10,
    ...overrides,
  };
}

describe('BaselineStore', () => {
  it('load returns null for nonexistent session', () => {
    const storeDir = makeTempDir();
    const store = new BaselineStore(storeDir);

    assert.equal(store.load('nonexistent-session'), null);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('save and load round-trips correctly', () => {
    const storeDir = makeTempDir();
    const store = new BaselineStore(storeDir);

    const findings = [makeFinding({ valueSha256: 'abc', filePath: 'a.ts' })];
    store.save('session-1', findings);

    const loaded = store.load('session-1');
    assert.ok(loaded);
    assert.equal(loaded.sessionId, 'session-1');
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].valueSha256, 'abc');
    assert.equal(loaded.entries[0].filePath, 'a.ts');

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('filterNew returns all findings when no baseline exists', () => {
    const storeDir = makeTempDir();
    const store = new BaselineStore(storeDir);

    const findings = [
      makeFinding({ valueSha256: 'new-1' }),
      makeFinding({ valueSha256: 'new-2' }),
    ];

    const result = store.filterNew('session-1', findings);
    assert.equal(result.length, 2);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('filterNew excludes findings that match baseline entries', () => {
    const storeDir = makeTempDir();
    const store = new BaselineStore(storeDir);

    const baselineFindings = [
      makeFinding({ valueSha256: 'existing-1', filePath: 'a.ts' }),
      makeFinding({ valueSha256: 'existing-2', filePath: 'b.ts' }),
    ];
    store.save('session-1', baselineFindings);

    const currentFindings = [
      makeFinding({ valueSha256: 'existing-1', filePath: 'a.ts' }),
      makeFinding({ valueSha256: 'new-1', filePath: 'c.ts' }),
    ];

    const result = store.filterNew('session-1', currentFindings);
    assert.equal(result.length, 1);
    assert.equal(result[0].valueSha256, 'new-1');

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('sanitizes session ID for file path safety', () => {
    const storeDir = makeTempDir();
    const store = new BaselineStore(storeDir);

    store.save('../../escape-attempt', [makeFinding()]);

    const baselinesDir = path.join(storeDir, 'baselines');
    const files = fs.readdirSync(baselinesDir);
    assert.equal(files.length, 1);
    assert.ok(!files[0].includes('..'));

    fs.rmSync(storeDir, { recursive: true, force: true });
  });
});
