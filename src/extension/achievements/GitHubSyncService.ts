import * as vscode from 'vscode';

// --- Shareable Profile Schema ---

export interface ShareableProfile {
  version: 1;
  username: string;
  displayName: string;
  avatarUrl: string;
  lastUpdated: string; // ISO 8601
  totalXp: number;
  level: number;
  unlockedIds: string[];
  stats: {
    sessionsCompleted: number;
    totalSessionMinutes: number;
    bugFixes: number;
    testPasses: number;
    consecutiveDays: number;
    totalEdits: number;
  };
}

export interface CommunityFriendProfile {
  username: string;
  displayName: string;
  avatarUrl: string;
  totalXp: number;
  level: number;
  unlockedIds: string[];
  stats: ShareableProfile['stats'];
  lastUpdated: string;
  fetchedAt: number; // timestamp for cache TTL
}

export interface GitHubSyncStatus {
  connected: boolean;
  username: string;
  gistId: string;
  gistUrl: string;
  lastSyncedAt: string;
  syncEnabled: boolean;
}

const GIST_DESCRIPTION = 'ClaUi Developer Achievements';
const GIST_FILENAME = 'claui-achievements.json';
const FRIEND_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const STATE_KEY_GIST_ID = 'claui.githubSync.gistId';
const STATE_KEY_FRIENDS = 'claui.githubSync.friends';
const STATE_KEY_FRIEND_CACHE = 'claui.githubSync.friendCache';
const STATE_KEY_LAST_SYNCED = 'claui.githubSync.lastSyncedAt';

