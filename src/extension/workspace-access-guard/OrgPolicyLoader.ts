import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  WorkspaceAccessOrgPolicy,
  WorkspaceAccessOrgPolicyStatus,
} from '../../shared/workspace-access-guard/types';
import { DEFAULT_ORG_POLICY } from '../../workspace-access-guard-runtime/defaultOrgPolicy';

export class OrgPolicyLoader implements vscode.Disposable {
  private policy: WorkspaceAccessOrgPolicy = DEFAULT_ORG_POLICY;
  private policyPath: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastModified?: string;
  private loadError?: string;
  private isFromFile = false;
  private onChangeCallback?: () => void;

  constructor(policyPath: string) {
    this.policyPath = policyPath;
    this.loadPolicy();
    this.startWatching();
  }

  getPolicy(): WorkspaceAccessOrgPolicy {
    return this.policy;
  }

  getStatus(): WorkspaceAccessOrgPolicyStatus {
    return {
      loaded: true,
      source: this.isFromFile ? 'file' : 'built-in-defaults',
      filePath: this.isFromFile ? this.policyPath : undefined,
      lastModified: this.lastModified,
      deniedRootCount: this.policy.deniedRoots.filter(r => r.enabled).length,
      policyName: this.policy.policyName,
      error: this.loadError,
    };
  }

  onChange(cb: () => void): void {
    this.onChangeCallback = cb;
  }

  reload(): void {
    this.loadPolicy();
    this.onChangeCallback?.();
  }

  private loadPolicy(): void {
    this.loadError = undefined;
    try {
      if (!fs.existsSync(this.policyPath)) {
        this.policy = DEFAULT_ORG_POLICY;
        this.isFromFile = false;
        return;
      }

      const raw = fs.readFileSync(this.policyPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.deniedRoots)) {
        this.loadError = 'Invalid schema: missing schemaVersion or deniedRoots';
        this.policy = DEFAULT_ORG_POLICY;
        this.isFromFile = false;
        return;
      }

      const stat = fs.statSync(this.policyPath);
      this.lastModified = stat.mtime.toISOString();
      this.policy = parsed as WorkspaceAccessOrgPolicy;
      this.isFromFile = true;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.isFromFile = false;
    }
  }

  private startWatching(): void {
    try {
      const dir = require('path').dirname(this.policyPath);
      if (!fs.existsSync(dir)) return;

      this.watcher = fs.watch(this.policyPath, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.loadPolicy();
          this.onChangeCallback?.();
        }, 500);
      });
      this.watcher.on('error', () => { /* ignore watcher errors */ });
    } catch { /* policy file or dir may not exist yet */ }
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
