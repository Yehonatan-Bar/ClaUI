import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExceptionLoader } from '../../src/super-particle-accelerator-runtime/ExceptionLoader';
import { SuperParticleAcceleratorException } from '../../src/shared/super-particle-accelerator/types';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `spa-exc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeException(overrides: Partial<SuperParticleAcceleratorException> = {}): SuperParticleAcceleratorException {
  return {
    id: 'exc-1',
    ruleId: 'generic-api-key',
    valueSha256: 'deadbeef',
    filePathGlob: 'src/**/*.ts',
    createdAt: '2026-05-20T00:00:00.000Z',
    expiresAt: '2026-06-20T00:00:00.000Z',
    maxUses: 5,
    usedCount: 0,
    reason: 'Testing',
    ...overrides,
  };
}

describe('ExceptionLoader', () => {
  it('returns empty array for missing file', () => {
    const storeDir = makeTempDir();
    const loader = new ExceptionLoader(storeDir);

    const result = loader.loadActive();
    assert.deepEqual(result, []);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('loads active exceptions', () => {
    const storeDir = makeTempDir();
    const exc = makeException();
    fs.writeFileSync(path.join(storeDir, 'exceptions.json'), JSON.stringify([exc]));

    const loader = new ExceptionLoader(storeDir);
    const result = loader.loadActive('2026-05-24T00:00:00.000Z');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'exc-1');

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('filters out expired exceptions', () => {
    const storeDir = makeTempDir();
    const exc = makeException({ expiresAt: '2026-05-01T00:00:00.000Z' });
    fs.writeFileSync(path.join(storeDir, 'exceptions.json'), JSON.stringify([exc]));

    const loader = new ExceptionLoader(storeDir);
    const result = loader.loadActive('2026-05-24T00:00:00.000Z');
    assert.equal(result.length, 0);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('filters out exhausted exceptions (usedCount >= maxUses)', () => {
    const storeDir = makeTempDir();
    const exc = makeException({ usedCount: 5, maxUses: 5 });
    fs.writeFileSync(path.join(storeDir, 'exceptions.json'), JSON.stringify([exc]));

    const loader = new ExceptionLoader(storeDir);
    const result = loader.loadActive('2026-05-24T00:00:00.000Z');
    assert.equal(result.length, 0);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('consumeMany increments usedCount via atomic write', () => {
    const storeDir = makeTempDir();
    const exc1 = makeException({ id: 'exc-1', usedCount: 0 });
    const exc2 = makeException({ id: 'exc-2', usedCount: 2 });
    fs.writeFileSync(path.join(storeDir, 'exceptions.json'), JSON.stringify([exc1, exc2]));

    const loader = new ExceptionLoader(storeDir);
    loader.consumeMany(['exc-1']);

    const raw = fs.readFileSync(path.join(storeDir, 'exceptions.json'), 'utf-8');
    const updated: SuperParticleAcceleratorException[] = JSON.parse(raw);
    assert.equal(updated.find(e => e.id === 'exc-1')!.usedCount, 1);
    assert.equal(updated.find(e => e.id === 'exc-2')!.usedCount, 2);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('consumeMany is a no-op for empty ids array', () => {
    const storeDir = makeTempDir();
    const exc = makeException();
    fs.writeFileSync(path.join(storeDir, 'exceptions.json'), JSON.stringify([exc]));

    const loader = new ExceptionLoader(storeDir);
    loader.consumeMany([]);

    const raw = fs.readFileSync(path.join(storeDir, 'exceptions.json'), 'utf-8');
    const updated: SuperParticleAcceleratorException[] = JSON.parse(raw);
    assert.equal(updated[0].usedCount, 0);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });
});
