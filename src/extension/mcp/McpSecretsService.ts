import * as vscode from 'vscode';
import type { McpScope } from '../types/webview-messages';

interface McpSecretIndexEntry {
  scope: McpScope;
  serverName: string;
  variable: string;
  storageKey: string;
}

const MCP_SECRET_INDEX_KEY = 'claudeMirror.mcp.secretIndex';

export class McpSecretsService {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async storeSecretValues(serverName: string, scope: McpScope, values: Record<string, string>): Promise<void> {
    if (Object.keys(values).length === 0) {
      return;
    }

    const index = await this.readIndex();
    for (const [variable, rawValue] of Object.entries(values)) {
      const value = rawValue.trim();
      if (!value) {
        continue;
      }
      const storageKey = this.buildStorageKey(scope, serverName, variable);
      await this.secrets.store(storageKey, value);
      this.upsertIndex(index, { scope, serverName, variable, storageKey });
    }
    await this.writeIndex(index);
  }

  async deleteServerSecrets(serverName: string, scope: McpScope): Promise<void> {
    const index = await this.readIndex();
    const remaining: McpSecretIndexEntry[] = [];

    for (const entry of index) {
      if (entry.serverName === serverName && entry.scope === scope) {
        await this.secrets.delete(entry.storageKey);
      } else {
        remaining.push(entry);
      }
    }

    await this.writeIndex(remaining);
  }

  async getInjectedEnv(): Promise<Record<string, string>> {
    const index = await this.readIndex();
    const env: Record<string, string> = {};

    for (const entry of index) {
      const value = await this.secrets.get(entry.storageKey);
      if (value) {
        env[entry.variable] = value;
      }
    }

    return env;
  }

  private buildStorageKey(scope: McpScope, serverName: string, variable: string): string {
    const normalizedServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const normalizedVar = variable.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    return `claudeMirror.mcp.${scope}.${normalizedServer}.${normalizedVar}`;
  }

  private async readIndex(): Promise<McpSecretIndexEntry[]> {
    const raw = await this.secrets.get(MCP_SECRET_INDEX_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(this.isIndexEntry);
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: McpSecretIndexEntry[]): Promise<void> {
    await this.secrets.store(MCP_SECRET_INDEX_KEY, JSON.stringify(entries));
  }

  private upsertIndex(entries: McpSecretIndexEntry[], next: McpSecretIndexEntry): void {
    const existingIndex = entries.findIndex(
      (entry) => entry.serverName === next.serverName && entry.scope === next.scope && entry.variable === next.variable
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = next;
      return;
    }
    entries.push(next);
  }

  private isIndexEntry(value: unknown): value is McpSecretIndexEntry {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const entry = value as Record<string, unknown>;
    return (
      typeof entry.scope === 'string' &&
      typeof entry.serverName === 'string' &&
      typeof entry.variable === 'string' &&
      typeof entry.storageKey === 'string'
    );
  }
}
