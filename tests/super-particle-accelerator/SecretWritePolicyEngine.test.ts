import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SecretWritePolicyEngine } from '../../src/super-particle-accelerator-runtime/SecretWritePolicyEngine';
import { PathClassifier } from '../../src/super-particle-accelerator-runtime/PathClassifier';
import type {
  SecretFinding,
  SecretWritePolicyInput,
  SuperParticleAcceleratorSettings,
} from '../../src/shared/super-particle-accelerator/types';

function makeSettings(overrides: Partial<SuperParticleAcceleratorSettings> = {}): SuperParticleAcceleratorSettings {
  return {
    enabled: true,
    mode: 'block',
    scanEditTools: true,
    scanBashCommands: true,
    scanMcpTools: true,
    scanWorkingTreeOnStop: true,
    blockGitCommitPush: true,
    allowIgnoredEnvFiles: true,
    entropyThreshold: 4.2,
    frontendPathGlobs: ['src/**/*.tsx', 'src/**/*.jsx', 'public/**'],
    allowedSecretFileGlobs: ['.env.local', '.env.*.local'],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<SecretFinding> = {}): SecretFinding {
  return {
    ruleId: 'test-rule',
    type: 'generic_high_entropy_secret',
    severity: 'high',
    confidence: 'high',
    redactedPreview: 'sk-li***qrst',
    valueSha256: 'abc123def456',
    ...overrides,
  };
}

function makeInput(overrides: Partial<SecretWritePolicyInput> = {}): SecretWritePolicyInput {
  return {
    findings: [makeFinding()],
    source: 'edit',
    provider: 'claude',
    cwd: '/project',
    settings: makeSettings(),
    exceptions: [],
    ...overrides,
  };
}

function createEngine(): SecretWritePolicyEngine {
  const classifier = new PathClassifier(
    ['src/**/*.tsx', 'src/**/*.jsx', 'public/**'],
    ['.env.local', '.env.*.local'],
  );
  return new SecretWritePolicyEngine(classifier);
}

describe('SecretWritePolicyEngine', () => {
  describe('Gate 0 - no findings', () => {
    it('allows when no findings', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({ findings: [] }));
      assert.equal(decision.action, 'allow');
    });
  });

  describe('Gate 1 - placeholder filter', () => {
    it('allows when all findings are placeholders', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        findings: [makeFinding({ redactedPreview: 'YOUR_API_KEY_HERE' })],
      }));
      assert.equal(decision.action, 'allow');
    });

    it('allows when all findings are low confidence', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        findings: [makeFinding({ confidence: 'low' })],
      }));
      assert.equal(decision.action, 'allow');
    });
  });

  describe('Gate 2 - public path hard deny', () => {
    it('denies secrets in public directory', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/public/config.js',
      }));
      assert.equal(decision.action, 'deny');
      assert.ok(decision.reason.includes('client-side or public code'));
    });

    it('denies secrets in dist directory', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/dist/bundle.js',
      }));
      assert.equal(decision.action, 'deny');
    });

    it('denies secrets in bundled files', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/output/app.bundle.js',
      }));
      assert.equal(decision.action, 'deny');
    });
  });

  describe('Gate 3 - gitignored env files', () => {
    it('audits when file is gitignored and allowIgnoredEnvFiles is true', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/.env.local',
        isFileGitIgnored: true,
      }));
      assert.equal(decision.action, 'audit');
      assert.ok(decision.reason.includes('gitignored'));
    });

    it('denies when file matches allowedSecretFileGlobs but is NOT gitignored', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/.env.local',
        isFileGitIgnored: false,
      }));
      assert.equal(decision.action, 'deny');
    });

    it('denies when isFileGitIgnored is undefined (not verified)', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/.env.local',
      }));
      assert.equal(decision.action, 'deny');
    });

    it('denies gitignored env file when allowIgnoredEnvFiles is false', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/.env.local',
        isFileGitIgnored: true,
        settings: makeSettings({ allowIgnoredEnvFiles: false }),
      }));
      assert.equal(decision.action, 'deny');
    });
  });

  describe('Gate 4 - exceptions', () => {
    it('audits when finding is covered by a valid exception', () => {
      const engine = createEngine();
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

      const decision = engine.evaluate(makeInput({
        filePath: '/project/server/config.ts',
        exceptions: [{
          id: 'exc-1',
          createdAt: now.toISOString(),
          expiresAt: future,
          createdBy: 'user',
          ruleId: 'test-rule',
          valueSha256: 'abc123def456',
          filePathGlob: '**/*.ts',
          maxUses: 10,
          usedCount: 0,
          reason: 'Test exception',
        }],
      }));
      assert.equal(decision.action, 'audit');
      assert.deepEqual(decision.consumedExceptionIds, ['exc-1']);
    });

    it('denies when exception is expired', () => {
      const engine = createEngine();
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const decision = engine.evaluate(makeInput({
        filePath: '/project/server/config.ts',
        exceptions: [{
          id: 'exc-1',
          createdAt: past,
          expiresAt: past,
          createdBy: 'user',
          ruleId: 'test-rule',
          valueSha256: 'abc123def456',
          filePathGlob: '**/*.ts',
          maxUses: 10,
          usedCount: 0,
          reason: 'Expired exception',
        }],
      }));
      assert.equal(decision.action, 'deny');
    });
  });

  describe('mode: audit', () => {
    it('audits instead of denying when mode is audit', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/server/config.ts',
        settings: makeSettings({ mode: 'audit' }),
      }));
      assert.equal(decision.action, 'audit');
    });

    it('still hard-denies public paths even in audit mode', () => {
      const engine = createEngine();
      const decision = engine.evaluate(makeInput({
        filePath: '/project/public/config.js',
        settings: makeSettings({ mode: 'audit' }),
      }));
      assert.equal(decision.action, 'deny');
    });
  });
});
