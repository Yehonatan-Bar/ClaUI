import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorAuditEvent } from '../../shared/super-particle-accelerator/types';

export class SuperParticleAcceleratorAuditReader {
  private auditDir: string;

  constructor(storeDir: string) {
    this.auditDir = path.join(storeDir, 'audit');
  }

  read(limit = 100): SuperParticleAcceleratorAuditEvent[] {
    try {
      if (!fs.existsSync(this.auditDir)) return [];

      const files = fs.readdirSync(this.auditDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse();

      const events: SuperParticleAcceleratorAuditEvent[] = [];

      for (const file of files) {
        if (events.length >= limit) break;

        const content = fs.readFileSync(path.join(this.auditDir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean).reverse();

        for (const line of lines) {
          if (events.length >= limit) break;
          try {
            events.push(JSON.parse(line));
          } catch {
            // skip malformed lines
          }
        }
      }

      return events;
    } catch {
      return [];
    }
  }
}
