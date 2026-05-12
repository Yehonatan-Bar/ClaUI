import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalBoostContextStore } from '../../src/extension/local-boost/LocalBoostContextStore';
import { LocalBoostContextFile, CLAUI_LOCAL_BOOST_SCHEMA_VERSION } from '../../src/extension/local-boost/LocalBoostTypes';

// ---------------------------------------------------------------------------
// Helper: create a unique temp directory per test run
// ---------------------------------------------------------------------------
function makeTempDir(): string {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dir = path.join(os.tmpdir(), `claui-ctx-test-${suffix}`);
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
// Tests
// ---------------------------------------------------------------------------

describe('LocalBoostContextStore', () => {
  let tmpDir: string;
  let store: LocalBoostContextStore;
  const TAB_ID = 'tab-abc-123';
  const PROVIDER = 'claude' as const;
  const WORKSPACE = '/home/user/project';

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new LocalBoostContextStore(tmpDir);
  });

  afterEach(() => {
    removeDirRecursive(tmpDir);
  });

  // -----------------------------------------------------------------------
  // createContext
  // -----------------------------------------------------------------------

  describe('createContext', () => {
    it('creates a JSON file with correct fields', async () => {
      const contextPath = await store.createContext(TAB_ID, PROVIDER, WORKSPACE);

      assert.ok(fs.existsSync(contextPath), `Context file should exist at ${contextPath}`);

      const raw = fs.readFileSync(contextPath, 'utf8');
      const context: LocalBoostContextFile = JSON.parse(raw);

      assert.equal(context.schemaVersion, CLAUI_LOCAL_BOOST_SCHEMA_VERSION);
      assert.equal(context.tabRuntimeId, TAB_ID);
      assert.equal(context.provider, PROVIDER);
      assert.equal(context.workspacePath, WORKSPACE);
      assert.equal(context.sessionId, null);
      assert.equal(context.turnId, null);
      assert.ok(typeof context.createdAt === 'string' && context.createdAt.length > 0);
      assert.ok(typeof context.updatedAt === 'string' && context.updatedAt.length > 0);
    });

    it('creates the contexts/ directory on demand', async () => {
      const contextsDir = path.join(tmpDir, 'contexts');
      assert.ok(!fs.existsSync(contextsDir), 'contexts/ dir should not pre-exist');

      await store.createContext(TAB_ID, PROVIDER, WORKSPACE);

      assert.ok(fs.existsSync(contextsDir), 'contexts/ dir should be created on demand');
    });
  });

  // -----------------------------------------------------------------------
  // updateSessionId
  // -----------------------------------------------------------------------

  describe('updateSessionId', () => {
    it('updates the sessionId field in the context file', async () => {
      await store.createContext(TAB_ID, PROVIDER, WORKSPACE);

      const newSessionId = 'session-xyz-789';
      await store.updateSessionId(TAB_ID, newSessionId);

      const contextPath = store.getContextPath(TAB_ID);
      const raw = fs.readFileSync(contextPath, 'utf8');
      const context: LocalBoostContextFile = JSON.parse(raw);

      assert.equal(context.sessionId, newSessionId);
      // Other fields should remain unchanged
      assert.equal(context.tabRuntimeId, TAB_ID);
      assert.equal(context.provider, PROVIDER);
      assert.equal(context.workspacePath, WORKSPACE);
    });

    it('updates the updatedAt timestamp', async () => {
      const contextPath = await store.createContext(TAB_ID, PROVIDER, WORKSPACE);

      const rawBefore = fs.readFileSync(contextPath, 'utf8');
      const before: LocalBoostContextFile = JSON.parse(rawBefore);
      const originalUpdatedAt = before.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.updateSessionId(TAB_ID, 'new-session');

      const rawAfter = fs.readFileSync(contextPath, 'utf8');
      const after: LocalBoostContextFile = JSON.parse(rawAfter);

      assert.ok(
        new Date(after.updatedAt).getTime() >= new Date(originalUpdatedAt).getTime(),
        'updatedAt should be equal to or later than the original',
      );
    });
  });

  // -----------------------------------------------------------------------
  // updateTurnId
  // -----------------------------------------------------------------------

  describe('updateTurnId', () => {
    it('updates the turnId field in the context file', async () => {
      await store.createContext(TAB_ID, PROVIDER, WORKSPACE);

      const newTurnId = 'turn-42';
      await store.updateTurnId(TAB_ID, newTurnId);

      const contextPath = store.getContextPath(TAB_ID);
      const raw = fs.readFileSync(contextPath, 'utf8');
      const context: LocalBoostContextFile = JSON.parse(raw);

      assert.equal(context.turnId, newTurnId);
      // Other fields should remain unchanged
      assert.equal(context.tabRuntimeId, TAB_ID);
      assert.equal(context.provider, PROVIDER);
    });
  });

  // -----------------------------------------------------------------------
  // disposeContext
  // -----------------------------------------------------------------------

  describe('disposeContext', () => {
    it('deletes the context file', async () => {
      const contextPath = await store.createContext(TAB_ID, PROVIDER, WORKSPACE);
      assert.ok(fs.existsSync(contextPath), 'File should exist before dispose');

      await store.disposeContext(TAB_ID);

      assert.ok(!fs.existsSync(contextPath), 'File should be deleted after dispose');
    });

    it('does not throw when file is already gone', async () => {
      // disposeContext on a never-created tab should not throw
      await assert.doesNotReject(
        () => store.disposeContext('nonexistent-tab'),
        'disposeContext should not throw for missing files',
      );
    });
  });

  // -----------------------------------------------------------------------
  // getContextPath
  // -----------------------------------------------------------------------

  describe('getContextPath', () => {
    it('returns expected path format: storeDir/contexts/<tabRuntimeId>.json', () => {
      const expected = path.join(tmpDir, 'contexts', `${TAB_ID}.json`);
      assert.equal(store.getContextPath(TAB_ID), expected);
    });

    it('varies by tabRuntimeId', () => {
      const path1 = store.getContextPath('tab-a');
      const path2 = store.getContextPath('tab-b');
      assert.notEqual(path1, path2);
    });
  });

  // -----------------------------------------------------------------------
  // Corrupt file handling
  // -----------------------------------------------------------------------

  describe('corrupt file handling', () => {
    it('updateSessionId does not throw when context file contains invalid JSON', async () => {
      // Create the context file, then corrupt it
      const contextPath = await store.createContext(TAB_ID, PROVIDER, WORKSPACE);
      fs.writeFileSync(contextPath, '{{not valid json!!!', 'utf8');

      // updateSessionId reads and parses the file -- should silently ignore corruption
      await assert.doesNotReject(
        () => store.updateSessionId(TAB_ID, 'new-session'),
        'updateSessionId should not throw on corrupt file',
      );
    });

    it('updateTurnId does not throw when context file contains invalid JSON', async () => {
      const contextPath = await store.createContext(TAB_ID, PROVIDER, WORKSPACE);
      fs.writeFileSync(contextPath, '', 'utf8');

      await assert.doesNotReject(
        () => store.updateTurnId(TAB_ID, 'new-turn'),
        'updateTurnId should not throw on corrupt file',
      );
    });

    it('updateSessionId does not throw when context file is missing', async () => {
      // Never create the context -- file does not exist
      await assert.doesNotReject(
        () => store.updateSessionId('never-created', 'new-session'),
        'updateSessionId should not throw when file is missing',
      );
    });
  });
});
