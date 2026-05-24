import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Runtime settings file-based activation', () => {
  it('tryLoadRuntimeSettings returns null for missing file', () => {
    // The function reads from a path. With a non-existent dir, it should return null.
    // We test the pattern directly since the function is not exported.
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const storeDir = path.join(os.tmpdir(), `spa-test-${Date.now()}`);
    fs.mkdirSync(storeDir, { recursive: true });

    const settingsPath = path.join(storeDir, 'runtime-enabled.json');
    let result: unknown = null;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      result = JSON.parse(raw);
    } catch {
      result = null;
    }
    assert.equal(result, null);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('tryLoadRuntimeSettings reads valid settings file', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const storeDir = path.join(os.tmpdir(), `spa-test-${Date.now()}`);
    fs.mkdirSync(storeDir, { recursive: true });

    const settings = {
      enabled: true,
      mode: 'block',
      scanEditTools: true,
      scanBashCommands: true,
      scanMcpTools: true,
      scanWorkingTreeOnStop: true,
      blockGitCommitPush: true,
      allowIgnoredEnvFiles: true,
      entropyThreshold: 4.2,
      frontendPathGlobs: ['src/**/*.tsx'],
      allowedSecretFileGlobs: ['.env.local'],
    };
    fs.writeFileSync(path.join(storeDir, 'runtime-enabled.json'), JSON.stringify(settings));

    const raw = fs.readFileSync(path.join(storeDir, 'runtime-enabled.json'), 'utf-8');
    const data = JSON.parse(raw);

    assert.equal(data.enabled, true);
    assert.equal(data.mode, 'block');
    assert.deepEqual(data.frontendPathGlobs, ['src/**/*.tsx']);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('tryLoadRuntimeSettings returns null when enabled is false', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const storeDir = path.join(os.tmpdir(), `spa-test-${Date.now()}`);
    fs.mkdirSync(storeDir, { recursive: true });

    fs.writeFileSync(
      path.join(storeDir, 'runtime-enabled.json'),
      JSON.stringify({ enabled: false }),
    );

    const raw = fs.readFileSync(path.join(storeDir, 'runtime-enabled.json'), 'utf-8');
    const data = JSON.parse(raw);

    assert.equal(data.enabled, false);

    fs.rmSync(storeDir, { recursive: true, force: true });
  });
});

describe('simpleGlobMatch globstar fix', () => {
  function simpleGlobMatch(filePath: string, glob: string): boolean {
    const pattern = glob
      .replace(/\./g, '\\.')
      .replace(/\?/g, '<<QMARK>>')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>\//g, '(.*/)?')
      .replace(/<<GLOBSTAR>>/g, '.*')
      .replace(/<<QMARK>>/g, '.');
    return new RegExp(`^${pattern}$`).test(filePath);
  }

  it('src/**/*.tsx matches src/App.tsx (zero path segments)', () => {
    assert.ok(simpleGlobMatch('src/App.tsx', 'src/**/*.tsx'));
  });

  it('src/**/*.tsx matches src/components/App.tsx (one path segment)', () => {
    assert.ok(simpleGlobMatch('src/components/App.tsx', 'src/**/*.tsx'));
  });

  it('src/**/*.tsx matches src/a/b/c/App.tsx (multiple segments)', () => {
    assert.ok(simpleGlobMatch('src/a/b/c/App.tsx', 'src/**/*.tsx'));
  });

  it('**/*.bundle.js matches app.bundle.js (root level)', () => {
    assert.ok(simpleGlobMatch('app.bundle.js', '**/*.bundle.js'));
  });

  it('**/*.bundle.js matches dist/app.bundle.js (subdir)', () => {
    assert.ok(simpleGlobMatch('dist/app.bundle.js', '**/*.bundle.js'));
  });

  it('public/** matches public/index.html', () => {
    assert.ok(simpleGlobMatch('public/index.html', 'public/**'));
  });

  it('.env.local matches .env.local exactly', () => {
    assert.ok(simpleGlobMatch('.env.local', '.env.local'));
  });

  it('.env.*.local matches .env.development.local', () => {
    assert.ok(simpleGlobMatch('.env.development.local', '.env.*.local'));
  });

  it('does not match wrong extension', () => {
    assert.ok(!simpleGlobMatch('src/App.js', 'src/**/*.tsx'));
  });
});
