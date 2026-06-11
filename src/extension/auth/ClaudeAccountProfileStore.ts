import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export interface ClaudeAccountProfile {
  id: string;
  label: string;
  configDir: string;
  isDefault?: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

const STORAGE_KEY = 'claudeMirror.claudeAccountProfiles';
const CURRENT_PROFILE_KEY = 'claudeMirror.currentClaudeAccountProfileId';
export const DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID = 'default';

type StoredProfile = Omit<ClaudeAccountProfile, 'isDefault'> & {
  isDefault?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'profile';
  return `${slug}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export class ClaudeAccountProfileStore {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly globalStorageUri: vscode.Uri,
  ) {}

  getDefaultProfile(): ClaudeAccountProfile {
    return {
      id: DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID,
      label: 'Default',
      configDir: '',
      isDefault: true,
      createdAt: '1970-01-01T00:00:00.000Z',
    };
  }

  list(): ClaudeAccountProfile[] {
    const seen = new Set<string>([DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID]);
    const profiles = this.getStoredProfiles()
      .filter((profile) => {
        if (!profile.id || seen.has(profile.id)) {
          return false;
        }
        seen.add(profile.id);
        return true;
      })
      .map((profile) => ({ ...profile, isDefault: false }));
    return [this.getDefaultProfile(), ...profiles];
  }

  getProfile(id?: string | null): ClaudeAccountProfile | undefined {
    if (!id || id === DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID) {
      return this.getDefaultProfile();
    }
    return this.list().find((profile) => profile.id === id);
  }

  getCurrentProfile(): ClaudeAccountProfile {
    const id = this.globalState.get<string>(CURRENT_PROFILE_KEY, DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID);
    return this.getProfile(id) ?? this.getDefaultProfile();
  }

  async setCurrentProfileId(id: string): Promise<ClaudeAccountProfile> {
    const profile = this.getProfile(id);
    if (!profile) {
      throw new Error(`Claude account profile not found: ${id}`);
    }
    await this.globalState.update(CURRENT_PROFILE_KEY, profile.id);
    return profile;
  }

  async create(label: string, configDir?: string): Promise<ClaudeAccountProfile> {
    const trimmed = label.trim();
    if (!trimmed) {
      throw new Error('Profile name is required.');
    }

    const id = makeId(trimmed);
    const profile: ClaudeAccountProfile = {
      id,
      label: trimmed,
      configDir: configDir?.trim() || this.defaultConfigDirForId(id),
      createdAt: nowIso(),
    };

    const stored = this.getStoredProfiles();
    stored.push(profile);
    await this.globalState.update(STORAGE_KEY, stored);
    this.ensureDirectoryExists(profile);
    return profile;
  }

  async rename(id: string, label: string): Promise<ClaudeAccountProfile> {
    if (id === DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID) {
      throw new Error('The Default Claude account profile cannot be renamed.');
    }
    const trimmed = label.trim();
    if (!trimmed) {
      throw new Error('Profile name is required.');
    }

    const stored = this.getStoredProfiles();
    const index = stored.findIndex((profile) => profile.id === id);
    if (index < 0) {
      throw new Error(`Claude account profile not found: ${id}`);
    }

    stored[index] = { ...stored[index], label: trimmed };
    await this.globalState.update(STORAGE_KEY, stored);
    return stored[index];
  }

  async delete(id: string): Promise<void> {
    if (id === DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID) {
      throw new Error('The Default Claude account profile cannot be deleted.');
    }

    const stored = this.getStoredProfiles();
    const next = stored.filter((profile) => profile.id !== id);
    if (next.length === stored.length) {
      throw new Error(`Claude account profile not found: ${id}`);
    }

    await this.globalState.update(STORAGE_KEY, next);
    const currentId = this.globalState.get<string>(CURRENT_PROFILE_KEY, DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID);
    if (currentId === id) {
      await this.globalState.update(CURRENT_PROFILE_KEY, DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID);
    }
  }

  async markUsed(id?: string | null): Promise<void> {
    const profile = this.getProfile(id);
    if (!profile || profile.isDefault) {
      return;
    }
    const stored = this.getStoredProfiles();
    const index = stored.findIndex((item) => item.id === profile.id);
    if (index < 0) {
      return;
    }
    stored[index] = { ...stored[index], lastUsedAt: nowIso() };
    await this.globalState.update(STORAGE_KEY, stored);
  }

  resolveConfigDir(profileOrId?: ClaudeAccountProfile | string | null): string | undefined {
    const profile = typeof profileOrId === 'string'
      ? this.getProfile(profileOrId)
      : profileOrId;
    if (!profile || profile.isDefault || profile.id === DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID) {
      return undefined;
    }
    const configDir = profile.configDir.trim();
    if (!configDir) {
      return undefined;
    }
    this.ensureDirectoryExists(profile);
    return configDir;
  }

  ensureDirectoryExists(profileOrId?: ClaudeAccountProfile | string | null): string | undefined {
    const profile = typeof profileOrId === 'string'
      ? this.getProfile(profileOrId)
      : profileOrId;
    if (!profile || profile.isDefault || !profile.configDir.trim()) {
      return undefined;
    }
    fs.mkdirSync(profile.configDir, { recursive: true });
    return profile.configDir;
  }

  compactPathForLog(profileOrId?: ClaudeAccountProfile | string | null): string {
    const dir = this.resolveConfigDir(profileOrId);
    if (!dir) {
      return '(default ~/.claude)';
    }
    const root = path.join(this.globalStorageUri.fsPath, 'claude-profiles');
    const relative = path.relative(root, dir);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return `<globalStorage>/claude-profiles/${relative.replace(/\\/g, '/')}`;
    }
    return dir;
  }

  private getStoredProfiles(): StoredProfile[] {
    const raw = this.globalState.get<StoredProfile[]>(STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((profile) => profile && typeof profile.id === 'string' && typeof profile.label === 'string')
      .map((profile) => ({
        ...profile,
        configDir: typeof profile.configDir === 'string' && profile.configDir.trim()
          ? profile.configDir
          : this.defaultConfigDirForId(profile.id),
        createdAt: typeof profile.createdAt === 'string' ? profile.createdAt : nowIso(),
      }));
  }

  private defaultConfigDirForId(id: string): string {
    return path.join(this.globalStorageUri.fsPath, 'claude-profiles', id);
  }
}
