import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { StreamDemux } from '../process/StreamDemux';
import type { CodexExecDemux } from '../process/CodexExecDemux';
import type { MPFileChange, MPFileChangeKind, MPFileChangeReportSource } from './MultiParticipantProtocol';

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const SNAPSHOT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '__pycache__',
  '.tox', '.mypy_cache', '.pytest_cache', 'dist', '.next',
  '.nuxt', 'coverage', '.venv', 'venv',
]);

export interface FileChangeTrackerEvents {
  fileChanges: [deliveryId: string, changes: MPFileChange[], source: MPFileChangeReportSource];
}

interface TrackedBlock {
  toolName: string;
  partialJson: string;
}

/**
 * Tracks file changes made by agents during a delivery turn.
 *
 * For Claude: intercepts toolUseStart / toolUseDelta / blockStop events from
 * StreamDemux, extracts file_path from Edit/MultiEdit/Write/NotebookEdit tools.
 *
 * For Codex (or as fallback): takes a filesystem snapshot before the turn and
 * diffs against a post-turn snapshot to detect creates/modifies/deletes.
 */
export class FileChangeTracker extends EventEmitter {
  private activeDeliveryId: string | null = null;
  private trackedBlocks = new Map<number, TrackedBlock>();
  private pendingChanges: MPFileChange[] = [];
  private snapshotBefore: Map<string, number> | null = null;
  private workspaceRoot: string | null;
  private snapshotDepth: number;
  private log: (msg: string) => void;

  constructor(workspaceRoot?: string, snapshotDepth?: number, log?: (msg: string) => void) {
    super();
    this.workspaceRoot = workspaceRoot || null;
    this.snapshotDepth = snapshotDepth ?? 2;
    this.log = log || (() => {});
  }

  // -- Turn lifecycle --

  startTurn(deliveryId: string): void {
    this.activeDeliveryId = deliveryId;
    this.trackedBlocks.clear();
    this.pendingChanges = [];
  }

  finishTurn(): MPFileChange[] {
    const changes = [...this.pendingChanges];
    const deliveryId = this.activeDeliveryId;
    this.activeDeliveryId = null;
    this.trackedBlocks.clear();
    this.pendingChanges = [];

    if (deliveryId && changes.length > 0) {
      this.emit('fileChanges', deliveryId, changes, 'tool-use' as MPFileChangeReportSource);
    }
    return changes;
  }

  // -- Claude: structured tool_use tracking (C1) --

  attachToClaudeDemux(demux: StreamDemux): void {
    demux.on('toolUseStart', (data: { messageId: string; blockIndex: number; toolName: string; toolId: string }) => {
      if (!this.activeDeliveryId) return;
      if (!WRITE_TOOLS.has(data.toolName)) return;
      this.trackedBlocks.set(data.blockIndex, { toolName: data.toolName, partialJson: '' });
    });

    demux.on('toolUseDelta', (data: { messageId: string; blockIndex: number; partialJson: string }) => {
      const block = this.trackedBlocks.get(data.blockIndex);
      if (block) {
        block.partialJson += data.partialJson;
      }
    });

    demux.on('blockStop', (data: { blockIndex: number }) => {
      const block = this.trackedBlocks.get(data.blockIndex);
      if (!block) return;
      this.trackedBlocks.delete(data.blockIndex);

      const filePath = this.extractFilePath(block.partialJson);
      if (filePath) {
        const change: MPFileChange = {
          path: filePath,
          changeKind: this.classifyToolChangeKind(block.toolName),
          toolName: block.toolName as MPFileChange['toolName'],
        };
        if (this.workspaceRoot) {
          change.absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
        }
        this.pendingChanges.push(change);
        this.log(`[FileTracker] Claude tool ${block.toolName}: ${filePath}`);
      }
    });
  }

  // -- Codex: command-based heuristic tracking --

