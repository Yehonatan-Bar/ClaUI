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
const GIST_README_FILENAME = 'README.md';
const FRIEND_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const STATE_KEY_GIST_ID = 'claui.githubSync.gistId';
const STATE_KEY_FRIENDS = 'claui.githubSync.friends';
const STATE_KEY_FRIEND_CACHE = 'claui.githubSync.friendCache';
const STATE_KEY_LAST_SYNCED = 'claui.githubSync.lastSyncedAt';
const SECRET_KEY_GITHUB_TOKEN = 'claui.githubSync.token';
const SECRET_KEY_PAT_LEGACY = 'claui.githubSync.pat';
const GITHUB_DEVICE_FLOW_SCOPE = 'gist';

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface GitHubDeviceTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

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
    private readonly secrets: vscode.SecretStorage,
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
    const oauthClientId = this.getGitHubOAuthClientId();
    if (oauthClientId) {
      return this.connectWithDeviceFlow(oauthClientId);
    }
    return this.connectWithPatFallback();
  }

  private async connectWithDeviceFlow(clientId: string): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      const deviceCode = await this.requestDeviceCode(clientId);
      const verificationUrl = deviceCode.verification_uri_complete || deviceCode.verification_uri;

      try {
        await vscode.env.clipboard.writeText(deviceCode.user_code);
      } catch {
        // Best-effort clipboard copy only.
      }

      await vscode.env.openExternal(vscode.Uri.parse(verificationUrl));

      void vscode.window.showInformationMessage(
        `GitHub sign-in started. Enter code ${deviceCode.user_code} (copied to clipboard) and approve gist access.`,
        'Copy Code',
        'Open GitHub'
      ).then(async (choice) => {
        if (choice === 'Copy Code') {
          try {
            await vscode.env.clipboard.writeText(deviceCode.user_code);
          } catch {
            // Ignore clipboard failures.
          }
        } else if (choice === 'Open GitHub') {
          await vscode.env.openExternal(vscode.Uri.parse(verificationUrl));
        }
      });

      const accessToken = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Connecting GitHub',
          cancellable: true,
        },
        async (progress, cancelToken) => {
          progress.report({ message: `Approve in GitHub using code ${deviceCode.user_code}` });
          return this.pollForDeviceToken(clientId, deviceCode, progress, cancelToken);
        }
      );

      if (!accessToken) {
        return { success: false, error: 'GitHub sign-in was cancelled' };
      }

      return this.completeTokenConnect(accessToken, 'GitHub OAuth');
    } catch (err: unknown) {
      this.token = '';
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitHubSync] Device flow connect error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  private async connectWithPatFallback(): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      // Prompt user for a Personal Access Token (minimal permissions: gist scope only)
      const pat = await vscode.window.showInputBox({
        title: 'Connect GitHub (PAT fallback)',
        prompt: 'Paste a GitHub PAT with "gist" scope. Tip: configure claudeMirror.achievements.githubOAuthClientId for browser sign-in.',
        password: true,
        placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim()) return 'Token cannot be empty';
          if (!value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
            return 'Token should start with ghp_ (classic) or github_pat_ (fine-grained)';
          }
          return null;
        },
      });

      if (!pat) {
        return { success: false, error: 'PAT entry was cancelled' };
      }

      const trimmedPat = pat.trim();
      return this.completeTokenConnect(trimmedPat, 'GitHub PAT');
    } catch (err: unknown) {
      this.token = '';
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
    await this.secrets.delete(SECRET_KEY_GITHUB_TOKEN);
    await this.secrets.delete(SECRET_KEY_PAT_LEGACY);
    await this.globalState.update(STATE_KEY_GIST_ID, '');
    await this.globalState.update(STATE_KEY_LAST_SYNCED, '');
    this.log('[GitHubSync] Disconnected');
  }

  isConnected(): boolean {
    return !!this.token && !!this.username;
  }

  /** Restore connection from stored GitHub token on extension activation. Fire-and-forget. */
  async tryAutoReconnect(): Promise<void> {
    const storedToken = await this.secrets.get(SECRET_KEY_GITHUB_TOKEN);
    const legacyPat = storedToken ? '' : (await this.secrets.get(SECRET_KEY_PAT_LEGACY)) || '';
    const tokenToUse = storedToken || legacyPat;
    if (!tokenToUse) return;

    this.token = tokenToUse;

    try {
      const userRes = await this.githubApi('GET', '/user');
      if (!userRes.ok) {
        // Token revoked or expired - clear it
        this.log(`[GitHubSync] Auto-reconnect failed: API returned ${userRes.status}`);
        this.token = '';
        await this.secrets.delete(SECRET_KEY_GITHUB_TOKEN);
        await this.secrets.delete(SECRET_KEY_PAT_LEGACY);
        return;
      }
      const userData = await userRes.json();
      this.username = userData.login;
      this.displayName = userData.name || userData.login;
      this.avatarUrl = userData.avatar_url || '';
      if (!storedToken && legacyPat) {
        await this.secrets.store(SECRET_KEY_GITHUB_TOKEN, legacyPat);
      }
      this.log(`[GitHubSync] Auto-reconnected as @${this.username}`);
    } catch (err: unknown) {
      // Network error - keep the stored token (user might be offline), just clear in-memory token
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitHubSync] Auto-reconnect network error: ${msg}`);
      this.token = '';
    }
  }

  // --- Publish ---

  async publish(profile: ShareableProfile): Promise<{ success: boolean; gistUrl?: string; error?: string }> {
    if (!this.isConnected()) {
      return { success: false, error: 'Not connected to GitHub' };
    }

    const content = JSON.stringify(profile, null, 2);
    const readmeContent = this.generatePublishedGistReadme(profile);
    const gistFiles = {
      [GIST_FILENAME]: { content },
      [GIST_README_FILENAME]: { content: readmeContent },
    };

    try {
      if (this.gistId) {
        // Update existing gist
        const res = await this.githubApi('PATCH', `/gists/${this.gistId}`, {
          description: GIST_DESCRIPTION,
          files: gistFiles,
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
        files: gistFiles,
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

  private generatePublishedGistReadme(profile: ShareableProfile): string {
    const gistUrl = this.gistId ? `https://gist.github.com/${this.username}/${this.gistId}` : '';
    return [
      this.generateProfileCard(profile),
      '',
      '### Public Sync Data',
      '',
      `This profile is auto-generated by ClaUi and synced to a public GitHub Gist.`,
      '',
      `- Data file: \`${GIST_FILENAME}\``,
      gistUrl ? `- Gist: ${gistUrl}` : '- Gist: (created on first publish)',
      '',
      '> Tip: the JSON file powers ClaUi community comparison and shields.io badges.',
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

  private getGitHubOAuthClientId(): string {
    return vscode.workspace
      .getConfiguration('claudeMirror')
      .get<string>('achievements.githubOAuthClientId', '')
      .trim();
  }

  private async completeTokenConnect(
    token: string,
    sourceLabel: string
  ): Promise<{ success: boolean; username?: string; error?: string }> {
    this.token = token;

    const userRes = await this.githubApi('GET', '/user');
    if (!userRes.ok) {
      this.token = '';
      if (userRes.status === 401) {
        return { success: false, error: `Invalid ${sourceLabel} token. Check that it is active and authorized.` };
      }
      return { success: false, error: `GitHub API error: ${userRes.status}` };
    }

    const scopes = userRes.headers.get('x-oauth-scopes') || '';
    const scopeList = scopes
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (!scopeList.includes(GITHUB_DEVICE_FLOW_SCOPE)) {
      this.token = '';
      return {
        success: false,
        error: `Token is missing "${GITHUB_DEVICE_FLOW_SCOPE}" scope. Reconnect and approve gist access.`,
      };
    }

    const userData = await userRes.json();
    this.username = userData.login;
    this.displayName = userData.name || userData.login;
    this.avatarUrl = userData.avatar_url || '';

    await this.secrets.store(SECRET_KEY_GITHUB_TOKEN, token);
    await this.secrets.delete(SECRET_KEY_PAT_LEGACY);

    this.log(`[GitHubSync] Connected via ${sourceLabel} as @${this.username}`);
    return { success: true, username: this.username };
  }

  private async requestDeviceCode(clientId: string): Promise<GitHubDeviceCodeResponse> {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ClaUi-VSCode-Extension',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GITHUB_DEVICE_FLOW_SCOPE,
      }).toString(),
    });

    const payload = await res.json() as Partial<GitHubDeviceCodeResponse> & { error?: string; error_description?: string };
    if (!res.ok || !payload.device_code || !payload.user_code || !payload.verification_uri || !payload.expires_in) {
      const detail = payload.error_description || payload.error || `HTTP ${res.status}`;
      throw new Error(`Failed to start GitHub sign-in: ${detail}`);
    }

    return payload as GitHubDeviceCodeResponse;
  }

  private async pollForDeviceToken(
    clientId: string,
    deviceCode: GitHubDeviceCodeResponse,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancelToken: vscode.CancellationToken
  ): Promise<string | null> {
    let intervalMs = Math.max(1000, (deviceCode.interval || 5) * 1000);
    const deadline = Date.now() + (deviceCode.expires_in * 1000);

    while (Date.now() < deadline) {
      if (cancelToken.isCancellationRequested) {
        return null;
      }

      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ClaUi-VSCode-Extension',
        },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });

      const payload = await res.json() as GitHubDeviceTokenResponse;
      if (!res.ok) {
        const detail = payload.error_description || payload.error || `HTTP ${res.status}`;
        throw new Error(`GitHub sign-in failed: ${detail}`);
      }

      if (payload.access_token) {
        return payload.access_token;
      }

      if (payload.error === 'authorization_pending') {
        await this.sleep(intervalMs);
        continue;
      }

      if (payload.error === 'slow_down') {
        intervalMs += 5000;
        progress.report({ message: 'Waiting for approval (GitHub asked to slow polling)...' });
        await this.sleep(intervalMs);
        continue;
      }

      if (payload.error === 'access_denied') {
        throw new Error('GitHub authorization was denied');
      }

      if (payload.error === 'expired_token') {
        throw new Error('GitHub sign-in code expired. Try connecting again.');
      }

      throw new Error(payload.error_description || payload.error || 'GitHub sign-in failed');
    }

    throw new Error('GitHub sign-in timed out. Try connecting again.');
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
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
