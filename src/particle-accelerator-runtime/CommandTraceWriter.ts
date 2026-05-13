import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ParticleAcceleratorTrace } from '../extension/particle-accelerator/ParticleAcceleratorTypes';

export class CommandTraceWriter {
  constructor(private storeDir: string) {}

  async writeTrace(trace: ParticleAcceleratorTrace): Promise<void> {
    const dateDir = this.getDateDir('traces');
    await ensureDir(dateDir);

    const filePath = path.join(dateDir, `${trace.traceId}.json`);
    const tmpPath = filePath + '.tmp';

    const content = JSON.stringify(trace, null, 2);
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  async writeRawLog(traceId: string, stream: 'stdout' | 'stderr', content: string): Promise<void> {
    const dateDir = this.getDateDir('raw');
    await ensureDir(dateDir);

    const filePath = path.join(dateDir, `${traceId}.${stream}.log`);
    const tmpPath = filePath + '.tmp';

    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  private getDateDir(subdir: string): string {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(this.storeDir, subdir, date);
  }

  static generateTraceId(): string {
    return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}
