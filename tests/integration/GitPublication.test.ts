import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { GitPublicationScanner } from '../../src/shared/scanners/GitPublicationScanner';

describe('GitPublication integration', () => {
  it('detects added secrets before publication', () => {
    const diff = [
      'diff --git a/config.ts b/config.ts',
      '+++ b/config.ts',
      '@@ -0,0 +1 @@',
      '+const key = "AKIAIOSFODNN7EXAMPLE";',
    ].join('\n');
    const result = new GitPublicationScanner().scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some((finding) => finding.ruleId === 'git-diff-aws-key'));
  });
});
