import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { CommandTraceWriter } from '../../src/particle-accelerator-runtime/CommandTraceWriter';
import { ParticleAcceleratorTrace, CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION } from '../../src/extension/particle-accelerator/ParticleAcceleratorTypes';

// ---------------------------------------------------------------------------
// Helper: create a temp directory that is unique per test run
// ---------------------------------------------------------------------------
function makeTempDir(): string {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dir = path.join(os.tmpdir(), `claui-ctw-test-${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeDirRecursive(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Helper: build a minimal valid ParticleAcceleratorTrace object
// ---------------------------------------------------------------------------
function buildTrace(overrides: Partial<ParticleAcceleratorTrace> = {}): ParticleAcceleratorTrace {
  return {
    schemaVersion: CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION,
    traceId: `test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    provider: 'claude',
    tabRuntimeId: 'tab-1',
    sessionId: null,
    turnId: null,
    workspacePath: '/workspace',
    command: { original: 'npm test', family: 'npm', encoded: 'npm test' },
    execution: { exitCode: 0, signal: null, interrupted: false, durationMs: 120, shell: '/bin/bash' },
    output: {
      rawStdoutBytes: 500,
      rawStderrBytes: 0,
      filteredStdoutBytes: 200,
      filteredStderrBytes: 0,
      estimatedTokensSaved: 75,
      compressionRatio: 0.4,
    },
    filter: { name: 'GenericFilter', version: '1.0.0', profile: 'balanced', fallbackUsed: false },
    redaction: { replacements: 0, rulesTriggered: [] },
    storage: { stdoutLogPath: null, stderrLogPath: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandTraceWriter', () => {
  let tmpDir: string;
  let writer: CommandTraceWriter;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writer = new CommandTraceWriter(tmpDir);
  });

  afterEach(() => {
    removeDirRecursive(tmpDir);
  });

  // -----------------------------------------------------------------------
  // writeTrace
  // -----------------------------------------------------------------------

  describe('writeTrace', () => {
    it('creates a valid JSON file in traces/YYYY-MM-DD/', async () => {
      const trace = buildTrace();
      await writer.writeTrace(trace);

      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedDir = path.join(tmpDir, 'traces', todayStr);
      const expectedFile = path.join(expectedDir, `${trace.traceId}.json`);

      // File should exist
      assert.ok(fs.existsSync(expectedFile), `Trace file not found at ${expectedFile}`);

      // File content should parse to the same trace
      const content = fs.readFileSync(expectedFile, 'utf8');
      const parsed = JSON.parse(content) as ParticleAcceleratorTrace;
      assert.equal(parsed.traceId, trace.traceId);
      assert.equal(parsed.provider, trace.provider);
      assert.equal(parsed.command.original, trace.command.original);
      assert.equal(parsed.schemaVersion, CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION);
    });

    it('creates the date directory on demand', async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedDir = path.join(tmpDir, 'traces', todayStr);

      // Directory should NOT exist before the call
      assert.ok(!fs.existsSync(expectedDir), 'Directory should not exist before writeTrace');

      await writer.writeTrace(buildTrace());

      // Directory should now exist
      assert.ok(fs.existsSync(expectedDir), 'Directory should be created by writeTrace');
    });

    it('uses atomic writes (tmp + rename)', async () => {
      const trace = buildTrace();
      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, 'traces', todayStr, `${trace.traceId}.json`);
      const tmpFile = expectedFile + '.tmp';

      await writer.writeTrace(trace);

      // After completion, the .tmp file should NOT remain
      assert.ok(!fs.existsSync(tmpFile), '.tmp file should be removed after rename');
      // The final file should exist
      assert.ok(fs.existsSync(expectedFile), 'Final JSON file should exist');
    });
  });

  // -----------------------------------------------------------------------
  // writeRawLog
  // -----------------------------------------------------------------------

  describe('writeRawLog', () => {
    it('creates stdout log files in raw/YYYY-MM-DD/', async () => {
      const traceId = 'raw-test-stdout';
      const content = 'Line 1\nLine 2\nLine 3';

      await writer.writeRawLog(traceId, 'stdout', content);

      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, 'raw', todayStr, `${traceId}.stdout.log`);

      assert.ok(fs.existsSync(expectedFile), `Raw stdout log not found at ${expectedFile}`);
      assert.equal(fs.readFileSync(expectedFile, 'utf8'), content);
    });

    it('creates stderr log files in raw/YYYY-MM-DD/', async () => {
      const traceId = 'raw-test-stderr';
      const content = 'Error: something failed';

      await writer.writeRawLog(traceId, 'stderr', content);

      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, 'raw', todayStr, `${traceId}.stderr.log`);

      assert.ok(fs.existsSync(expectedFile), `Raw stderr log not found at ${expectedFile}`);
      assert.equal(fs.readFileSync(expectedFile, 'utf8'), content);
    });

    it('creates the raw date directory on demand', async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedDir = path.join(tmpDir, 'raw', todayStr);

      assert.ok(!fs.existsSync(expectedDir), 'raw dir should not pre-exist');

      await writer.writeRawLog('dir-test', 'stdout', 'hello');

      assert.ok(fs.existsSync(expectedDir), 'raw dir should be created on demand');
    });

    it('uses atomic writes (tmp + rename) for raw logs', async () => {
      const traceId = 'atomic-raw';
      const todayStr = new Date().toISOString().slice(0, 10);
      const expectedFile = path.join(tmpDir, 'raw', todayStr, `${traceId}.stdout.log`);
      const tmpFile = expectedFile + '.tmp';

      await writer.writeRawLog(traceId, 'stdout', 'data');

      assert.ok(!fs.existsSync(tmpFile), '.tmp file should be removed after rename');
      assert.ok(fs.existsSync(expectedFile), 'Final log file should exist');
    });
  });

  // -----------------------------------------------------------------------
  // generateTraceId (static)
  // -----------------------------------------------------------------------

  describe('generateTraceId', () => {
    it('returns a string matching timestamp-hex pattern', () => {
      const id = CommandTraceWriter.generateTraceId();
      // Format: <epoch>-<8 hex chars>
      assert.match(id, /^\d+-[0-9a-f]{8}$/);
    });

    it('produces unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => CommandTraceWriter.generateTraceId()));
      assert.equal(ids.size, 20, 'All generated IDs should be unique');
    });
  });
});
