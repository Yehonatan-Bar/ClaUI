import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WorkspaceAccessAuditEvent } from '../shared/workspace-access-guard/types';

export class WagAuditWriter {
  private auditDir: string;

  constructor(storeDir: string) {
    this.auditDir = path.join(storeDir, 'audit');
  }

  write(event: WorkspaceAccessAuditEvent): void {
    fs.mkdirSync(this.auditDir, { recursive: true });
    const dateStr = event.timestamp.slice(0, 10);
    const filePath = path.join(this.auditDir, `${dateStr}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }
}

export function hashWorkspacePath(workspacePath: string): string {
  return crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 16);
}

export function createAuditEvent(
  params: Omit<WorkspaceAccessAuditEvent, 'id' | 'timestamp'>,
): WorkspaceAccessAuditEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...params,
  };
}
