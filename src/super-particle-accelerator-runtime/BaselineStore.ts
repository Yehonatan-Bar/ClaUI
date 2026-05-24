import * as fs from 'fs';
import * as path from 'path';
import { SpaBaseline, SecretFinding } from '../shared/super-particle-accelerator/types';

export class BaselineStore {
  private baselineDir: string;

  constructor(storeDir: string) {
    this.baselineDir = path.join(storeDir, 'baselines');
  }

  load(sessionId: string): SpaBaseline | null {
    const filePath = this.pathFor(sessionId);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  save(sessionId: string, findings: SecretFinding[]): void {
    fs.mkdirSync(this.baselineDir, { recursive: true });
    const baseline: SpaBaseline = {
      sessionId,
      createdAt: new Date().toISOString(),
      entries: findings.map(f => ({
        valueSha256: f.valueSha256,
        filePath: f.filePath ?? '',
      })),
    };
    const tmpPath = this.pathFor(sessionId) + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(baseline, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.pathFor(sessionId));
  }

  filterNew(sessionId: string, findings: SecretFinding[]): SecretFinding[] {
    const baseline = this.load(sessionId);
    if (!baseline) return findings;

    const baselineSet = new Set(
      baseline.entries.map(e => `${e.valueSha256}:${e.filePath}`)
    );

    return findings.filter(f =>
      !baselineSet.has(`${f.valueSha256}:${f.filePath ?? ''}`)
    );
  }

  private pathFor(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baselineDir, `${safe}.json`);
  }
}
