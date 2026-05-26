import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractCommandPaths } from '../../src/workspace-access-guard-runtime/CommandPathExtractor';

describe('Workspace Access Guard CommandPathExtractor', () => {
  it('classifies recursive searches and extracts explicit targets', () => {
    const result = extractCommandPaths('grep -r "password" /c/Users/yoni.bar', 'C:\\projects\\repo');
    assert.equal(result.accessKind, 'recursive-file-read');
    assert.deepEqual(result.paths, ['/c/Users/yoni.bar']);
  });

  it('treats npm test as build/test with cwd target', () => {
    const result = extractCommandPaths('npm test', 'C:\\projects\\repo');
    assert.equal(result.accessKind, 'build-or-test');
    assert.equal(result.cwdIsTarget, true);
  });

  it('classifies unknown commands with path args as unknown file access', () => {
    const result = extractCommandPaths('custom-reader C:\\Users\\yoni.bar\\.ssh\\id_rsa', 'C:\\projects\\repo');
    assert.equal(result.accessKind, 'unknown-file-access');
    assert.deepEqual(result.paths, ['C:\\Users\\yoni.bar\\.ssh\\id_rsa']);
  });
});
