import * as vscode from 'vscode';
import * as path from 'path';
import { SecretProtectionBroker } from './SecretProtectionBroker';
import { SafePersistenceGuard } from './guards/SafePersistenceGuard';
import {
  getSecretProtectionSettings,
  onSecretProtectionSettingsChanged,
  SecretProtectionSettings,
} from './SecretProtectionSettings';
import { loadPolicy } from '../../shared/secret-protection/policySchema';
import { AuditEvent, DlpException } from '../../shared/secret-protection/types';
import { AuditEventFilter, AuditStore } from '../../shared/audit/AuditStore';
import { ComplianceReport, ComplianceReporter } from '../../shared/audit/ComplianceReporter';
import { ExceptionStore } from '../../server/enforcement/ExceptionStore';

export class SecretProtectionService implements vscode.Disposable {
  private broker: SecretProtectionBroker | null = null;
  private persistenceGuard: SafePersistenceGuard | null = null;
  private exceptionStore: ExceptionStore | null = null;
  private settings: SecretProtectionSettings;
  private auditStoreDir: string;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly log: (msg: string) => void;
  private readonly changeListeners: Array<(service: SecretProtectionService) => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    logger?: (msg: string) => void,
  ) {
    this.log = logger ?? (() => {});
    this.settings = getSecretProtectionSettings();
    this.auditStoreDir = path.join(
      this.context.globalStorageUri.fsPath, 'secret-protection',
    );
  }

  async initialize(): Promise<void> {
    // Always register the settings watcher so enabling at runtime works
    // without a reload (secretProtection.enabled defaults to false).
    this.disposables.push(
      onSecretProtectionSettingsChanged((newSettings) => {
        const wasEnabled = this.settings.enabled;
        this.settings = newSettings;
        if (newSettings.enabled) {
          this.createBroker();
          this.log(
            wasEnabled
              ? '[SecretProtection] Reconfigured after settings change'
              : '[SecretProtection] Enabled at runtime',
          );
        } else {
          this.broker = null;
          this.persistenceGuard = null;
          this.log('[SecretProtection] Disabled after settings change');
        }
        for (const listener of this.changeListeners) {
          try { listener(this); } catch { /* skip */ }
        }
      }),
    );

    if (!this.settings.enabled) {
      this.log('[SecretProtection] Disabled by settings (will activate on setting change)');
      return;
    }

    this.createBroker();
    this.log(`[SecretProtection] Initialized (mode=${this.settings.mode})`);
  }

  isEnabled(): boolean {
    return this.settings.enabled && this.broker !== null;
  }

  getBroker(): SecretProtectionBroker | null {
    return this.broker;
  }

  getPersistenceGuard(): SafePersistenceGuard | null {
    return this.persistenceGuard;
  }

  getSettings(): SecretProtectionSettings {
    return this.settings;
  }

  getAuditStoreDir(): string {
    return this.auditStoreDir;
  }

  async readAuditEvents(filter?: AuditEventFilter, limit = 100): Promise<AuditEvent[]> {
    return new AuditStore(this.auditStoreDir).read(filter, limit);
  }

  async getComplianceReport(filter?: AuditEventFilter): Promise<ComplianceReport> {
    return new ComplianceReporter(new AuditStore(this.auditStoreDir)).generate(filter);
  }

  async updateSetting<K extends keyof SecretProtectionSettings>(
    key: K,
    value: SecretProtectionSettings[K],
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration('claudeMirror.secretProtection')
      .update(String(key), value, vscode.ConfigurationTarget.Global);
  }

  onDidChangeSettings(listener: (service: SecretProtectionService) => void): void {
    this.changeListeners.push(listener);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.broker = null;
    this.persistenceGuard = null;
  }

  async addException(exception: DlpException): Promise<void> {
    if (this.broker) {
      this.broker.addException(exception);
    }
    if (this.exceptionStore) {
      await this.exceptionStore.add(exception);
    }
  }

  async consumeException(exceptionId: string): Promise<DlpException | null> {
    if (!this.exceptionStore) return null;
    return this.exceptionStore.consume(exceptionId);
  }

  getExceptionStorePath(): string {
    return path.join(this.auditStoreDir, 'exceptions.json');
  }

  private createBroker(): void {
    try {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const { config: policyConfig, source, warnings } = loadPolicy(workspacePath);

      for (const w of warnings) {
        this.log(`[SecretProtection] Policy warning: ${w}`);
      }
      this.log(`[SecretProtection] Policy loaded from ${source}`);

      this.broker = new SecretProtectionBroker(
        this.settings, policyConfig, this.auditStoreDir,
      );
      this.persistenceGuard = new SafePersistenceGuard(this.broker);

      this.exceptionStore = new ExceptionStore(this.getExceptionStorePath());
      this.broker.setOnExceptionConsumed((exceptionId) => {
        void this.exceptionStore?.consume(exceptionId).catch(() => {});
      });
      void this.exceptionStore.listActive().then((active) => {
        for (const ex of active) {
          this.broker?.addException(ex);
        }
        if (active.length > 0) {
          this.log(`[SecretProtection] Loaded ${active.length} active exception(s) from store`);
        }
      }).catch((err) => this.log(`[SecretProtection] Exception store load failed: ${err instanceof Error ? err.message : String(err)}`));

      void this.exceptionStore.prune().catch(() => {});

      void new AuditStore(this.auditStoreDir)
        .prune(this.settings.auditRetentionDays)
        .catch((err) => this.log(`[SecretProtection] Audit retention cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
    } catch (err) {
      this.log(
        `[SecretProtection] Broker creation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.broker = null;
      this.persistenceGuard = null;
      this.exceptionStore = null;
    }
  }
}
