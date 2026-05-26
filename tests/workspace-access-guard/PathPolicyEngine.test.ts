import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { evaluate } from '../../src/workspace-access-guard-runtime/PathPolicyEngine';
import { extractCommandPaths } from '../../src/workspace-access-guard-runtime/CommandPathExtractor';
import { DEFAULT_ORG_POLICY } from '../../src/workspace-access-guard-runtime/defaultOrgPolicy';
import type {
  WorkspaceAccessGuardSettings,
  WorkspaceAccessOrgPolicy,
  WorkspaceAccessPolicyInput,
} from '../../src/shared/workspace-access-guard/types';

const env = {
  USERPROFILE: 'C:\\Users\\yoni.bar',
  APPDATA: 'C:\\Users\\yoni.bar\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\yoni.bar\\AppData\\Local',
  HOME: 'C:\\Users\\yoni.bar',
};

const settings: WorkspaceAccessGuardSettings = {
  enabled: true,
  mode: 'block',
  userAllowedRoots: [],
  autoAllowWorkspaceFolders: true,
  orgPolicyPath: 'C:\\ProgramData\\ClaUi\\workspace-access-guard.policy.json',
  scanBashCommands: true,
  scanFileTools: true,
  scanMcpTools: true,
  blockOutsideAllowedRoots: true,
  blockDeniedRoots: true,
  warnOnBroadAllowedRoots: true,
  denyUnresolvedSymlinkTargets: true,
  denyUnknownFileAccessCommands: true,
  auditRetentionDays: 90,
};

function makeInput(overrides: Partial<WorkspaceAccessPolicyInput>): WorkspaceAccessPolicyInput {
  return {
    provider: 'claude',
    toolName: 'Read',
    operation: 'read',
    cwd: 'C:\\projects\\repo',
    extractedPaths: ['C:\\projects\\repo\\README.md'],
    userAllowedRoots: ['C:\\projects'],
    orgPolicy: DEFAULT_ORG_POLICY,
    settings,
    env,
    ...overrides,
  };
}

describe('Workspace Access Guard PathPolicyEngine', () => {
  it('denies built-in sensitive roots even when user profile is allowed', () => {
    const decision = evaluate(makeInput({
      extractedPaths: ['C:\\Users\\yoni.bar\\.ssh\\id_rsa'],
      userAllowedRoots: ['C:\\Users\\yoni.bar'],
    }));
    assert.equal(decision.action, 'deny');
    assert.equal(decision.matchedRuleId, 'ssh-dir');
  });

  it('denies file access when no allowed roots are configured', () => {
    const decision = evaluate(makeInput({
      extractedPaths: ['C:\\projects\\repo\\README.md'],
      userAllowedRoots: [],
    }));
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'No allowed working folders are configured');
  });

  it('denies direct file tools when no filesystem path can be parsed', () => {
    const decision = evaluate(makeInput({
      toolName: 'Read',
      operation: 'read',
      extractedPaths: [],
      userAllowedRoots: ['C:\\projects'],
    }));
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'File tool input did not include a parseable filesystem path');
  });

  it('does not let broad roots grant access', () => {
    const decision = evaluate(makeInput({
      extractedPaths: ['C:\\projects\\repo\\README.md'],
      userAllowedRoots: ['C:\\'],
    }));
    assert.equal(decision.action, 'deny');
  });

  it('supports wildcard denied roots', () => {
    const orgPolicy: WorkspaceAccessOrgPolicy = {
      ...DEFAULT_ORG_POLICY,
      deniedRoots: [
        {
          id: 'doc-secrets',
          description: 'Document secrets',
          path: 'C:\\Users\\*\\Documents\\Secrets\\**',
          enabled: true,
          severity: 'critical',
          category: 'custom',
        },
      ],
    };
    const decision = evaluate(makeInput({
      extractedPaths: ['C:\\Users\\yoni.bar\\Documents\\Secrets\\customer.txt'],
      userAllowedRoots: ['C:\\Users\\yoni.bar\\Documents'],
      orgPolicy,
    }));
    assert.equal(decision.action, 'deny');
    assert.equal(decision.matchedRuleId, 'doc-secrets');
  });

  it('allows npm test from an allowed workspace', () => {
    const cwd = 'C:\\projects\\claude-code-mirror';
    const extraction = extractCommandPaths('npm test', cwd);
    const decision = evaluate(makeInput({
      toolName: 'Bash',
      operation: 'bash',
      command: 'npm test',
      cwd,
      extractedPaths: extraction.cwdIsTarget ? [cwd] : extraction.paths,
      userAllowedRoots: ['C:\\projects'],
    }));
    assert.equal(decision.action, 'allow');
  });

  it('denies unknown file-access commands even inside an allowed workspace', () => {
    const cwd = 'C:\\projects\\claude-code-mirror';
    const decision = evaluate(makeInput({
      toolName: 'Bash',
      operation: 'unknown',
      command: 'custom-reader .',
      cwd,
      extractedPaths: [cwd],
      userAllowedRoots: ['C:\\projects'],
    }));
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'File-access command could not be safely parsed');
  });
});
