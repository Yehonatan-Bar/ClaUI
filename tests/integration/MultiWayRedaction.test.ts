import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CompositeSecretScanner } from '../../src/shared/secret-protection/scanners/CompositeSecretScanner';
import { RedactionEngine } from '../../src/shared/secret-protection/RedactionEngine';
import type { SecretProtectionSettings } from '../../src/shared/secret-protection/types';

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

describe('MultiWayRedaction integration', () => {
  it('scans then redacts prompt-bound secrets', () => {
    const text = 'API_TOKEN=supersecretvalue123';
    const scan = new CompositeSecretScanner(settings).scan(text, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    const redacted = new RedactionEngine().redact(text, scan.findings);
    assert.ok(redacted.replacementCount > 0);
    assert.equal(redacted.redacted.includes('supersecretvalue123'), false);
  });
});
