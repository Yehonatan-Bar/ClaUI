/**
 * At-most-once "What's New" toast across VS Code windows.
 *
 * globalState has no compare-and-set, so the claim is an exclusive file create
 * (`wx`) inside the per-user global storage directory. Pure Node (no `vscode`
 * import) so it is covered by tests/unit/whatsNewReceipt.test.ts with a temp dir.
 *
 * Semantics:
 *   - true  = this window claimed the receipt and may show the toast
 *   - false = the receipt already exists (another window showed the toast)
 *   - any other failure (directory cannot be created, open fails for a reason
 *     other than EEXIST) logs and returns true: best effort beats silence.
 */
import * as fs from 'fs';
import * as path from 'path';

export const WHATS_NEW_RECEIPT_DIR_NAME = 'whats-new';

export function toastReceiptPath(globalStorageDir: string, version: string): string {
  const safeVersion = version.replace(/[^0-9A-Za-z.-]/g, '_');
  return path.join(globalStorageDir, WHATS_NEW_RECEIPT_DIR_NAME, `toast-${safeVersion}.receipt`);
}

export async function claimToastReceipt(
  globalStorageDir: string,
  version: string,
  log: (message: string) => void,
): Promise<boolean> {
  const file = toastReceiptPath(globalStorageDir, version);
  const dir = path.dirname(file);

  // Directory creation failures are NOT a claim by another window (for example
  // `whats-new` unexpectedly being a file yields EEXIST here too), so handle
  // them separately and fail open.
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    log(`[WhatsNew] Receipt directory unavailable (${describeError(err)}); showing toast anyway`);
    return true;
  }

  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(file, 'wx');
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      return false;
    }
    log(`[WhatsNew] Receipt file unavailable (${describeError(err)}); showing toast anyway`);
    return true;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (err) {
        log(`[WhatsNew] Receipt handle close failed: ${describeError(err)}`);
      }
    }
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
