import * as crypto from 'crypto';

/**
 * Self-contained crypto helpers (no external deps): random tokens, salted scrypt
 * hashing with constant-time verification, and a minimal HS256 JWT. Used by both
 * the developer-token authentication and the admin login.
 */

/** Cryptographically-random URL-safe token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Salted scrypt hash of a secret; returns "salt:hash" (both base64url). */
export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(secret, salt, 32);
  return `${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

/** Constant-time verify of a secret against a "salt:hash" string. */
export function verifySecret(secret: string, stored: string): boolean {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[0], 'base64url');
    expected = Buffer.from(parts[1], 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(secret, salt, expected.length);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/** Constant-time string comparison. Differing lengths return false. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ab.length !== bb.length) {
    // Touch the buffer so we still spend comparable time; result is still false.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// --- Minimal HS256 JWT ---

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Sign a payload as an HS256 JWT with `iat`/`exp` claims. */
export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: nowSec, exp: nowSec + expiresInSec };
  const data = `${b64urlJson(header)}.${b64urlJson(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Verify an HS256 JWT signature + expiry. Returns the payload, or null if invalid. */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(parts[2]);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const exp = body.exp;
  if (typeof exp === 'number' && Math.floor(Date.now() / 1000) >= exp) return null;
  return body;
}
