import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SuperParticleAcceleratorException } from '../../shared/super-particle-accelerator/types';

export class SpaExceptionStore {
  private filePath: string;

  constructor(storeDir: string) {
    this.filePath = path.join(storeDir, 'exceptions.json');
  }

  listActive(now = new Date().toISOString()): SuperParticleAcceleratorException[] {
    return this.readAll().filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
  }

  add(input: Omit<SuperParticleAcceleratorException, 'id' | 'createdAt' | 'usedCount'>): SuperParticleAcceleratorException {
    const exception: SuperParticleAcceleratorException = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      usedCount: 0,
    };
    const all = this.readAll();
    all.push(exception);
    this.writeAllAtomic(all);
    return exception;
  }

  delete(exceptionId: string): boolean {
    const all = this.readAll();
    const idx = all.findIndex(ex => ex.id === exceptionId);
    if (idx === -1) return false;
    all.splice(idx, 1);
    this.writeAllAtomic(all);
    return true;
  }

  prune(now = new Date().toISOString()): number {
    const all = this.readAll();
    const active = all.filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
    const removed = all.length - active.length;
    if (removed > 0) this.writeAllAtomic(active);
    return removed;
  }

  private readAll(): SuperParticleAcceleratorException[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAllAtomic(exceptions: SuperParticleAcceleratorException[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.exceptions.tmp.${process.pid}`);
    fs.writeFileSync(tmpPath, JSON.stringify(exceptions, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
