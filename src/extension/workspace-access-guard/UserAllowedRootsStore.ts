import * as fs from 'fs';
import * as path from 'path';
import { UserAllowedRootsData } from '../../shared/workspace-access-guard/types';

export class UserAllowedRootsStore {
  private filePath: string;

  constructor(storeDir: string) {
    this.filePath = path.join(storeDir, 'user-allowed-roots.json');
  }

  getPath(): string {
    return this.filePath;
  }

  load(): string[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data: UserAllowedRootsData = JSON.parse(raw);
      if (Array.isArray(data.roots)) return data.roots;
    } catch { /* file missing or invalid */ }
    return [];
  }

  save(roots: string[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: UserAllowedRootsData = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      roots,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  addRoots(newRoots: string[]): string[] {
    const current = this.load();
    let changed = false;
    for (const root of newRoots) {
      const normalized = root.replace(/\//g, '\\').replace(/\\+$/, '');
      if (!current.some(r => r.toLowerCase() === normalized.toLowerCase())) {
        current.push(normalized);
        changed = true;
      }
    }
    if (changed) this.save(current);
    return current;
  }

  removeRoot(root: string): string[] {
    const current = this.load();
    const normalized = root.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const filtered = current.filter(r => r.toLowerCase() !== normalized);
    if (filtered.length !== current.length) {
      this.save(filtered);
    }
    return filtered;
  }
}
