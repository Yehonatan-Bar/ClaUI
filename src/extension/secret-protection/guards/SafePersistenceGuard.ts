import { SecretProtectionBroker } from '../SecretProtectionBroker';
import { DlpDecision } from '../../../shared/secret-protection/types';

export interface PersistenceGuardResult {
  safe: boolean;
  content: string;
  decision: DlpDecision;
}

export class SafePersistenceGuard {
  constructor(private readonly broker: SecretProtectionBroker) {}

  async guardWrite(key: string, value: string): Promise<PersistenceGuardResult> {
    const decision = await this.broker.scanPersistence(key, value);

    if (decision.action === 'block') {
      return { safe: false, content: '', decision };
    }

    if (decision.action === 'redact' && decision.redactedContent !== undefined) {
      return { safe: true, content: decision.redactedContent, decision };
    }

    return { safe: true, content: value, decision };
  }
}
