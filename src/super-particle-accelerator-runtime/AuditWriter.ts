import * as fs from 'fs';
import * as path from 'path';
import { SuperParticleAcceleratorAuditEvent } from '../shared/super-particle-accelerator/types';

export class SpaAuditWriter {
  private auditDir: string;

  constructor(storeDir: string) {
    this.auditDir = path.join(storeDir, 'audit');
  }

  write(event: SuperParticleAcceleratorAuditEvent): void {
    fs.mkdirSync(this.auditDir, { recursive: true });
    const dateStr = event.timestamp.slice(0, 10);
    const filePath = path.join(this.auditDir, `${dateStr}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }
}
