import { AuditEvent } from '../secret-protection/types';
import { AuditEventFilter, AuditStore } from './AuditStore';

export type { AuditEventFilter };

export class AuditEventWriter {
  async writeEvent(event: AuditEvent, storeDir: string): Promise<void> {
    await new AuditStore(storeDir).append(event);
  }

  async readEvents(
    storeDir: string,
    filter?: AuditEventFilter,
    limit?: number,
  ): Promise<AuditEvent[]> {
    return new AuditStore(storeDir).read(filter, limit);
  }

  async pruneOldEvents(storeDir: string, retentionDays: number): Promise<number> {
    return new AuditStore(storeDir).prune(retentionDays);
  }
}
