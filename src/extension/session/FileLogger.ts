import * as fs from 'fs';
import * as path from 'path';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Writes log lines to a file on disk, with automatic rotation at 2MB
 * and support for renaming when the session name changes.
 *
 * File naming: <sessionName>_<dd-hh-mm>[_<rotation>].log
 */
export class FileLogger {
  private writeStream: fs.WriteStream | null = null;
  private currentFilePath = '';
  private currentFileSize = 0;
  private sessionName: string;
  private disposed = false;
  /** Timestamp captured at file creation, used in file name */
  private fileTimestamp: string;

  constructor(
    private readonly logDir: string,
    initialSessionName: string
  ) {
    this.sessionName = this.sanitizeFileName(initialSessionName);
    fs.mkdirSync(this.logDir, { recursive: true });
    this.fileTimestamp = FileLogger.buildTimestamp();
    this.openNewFile();
  }

  /** Write a pre-formatted log line to the file */
  write(line: string): void {
    if (this.disposed || !this.writeStream) {
      return;
    }
    const data = line + '\n';
    const byteLength = Buffer.byteLength(data, 'utf-8');
    this.writeStream.write(data);
    this.currentFileSize += byteLength;

    if (this.currentFileSize >= MAX_FILE_SIZE) {
      this.rotate();
    }
  }

  /** Update the session name and rename the current log file on disk */
  updateSessionName(newName: string): void {
    if (this.disposed) {
      return;
    }
    const oldPath = this.currentFilePath;
    this.sessionName = this.sanitizeFileName(newName);

    const newFileName = `${this.sessionName}_${this.fileTimestamp}.log`;
    const newPath = path.join(this.logDir, newFileName);

    // Close current stream before renaming
    this.closeStream();

    try {
      if (fs.existsSync(oldPath) && oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }
    } catch {
      // If rename fails (e.g. file locked), the old file stays; new writes go to the new path
    }

    this.currentFilePath = newPath;
    this.writeStream = fs.createWriteStream(this.currentFilePath, {
      flags: 'a',
      encoding: 'utf-8',
    });
  }

  /** Close current file and open a fresh one (2MB rotation) */
  private rotate(): void {
    if (this.disposed) {
      return;
    }
    this.closeStream();
    // New timestamp for the rotated file
    this.fileTimestamp = FileLogger.buildTimestamp();
    this.openNewFile();
  }

  /** Clean up resources */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.closeStream();
  }

  /** Current log file path (for diagnostics) */
  get filePath(): string {
    return this.currentFilePath;
  }

  // --- Private helpers ---

  private openNewFile(): void {
    const fileName = `${this.sessionName}_${this.fileTimestamp}.log`;
    this.currentFilePath = path.join(this.logDir, fileName);
    this.currentFileSize = 0;

    // If the file already exists, account for its size so the 2MB check is accurate
    try {
      if (fs.existsSync(this.currentFilePath)) {
        this.currentFileSize = fs.statSync(this.currentFilePath).size;
      }
    } catch {
      // Ignore stat errors
    }

    this.writeStream = fs.createWriteStream(this.currentFilePath, {
      flags: 'a',
      encoding: 'utf-8',
    });
  }

  /** Build dd-hh-mm timestamp from current time */
  private static buildTimestamp(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${dd}-${hh}-${mm}`;
  }

  /** Remove characters unsafe for file names, keep Hebrew intact */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  private closeStream(): void {
    if (this.writeStream) {
      try {
        this.writeStream.end();
      } catch {
        // Ignore close errors
      }
      this.writeStream = null;
    }
  }
}
