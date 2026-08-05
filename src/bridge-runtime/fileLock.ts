import * as fs from 'fs';
import * as path from 'path';

/**
 * Best-effort cross-process mutex via atomic directory creation.
 *
 * `fs.mkdirSync` is atomic on every platform: exactly one caller wins when the
 * directory does not yet exist. A lock whose mtime is older than `staleMs` is
 * treated as abandoned (the holder crashed) and reclaimed. If the lock cannot
 * be acquired within `timeoutMs`, the caller proceeds UNLOCKED rather than
 * failing the turn — the lock only protects a best-effort heuristic, so waiting
 * forever would be worse than a rare imperfect result.
 */
export interface HeldLock {
  release(): void;
}

export async function acquireLock(
  lockDir: string,
  opts: { timeoutMs?: number; staleMs?: number; pollMs?: number } = {},
): Promise<HeldLock> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const staleMs = opts.staleMs ?? 20 * 60 * 1000;
  const pollMs = opts.pollMs ?? 150;
  const deadline = Date.now() + timeoutMs;

  const noop: HeldLock = { release: () => undefined };
  const held: HeldLock = {
    release: () => {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        /* already released or reclaimed */
      }
    },
  };

  try {
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  } catch {
    /* parent may already exist */
  }

  for (;;) {
    try {
      fs.mkdirSync(lockDir); // throws if it already exists
      return held;
    } catch {
      // Someone holds it — reclaim if stale.
      try {
        const age = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (age > staleMs) {
          try {
            fs.rmdirSync(lockDir);
          } catch {
            /* raced with another reclaimer */
          }
          continue;
        }
      } catch {
        /* lock vanished between mkdir and stat — retry immediately */
        continue;
      }
      if (Date.now() >= deadline) {
        return noop;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
