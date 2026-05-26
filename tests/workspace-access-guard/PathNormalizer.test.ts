import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizePath, isPathInsideRoot } from '../../src/workspace-access-guard-runtime/PathNormalizer';

const env = {
  USERPROFILE: 'C:\\Users\\yoni.bar',
  APPDATA: 'C:\\Users\\yoni.bar\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\yoni.bar\\AppData\\Local',
  HOME: 'C:\\Users\\yoni.bar',
};

describe('Workspace Access Guard PathNormalizer', () => {
  it('normalizes Git Bash drive paths', () => {
    const result = normalizePath('/c/Users/yoni.bar/.ssh/id_rsa', 'C:\\projects\\repo', env);
    assert.equal(result.absolutePath.toLowerCase(), 'c:\\users\\yoni.bar\\.ssh\\id_rsa');
  });

  it('normalizes WSL drive paths', () => {
    const result = normalizePath('/mnt/c/Users/yoni.bar/.aws/credentials', 'C:\\projects\\repo', env);
    assert.equal(result.absolutePath.toLowerCase(), 'c:\\users\\yoni.bar\\.aws\\credentials');
  });

  it('expands Windows environment variables', () => {
    const result = normalizePath('%USERPROFILE%\\.ssh\\id_rsa', 'C:\\projects\\repo', env);
    assert.equal(result.absolutePath.toLowerCase(), 'c:\\users\\yoni.bar\\.ssh\\id_rsa');
  });

  it('uses segment-aware containment instead of prefix matching', () => {
    assert.equal(isPathInsideRoot('C:\\projects\\app', 'C:\\projects'), true);
    assert.equal(isPathInsideRoot('C:\\projects2\\secret.txt', 'C:\\projects'), false);
  });
});
