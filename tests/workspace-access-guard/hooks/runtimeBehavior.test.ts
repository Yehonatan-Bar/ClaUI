import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const claudeHookPath = path.resolve(__dirname, '..', '..', '..', 'dist', 'workspace-access-guard-runtime', 'hooks', 'claude-wag.js');
const codexHookPath = path.resolve(__dirname, '..', '..', '..', 'dist', 'workspace-access-guard-runtime', 'hooks', 'codex-wag.js');

interface RunHookOptions {
  hookPath?: string;
  eventName?: string;
  roots?: string[];
  runtimeSettings?: Record<string, unknown>;
}

function runHook(input: unknown, workspacePath: string, options: RunHookOptions = {}) {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wag-hook-'));
  const rootsPath = path.join(storeDir, 'user-allowed-roots.json');
  fs.writeFileSync(rootsPath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    roots: options.roots ?? ['C:\\projects'],
  }));

  if (options.runtimeSettings) {
    fs.writeFileSync(path.join(storeDir, 'runtime-enabled.json'), JSON.stringify({
      enabled: true,
      mode: 'block',
      userAllowedRoots: [],
      autoAllowWorkspaceFolders: true,
      orgPolicyPath: '',
      scanBashCommands: true,
      scanFileTools: true,
      scanMcpTools: true,
      blockOutsideAllowedRoots: true,
      blockDeniedRoots: true,
      warnOnBroadAllowedRoots: true,
      denyUnresolvedSymlinkTargets: true,
      denyUnknownFileAccessCommands: true,
      auditRetentionDays: 90,
      ...options.runtimeSettings,
    }));
  }

  const result = spawnSync(process.execPath, [
    options.hookPath ?? claudeHookPath,
    '--claui-workspace-access-guard-hook',
    options.eventName ?? 'PreToolUse',
  ], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUI_WORKSPACE_ACCESS_GUARD: '1',
      CLAUI_WORKSPACE_ACCESS_GUARD_MODE: 'block',
      CLAUI_WORKSPACE_ACCESS_GUARD_STORE_DIR: storeDir,
      CLAUI_WORKSPACE_ACCESS_GUARD_USER_ROOTS_PATH: rootsPath,
      CLAUI_WORKSPACE_ACCESS_GUARD_ORG_POLICY_PATH: '',
      CLAUI_WORKSPACE_ACCESS_GUARD_WORKSPACE_PATH: workspacePath,
      USERPROFILE: 'C:\\Users\\yoni.bar',
      APPDATA: 'C:\\Users\\yoni.bar\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\yoni.bar\\AppData\\Local',
    },
  });

  fs.rmSync(storeDir, { recursive: true, force: true });
  return result;
}

describe('Workspace Access Guard runtime hook behavior', () => {
  it('does not auto-allow cwd outside the workspace', { skip: !fs.existsSync(claudeHookPath) }, () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'cat .ssh/id_rsa',
        cwd: 'C:\\Users\\yoni.bar',
      },
    }, 'C:\\projects\\claude-code-mirror');

    assert.equal(result.status, 0);
    assert.match(result.stdout, /permissionDecision":"deny"/);
  });

  it('allows npm test in an allowed workspace', { skip: !fs.existsSync(claudeHookPath) }, () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test',
        cwd: 'C:\\projects\\claude-code-mirror',
      },
    }, 'C:\\projects\\claude-code-mirror');

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('honors runtime-enabled settings when WAG env is enabled', { skip: !fs.existsSync(claudeHookPath) }, () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'cat C:\\outside\\file.txt',
        cwd: 'C:\\projects\\claude-code-mirror',
      },
    }, 'C:\\projects\\claude-code-mirror', {
      runtimeSettings: {
        autoAllowWorkspaceFolders: false,
        blockOutsideAllowedRoots: false,
        userAllowedRoots: ['C:\\projects'],
      },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('denies direct file tools with no parseable path', { skip: !fs.existsSync(claudeHookPath) }, () => {
    const result = runHook({
      tool_name: 'Read',
      tool_input: {},
    }, 'C:\\projects\\claude-code-mirror');

    assert.equal(result.status, 0);
    assert.match(result.stdout, /permissionDecision":"deny"/);
    assert.match(result.stdout, /did not expose a path/);
  });

  it('uses the actual Codex hook event name in PermissionRequest deny output', { skip: !fs.existsSync(codexHookPath) }, () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: {
        command: 'custom-reader .',
        cwd: 'C:\\projects\\claude-code-mirror',
      },
    }, 'C:\\projects\\claude-code-mirror', {
      hookPath: codexHookPath,
      eventName: 'PermissionRequest',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"hookEventName":"PermissionRequest"/);
    assert.match(result.stdout, /permissionDecision":"deny"/);
  });
});