  attachToCodexDemux(demux: CodexExecDemux): void {
    demux.on('commandExecutionComplete', (data: { id: string; command: string; exitCode: number | null }) => {
      if (!this.activeDeliveryId) return;
      if (data.exitCode !== 0 && data.exitCode !== null) return;

      const filePaths = this.extractFilePathsFromCommand(data.command);
      for (const fp of filePaths) {
        this.pendingChanges.push({
          path: fp,
          changeKind: 'modify',
        });
        this.log(`[FileTracker] Codex command file: ${fp}`);
      }
    });
  }

  // -- Snapshot-based fallback (C2) --

  async takeSnapshotBefore(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      this.snapshotBefore = await this.scanWorkspace(this.workspaceRoot, this.snapshotDepth);
      this.log(`[FileTracker] Snapshot taken: ${this.snapshotBefore.size} files`);
    } catch (err) {
      this.log(`[FileTracker] Snapshot failed: ${err}`);
      this.snapshotBefore = null;
    }
  }

  async diffSnapshot(deliveryId: string): Promise<MPFileChange[]> {
    if (!this.workspaceRoot || !this.snapshotBefore) return [];

    let after: Map<string, number>;
    try {
      after = await this.scanWorkspace(this.workspaceRoot, this.snapshotDepth);
    } catch {
      this.snapshotBefore = null;
      return [];
    }

    const changes: MPFileChange[] = [];

    for (const [filePath, mtime] of after) {
      const beforeMtime = this.snapshotBefore.get(filePath);
      if (beforeMtime === undefined) {
        changes.push({ path: filePath, changeKind: 'create' });
      } else if (mtime > beforeMtime) {
        changes.push({ path: filePath, changeKind: 'modify' });
      }
    }

    for (const [filePath] of this.snapshotBefore) {
      if (!after.has(filePath)) {
        changes.push({ path: filePath, changeKind: 'delete' });
      }
    }

    this.snapshotBefore = null;

    if (changes.length > 0) {
      this.log(`[FileTracker] Snapshot diff: ${changes.length} changes`);
      this.emit('fileChanges', deliveryId, changes, 'snapshot' as MPFileChangeReportSource);
    }

    return changes;
  }

  // -- Internals --

  private classifyToolChangeKind(toolName: string): MPFileChangeKind {
    if (toolName === 'Write') return 'create';
    return 'modify';
  }

  private extractFilePath(json: string): string | null {
    try {
      const parsed = JSON.parse(json);
      return parsed.file_path || parsed.path || null;
    } catch {
      return null;
    }
  }

  private extractFilePathsFromCommand(command: string): string[] {
    const paths: string[] = [];
    // Match common file-writing shell patterns
    const patterns = [
      /(?:>|>>)\s*["']?([^\s"'|;&]+)/g,   // redirect: > file or >> file
      /\btee\s+(?:-a\s+)?["']?([^\s"'|;&]+)/g,  // tee file
      /\bcp\s+\S+\s+["']?([^\s"'|;&]+)/g,  // cp src dest
      /\bmv\s+\S+\s+["']?([^\s"'|;&]+)/g,  // mv src dest
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(command)) !== null) {
        if (match[1] && !match[1].startsWith('/dev/')) {
          paths.push(match[1]);
        }
      }
    }
    return paths;
  }

  private async scanWorkspace(root: string, maxDepth: number): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await this.scanDir(root, root, 0, maxDepth, result);
    return result;
  }

  private async scanDir(
    baseRoot: string,
    dir: string,
    currentDepth: number,
    maxDepth: number,
    result: Map<string, number>,
  ): Promise<void> {
    if (currentDepth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SNAPSHOT_EXCLUDE_DIRS.has(entry.name)) continue;
        await this.scanDir(baseRoot, fullPath, currentDepth + 1, maxDepth, result);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          const relativePath = path.relative(baseRoot, fullPath);
          result.set(relativePath, stat.mtimeMs);
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    }
  }
}
