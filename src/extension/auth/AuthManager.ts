import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Phase 5 stub: Reads credentials and manages account switching.
 */
export interface CredentialProfile {
  name: string;
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
}
