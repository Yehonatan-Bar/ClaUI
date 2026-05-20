import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SecretProtectionBroker } from '../../../src/extension/secret-protection/SecretProtectionBroker';
import { DEFAULT_POLICY } from '../../../src/shared/secret-protection/policySchema';
import type { SecretProtectionSettings } from '../../../src/shared/secret-protection/types';

const settings: SecretProtectionSettings = {
  enabled: true,
  mode: 'balanced',
  blockProtectedPaths: true,
  scanPrompts: true,
  scanTerminalOutput: true,
  scanGitPublication: true,
  scanMcp: true,
  requireBrowserCaptureApproval: true,
  exceptionMaxMinutes: 30,
  auditRetentionDays: 90,
  enableEntropyScanner: false,
};

describe('Browser capture enforcement', () => {
  it('requires approval and writes an audit event for image captures', async () => {
    const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-browser-capture-'));
    try {
      const broker = new SecretProtectionBroker(settings, DEFAULT_POLICY, auditDir, 'unit-session');

      const decision = await broker.scanBrowserCapture('image_count=1; media_types=image/png');

      assert.equal(decision.action, 'require_approval');
      assert.equal(decision.audit.boundary, 'browser.capture');
      assert.deepEqual(decision.audit.ruleIds, ['browser-capture-approval-required']);
      assert.ok(decision.approvalRequest);
    } finally {
      fs.rmSync(auditDir, { recursive: true, force: true });
    }
  });
});
