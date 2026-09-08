import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  WHATS_NEW_RECEIPT_DIR_NAME,
  claimToastReceipt,
  toastReceiptPath,
} from '../../src/extension/whatsnew/toastReceipt';

function makeTempStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claui-whats-new-'));
}

function collectLogs() {
  const lines: string[] = [];
  return { lines, log: (message: string) => lines.push(message) };
}

test('toastReceiptPath: lives under <storage>/whats-new and sanitizes the version', () => {
  const file = toastReceiptPath('C:/store', '0.1.229');
  assert.equal(path.basename(path.dirname(file)), WHATS_NEW_RECEIPT_DIR_NAME);
  assert.equal(path.basename(file), 'toast-0.1.229.receipt');
  assert.equal(path.basename(toastReceiptPath('C:/store', '1.0.0/../x')), 'toast-1.0.0_.._x.receipt');
});

test('first claim wins, second claim for the same version loses, other versions are independent', async () => {
  const storage = makeTempStorage();
  const { lines, log } = collectLogs();
  try {
    assert.equal(await claimToastReceipt(storage, '0.1.229', log), true, 'first window claims');
    assert.equal(await claimToastReceipt(storage, '0.1.229', log), false, 'second window sees EEXIST');
    assert.equal(await claimToastReceipt(storage, '0.1.230', log), true, 'a new version is a new receipt');
    assert.ok(fs.existsSync(toastReceiptPath(storage, '0.1.229')));
    assert.deepEqual(lines, [], 'the happy path logs nothing');
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test('creates the receipt directory on a fresh installation', async () => {
  const storage = path.join(makeTempStorage(), 'not-yet-created', 'nested');
  const { log } = collectLogs();
  try {
    assert.equal(fs.existsSync(storage), false);
    assert.equal(await claimToastReceipt(storage, '0.1.229', log), true);
    assert.ok(fs.existsSync(path.join(storage, WHATS_NEW_RECEIPT_DIR_NAME)));
  } finally {
    fs.rmSync(path.dirname(path.dirname(storage)), { recursive: true, force: true });
  }
});

test('directory blocked by a file: fails open (shows the toast) and logs, instead of a false "already claimed"', async () => {
  const storage = makeTempStorage();
  const { lines, log } = collectLogs();
  try {
    // A stray FILE named `whats-new` makes mkdir fail with EEXIST/ENOTDIR;
    // that must not be mistaken for another window's receipt.
    fs.writeFileSync(path.join(storage, WHATS_NEW_RECEIPT_DIR_NAME), 'not a directory');
    assert.equal(await claimToastReceipt(storage, '0.1.229', log), true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /showing toast anyway/);
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test('concurrent claims from the same process resolve to exactly one winner', async () => {
  const storage = makeTempStorage();
  const { log } = collectLogs();
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimToastReceipt(storage, '0.1.229', log)),
    );
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
