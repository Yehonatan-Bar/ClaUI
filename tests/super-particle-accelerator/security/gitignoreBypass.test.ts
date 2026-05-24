import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SecretWritePolicyEngine } from '../../../src/super-particle-accelerator-runtime/SecretWritePolicyEngine';
import { PathClassifier } from '../../../src/super-particle-accelerator-runtime/PathClassifier';
import type {
  SecretFinding,
  SecretWritePolicyInput,
  SuperParticleAcceleratorSettings,
} from '../../../src/shared/super-particle-accelerator/types';

function makeSettings(overrides: Partial<SuperParticleAcceleratorSettings> = {}): SuperParticleAcceleratorSettings {
  return {
    enabled: true, mode: 'block', scanEditTools: true, scanBashCommands: true,
    scanMcpTools: true, scanWorkingTreeOnStop: true, blockGitCommitPush: true,
    allowIgnoredEnvFiles: true, entropyThreshold: 4.2,
    frontendPathGlobs: ['src/**/*.tsx', 'public/**'],
    allowedSecretFileGlobs: ['.env.local', '.env.*.local'],
    ...overrides,
  };
}

function makeFinding(): SecretFinding {
  return {
    ruleId: 'test', type: 'generic_high_entropy_secret', severity: 'high',
    confidence: 'high', redactedPreview: 'sk-li***qr', valueSha256: 'abc123',
  };
}

function createEngine(): SecretWritePolicyEngine {
  const classifier = new PathClassifier(
    ['src/**/*.tsx', 'public/**'],
    ['.env.local', '.env.*.local'],
  );
  return new SecretWritePolicyEngine(classifier);
}

describe('Security: gitignore bypass prevention', () => {
  it('MUST deny .env.local when isFileGitIgnored is false', () => {
    const engine = createEngine();
    const decision = engine.evaluate({
      findings: [makeFinding()],
      filePath: '/project/.env.local',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
      settings: makeSettings(),
      exceptions: [],
      isFileGitIgnored: false,
    });
    assert.equal(decision.action, 'deny',
      'SECURITY: .env.local that is NOT gitignored must be denied');
  });

  it('MUST deny .env.local when isFileGitIgnored is undefined (not checked)', () => {
    const engine = createEngine();
    const decision = engine.evaluate({
      findings: [makeFinding()],
      filePath: '/project/.env.local',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
      settings: makeSettings(),
      exceptions: [],
    });
    assert.equal(decision.action, 'deny',
      'SECURITY: .env.local without gitignore verification must be denied');
  });

  it('allows .env.local only when isFileGitIgnored is explicitly true', () => {
    const engine = createEngine();
    const decision = engine.evaluate({
      findings: [makeFinding()],
      filePath: '/project/.env.local',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
      settings: makeSettings(),
      exceptions: [],
      isFileGitIgnored: true,
    });
    assert.equal(decision.action, 'audit',
      'Gitignored .env.local should be audited, not denied');
  });

  it('MUST deny secrets in public/ even if gitignored', () => {
    const engine = createEngine();
    const decision = engine.evaluate({
      findings: [makeFinding()],
      filePath: '/project/public/config.js',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
      settings: makeSettings(),
      exceptions: [],
      isFileGitIgnored: true,
    });
    assert.equal(decision.action, 'deny',
      'SECURITY: Public directory must be denied regardless of gitignore');
  });

  it('exceptions cannot override public path hard deny', () => {
    const engine = createEngine();
    const future = new Date(Date.now() + 3600000).toISOString();
    const decision = engine.evaluate({
      findings: [makeFinding()],
      filePath: '/project/public/config.js',
      source: 'edit',
      provider: 'claude',
      cwd: '/project',
      settings: makeSettings(),
      exceptions: [{
        id: 'exc-1', createdAt: new Date().toISOString(), expiresAt: future,
        createdBy: 'user', ruleId: 'test', valueSha256: 'abc123',
        filePathGlob: '**/*', maxUses: 100, usedCount: 0, reason: 'Override attempt',
      }],
    });
    assert.equal(decision.action, 'deny',
      'SECURITY: No exception can override public path hard deny');
    assert.deepEqual(decision.consumedExceptionIds, []);
  });
});
