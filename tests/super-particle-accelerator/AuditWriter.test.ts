import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpaAuditWriter } from '../../src/super-particle-accelerator-runtime/AuditWriter';
import { SuperParticleAcceleratorAuditEvent } from '../../src/shared/super-particle-accelerator/types';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `spa-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEvent(overrides: Partial<SuperParticleAcceleratorAuditEvent> = {}): SuperParticleAcceleratorAuditEvent {
  return {
    id: 'test-event-1',
    timestamp: '2026-05-24T12:00:00.000Z',
    provider: 'claude',
    sessionId: 'sess-1',
    workspacePathHash: 'abc123',
    toolName: 'Edit',
    source: 'edit',
    action: 'deny',
    reason: 'Secret found',
    findings: [],
    ...overrides,
  };
}

describe('SpaAuditWriter', () => {
  it('creates audit directory and writes JSONL file', () => {
    const storeDir = makeTempDir();
    const writer = new SpaAuditWriter(storeDir);

    const event = makeEvent();
    writer.write(event);

    const auditDir = path.join(storeDir, 'audit');
    assert.ok(fs.existsSync(auditDir));

    const filePath = path.join(auditDir, '2026-05-24.jsonl');
    assert.ok(fs.existsSync(filePath));

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, 'test-event-1');
    assert.equal(parsed.action, 'deny');

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('appends multiple events to the same date file', () => {
    const storeDir = makeTempDir();
    const writer = new SpaAuditWriter(storeDir);

    writer.write(makeEvent({ id: 'ev-1' }));
    writer.write(makeEvent({ id: 'ev-2' }));
    writer.write(makeEvent({ id: 'ev-3' }));

    const filePath = path.join(storeDir, 'audit', '2026-05-24.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).id, 'ev-1');
    assert.equal(JSON.parse(lines[2]).id, 'ev-3');

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('uses different files for different dates', () => {
    const storeDir = makeTempDir();
    const writer = new SpaAuditWriter(storeDir);

    writer.write(makeEvent({ timestamp: '2026-05-24T10:00:00.000Z' }));
    writer.write(makeEvent({ timestamp: '2026-05-25T10:00:00.000Z' }));

    const auditDir = path.join(storeDir, 'audit');
    assert.ok(fs.existsSync(path.join(auditDir, '2026-05-24.jsonl')));
    assert.ok(fs.existsSync(path.join(auditDir, '2026-05-25.jsonl')));

    fs.rmSync(storeDir, { recursive: true, force: true });
  });
});
