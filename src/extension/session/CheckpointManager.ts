import * as fs from 'fs';
import * as path from 'path';
import type { CheckpointFileEntry, CheckpointState, CheckpointSummary } from '../types/webview-messages';

/**
 * A checkpoint capturing all file changes made during a single turn.
 * Stored only on the extension side (file contents are never sent to the webview).
 */
export interface Checkpoint {
  turnIndex: number;
  messageId: string;
  timestamp: number;
  files: CheckpointFileEntry[];
}

/**
 * Manages per-session file change checkpoints for revert/redo.
 *
 * Lifecycle:
 * - captureBeforeContent() is called at blockStop for each code-write tool
 *   (Write, Edit, MultiEdit, NotebookEdit). blockStop fires BEFORE the tool
 *   executes, so the file content read at this point is the "before" state.
 * - finalizeTurn() is called at handleResultEvent (turn completion). It reads
 *   the current file content ("after") and creates a Checkpoint.
 * - revert() / redo() restore file contents from stored snapshots.
 *
 * Each SessionTab has its own CheckpointManager, ensuring session isolation.
 */
export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  /** Keyed by absolute file path -- first capture per turn wins (state before first edit). */
  private pendingFilesBefore: Map<string, { content: string | null; toolName: string }> = new Map();
  private revertedToIndex: number | null = null;
  private workspaceRoot: string = '';

  /** Skip files larger than 1MB to avoid excessive memory usage. */
  static readonly MAX_FILE_SIZE = 1 * 1024 * 1024;

  constructor(private log: (msg: string) => void) {}

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /**
   * Called at blockStop for each code-write tool.
   * Reads file BEFORE the tool executes (blockStop fires before execution).
   * Dedupes by filePath -- first capture wins (we want the state before the
   * first edit in this turn).
   */
  captureBeforeContent(filePath: string, toolName: string): void {
    const absolute = this.resolveAbsolute(filePath);
    if (this.pendingFilesBefore.has(absolute)) {
      return; // already captured for this turn
    }

    try {
      const stats = fs.statSync(absolute);
      if (stats.size > CheckpointManager.MAX_FILE_SIZE) {
        this.log(`[CHECKPOINT] Skipping large file (${(stats.size / 1024).toFixed(0)}KB): ${absolute}`);
        return;
      }
      // Check if binary by reading a small sample
      const sample = Buffer.alloc(512);
      const fd = fs.openSync(absolute, 'r');
      const bytesRead = fs.readSync(fd, sample, 0, 512, 0);
      fs.closeSync(fd);
      if (this.isBinaryBuffer(sample.subarray(0, bytesRead))) {
        this.log(`[CHECKPOINT] Skipping binary file: ${absolute}`);
        return;
      }
      const content = fs.readFileSync(absolute, 'utf8');
      this.pendingFilesBefore.set(absolute, { content, toolName });
      this.log(`[CHECKPOINT] Captured before-content for ${filePath} (${content.length} chars)`);
    } catch {
      // File does not exist yet -- the tool is creating a new file
      this.pendingFilesBefore.set(absolute, { content: null, toolName });
      this.log(`[CHECKPOINT] File does not exist yet (new file): ${filePath}`);
    }
  }

  /**
   * Called at handleResultEvent (turn completion).
   * Reads "after" content for all captured files and creates a Checkpoint.
   * If revertedToIndex is set, discards future checkpoints (redo branch lost).
   */
  finalizeTurn(turnIndex: number, messageId: string): void {
    if (this.pendingFilesBefore.size === 0) {
      return; // discussion-only turn, no checkpoint needed
    }

    // If we were in a reverted state and the user did new work,
    // discard the redo branch (checkpoints after revertedToIndex)
    if (this.revertedToIndex !== null) {
      this.checkpoints = this.checkpoints.filter(cp => cp.turnIndex < this.revertedToIndex!);
      this.log(`[CHECKPOINT] Discarded redo branch (checkpoints after turnIndex=${this.revertedToIndex})`);
      this.revertedToIndex = null;
    }

    const files: CheckpointFileEntry[] = [];
    for (const [absolute, { content: before, toolName }] of this.pendingFilesBefore) {
      let after: string | null;
      try {
        after = fs.readFileSync(absolute, 'utf8');
      } catch {
        // File was deleted during the turn (unlikely but possible)
        after = null;
      }

      // Only record if content actually changed
      if (before !== after) {
        files.push({
          filePath: absolute,
          before,
          after,
          toolName,
        });
      }
    }

    this.pendingFilesBefore.clear();

    if (files.length === 0) {
      this.log(`[CHECKPOINT] No actual file changes in turn ${turnIndex}, skipping checkpoint`);
      return;
    }

    const checkpoint: Checkpoint = {
      turnIndex,
      messageId,
      timestamp: Date.now(),
      files,
    };
    this.checkpoints.push(checkpoint);
    this.log(`[CHECKPOINT] Created checkpoint for turn ${turnIndex}: ${files.length} file(s) changed [${files.map(f => path.basename(f.filePath)).join(', ')}]`);
  }

  /**
   * Revert all file changes from turnIndex through the latest checkpoint.
   * For each file, restores the "before" content from the earliest checkpoint
   * in the range that touched that file.
   */
  revert(turnIndex: number): { success: boolean; conflicts: string[]; error?: string } {
    const targetCheckpoints = this.checkpoints.filter(cp => cp.turnIndex >= turnIndex);
    if (targetCheckpoints.length === 0) {
      return { success: false, conflicts: [], error: `No checkpoints found for turnIndex >= ${turnIndex}` };
    }

    // Build map: filePath -> earliest "before" content in range
    // We need the state BEFORE the first modification in the revert range
    const fileRestoreMap = new Map<string, { before: string | null; expectedAfter: string | null }>();
    for (const cp of targetCheckpoints) {
      for (const file of cp.files) {
        if (!fileRestoreMap.has(file.filePath)) {
          // First (earliest) checkpoint in range that touches this file
          fileRestoreMap.set(file.filePath, { before: file.before, expectedAfter: file.after });
        } else {
          // Update expectedAfter to the latest value (for conflict detection)
          const existing = fileRestoreMap.get(file.filePath)!;
          existing.expectedAfter = file.after;
        }
      }
    }

    const conflicts: string[] = [];
    let filesReverted = 0;

    for (const [filePath, { before, expectedAfter }] of fileRestoreMap) {
      // Conflict detection: check if current disk content matches expected "after"
      let currentContent: string | null;
      try {
        currentContent = fs.readFileSync(filePath, 'utf8');
      } catch {
        currentContent = null; // file doesn't exist
      }

      if (expectedAfter !== null && currentContent !== null && currentContent !== expectedAfter) {
        conflicts.push(filePath);
        this.log(`[CHECKPOINT] Conflict detected for ${filePath}: file was modified externally`);
        continue; // skip conflicting files
      }
      if (expectedAfter === null && currentContent !== null) {
        // File should have been deleted but exists -- external modification
        conflicts.push(filePath);
        this.log(`[CHECKPOINT] Conflict detected for ${filePath}: file should not exist but does`);
        continue;
      }

      // Restore the "before" state
      try {
        if (before === null) {
          // File was newly created -- delete it
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.log(`[CHECKPOINT] Deleted newly created file: ${filePath}`);
          }
        } else {
          // Ensure directory exists (in case it was removed)
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, before, 'utf8');
          this.log(`[CHECKPOINT] Restored file: ${filePath}`);
        }
        filesReverted++;
      } catch (err) {
        this.log(`[CHECKPOINT] Error restoring ${filePath}: ${err}`);
        conflicts.push(filePath);
      }
    }

    this.revertedToIndex = turnIndex;
    this.log(`[CHECKPOINT] Reverted ${filesReverted} file(s) to before turn ${turnIndex}. Conflicts: ${conflicts.length}`);

    return { success: true, conflicts };
  }

  /**
   * Redo: re-apply changes from current revertedToIndex through targetTurnIndex.
   * For each file, restores the "after" content from the latest checkpoint
   * in the range that touched that file.
   */
  redo(targetTurnIndex: number): { success: boolean; conflicts: string[]; error?: string } {
    if (this.revertedToIndex === null) {
      return { success: false, conflicts: [], error: 'No revert to redo from' };
    }

    const targetCheckpoints = this.checkpoints.filter(
      cp => cp.turnIndex >= this.revertedToIndex! && cp.turnIndex <= targetTurnIndex
    );
    if (targetCheckpoints.length === 0) {
      return { success: false, conflicts: [], error: `No checkpoints found in range [${this.revertedToIndex}, ${targetTurnIndex}]` };
    }

    // Build map: filePath -> latest "after" content in range
    const fileRestoreMap = new Map<string, { after: string | null; expectedBefore: string | null }>();
    for (const cp of targetCheckpoints) {
      for (const file of cp.files) {
        // Keep updating -- we want the latest "after" in the range
        fileRestoreMap.set(file.filePath, {
          after: file.after,
          expectedBefore: fileRestoreMap.has(file.filePath)
            ? fileRestoreMap.get(file.filePath)!.expectedBefore
            : file.before,
        });
      }
    }

    const conflicts: string[] = [];
    let filesRedone = 0;

    for (const [filePath, { after, expectedBefore }] of fileRestoreMap) {
      // Conflict detection
      let currentContent: string | null;
      try {
        currentContent = fs.readFileSync(filePath, 'utf8');
      } catch {
        currentContent = null;
      }

      if (expectedBefore !== null && currentContent !== null && currentContent !== expectedBefore) {
        conflicts.push(filePath);
        this.log(`[CHECKPOINT] Redo conflict for ${filePath}: current content doesn't match expected before state`);
        continue;
      }

      // Apply the "after" state
      try {
        if (after === null) {
          // File should be deleted
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.log(`[CHECKPOINT] Redo: deleted file: ${filePath}`);
          }
        } else {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, after, 'utf8');
          this.log(`[CHECKPOINT] Redo: restored file: ${filePath}`);
        }
        filesRedone++;
      } catch (err) {
        this.log(`[CHECKPOINT] Redo error for ${filePath}: ${err}`);
        conflicts.push(filePath);
      }
    }

    // Find the max turn index in the range we just redid
    const maxRedone = Math.max(...targetCheckpoints.map(cp => cp.turnIndex));
    const maxCheckpointTurn = Math.max(...this.checkpoints.map(cp => cp.turnIndex));

    if (maxRedone >= maxCheckpointTurn) {
      // Fully redone
      this.revertedToIndex = null;
      this.log(`[CHECKPOINT] Fully redone, revertedToIndex cleared`);
    } else {
      this.revertedToIndex = maxRedone + 1;
      this.log(`[CHECKPOINT] Partial redo, revertedToIndex now ${this.revertedToIndex}`);
    }

    return { success: true, conflicts };
  }

  /** Lightweight state for the webview (no file contents). */
  getState(): CheckpointState {
    const checkpoints: CheckpointSummary[] = this.checkpoints.map(cp => ({
      turnIndex: cp.turnIndex,
      messageId: cp.messageId,
      timestamp: cp.timestamp,
      fileCount: cp.files.length,
      filePaths: cp.files.map(f => f.filePath),
    }));

    return {
      checkpoints,
      revertedToIndex: this.revertedToIndex,
    };
  }

  /** Reset all checkpoints (on session clear/restart). */
  reset(): void {
    this.checkpoints = [];
    this.pendingFilesBefore.clear();
    this.revertedToIndex = null;
    this.log('[CHECKPOINT] Reset all checkpoints');
  }

  /** Discard pending captures without creating a checkpoint. */
  discardPending(): void {
    if (this.pendingFilesBefore.size > 0) {
      this.log(`[CHECKPOINT] Discarded ${this.pendingFilesBefore.size} pending captures`);
      this.pendingFilesBefore.clear();
    }
  }

  /** Resolve a file path to an absolute path using the workspace root. */
  private resolveAbsolute(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspaceRoot, filePath);
  }

  /** Heuristic check for binary content in a buffer sample. */
  private isBinaryBuffer(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];
      // NULL bytes are a strong indicator of binary content
      if (byte === 0) return true;
    }
    return false;
  }
}
