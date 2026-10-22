import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  ResolveDroppedFilesRequest,
  SaveDroppedFilesRequest,
  OsFileDragStartedRequest,
  ResolveOsDroppedFilesRequest,
  FilePathsPickedMessage,
  OsDroppedFilesResolvedMessage,
  DroppedOsItemMeta,
} from '../types/webview-messages';
import {
  prefetchExplorerSelection,
  takeExplorerSelectionForDrop,
  queryExplorerSelectionNow,
} from './explorerSelection';

/**
 * Files Shift+dropped onto the chat panel.
 *
 * - VS Code Explorer / editor tab drags carry paths and URIs: they are resolved
 *   to filesystem paths.
 * - OS file manager drags (Windows Explorer, Desktop) only expose names, sizes
 *   and contents to the webview. The originals are found by matching that
 *   metadata against the Explorer / Desktop selection (explorerSelection.ts).
 * - Items with no original path (Outlook attachments, browser downloads,
 *   archive members) fall back to copies saved under the temp folder.
 *
 * Paths reach the chat input through `filePathsPicked` (the "+" picker's
 * message) or `osDroppedFilesResolved`. No `vscode` import here so the logic
 * stays unit-testable (tests/unit/droppedFiles.test.ts).
 */

/** Hard cap per dropped OS file (decoded bytes); the webview enforces the same limit before reading. */
export const MAX_DROPPED_FILE_BYTES = 25 * 1024 * 1024;
/** Max OS files accepted from one drop. */
export const MAX_DROPPED_FILES_PER_DROP = 20;
/** Drop folders older than this are deleted on the next save. */
const DROPPED_FILES_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DROPPED_FILES_DIR_NAME = 'claui-dropped-files';

export interface SkippedDroppedFile {
  name: string;
  reason: string;
}

export interface SaveDroppedFilesResult {
  /** Folder the copies were written to (one fresh folder per drop) */
  dropDir: string;
  paths: string[];
  skipped: SkippedDroppedFile[];
}

/** Root folder for OS-dropped file copies (`%TEMP%\claui-dropped-files`). */
export function getDroppedFilesRoot(): string {
  return path.join(os.tmpdir(), DROPPED_FILES_DIR_NAME);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Convert one dropped resource URI to a filesystem path.
 * Supports `file:` (local, UNC) and `vscode-remote:` (remote/WSL workspaces, where the
 * extension host runs on the remote side and the URI path is the remote fs path).
 * Returns null for anything else (untitled editors, http links, settings, ...).
 */
export function droppedUriToFsPath(rawUri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUri.trim());
  } catch {
    return null;
  }
  try {
    if (parsed.protocol === 'file:') {
      return fileURLToPath(parsed);
    }
    if (parsed.protocol === 'vscode-remote:') {
      const remotePath = decodeURIComponent(parsed.pathname);
      // Windows remotes encode drive paths as "/c:/dir/file"
      if (/^\/[a-zA-Z]:\//.test(remotePath)) return remotePath.slice(1);
      return remotePath.length > 1 ? remotePath : null;
    }
  } catch {
    // Malformed / non-absolute file URL
  }
  return null;
}

/**
 * Merge the VS Code drag payloads into unique absolute paths.
 * `paths` (CodeFiles) come first because they also include folders; URIs only add
 * entries that are not already present (case-insensitive on Windows).
 */
export function resolveDroppedPaths(
  paths: unknown,
  uris: unknown,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const resolved: string[] = [];
  const seen = new Set<string>();

  const addPath = (candidate: string) => {
    // On Windows require a drive letter or UNC root: a rooted "/home/x" from a remote URI is not a local path
    const isUsableAbsolute = platform === 'win32'
      ? /^(?:[a-zA-Z]:[\\/]|\\\\[^\\])/.test(candidate)
      : pathApi.isAbsolute(candidate);
    if (!isUsableAbsolute) return;
    const normalized = pathApi.normalize(candidate);
    const dedupeKey = platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    resolved.push(normalized);
  };

  for (const candidate of asStringArray(paths)) {
    addPath(candidate.trim());
  }
  for (const rawUri of asStringArray(uris)) {
    const fsPath = droppedUriToFsPath(rawUri);
    if (fsPath) addPath(fsPath);
  }
  return resolved;
}

/** Make an OS-provided file name safe to write on Windows / macOS / Linux, keeping Unicode (Hebrew) intact. */
export function sanitizeDroppedFileName(rawName: unknown): string {
  const baseName = typeof rawName === 'string' ? rawName.split(/[\\/]/).pop() ?? '' : '';
  const cleaned = baseName
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'dropped-file';
  }
  // Windows reserved device names (CON, NUL, COM1, ...) cannot be used as file names
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned.length > 180 ? cleaned.slice(cleaned.length - 180) : cleaned;
}

/** Pick `name`, `name (2).ext`, `name (3).ext`... so two dropped files with the same name never overwrite each other. */
function pickUniqueFileName(fileName: string, usedNamesLower: Set<string>): string {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  let candidate = fileName;
  for (let counter = 2; usedNamesLower.has(candidate.toLowerCase()); counter++) {
    candidate = `${stem} (${counter})${extension}`;
  }
  usedNamesLower.add(candidate.toLowerCase());
  return candidate;
}

