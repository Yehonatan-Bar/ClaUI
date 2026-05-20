import * as fs from 'fs';
import * as path from 'path';
import type { DlpException } from '../../shared/secret-protection/types';

export class ExceptionStore {
  constructor(private readonly filePath: string) {}

  async listActive(now = new Date()): Promise<DlpException[]> {
    const exceptions = await this.readAll();
    return exceptions.filter((exception) =>
      new Date(exception.expiresAt) > now &&
      exception.usedCount < exception.maxUses
    );
  }

  async add(exception: DlpException): Promise<void> {
    const exceptions = await this.readAll();
    exceptions.push(exception);
    await this.writeAll(exceptions);
  }

  async consume(exceptionId: string): Promise<DlpException | null> {
    const exceptions = await this.readAll();
    const index = exceptions.findIndex((exception) => exception.id === exceptionId);
    if (index < 0) return null;

    const updated = {
      ...exceptions[index],
      usedCount: exceptions[index].usedCount + 1,
    };
    exceptions[index] = updated;
    await this.writeAll(exceptions);
    return updated;
  }

  async prune(now = new Date()): Promise<number> {
    const exceptions = await this.readAll();
    const active = exceptions.filter((exception) =>
      new Date(exception.expiresAt) > now &&
      exception.usedCount < exception.maxUses
    );
    await this.writeAll(active);
    return exceptions.length - active.length;
  }

  private async readAll(): Promise<DlpException[]> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isDlpException) : [];
    } catch {
      return [];
    }
  }

  private async writeAll(exceptions: DlpException[]): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(
      this.filePath,
      JSON.stringify(exceptions, null, 2),
      'utf-8',
    );
  }
}

function isDlpException(value: unknown): value is DlpException {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Partial<DlpException>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.expiresAt === 'string' &&
    typeof obj.ruleId === 'string' &&
    typeof obj.maxUses === 'number' &&
    typeof obj.usedCount === 'number' &&
    !!obj.destination
  );
}
