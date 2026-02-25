import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

/**
 * Phase 5 stub: Reads credentials and manages account switching.
 */
export interface CredentialProfile {
  name: string;
  subscriptionType: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  email: string;
  subscriptionType: string;
}

export class AuthManager {
  private readonly credentialsPath: string;

  constructor() {
    this.credentialsPath = path.join(
      os.homedir(),
      '.claude',
      '.credentials.json'
    );
  }

  /** Check if credentials file exists */
  get hasCredentials(): boolean {
    return fs.existsSync(this.credentialsPath);
  }

  /** List available credential profiles (Phase 5 implementation pending) */
  async listProfiles(): Promise<CredentialProfile[]> {
    // Phase 5: Parse .credentials.json and return profiles
    return [];
  }

  /** Switch to a different account (Phase 5 implementation pending) */
  async switchAccount(_profileName: string): Promise<void> {
    // Phase 5: Switch active credentials
  }

  async getAuthStatus(cliPath: string): Promise<AuthStatus> {
    try {
      const stdout = await this.execClaudeAuthCommand(cliPath, ['auth', 'status', '--json']);
      const parsed = JSON.parse(stdout) as unknown;
      return this.parseAuthStatus(parsed);
    } catch {
      return { loggedIn: false, email: '', subscriptionType: '' };
    }
  }

  async logout(cliPath: string): Promise<boolean> {
    try {
      await this.execClaudeAuthCommand(cliPath, ['auth', 'logout']);
      return true;
    } catch {
      return false;
    }
  }

  private execClaudeAuthCommand(cliPath: string, args: string[]): Promise<string> {
    const command = (cliPath || 'claude').trim() || 'claude';
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          timeout: 10_000,
          windowsHide: true,
          shell: process.platform === 'win32',
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve((stdout ?? '').trim());
        }
      );
    });
  }

  private parseAuthStatus(value: unknown): AuthStatus {
    const fallback: AuthStatus = { loggedIn: false, email: '', subscriptionType: '' };
    if (!value || typeof value !== 'object') return fallback;

    const obj = value as Record<string, unknown>;
    const account = this.asRecord(obj.account);
    const user = this.asRecord(obj.user);

    const email =
      this.asString(obj.email) ||
      this.asString(account?.email) ||
      this.asString(user?.email) ||
      '';

    const subscriptionType =
      this.asString(obj.subscriptionType) ||
      this.asString(obj.subscription_type) ||
      this.asString(obj.plan) ||
      this.asString(account?.subscriptionType) ||
      this.asString(account?.subscription_type) ||
      '';

    const loggedIn =
      this.asBoolean(obj.loggedIn) ??
      this.asBoolean(obj.logged_in) ??
      this.asBoolean(obj.authenticated) ??
      (typeof obj.status === 'string'
        ? ['authenticated', 'logged_in', 'logged-in', 'ok'].includes(obj.status.toLowerCase())
        : undefined) ??
      !!email;

    return { loggedIn, email, subscriptionType };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }
}
