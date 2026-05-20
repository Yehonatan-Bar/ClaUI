import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CompositeSecretScanner } from '../../../src/shared/secret-protection/scanners/CompositeSecretScanner';
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

describe('CompositeSecretScanner', () => {
  it('deduplicates overlapping scanner findings', () => {
    const result = new CompositeSecretScanner(settings).scan('API_TOKEN=supersecretvalue123', {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    const uniqueIds = new Set(result.findings.map((finding) => finding.id));
    assert.equal(uniqueIds.size, result.findings.length);
    assert.ok(result.findings.length >= 1);
  });
});