export class GitHubSyncService {
  private gistId: string;
  private friends: string[];
  private friendCache: Map<string, CommunityFriendProfile>;
  private lastSyncedAt: string;
  private username = '';
  private avatarUrl = '';
  private displayName = '';
  private token = '';

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly log: (msg: string) => void
  ) {
    this.gistId = globalState.get<string>(STATE_KEY_GIST_ID, '');
    this.friends = globalState.get<string[]>(STATE_KEY_FRIENDS, []);
    this.lastSyncedAt = globalState.get<string>(STATE_KEY_LAST_SYNCED, '');

    // Restore friend cache from persisted state
    const cached = globalState.get<Record<string, CommunityFriendProfile>>(STATE_KEY_FRIEND_CACHE, {});
    this.friendCache = new Map(Object.entries(cached));
  }

  // --- Auth ---

  async connect(): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      const session = await vscode.authentication.getSession('github', ['gist'], { createIfNone: true });
      if (!session) {
        return { success: false, error: 'GitHub authentication was cancelled' };
      }
      this.token = session.accessToken;

      // Fetch user info
      const userRes = await this.githubApi('GET', '/user');
      if (!userRes.ok) {
        return { success: false, error: `GitHub API error: ${userRes.status}` };
      }
      const userData = await userRes.json();
      this.username = userData.login;
      this.displayName = userData.name || userData.login;
      this.avatarUrl = userData.avatar_url || '';

      this.log(`[GitHubSync] Connected as @${this.username}`);
      return { success: true, username: this.username };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitHubSync] Connect error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async disconnect(): Promise<void> {
    this.token = '';
    this.username = '';
    this.gistId = '';
    this.lastSyncedAt = '';
    await this.globalState.update(STATE_KEY_GIST_ID, '');
    await this.globalState.update(STATE_KEY_LAST_SYNCED, '');
    this.log('[GitHubSync] Disconnected');
  }

  isConnected(): boolean {
    return !!this.token && !!this.username;
  }

  // --- Publish ---

  async publish(profile: ShareableProfile): Promise<{ success: boolean; gistUrl?: string; error?: string }> {
    if (!this.isConnected()) {
      return { success: false, error: 'Not connected to GitHub' };
    }

    const content = JSON.stringify(profile, null, 2);

    try {
      if (this.gistId) {
        // Update existing gist
        const res = await this.githubApi('PATCH', `/gists/${this.gistId}`, {
          description: GIST_DESCRIPTION,
          files: { [GIST_FILENAME]: { content } },
        });
        if (res.ok) {
          const data = await res.json();
          this.lastSyncedAt = new Date().toISOString();
          await this.globalState.update(STATE_KEY_LAST_SYNCED, this.lastSyncedAt);
          this.log(`[GitHubSync] Updated gist ${this.gistId}`);
          return { success: true, gistUrl: data.html_url };
        }
        // If patch failed (e.g. gist deleted), fall through to create
        this.log(`[GitHubSync] Gist update failed (${res.status}), creating new one`);
        this.gistId = '';
      }

      // Create new gist
      const res = await this.githubApi('POST', '/gists', {
        description: GIST_DESCRIPTION,
        public: true,
        files: { [GIST_FILENAME]: { content } },
      });
      if (!res.ok) {
        return { success: false, error: `GitHub API error: ${res.status}` };
      }
      const data = await res.json();
      this.gistId = data.id;
      this.lastSyncedAt = new Date().toISOString();
      await this.globalState.update(STATE_KEY_GIST_ID, this.gistId);
      await this.globalState.update(STATE_KEY_LAST_SYNCED, this.lastSyncedAt);
      this.log(`[GitHubSync] Created gist ${this.gistId}`);
      return { success: true, gistUrl: data.html_url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitHubSync] Publish error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /** Auto-sync: silently publish after session end if enabled. Best-effort. */
  async syncIfNeeded(profile: ShareableProfile): Promise<void> {
    if (!this.isSyncEnabled() || !this.isConnected()) return;
    try {
      await this.publish(profile);
    } catch (err) {
      // Silent failure - auto-sync should never break the extension
      this.log(`[GitHubSync] Auto-sync failed: ${err}`);
    }
  }

  // --- Friend lookup ---

  async lookupFriend(username: string): Promise<CommunityFriendProfile | null> {
    // Check cache first
    const cached = this.friendCache.get(username);
    if (cached && Date.now() - cached.fetchedAt < FRIEND_CACHE_TTL_MS) {
      return cached;
    }

    try {
      // Search user's gists by description convention
      const res = await this.githubApi('GET', `/users/${encodeURIComponent(username)}/gists`);
      if (!res.ok) {
        this.log(`[GitHubSync] Failed to fetch gists for @${username}: ${res.status}`);
        return null;
      }
      const gists = await res.json() as Array<{ description: string; files: Record<string, { raw_url: string }> }>;
      const match = gists.find(
        (g) => g.description === GIST_DESCRIPTION && g.files[GIST_FILENAME]
      );
      if (!match) {
        this.log(`[GitHubSync] No ClaUi gist found for @${username}`);
        return null;
      }

      // Fetch the raw JSON
      const rawUrl = match.files[GIST_FILENAME].raw_url;
      const rawRes = await fetch(rawUrl);
      if (!rawRes.ok) return null;
      const data = await rawRes.json() as ShareableProfile;

      const friendProfile: CommunityFriendProfile = {
        username: data.username || username,
        displayName: data.displayName || username,
        avatarUrl: data.avatarUrl || '',
        totalXp: data.totalXp,
        level: data.level,
        unlockedIds: data.unlockedIds || [],
        stats: data.stats,
        lastUpdated: data.lastUpdated,
        fetchedAt: Date.now(),
      };

      // Cache the result
      this.friendCache.set(username, friendProfile);
      await this.persistFriendCache();

      return friendProfile;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitHubSync] Friend lookup error for @${username}: ${msg}`);
      return null;
    }
  }

  async addFriend(username: string): Promise<{ success: boolean; profile?: CommunityFriendProfile; error?: string }> {
    const normalized = username.trim().replace(/^@/, '');
    if (!normalized) {
      return { success: false, error: 'Username is empty' };
    }
    if (this.friends.includes(normalized)) {
      // Already a friend, just refresh
      const profile = await this.lookupFriend(normalized);
      return profile
        ? { success: true, profile }
        : { success: false, error: `Could not find ClaUi profile for @${normalized}` };
    }

    const profile = await this.lookupFriend(normalized);
    if (!profile) {
      return { success: false, error: `No ClaUi profile found for @${normalized}` };
    }

    this.friends.push(normalized);
    await this.globalState.update(STATE_KEY_FRIENDS, this.friends);
    this.log(`[GitHubSync] Added friend @${normalized}`);
    return { success: true, profile };
  }

  async removeFriend(username: string): Promise<void> {
    this.friends = this.friends.filter((f) => f !== username);
    this.friendCache.delete(username);
    await this.globalState.update(STATE_KEY_FRIENDS, this.friends);
    await this.persistFriendCache();
    this.log(`[GitHubSync] Removed friend @${username}`);
  }

  async refreshFriends(): Promise<CommunityFriendProfile[]> {
    // Invalidate cache to force fresh fetches
    this.friendCache.clear();
    const results: CommunityFriendProfile[] = [];
    for (const username of this.friends) {
      const profile = await this.lookupFriend(username);
      if (profile) results.push(profile);
    }
    return results;
  }

  async getCommunityFriends(): Promise<CommunityFriendProfile[]> {
    const results: CommunityFriendProfile[] = [];
    for (const username of this.friends) {
      const profile = await this.lookupFriend(username);
      if (profile) results.push(profile);
    }
    return results;
  }

  getFriendsList(): string[] {
    return [...this.friends];
  }

  // --- Badge generation ---

  getGistRawUrl(): string {
    if (!this.gistId) return '';
    return `https://gist.githubusercontent.com/${this.username}/${this.gistId}/raw/${GIST_FILENAME}`;
  }

  generateShieldsBadges(): string {
    const rawUrl = encodeURIComponent(this.getGistRawUrl());
    if (!rawUrl) return '';
    return [
      `![ClaUi Level](https://img.shields.io/badge/dynamic/json?url=${rawUrl}&query=$.level&label=ClaUi%20Level&color=blueviolet&style=for-the-badge)`,
      `![XP](https://img.shields.io/badge/dynamic/json?url=${rawUrl}&query=$.totalXp&label=XP&color=blue&style=for-the-badge)`,
      `![Achievements](https://img.shields.io/badge/dynamic/json?url=${rawUrl}&query=$.unlockedIds.length&label=Achievements&color=green&style=for-the-badge)`,
    ].join('\n');
  }

  generateProfileCard(profile: ShareableProfile): string {
    const achievementCount = profile.unlockedIds.length;
    return [
      '## ClaUi Developer Achievements',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Level | ${profile.level} |`,
      `| Total XP | ${profile.totalXp.toLocaleString()} |`,
      `| Achievements | ${achievementCount}/30 |`,
      `| Sessions | ${profile.stats.sessionsCompleted} |`,
      `| Daily Streak | ${profile.stats.consecutiveDays} |`,
      `| Bug Fixes | ${profile.stats.bugFixes} |`,
      `| Tests Passed | ${profile.stats.testPasses} |`,
      `| Total Edits | ${profile.stats.totalEdits.toLocaleString()} |`,
      '',
      '*Powered by [ClaUi](https://github.com/Yehonatan-Bar/ClaUI)*',
    ].join('\n');
  }

  // --- Status ---

  getStatus(): GitHubSyncStatus {
    return {
      connected: this.isConnected(),
      username: this.username,
      gistId: this.gistId,
      gistUrl: this.gistId ? `https://gist.github.com/${this.username}/${this.gistId}` : '',
      lastSyncedAt: this.lastSyncedAt,
      syncEnabled: this.isSyncEnabled(),
    };
  }

  getUsername(): string {
    return this.username;
  }

  getDisplayName(): string {
    return this.displayName;
  }

  getAvatarUrl(): string {
    return this.avatarUrl;
  }

  // --- Private helpers ---

  private isSyncEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('claudeMirror')
      .get<boolean>('achievements.githubSync', false);
  }

  private async githubApi(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ClaUi-VSCode-Extension',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async persistFriendCache(): Promise<void> {
    const obj: Record<string, CommunityFriendProfile> = {};
    for (const [key, val] of this.friendCache) {
      obj[key] = val;
    }
    await this.globalState.update(STATE_KEY_FRIEND_CACHE, obj);
  }
}
