import * as fs from 'fs';
import * as path from 'path';
import { ParticleAcceleratorContextFile, CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION } from './ParticleAcceleratorTypes';

export class ParticleAcceleratorContextStore {
  constructor(private storeDir: string) {}

  async createContext(
    tabRuntimeId: string,
    provider: 'claude' | 'codex',
    workspacePath: string,
  ): Promise<string> {
    const contextPath = this.getContextPath(tabRuntimeId);
    await ensureDir(path.dirname(contextPath));

    const context: ParticleAcceleratorContextFile = {
      schemaVersion: CLAUI_PARTICLE_ACCELERATOR_SCHEMA_VERSION,
      tabRuntimeId,
      provider,
      workspacePath,
      sessionId: null,
      turnId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeJsonAtomic(contextPath, context);
    return contextPath;
  }

  async updateSessionId(tabRuntimeId: string, sessionId: string): Promise<void> {
    await this.updateField(tabRuntimeId, { sessionId });
  }

  async updateTurnId(tabRuntimeId: string, turnId: string): Promise<void> {
    await this.updateField(tabRuntimeId, { turnId });
  }

  async disposeContext(tabRuntimeId: string): Promise<void> {
    const contextPath = this.getContextPath(tabRuntimeId);
    try {
      await fs.promises.unlink(contextPath);
    } catch {
      // File may already be gone
    }
  }

  getContextPath(tabRuntimeId: string): string {
    return path.join(this.storeDir, 'contexts', `${tabRuntimeId}.json`);
  }

  private async updateField(tabRuntimeId: string, fields: Partial<ParticleAcceleratorContextFile>): Promise<void> {
    const contextPath = this.getContextPath(tabRuntimeId);
    try {
      const raw = await fs.promises.readFile(contextPath, 'utf8');
      const context: ParticleAcceleratorContextFile = JSON.parse(raw);
      Object.assign(context, fields, { updatedAt: new Date().toISOString() });
      await writeJsonAtomic(contextPath, context);
    } catch {
      // Context may have been disposed or corrupted; ignore
    }
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}
