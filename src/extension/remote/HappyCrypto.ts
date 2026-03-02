/**
 * E2E encryption module for Happy Coder protocol.
 * - Ed25519 keypair from seed (tweetnacl) stored in VS Code SecretStorage
 * - Challenge signing for auth
 * - AES-256-GCM encrypt/decrypt (Node.js built-in crypto)
 * - Session key generation
 */

import * as crypto from 'crypto';
import type * as vscode from 'vscode';

// tweetnacl is loaded lazily to avoid hard failure if not installed
let nacl: typeof import('tweetnacl') | null = null;
function getNacl(): typeof import('tweetnacl') {
  if (!nacl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nacl = require('tweetnacl') as typeof import('tweetnacl');
  }
  return nacl;
}

const SECRET_KEY_NAME = 'claui.remote.ed25519Seed';

export class HappyCrypto {
  private seed: Uint8Array | null = null;
  private keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;
  private sessionKey: Buffer | null = null;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  // -----------------------------------------------------------------------
  // Key management
  // -----------------------------------------------------------------------

  /** Initialize or restore the ed25519 keypair from SecretStorage */
  async init(): Promise<void> {
    const stored = await this.secrets.get(SECRET_KEY_NAME);
    if (stored) {
      this.seed = Buffer.from(stored, 'hex');
    } else {
      this.seed = crypto.randomBytes(32);
      await this.secrets.store(SECRET_KEY_NAME, Buffer.from(this.seed).toString('hex'));
    }
    const tw = getNacl();
    this.keyPair = tw.sign.keyPair.fromSeed(this.seed);
  }

  /** Get the public key as hex string (for auth requests) */
  getPublicKeyHex(): string {
    if (!this.keyPair) { throw new Error('HappyCrypto not initialized'); }
    return Buffer.from(this.keyPair.publicKey).toString('hex');
  }

  // -----------------------------------------------------------------------
  // Auth: challenge signing
  // -----------------------------------------------------------------------

  /** Sign a challenge string and return the signature as hex */
  signChallenge(challenge: string): string {
    if (!this.keyPair) { throw new Error('HappyCrypto not initialized'); }
    const tw = getNacl();
    const message = new TextEncoder().encode(challenge);
    const signature = tw.sign.detached(message, this.keyPair.secretKey);
    return Buffer.from(signature).toString('hex');
  }

  // -----------------------------------------------------------------------
  // AES-256-GCM session encryption
  // -----------------------------------------------------------------------

  /** Generate a random AES-256 session key */
  generateSessionKey(): void {
    this.sessionKey = crypto.randomBytes(32);
  }

  /** Get the current session key (for wrapping/exchange) */
  getSessionKey(): Buffer | null {
    return this.sessionKey;
  }

  /** Set a session key received from the server */
  setSessionKey(key: Buffer): void {
    this.sessionKey = key;
  }

  /** Encrypt a string with AES-256-GCM using the session key */
  encrypt(plaintext: string): string {
    if (!this.sessionKey) { throw new Error('No session key'); }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv:tag:ciphertext (all base64)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /** Decrypt an AES-256-GCM ciphertext string */
  decrypt(payload: string): string {
    if (!this.sessionKey) { throw new Error('No session key'); }
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) { throw new Error('Invalid encrypted payload format'); }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.sessionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  }

  /** Dispose secrets from memory */
  dispose(): void {
    this.seed = null;
    this.keyPair = null;
    this.sessionKey = null;
  }
}