function createDropFolderName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Write copies of OS-dropped files into a fresh folder under `rootDir` and return their paths. */
export async function saveDroppedFiles(
  files: unknown,
  rootDir: string = getDroppedFilesRoot(),
  now: Date = new Date(),
): Promise<SaveDroppedFilesResult> {
  const dropDir = path.join(rootDir, createDropFolderName(now));
  const result: SaveDroppedFilesResult = { dropDir, paths: [], skipped: [] };
  const entries = Array.isArray(files) ? files : [];
  const usedNamesLower = new Set<string>();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as { name?: unknown; base64?: unknown } | null;
    const displayName = typeof entry?.name === 'string' && entry.name ? entry.name : `file ${index + 1}`;
    if (index >= MAX_DROPPED_FILES_PER_DROP) {
      result.skipped.push({ name: displayName, reason: `more than ${MAX_DROPPED_FILES_PER_DROP} files in one drop` });
      continue;
    }
    if (!entry || typeof entry.base64 !== 'string') {
      result.skipped.push({ name: displayName, reason: 'no file content' });
      continue;
    }
    // Reject oversized payloads before decoding them (4 base64 chars = 3 bytes)
    if (Math.floor((entry.base64.length * 3) / 4) > MAX_DROPPED_FILE_BYTES + 2) {
      result.skipped.push({ name: displayName, reason: 'larger than 25 MB' });
      continue;
    }
    const content = Buffer.from(entry.base64, 'base64');
    if (content.length > MAX_DROPPED_FILE_BYTES) {
      result.skipped.push({ name: displayName, reason: 'larger than 25 MB' });
      continue;
    }

    if (result.paths.length === 0) {
      await fs.promises.mkdir(dropDir, { recursive: true });
    }
    const targetPath = path.join(dropDir, pickUniqueFileName(sanitizeDroppedFileName(entry.name), usedNamesLower));
    await fs.promises.writeFile(targetPath, content);
    result.paths.push(targetPath);
  }

  return result;
}

/** Delete drop folders older than the retention window. Never throws. */
export async function pruneDroppedFiles(
  rootDir: string = getDroppedFilesRoot(),
  now: number = Date.now(),
  maxAgeMs: number = DROPPED_FILES_RETENTION_MS,
): Promise<number> {
  let removedCount = 0;
  let dropFolders: fs.Dirent[];
  try {
    dropFolders = await fs.promises.readdir(rootDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const dropFolder of dropFolders) {
    if (!dropFolder.isDirectory()) continue;
    const folderPath = path.join(rootDir, dropFolder.name);
    try {
      const stats = await fs.promises.stat(folderPath);
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.promises.rm(folderPath, { recursive: true, force: true });
        removedCount++;
      }
    } catch {
      // Folder in use or already gone: try again next time
    }
  }
  return removedCount;
}

export interface CandidateStat {
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

/** File.lastModified vs. the file's mtime: FAT volumes store modification times in 2 s steps. */
const MTIME_TOLERANCE_MS = 2000;
/** A stat on a disconnected network share must not stall the drop. */
const CANDIDATE_STAT_TIMEOUT_MS = 1500;

/** fs.stat with a timeout; null when the path is missing, unreadable or too slow. */
export function statCandidate(candidatePath: string): Promise<CandidateStat | null> {
  const statPromise = fs.promises
    .stat(candidatePath)
    .then((stats) => ({ isDirectory: stats.isDirectory(), size: stats.size, mtimeMs: stats.mtimeMs }))
    .catch(() => null);
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), CANDIDATE_STAT_TIMEOUT_MS));
  return Promise.race([statPromise, timeoutPromise]);
}

function normalizeDroppedItems(items: unknown): DroppedOsItemMeta[] {
  if (!Array.isArray(items)) return [];
  return items.map((rawItem) => {
    const item = (rawItem ?? {}) as Partial<DroppedOsItemMeta>;
    return {
      name: typeof item.name === 'string' ? item.name : '',
      size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : -1,
      lastModified: typeof item.lastModified === 'number' && Number.isFinite(item.lastModified) ? item.lastModified : 0,
      isDirectory: item.isDirectory === true,
    };
  });
}

/**
 * Map each dropped item to the one selected path it came from.
 * A file matches on name (case-insensitive on Windows) + exact size + mtime within
 * 2 s; a folder on name. Ambiguous or missing matches stay null (fail closed: a
 * wrong original is worse than a copy). Only the few selected paths are stat'ed.
 */
