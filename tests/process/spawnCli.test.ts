import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { spawnCli } from '../../src/extension/process/spawnCli';

const EDGE_CASE_ARGS = [
  'plain',
  'C:\\workspace with spaces\\repo',
  'service_tier="fast"',
  'instructions="Read the \\"Changed files\\" list"',
  'symbols & () % ! ^',
  'trailing-backslash\\',
];

function createArgvPrinter(): { dir: string; scriptPath: string; batchPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-spawn-cli-test-'));
  const scriptPath = path.join(dir, 'argv printer.js');
  const batchPath = path.join(dir, 'argv printer.cmd');
  fs.writeFileSync(scriptPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');

  const nodePath = process.execPath.replace(/%/g, '%%');
  fs.writeFileSync(batchPath, `@ECHO off\r\n"${nodePath}" "%~dp0argv printer.js" %*\r\n`);
  return { dir, scriptPath, batchPath };
}

function removeTestDirectory(dir: string): void {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(dir);
  const relative = path.relative(tempRoot, resolved);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Unsafe temp cleanup path: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function capture(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`argv printer exited with ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

test('spawnCli preserves argv for a concrete executable and a script path with spaces', async () => {
  const fixture = createArgvPrinter();
  try {
    const stdout = await capture(spawnCli(process.execPath, [fixture.scriptPath, ...EDGE_CASE_ARGS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    assert.deepEqual(JSON.parse(stdout), EDGE_CASE_ARGS);
  } finally {
    removeTestDirectory(fixture.dir);
  }
});

test('spawnCli preserves nested TOML quotes through a Windows .cmd shim', {
  skip: process.platform !== 'win32',
}, async () => {
  const fixture = createArgvPrinter();
  try {
    const stdout = await capture(spawnCli(fixture.batchPath, EDGE_CASE_ARGS, {
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    assert.deepEqual(JSON.parse(stdout), EDGE_CASE_ARGS);
  } finally {
    removeTestDirectory(fixture.dir);
  }
});
