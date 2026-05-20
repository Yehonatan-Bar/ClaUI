import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditEventWriter } from '../../../src/shared/audit/AuditEventWriter';
import type { AuditEvent } from '../../../src/shared/secret-protection/types';

describe('AuditEventWriter', () => {
  it('writes and reads date-partitioned audit events', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-audit-test-'));
    const writer = new AuditEventWriter();
    const event: AuditEvent = {
      id: 'evt1',
      timestamp: '2026-05-19T10:00:00.000Z',
      boundary: 'prompt.submit',
      action: 'redact',
      ruleIds: ['r1'],
      findingTypes: ['api_key'],
      severityMax: 'high',
      destinationKind: 'remote_model_provider',
      contentHash: 'hash',
      redactedBytes: 20,
      redactionCount: 1,
    };

    await writer.writeEvent(event, dir);
    const events = await writer.readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'evt1');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
