import { hashSecret, signJwt, timingSafeEqualStr, verifyJwt, verifySecret } from '../util/crypto';

export interface AdminAuthConfig {
  /** Admin username (from CLAUI_ADMIN_USER). */
  user?: string;
  /** Admin password in plaintext (from CLAUI_ADMIN_PASSWORD); hashed in-memory at construction. */
  password?: string;
  /** Secret used to sign session JWTs (from CLAUI_ADMIN_JWT_SECRET, or random per-process). */
  jwtSecret: string;
  /** Session lifetime in seconds (default 12h). */
  sessionTtlSec?: number;
  log?: (msg: string) => void;
}

/**
 * Admin authentication: verifies a single username/password defined at server
 * setup and issues/verifies short-lived HS256 session tokens. The password is
 * never stored in plaintext beyond the env var read; we keep only a salted
 * scrypt hash and compare in constant time.
 */
export class AdminAuth {
  private readonly user: string | null;
  private readonly passwordHash: string | null;
  private readonly jwtSecret: string;
  private readonly ttlSec: number;
  private readonly log: (msg: string) => void;

  constructor(config: AdminAuthConfig) {
    this.user = config.user && config.user.length > 0 ? config.user : null;
    this.passwordHash = config.password && config.password.length > 0 ? hashSecret(config.password) : null;
    this.jwtSecret = config.jwtSecret;
    this.ttlSec = config.sessionTtlSec ?? 12 * 60 * 60;
    this.log = config.log || console.log;

    if (!this.isConfigured()) {
      this.log('AdminAuth: WARNING - admin credentials not set (CLAUI_ADMIN_USER / CLAUI_ADMIN_PASSWORD). The admin dashboard will reject all logins until they are configured.');
    }
  }

  /** True when both a username and password were supplied at setup. */
  isConfigured(): boolean {
    return this.user !== null && this.passwordHash !== null;
  }

  /** Verify credentials; returns a session token on success, or null. Constant-time. */
  login(user: string, password: string): string | null {
    if (!this.isConfigured()) return null;
    const userOk = timingSafeEqualStr(user || '', this.user as string);
    const passOk = verifySecret(password || '', this.passwordHash as string);
    if (!userOk || !passOk) return null;
    return signJwt({ sub: this.user as string, role: 'admin' }, this.jwtSecret, this.ttlSec);
  }

  /** Validate a session token; returns true if it is a valid, unexpired admin token. */
  verify(token: string): boolean {
    if (!this.isConfigured()) return false;
    const payload = verifyJwt(token, this.jwtSecret);
    return !!payload && payload.role === 'admin';
  }
}
