import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildLocalBoostAgentEnv } from '../../src/extension/local-boost/LocalBoostEnvBuilder';
import { LocalBoostEnvInput } from '../../src/extension/local-boost/LocalBoostTypes';
import * as path from 'path';
import * as os from 'os';

// Use a real directory for binDir so that node can be found in PATH
const realNodeDir = path.dirname(process.execPath);

function makeInput(overrides?: Partial<LocalBoostEnvInput>): LocalBoostEnvInput {
  return {
    baseEnv: { PATH: process.env.PATH ?? '', HOME: '/home/test', CUSTOM_VAR: 'preserved' },
    provider: 'claude',
    workspacePath: '/workspace/project',
    tabRuntimeId: 'tab-abc-123',
    sessionId: 'session-xyz',
    binDir: realNodeDir,
    storeDir: '/tmp/boost-store',
    contextFilePath: '/tmp/boost-context.json',
    ...overrides,
  };
}

describe('buildLocalBoostAgentEnv', () => {

  // ── Core env vars are set correctly ─────────────────────────────────────

  it('sets CLAUI_LOCAL_BOOST=1', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST, '1');
  });

  it('sets CLAUI_LOCAL_BOOST_VERSION', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST_VERSION, '1.0.0');
  });

  it('sets CLAUI_LOCAL_BOOST_PROVIDER from input', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ provider: 'codex' }));
    assert.equal(env.CLAUI_LOCAL_BOOST_PROVIDER, 'codex');
  });

  it('sets CLAUI_LOCAL_BOOST_WORKSPACE from input', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST_WORKSPACE, '/workspace/project');
  });

  it('sets CLAUI_LOCAL_BOOST_TAB_RUNTIME_ID from input', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST_TAB_RUNTIME_ID, 'tab-abc-123');
  });

  it('sets CLAUI_LOCAL_BOOST_STORE_DIR from input', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST_STORE_DIR, '/tmp/boost-store');
  });

  it('sets CLAUI_LOCAL_BOOST_CONTEXT_FILE from input', () => {
    const env = buildLocalBoostAgentEnv(makeInput());
    assert.equal(env.CLAUI_LOCAL_BOOST_CONTEXT_FILE, '/tmp/boost-context.json');
  });

  // ── PATH prepend ──────────────────────────────────────────────────────

  it('prepends binDir to PATH', () => {
    const input = makeInput();
    const env = buildLocalBoostAgentEnv(input);
    const pathSep = process.platform === 'win32' ? ';' : ':';
    assert.ok(
      env.PATH!.startsWith(realNodeDir + pathSep),
      `expected PATH to start with binDir, got "${env.PATH!.substring(0, 80)}..."`,
    );
  });

  it('preserves original PATH as CLAUI_LOCAL_BOOST_ORIGINAL_PATH', () => {
    const originalPath = process.env.PATH ?? '';
    const input = makeInput({ baseEnv: { PATH: originalPath } });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.CLAUI_LOCAL_BOOST_ORIGINAL_PATH, originalPath);
  });

  // ── Telemetry var removal ─────────────────────────────────────────────

  it('removes BOOST_* telemetry vars', () => {
    const input = makeInput({
      baseEnv: { PATH: process.env.PATH ?? '', BOOST_FOO: 'should-be-removed', BOOST_BAR: 'also-removed' },
    });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.BOOST_FOO, undefined, 'BOOST_FOO should be removed');
    assert.equal(env.BOOST_BAR, undefined, 'BOOST_BAR should be removed');
  });

  it('removes JFROG_* telemetry vars', () => {
    const input = makeInput({
      baseEnv: { PATH: process.env.PATH ?? '', JFROG_BAR: 'should-be-removed' },
    });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.JFROG_BAR, undefined, 'JFROG_BAR should be removed');
  });

  it('removes OTEL_EXPORTER_* telemetry vars', () => {
    const input = makeInput({
      baseEnv: { PATH: process.env.PATH ?? '', OTEL_EXPORTER_TRACE: 'val', OTEL_EXPORTER_OTLP_ENDPOINT: 'val' },
    });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.OTEL_EXPORTER_TRACE, undefined, 'OTEL_EXPORTER_TRACE should be removed');
    assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined, 'OTEL_EXPORTER_OTLP_ENDPOINT should be removed');
  });

  it('removes OTEL_TRACES_EXPORTER and OTEL_METRICS_EXPORTER', () => {
    const input = makeInput({
      baseEnv: { PATH: process.env.PATH ?? '', OTEL_TRACES_EXPORTER: 'jaeger', OTEL_METRICS_EXPORTER: 'prometheus' },
    });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.OTEL_TRACES_EXPORTER, undefined, 'OTEL_TRACES_EXPORTER should be removed');
    assert.equal(env.OTEL_METRICS_EXPORTER, undefined, 'OTEL_METRICS_EXPORTER should be removed');
  });

  // ── Optional vars when provided ───────────────────────────────────────

  it('sets CLAUI_LOCAL_BOOST_SESSION_ID when sessionId is provided', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ sessionId: 'my-session' }));
    assert.equal(env.CLAUI_LOCAL_BOOST_SESSION_ID, 'my-session');
  });

  it('sets CLAUI_LOCAL_BOOST_SHELL when shell is provided', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ shell: '/bin/zsh' }));
    assert.equal(env.CLAUI_LOCAL_BOOST_SHELL, '/bin/zsh');
  });

  it('sets CLAUI_LOCAL_BOOST_FILTER_PROFILE when filterProfile is provided', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ filterProfile: 'strict' }));
    assert.equal(env.CLAUI_LOCAL_BOOST_FILTER_PROFILE, 'strict');
  });

  it('sets CLAUI_LOCAL_BOOST_STORE_RAW_LOGS="true" when storeRawLogs is true', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ storeRawLogs: true }));
    assert.equal(env.CLAUI_LOCAL_BOOST_STORE_RAW_LOGS, 'true');
  });

  it('sets CLAUI_LOCAL_BOOST_STORE_RAW_LOGS="false" when storeRawLogs is false', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ storeRawLogs: false }));
    assert.equal(env.CLAUI_LOCAL_BOOST_STORE_RAW_LOGS, 'false');
  });

  // ── Optional vars absent when not provided ────────────────────────────

  it('does not set CLAUI_LOCAL_BOOST_SESSION_ID when sessionId is null', () => {
    const env = buildLocalBoostAgentEnv(makeInput({ sessionId: null }));
    assert.equal(env.CLAUI_LOCAL_BOOST_SESSION_ID, undefined);
  });

  it('does not set CLAUI_LOCAL_BOOST_SHELL when shell is omitted', () => {
    const input = makeInput();
    delete (input as any).shell;
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.CLAUI_LOCAL_BOOST_SHELL, undefined);
  });

  it('does not set CLAUI_LOCAL_BOOST_FILTER_PROFILE when filterProfile is omitted', () => {
    const input = makeInput();
    delete (input as any).filterProfile;
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.CLAUI_LOCAL_BOOST_FILTER_PROFILE, undefined);
  });

  it('does not set CLAUI_LOCAL_BOOST_STORE_RAW_LOGS when storeRawLogs is omitted', () => {
    const input = makeInput();
    delete (input as any).storeRawLogs;
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.CLAUI_LOCAL_BOOST_STORE_RAW_LOGS, undefined);
  });

  // ── Base env preservation ─────────────────────────────────────────────

  it('preserves non-telemetry base env vars', () => {
    const input = makeInput({
      baseEnv: { PATH: process.env.PATH ?? '', HOME: '/home/user', MY_APP_KEY: 'secret123' },
    });
    const env = buildLocalBoostAgentEnv(input);
    assert.equal(env.HOME, '/home/user');
    assert.equal(env.MY_APP_KEY, 'secret123');
  });

  it('does not mutate the original baseEnv object', () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', ORIGINAL: 'value' };
    const input = makeInput({ baseEnv });
    buildLocalBoostAgentEnv(input);
    // baseEnv should not have CLAUI vars injected into it
    assert.equal(baseEnv.CLAUI_LOCAL_BOOST, undefined, 'baseEnv should not be mutated');
  });

  // ── Node not found throws ─────────────────────────────────────────────

  it('throws when node is not in PATH', () => {
    const input = makeInput({
      baseEnv: { PATH: '/nonexistent/dir/only' },
      binDir: '/also/nonexistent',
    });
    assert.throws(
      () => buildLocalBoostAgentEnv(input),
      /Node\.js not found in PATH/,
    );
  });
});
