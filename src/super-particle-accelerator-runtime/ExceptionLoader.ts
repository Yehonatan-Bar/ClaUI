import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorException } from '../shared/super-particle-accelerator/types';

export class ExceptionLoader {
  private filePath: string;

  constructor(storeDir: string) {
    this.filePath = path.join(storeDir, 'exceptions.json');
  }

  loadActive(now = new Date().toISOString()): SuperParticleAcceleratorException[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const all: SuperParticleAcceleratorException[] = JSON.parse(raw);
      return all.filter(ex => ex.expiresAt > now && ex.usedCount < ex.maxUses);
    } catch {
      return [];
    }
  }

  consumeMany(exceptionIds: string[]): void {
    if (exceptionIds.length === 0) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const all: SuperParticleAcceleratorException[] = JSON.parse(raw);
      const idSet = new Set(exceptionIds);
      for (const ex of all) {
        if (idSet.has(ex.id)) ex.usedCount++;
      }
      const dir = path.dirname(this.filePath);
      const tmpPath = path.join(dir, `.exceptions.tmp.${process.pid}`);
      fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Best-effort: if consumption fails, the exception may be used beyond maxUses
    }
  }
}