export async function matchDroppedItemsToSelection(
  items: unknown,
  selectedPaths: string[],
  statPath: (candidatePath: string) => Promise<CandidateStat | null> = statCandidate,
  platform: NodeJS.Platform = process.platform,
): Promise<Array<string | null>> {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const nameKey = (name: string) => (platform === 'win32' ? name.toLowerCase() : name);
  const droppedItems = normalizeDroppedItems(items);

  // Selected paths grouped by file name (duplicates removed)
  const candidatesByName = new Map<string, string[]>();
  const seenPaths = new Set<string>();
  for (const selectedPath of selectedPaths) {
    if (typeof selectedPath !== 'string' || !selectedPath) continue;
    const pathKey = nameKey(pathApi.normalize(selectedPath));
    if (seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    const key = nameKey(pathApi.basename(selectedPath));
    candidatesByName.set(key, [...(candidatesByName.get(key) ?? []), selectedPath]);
  }

  const statCache = new Map<string, Promise<CandidateStat | null>>();
  const cachedStat = (candidatePath: string) => {
    let pending = statCache.get(candidatePath);
    if (!pending) {
      pending = statPath(candidatePath);
      statCache.set(candidatePath, pending);
    }
    return pending;
  };

  const usedPaths = new Set<string>();
  const resolved: Array<string | null> = [];
  for (const item of droppedItems) {
    const candidates = item.name ? candidatesByName.get(nameKey(item.name)) ?? [] : [];
    const matching: string[] = [];
    for (const candidate of candidates) {
      if (usedPaths.has(candidate)) continue;
      const stats = await cachedStat(candidate);
      if (!stats || stats.isDirectory !== item.isDirectory) continue;
      if (!item.isDirectory) {
        if (stats.size !== item.size) continue;
        if (item.lastModified > 0 && Math.abs(stats.mtimeMs - item.lastModified) > MTIME_TOLERANCE_MS) continue;
      }
      matching.push(candidate);
    }
    if (matching.length === 1) {
      usedPaths.add(matching[0]);
      resolved.push(matching[0]);
    } else {
      resolved.push(null);
    }
  }
  return resolved;
}

/** Match OS-dropped items against the Explorer selection; a snapshot taken mid-drag that misses is retried once after the drop. */
async function resolveOsDroppedItems(
  request: ResolveOsDroppedFilesRequest,
  log: (line: string) => void,
): Promise<Array<string | null>> {
  const startedAt = Date.now();
  const { paths: selectionPromise, prefetched } = takeExplorerSelectionForDrop(log);
  let resolved = await matchDroppedItemsToSelection(request.items, await selectionPromise);

  if (prefetched && resolved.some((resolvedPath) => resolvedPath === null)) {
    const retryResolved = await matchDroppedItemsToSelection(request.items, await queryExplorerSelectionNow(log));
    resolved = resolved.map((resolvedPath, index) => resolvedPath ?? retryResolved[index] ?? null);
  }

  const resolvedCount = resolved.filter((resolvedPath) => resolvedPath !== null).length;
  log(`File drop: ${resolvedCount} of ${resolved.length} OS item(s) mapped to their original paths in ${Date.now() - startedAt} ms`);
  return resolved;
}

export interface FileDropRequestDeps {
  post: (message: FilePathsPickedMessage | OsDroppedFilesResolvedMessage) => void;
  log: (line: string) => void;
  warn: (text: string) => void;
}

export type FileDropRequest =
  | ResolveDroppedFilesRequest
  | SaveDroppedFilesRequest
  | OsFileDragStartedRequest
  | ResolveOsDroppedFilesRequest;

/**
 * Shared handler for the file-drop messages (Claude and Codex message handlers).
 * Paths reach the chat input via `filePathsPicked` / `osDroppedFilesResolved`.
 */
export async function processFileDropRequest(
  request: FileDropRequest,
  deps: FileDropRequestDeps,
): Promise<void> {
  if (request.type === 'osFileDragStarted') {
    prefetchExplorerSelection(deps.log);
    return;
  }

  if (request.type === 'resolveOsDroppedFiles') {
    let paths: Array<string | null>;
    try {
      paths = await resolveOsDroppedItems(request, deps.log);
    } catch (err) {
      deps.log(`File drop: resolving original paths failed: ${err instanceof Error ? err.message : String(err)}`);
      paths = Array.isArray(request.items) ? request.items.map(() => null) : [];
    }
    deps.post({ type: 'osDroppedFilesResolved', dropId: request.dropId, paths });
    return;
  }

  if (request.type === 'resolveDroppedFiles') {
    const paths = resolveDroppedPaths(request.paths, request.uris);
    deps.log(`File drop: ${paths.length} VS Code path(s) resolved`);
    if (paths.length > 0) {
      deps.post({ type: 'filePathsPicked', paths });
    } else {
      deps.warn('ClaUi: the dropped items are not files on disk, nothing was attached.');
    }
    return;
  }

  try {
    const { paths, skipped, dropDir } = await saveDroppedFiles(request.files);
    deps.log(`File drop: saved ${paths.length} OS file(s) to ${dropDir}, skipped ${skipped.length}`);
    if (paths.length > 0) {
      deps.post({ type: 'filePathsPicked', paths });
    }
    if (skipped.length > 0) {
      deps.warn(`ClaUi: not attached - ${skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log(`File drop: saving dropped files failed: ${message}`);
    deps.warn(`ClaUi: could not attach the dropped files: ${message}`);
  } finally {
    void pruneDroppedFiles();
  }
}
